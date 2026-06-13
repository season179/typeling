import { createHash } from "node:crypto";
import { rename } from "node:fs/promises";
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

interface D1ResultLike<T = Record<string, unknown>> {
	results?: T[];
	meta?: {
		changes?: number;
	};
}

interface D1PreparedStatementLike {
	bind(...values: unknown[]): D1PreparedStatementLike;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
	run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
	prepare(query: string): D1PreparedStatementLike;
}

interface D1SeasonRow {
	slug: string;
	name: string;
	theme: string;
}

interface D1EpisodeRow {
	idx: number;
	text: string;
}

export interface StorySummary {
	slug: string;
	name: string;
	theme: string;
	total_episodes: number;
}

export interface StoryStore {
	listStories(): Promise<StorySummary[]>;
	readSeason(seasonSlug: string): Promise<Season>;
	writeEpisodeText(
		seasonSlug: string,
		episodeIdx: number,
		text: string,
	): Promise<Season>;
}

export class InMemoryStoryStore implements StoryStore {
	#seasons: Map<string, Season>;

	constructor(input: { seasons: Season[] }) {
		this.#seasons = new Map(
			input.seasons.map((season) => {
				const parsed = seasonSchema.parse(structuredClone(season));
				return [parsed.slug, parsed];
			}),
		);
	}

	async listStories(): Promise<StorySummary[]> {
		return [...this.#seasons.values()]
			.map((season) => storySummary(season))
			.sort(compareStorySummaries);
	}

	async readSeason(seasonSlug: string): Promise<Season> {
		const season = this.#seasons.get(seasonSlug);
		if (!season) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}
		return structuredClone(season);
	}

	async writeEpisodeText(
		seasonSlug: string,
		episodeIdx: number,
		text: string,
	): Promise<Season> {
		const season = await this.readSeason(seasonSlug);
		const episode = season.episodes[episodeIdx];
		if (!episode) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}

		const nextSeason = seasonSchema.parse({
			...season,
			episodes: season.episodes.map((current) =>
				current.idx === episodeIdx ? { ...current, text } : current,
			),
		});
		this.#seasons.set(nextSeason.slug, nextSeason);
		return structuredClone(nextSeason);
	}
}

export class DiskStoryStore implements StoryStore {
	#seasonsDir: string;

	constructor(input: { seasonsDir: string }) {
		this.#seasonsDir = input.seasonsDir;
	}

	async listStories(): Promise<StorySummary[]> {
		const stories: StorySummary[] = [];
		const glob = new Bun.Glob("*.json");
		for await (const filePath of glob.scan({
			cwd: this.#seasonsDir,
			absolute: true,
		})) {
			if (filePath.endsWith("-test.json")) {
				continue;
			}
			const season = seasonSchema.parse(await Bun.file(filePath).json());
			stories.push(storySummary(season));
		}
		return stories.sort(compareStorySummaries);
	}

	async readSeason(seasonSlug: string): Promise<Season> {
		const seasonPath = join(this.#seasonsDir, `${seasonSlug}.json`);
		const seasonFile = Bun.file(seasonPath);
		if (!(await seasonFile.exists())) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}
		return seasonSchema.parse(await seasonFile.json());
	}

	async writeEpisodeText(
		seasonSlug: string,
		episodeIdx: number,
		text: string,
	): Promise<Season> {
		const season = await this.readSeason(seasonSlug);
		const episode = season.episodes[episodeIdx];
		if (!episode) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}

