import { createHash } from "node:crypto";
import { join } from "node:path";
import { seasonSchema } from "../lib/schemas/season";
import { type State, stateSchema } from "../lib/schemas/state";
import { extractAlignmentStoryWords } from "../lib/storyWordTokens";
import {
	type WordTimingSidecar,
	wordTimingSidecarSchema,
} from "../lib/wordTimings";
import { createStateQueue, type MutateFn } from "./state";

export type Season = ReturnType<typeof seasonSchema.parse>;
type EpisodeAudioCode = "EpisodeAudioMissing" | "EpisodeAudioStale";

export class SeasonFileNotFoundError extends Error {
	constructor(seasonSlug: string) {
		super(`Season file not found for slug: ${seasonSlug}`);
		this.name = "SeasonFileNotFoundError";
	}
}

export class EpisodeAudioError extends Error {
	status: 404 | 409;

	constructor(code: EpisodeAudioCode, status: 404 | 409) {
		super(code);
		this.name = "EpisodeAudioError";
		this.status = status;
	}
}

export interface EpisodeAudioAsset {
	audioBytes: Uint8Array;
	sidecar: WordTimingSidecar;
	contentType?: string;
}

interface StoredEpisodeAudioAsset extends EpisodeAudioAsset {
	seasonSlug: string;
	episodeIdx: number;
}

export interface R2ObjectBodyLike {
	httpMetadata?: {
		contentType?: string;
	};
	arrayBuffer(): Promise<ArrayBuffer>;
	json<T>(): Promise<T>;
}

export interface R2BucketLike {
	get(key: string): Promise<R2ObjectBodyLike | null>;
}

export interface AssetStore {
	readSeason(seasonSlug: string): Promise<Season>;
	readEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
	): Promise<EpisodeAudioAsset | null>;
}

export class InMemoryAssetStore implements AssetStore {
	#seasons: Map<string, Season>;
	#audio: Map<string, EpisodeAudioAsset>;

	constructor(input: { seasons: Season[]; audio?: StoredEpisodeAudioAsset[] }) {
		this.#seasons = new Map(
			input.seasons.map((season) => {
				const parsed = seasonSchema.parse(structuredClone(season));
				return [parsed.slug, parsed];
			}),
		);
		this.#audio = new Map(
			(input.audio ?? []).map((audio) => [
				audioKey(audio.seasonSlug, audio.episodeIdx),
				cloneAudioAsset(audio),
			]),
		);
	}

	async readSeason(seasonSlug: string): Promise<Season> {
		const season = this.#seasons.get(seasonSlug);
		if (!season) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}
		return structuredClone(season);
	}

	async readEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
	): Promise<EpisodeAudioAsset | null> {
		const audio = this.#audio.get(audioKey(seasonSlug, episodeIdx));
		if (!audio) {
			return null;
		}
		assertSidecarMatchesEpisode(
			audio.sidecar,
			seasonSlug,
			episodeIdx,
			episodeText,
			audio.audioBytes,
		);
		return cloneAudioAsset(audio);
	}
}

export class R2AssetStore implements AssetStore {
	#bucket: R2BucketLike;

	constructor(bucket: R2BucketLike) {
		this.#bucket = bucket;
	}

	async readSeason(seasonSlug: string): Promise<Season> {
		const object = await this.#bucket.get(seasonObjectKey(seasonSlug));
		if (!object) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}
		return seasonSchema.parse(await object.json());
	}

	async readEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
	): Promise<EpisodeAudioAsset | null> {
		const baseName = audioBaseName(seasonSlug, episodeIdx);
		const [audioObject, sidecarObject] = await Promise.all([
			this.#bucket.get(`audio/${baseName}.wav`),
			this.#bucket.get(`audio/${baseName}.words.json`),
		]);

		if (!audioObject || !sidecarObject) {
			return null;
		}

		try {
			const sidecar = wordTimingSidecarSchema.parse(await sidecarObject.json());
			const audioBytes = new Uint8Array(await audioObject.arrayBuffer());
			assertSidecarMatchesEpisode(
				sidecar,
				seasonSlug,
				episodeIdx,
				episodeText,
				audioBytes,
			);
			return {
				audioBytes,
				sidecar,
				contentType: audioObject.httpMetadata?.contentType,
			};
		} catch (error) {
			if (error instanceof EpisodeAudioError) {
				throw error;
			}
			throw new EpisodeAudioError("EpisodeAudioStale", 409);
		}
	}
}

export class DiskAssetStore implements AssetStore {
	#seasonsDir: string;
	#audioDir: string;

	constructor(input: { seasonsDir: string; audioDir: string }) {
		this.#seasonsDir = input.seasonsDir;
		this.#audioDir = input.audioDir;
	}

	async readSeason(seasonSlug: string): Promise<Season> {
		const seasonPath = join(this.#seasonsDir, `${seasonSlug}.json`);
		const seasonFile = Bun.file(seasonPath);
		if (!(await seasonFile.exists())) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}
		return seasonSchema.parse(await seasonFile.json());
	}

	async readEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
	): Promise<EpisodeAudioAsset | null> {
		const baseName = audioBaseName(seasonSlug, episodeIdx);
		const audioFile = Bun.file(join(this.#audioDir, `${baseName}.wav`));
		const timingsFile = Bun.file(
			join(this.#audioDir, `${baseName}.words.json`),
		);

		if (!(await audioFile.exists()) || !(await timingsFile.exists())) {
			return null;
		}

		try {
			const sidecar = wordTimingSidecarSchema.parse(await timingsFile.json());
			const audioBytes = new Uint8Array(await audioFile.arrayBuffer());
			assertSidecarMatchesEpisode(
				sidecar,
				seasonSlug,
				episodeIdx,
				episodeText,
				audioBytes,
			);
			return { audioBytes, sidecar };
		} catch (error) {
			if (error instanceof EpisodeAudioError) {
				throw error;
			}
			throw new EpisodeAudioError("EpisodeAudioStale", 409);
		}
	}
}

function audioKey(seasonSlug: string, episodeIdx: number): string {
	return `${seasonSlug}:e${episodeIdx}`;
}

function audioBaseName(seasonSlug: string, episodeIdx: number): string {
	return `${seasonSlug}-e${episodeIdx}`;
}

function seasonObjectKey(seasonSlug: string): string {
	return `seasons/${seasonSlug}.json`;
}

function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

function cloneAudioAsset(audio: EpisodeAudioAsset): EpisodeAudioAsset {
	return {
		audioBytes: new Uint8Array(audio.audioBytes),
		sidecar: wordTimingSidecarSchema.parse(structuredClone(audio.sidecar)),
		contentType: audio.contentType,
	};
}

function assertSidecarMatchesEpisode(
	sidecar: WordTimingSidecar,
	seasonSlug: string,
	episodeIdx: number,
	episodeText: string,
	audioBytes: Uint8Array,
): void {
	if (
		sidecar.seasonSlug !== seasonSlug ||
		sidecar.episodeIdx !== episodeIdx ||
		sidecar.audioHash !== sha256(audioBytes) ||
		sidecar.textHash !== sha256(episodeText)
	) {
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
	}

	const expectedWords = extractAlignmentStoryWords(episodeText);
	if (sidecar.words.length !== expectedWords.length) {
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
	}

	let previousEnd = 0;
	for (const [index, word] of sidecar.words.entries()) {
		const expected = expectedWords[index];
		if (
			!expected ||
			word.index !== expected.wordIndex ||
			word.text !== expected.text ||
			word.end < word.start ||
			word.start < previousEnd ||
			word.end > sidecar.durationSeconds
		) {
			throw new EpisodeAudioError("EpisodeAudioStale", 409);
		}
		previousEnd = word.end;
	}
}

export interface StateStore {
	readState(): Promise<State>;
	mutateState(fn: MutateFn): Promise<State>;
}

export interface DurableObjectStub {
	fetch(request: Request): Response | Promise<Response>;
}

export interface DurableObjectNamespaceBinding {
	idFromName(name: string): unknown;
	get(id: unknown): DurableObjectStub;
}

export class InMemoryStateStore implements StateStore {
	#state: State;
	#queue = Promise.resolve();

	constructor(seed: State) {
		this.#state = stateSchema.parse(structuredClone(seed));
	}

	async readState(): Promise<State> {
		return structuredClone(this.#state);
	}

	mutateState(fn: MutateFn): Promise<State> {
		const { promise, resolve, reject } = Promise.withResolvers<State>();
		this.#queue = this.#queue.then(async () => {
			try {
				const current = structuredClone(this.#state);
				const next = fn(current);
				this.#state = stateSchema.parse(structuredClone(next));
				resolve(structuredClone(this.#state));
			} catch (error) {
				reject(error);
			}
		});
		return promise;
	}
}

export class DiskStateStore implements StateStore {
	#queue: ReturnType<typeof createStateQueue>;

	constructor(statePath: string) {
		this.#queue = createStateQueue(statePath);
	}

	readState(): Promise<State> {
		return this.#queue.readState();
	}

	mutateState(fn: MutateFn): Promise<State> {
		return this.#queue.mutateState(fn);
	}
}

export interface ServerBindings {
	ASSET_STORE?: AssetStore;
	ASSETS_BUCKET?: R2BucketLike;
	APP_STATE_STORE?: StateStore;
	STATE_STORE?: DurableObjectNamespaceBinding;
}