		const parsed = seasonSchema.parse({
			...season,
			episodes: season.episodes.map((current) =>
				current.idx === episodeIdx ? { ...current, text } : current,
			),
		});
		const seasonPath = join(this.#seasonsDir, `${parsed.slug}.json`);
		const existing = Bun.file(seasonPath);
		await Bun.write(`${seasonPath}.bak`, existing);
		const tmpPath = `${seasonPath}.tmp`;
		await Bun.write(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`);
		await rename(tmpPath, seasonPath);
		return parsed;
	}
}

export class D1StoryStore implements StoryStore {
	#db: D1DatabaseLike;

	constructor(db: D1DatabaseLike) {
		this.#db = db;
	}

	async listStories(): Promise<StorySummary[]> {
		const stories = await this.#db
			.prepare(
				`
					SELECT seasons.slug, seasons.name, seasons.theme, COUNT(episodes.idx) AS total_episodes
					FROM seasons
					LEFT JOIN episodes ON episodes.season_slug = seasons.slug
					GROUP BY seasons.slug, seasons.name, seasons.theme
					ORDER BY seasons.name ASC, seasons.slug ASC
				`,
			)
			.all<StorySummary>();
		return stories.results ?? [];
	}

	async readSeason(seasonSlug: string): Promise<Season> {
		const season = await this.#db
			.prepare("SELECT slug, name, theme FROM seasons WHERE slug = ?")
			.bind(seasonSlug)
			.first<D1SeasonRow>();
		if (!season) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}

		const episodes = await this.#db
			.prepare(
				"SELECT idx, text FROM episodes WHERE season_slug = ? ORDER BY idx ASC",
			)
			.bind(seasonSlug)
			.all<D1EpisodeRow>();

		return seasonSchema.parse({
			slug: season.slug,
			name: season.name,
			theme: season.theme,
			episodes: (episodes.results ?? []).map((episode) => ({
				idx: episode.idx,
				text: episode.text,
			})),
		});
	}

	async writeEpisodeText(
		seasonSlug: string,
		episodeIdx: number,
		text: string,
	): Promise<Season> {
		const season = await this.readSeason(seasonSlug);
		if (!season.episodes[episodeIdx]) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}

		await this.#db
			.prepare(
				`
					UPDATE episodes
					SET text = ?, text_hash = ?, updated_at = CURRENT_TIMESTAMP
					WHERE season_slug = ? AND idx = ?
				`,
			)
			.bind(text, sha256(text), seasonSlug, episodeIdx)
			.run();

		return this.readSeason(seasonSlug);
	}
}

function storySummary(season: Season): StorySummary {
	return {
		slug: season.slug,
		name: season.name,
		theme: season.theme,
		total_episodes: season.episodes.length,
	};
}

function compareStorySummaries(a: StorySummary, b: StorySummary): number {
	return a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
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

export interface EpisodeAudioFileAsset {
	body?: ReadableStream | ArrayBuffer;
	contentLength?: number;
	contentRange?: string;
	contentType?: string;
	status: 200 | 206 | 412;
}

interface StoredEpisodeAudioAsset extends EpisodeAudioAsset {
	seasonSlug: string;
	episodeIdx: number;
}

interface R2RangeLike {
	offset?: number;
	length?: number;
	suffix?: number;
}

interface ResolvedByteRange {
	offset: number;
	length: number;
	size: number;
}

interface R2GetOptionsLike {
	onlyIf?: Headers;
	range?: Headers;
}

export interface R2ObjectBodyLike {
	httpMetadata?: {
		contentType?: string;
	};
	customMetadata?: Record<string, string>;
	body?: ReadableStream;
	range?: R2RangeLike;
	size?: number;
	arrayBuffer(): Promise<ArrayBuffer>;
	json<T>(): Promise<T>;
}

export interface R2BucketLike {
	get(
		key: string,
		options?: R2GetOptionsLike,
	): Promise<R2ObjectBodyLike | null>;
}

export interface AssetStore {
	readEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
	): Promise<EpisodeAudioAsset | null>;
	readEpisodeAudioFile(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		requestHeaders: Headers,
	): Promise<EpisodeAudioFileAsset | null>;
}

export class InMemoryAssetStore implements AssetStore {
	#audio: Map<string, EpisodeAudioAsset>;

	constructor(input: {
		audio?: StoredEpisodeAudioAsset[];
		seasons?: Season[];
	}) {
		this.#audio = new Map(
			(input.audio ?? []).map((audio) => [
				audioKey(audio.seasonSlug, audio.episodeIdx),
				cloneAudioAsset(audio),
			]),
		);
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

	async readEpisodeAudioFile(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		requestHeaders: Headers,
	): Promise<EpisodeAudioFileAsset | null> {
		const audio = await this.readEpisodeAudio(
			seasonSlug,
			episodeIdx,
			episodeText,
		);
		if (!audio) {
			return null;
		}

		return audioFileFromBytes(
			audio.audioBytes,
			audio.contentType,
			requestHeaders,
		);
	}
}

export class R2AssetStore implements AssetStore {
	#bucket: R2BucketLike;

	constructor(bucket: R2BucketLike) {
		this.#bucket = bucket;
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

	async readEpisodeAudioFile(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		requestHeaders: Headers,
	): Promise<EpisodeAudioFileAsset | null> {
		const baseName = audioBaseName(seasonSlug, episodeIdx);
		const [audioObject, sidecarObject] = await Promise.all([
			this.#bucket.get(`audio/${baseName}.wav`, {
				range: requestHeaders,
				onlyIf: requestHeaders,
			}),
			this.#bucket.get(`audio/${baseName}.words.json`),
		]);

		if (!audioObject || !sidecarObject) {
			return null;
		}

		try {
			const sidecar = wordTimingSidecarSchema.parse(await sidecarObject.json());
			assertSidecarMatchesEpisodeText(
				sidecar,
				seasonSlug,
				episodeIdx,
				episodeText,
			);
			assertR2AudioMetadataMatchesSidecar(audioObject, sidecar);
			return audioFileFromR2Object(audioObject, requestHeaders.has("range"));
		} catch (error) {
			if (error instanceof EpisodeAudioError) {
				throw error;
			}
			throw new EpisodeAudioError("EpisodeAudioStale", 409);
		}
	}
}

export class DiskAssetStore implements AssetStore {
	#audioDir: string;

	constructor(input: { audioDir: string; seasonsDir?: string }) {
		this.#audioDir = input.audioDir;
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

	async readEpisodeAudioFile(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		requestHeaders: Headers,
	): Promise<EpisodeAudioFileAsset | null> {
		const audio = await this.readEpisodeAudio(
			seasonSlug,
			episodeIdx,
			episodeText,
		);
		if (!audio) {
			return null;
		}

		return audioFileFromBytes(
			audio.audioBytes,
			audio.contentType,
			requestHeaders,
		);
	}
}

function audioKey(seasonSlug: string, episodeIdx: number): string {
	return `${seasonSlug}:e${episodeIdx}`;
}

function audioBaseName(seasonSlug: string, episodeIdx: number): string {
	return `${seasonSlug}-e${episodeIdx}`;
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

function audioFileFromBytes(
	audioBytes: Uint8Array,
	contentType?: string,
	requestHeaders?: Headers,
): EpisodeAudioFileAsset {
	const range = resolveByteRangeHeader(
		requestHeaders?.get("range") ?? null,
		audioBytes.byteLength,
	);
	if (range) {
		const body = audioBytes.slice(range.offset, range.offset + range.length);
		return {
			body: arrayBufferFromBytes(body),
			contentLength: range.length,
			contentRange: contentRangeHeader(range),
			contentType,
			status: 206,
		};
	}

	return {
		body: arrayBufferFromBytes(audioBytes),
		contentLength: audioBytes.byteLength,
		contentType,
		status: 200,
	};
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function audioFileFromR2Object(
	object: R2ObjectBodyLike,
	requestedRange: boolean,
): EpisodeAudioFileAsset {
	const contentType = object.httpMetadata?.contentType;
	if (!object.body) {
		return { contentType, status: 412 };
	}

	const range = object.range;
	if (!requestedRange || !range) {
		return {
			body: object.body,
			contentLength: object.size,
			contentType,
			status: 200,
		};
	}

	const resolvedRange = resolveR2Range(range, object.size);
	if (!resolvedRange) {
		return {
			body: object.body,
			contentType,
			status: 200,
		};
	}

	return {
		body: object.body,
		contentLength: resolvedRange.length,
		contentRange: contentRangeHeader(resolvedRange),
		contentType,
		status: 206,
	};
}

function resolveR2Range(
	range: R2RangeLike,
	size: number | undefined,
): ResolvedByteRange | undefined {
	if (size === undefined) {
		return undefined;
	}

	if (range.offset !== undefined && range.length !== undefined) {
		return { offset: range.offset, length: range.length, size };
	}
	if (range.offset !== undefined) {
		return { offset: range.offset, length: size - range.offset, size };
	}
	if (range.suffix !== undefined) {
		const length = Math.min(range.suffix, size);
		return { offset: size - length, length, size };
	}
	if (range.length !== undefined) {
		return { offset: 0, length: range.length, size };
	}

	return undefined;
}

function resolveByteRangeHeader(
	rangeHeader: string | null,
	size: number,
): ResolvedByteRange | undefined {
	if (!rangeHeader?.startsWith("bytes=") || size === 0) {
		return undefined;
	}

	const parts = rangeHeader.slice("bytes=".length).split("-");
	if (parts.length !== 2) {
		return undefined;
	}

	const startRaw = parts[0];
	const endRaw = parts[1];
	if (startRaw === undefined || endRaw === undefined) {
		return undefined;
	}

	if (startRaw === "" && endRaw === "") {
		return undefined;
	}
	if (startRaw === "") {
		return resolveSuffixByteRange(endRaw, size);
	}
	return resolveOffsetByteRange(startRaw, endRaw, size);
}

function resolveSuffixByteRange(
	suffixRaw: string,
	size: number,
): ResolvedByteRange | undefined {
	const suffixLength = parseRangeInteger(suffixRaw);
	if (suffixLength === undefined || suffixLength <= 0) {
		return undefined;
	}

	const length = Math.min(suffixLength, size);
	return { offset: size - length, length, size };
}

function resolveOffsetByteRange(
	startRaw: string,
	endRaw: string,
	size: number,
): ResolvedByteRange | undefined {
	const start = parseRangeInteger(startRaw);
	if (start === undefined || start >= size) {
		return undefined;
	}

	let end = size - 1;
	if (endRaw !== "") {
		const parsedEnd = parseRangeInteger(endRaw);
		if (parsedEnd === undefined || parsedEnd < start) {
			return undefined;
		}
		end = Math.min(parsedEnd, size - 1);
	}

	return { offset: start, length: end - start + 1, size };
}

function parseRangeInteger(value: string): number | undefined {
	if (!/^\d+$/.test(value)) {
		return undefined;
	}
	return Number.parseInt(value, 10);
}

function contentRangeHeader(range: ResolvedByteRange): string {
	const end = range.offset + range.length - 1;
	return `bytes ${range.offset}-${end}/${range.size}`;
}

function assertSidecarMatchesEpisode(
	sidecar: WordTimingSidecar,
	seasonSlug: string,
	episodeIdx: number,
	episodeText: string,
	audioBytes: Uint8Array,
): void {
	assertSidecarMatchesEpisodeText(sidecar, seasonSlug, episodeIdx, episodeText);
	if (sidecar.audioHash !== sha256(audioBytes)) {
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
	}
}

function assertSidecarMatchesEpisodeText(
	sidecar: WordTimingSidecar,
	seasonSlug: string,
	episodeIdx: number,
	episodeText: string,
): void {
	if (
		sidecar.seasonSlug !== seasonSlug ||
		sidecar.episodeIdx !== episodeIdx ||
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

function assertR2AudioMetadataMatchesSidecar(
	object: R2ObjectBodyLike,
	sidecar: WordTimingSidecar,
): void {
	const audioHash = object.customMetadata?.sha256;
	if (audioHash !== undefined && audioHash !== sidecar.audioHash) {
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
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
	STORY_DB?: D1DatabaseLike;
	STORY_STORE?: StoryStore;
	STATE_STORE?: DurableObjectNamespaceBinding;
}
