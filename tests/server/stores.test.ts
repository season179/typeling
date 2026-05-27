import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { extractAlignmentStoryWords } from "../../src/lib/storyWordTokens";
import { pcmToWavBuffer } from "../../src/lib/wav";
import { fetch } from "../../src/server/index";
import {
	InMemoryAssetStore,
	InMemoryStateStore,
} from "../../src/server/stores";

const fixtureSeason = {
	slug: "winni-s1-test",
	child_id: "winni",
	theme: "pink unicorn",
	episodes: Array.from({ length: 14 }, (_, i) => ({
		idx: i,
		text: `Episode ${i + 1} text for testing.`,
	})),
};

const fixtureState = {
	children: {
		winni: {
			name: "Winni",
			theme: "rainbow-unicorn",
			target_wpm: 15,
			active_season: "winni-s1-test",
			current_episode: 0,
			current_session_id: null,
		},
	},
	sessions: [],
};

const r2OnlySeason = {
	...fixtureSeason,
	slug: "r2-only-season",
	episodes: fixtureSeason.episodes.map((episode) => ({
		...episode,
		text: `R2 ${episode.text}`,
	})),
};

const r2OnlyState = {
	...fixtureState,
	children: {
		winni: {
			...fixtureState.children.winni,
			active_season: "r2-only-season",
			current_episode: 1,
		},
	},
};

const validSessionBody = {
	id: "test-session-1",
	child_id: "winni",
	season_slug: "winni-s1-test",
	episode_idx: 0,
	wpm: 12,
	char_count: 50,
	active_ms: 30000,
	started_at: "2026-05-10T00:00:00.000Z",
	finished_at: "2026-05-10T00:01:00.000Z",
};

const sha256 = (input: string | Uint8Array) =>
	createHash("sha256").update(input).digest("hex");

const testAudioBytes = pcmToWavBuffer(new Uint8Array(24000 * 2 * 2));

const audioForEpisode = (episodeIdx: number) => {
	const text = fixtureSeason.episodes[episodeIdx]?.text ?? "";
	const words = extractAlignmentStoryWords(text).map((word, index) => ({
		index: word.wordIndex,
		text: word.text,
		start: index * 0.2,
		end: index * 0.2 + 0.1,
	}));

	return {
		seasonSlug: fixtureSeason.slug,
		episodeIdx,
		audioBytes: testAudioBytes,
		sidecar: {
			seasonSlug: fixtureSeason.slug,
			episodeIdx,
			audioPath: `memory://${fixtureSeason.slug}-e${episodeIdx}.wav`,
			sourceTextPath: `memory://${fixtureSeason.slug}-e${episodeIdx}-source.txt`,
			rawAlignmentPath: `memory://${fixtureSeason.slug}-e${episodeIdx}.raw.txt`,
			audioHash: sha256(testAudioBytes),
			textHash: sha256(text),
			alignerModel: "test-aligner",
			durationSeconds: 2,
			generatedAt: "2026-05-20T00:00:00.000Z",
			words,
		},
	};
};

const postSession = (body: unknown, stateStore: InMemoryStateStore) =>
	fetch(
		new Request("http://127.0.0.1:3001/api/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
		{ APP_STATE_STORE: stateStore },
	);

const getSeason = (
	childId: string,
	stateStore: InMemoryStateStore,
	assetStore: InMemoryAssetStore,
) =>
	fetch(new Request(`http://127.0.0.1:3001/api/children/${childId}/season`), {
		APP_STATE_STORE: stateStore,
		ASSET_STORE: assetStore,
	});

const getEpisodeAudio = (
	childId: string,
	episodeIdx: number,
	stateStore: InMemoryStateStore,
	assetStore: InMemoryAssetStore,
) =>
	fetch(
		new Request(
			`http://127.0.0.1:3001/api/children/${childId}/episodes/${episodeIdx}/audio`,
		),
		{
			APP_STATE_STORE: stateStore,
			ASSET_STORE: assetStore,
		},
	);

const getEpisodeAudioFile = (
	childId: string,
	episodeIdx: number,
	stateStore: InMemoryStateStore,
	assetStore: InMemoryAssetStore,
) =>
	fetch(
		new Request(
			`http://127.0.0.1:3001/api/children/${childId}/episodes/${episodeIdx}/audio/file`,
		),
		{
			APP_STATE_STORE: stateStore,
			ASSET_STORE: assetStore,
		},
	);

function r2JsonObject(body: unknown) {
	return {
		async json<T>(): Promise<T> {
			return structuredClone(body) as T;
		},
		async arrayBuffer(): Promise<ArrayBuffer> {
			return new TextEncoder().encode(JSON.stringify(body)).buffer;
		},
	};
}

function r2BytesObject(body: Uint8Array, contentType = "audio/wav") {
	const bodyBuffer = body.buffer.slice(
		body.byteOffset,
		body.byteOffset + body.byteLength,
	) as ArrayBuffer;

	return {
		httpMetadata: { contentType },
		customMetadata: { sha256: sha256(body) },
		range: undefined as
			| { offset: number; length?: number }
			| { suffix: number }
			| undefined,
		size: body.byteLength,
		async json<T>(): Promise<T> {
			return JSON.parse(new TextDecoder().decode(body)) as T;
		},
		async arrayBuffer(): Promise<ArrayBuffer> {
			return bodyBuffer.slice(0);
		},
		body: new Blob([bodyBuffer]).stream(),
	};
}

type FakeR2JsonObject = ReturnType<typeof r2JsonObject>;
type FakeR2BytesObject = ReturnType<typeof r2BytesObject>;
type FakeR2Object = FakeR2JsonObject | FakeR2BytesObject;
type EpisodeAudioFixture = ReturnType<typeof audioForEpisode>;

function isFakeR2BytesObject(
	object: FakeR2Object,
): object is FakeR2BytesObject {
	return "body" in object;
}

function unlockedEpisodeStateStore(): InMemoryStateStore {
	return new InMemoryStateStore({
		...fixtureState,
		children: {
			winni: {
				...fixtureState.children.winni,
				current_episode: 2,
			},
		},
	});
}

function fakeR2AudioBucket(
	audio: EpisodeAudioFixture,
	options: { audioObject?: FakeR2BytesObject; sidecar?: unknown } = {},
) {
	return fakeR2Bucket({
		"seasons/winni-s1-test.json": r2JsonObject(fixtureSeason),
		"audio/winni-s1-test-e0.wav":
			options.audioObject ?? r2BytesObject(audio.audioBytes),
		"audio/winni-s1-test-e0.words.json": r2JsonObject(
			options.sidecar ?? audio.sidecar,
		),
	});
}

function fakeR2Bucket(objects: Record<string, FakeR2Object>) {
	return {
		requests: [] as { key: string; options?: unknown }[],
		get requestedKeys(): string[] {
			return this.requests.map((request) => request.key);
		},
		async get(key: string, options?: { range?: Headers; onlyIf?: Headers }) {
			this.requests.push({ key, options });
			const object = objects[key] ?? null;
			const rangeHeader = options?.range?.get("range");
			if (!object || !rangeHeader || !isFakeR2BytesObject(object)) {
				return object;
			}

			const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
			if (!match) {
				return object;
			}

			const start = match[1]!;
			const stop = match[2]!;
			if (start === "" && stop === "") {
				return object;
			}

			const suffixLength = start === "" ? Number.parseInt(stop, 10) : null;
			const offset =
				suffixLength === null
					? Number.parseInt(start, 10)
					: object.size - suffixLength;
			const end =
				suffixLength !== null || stop === ""
					? object.size - 1
					: Number.parseInt(stop, 10);
			const length = end - offset + 1;
			const bytes = new Uint8Array(await object.arrayBuffer());
			const ranged = r2BytesObject(
				bytes.slice(offset, offset + length),
				object.httpMetadata.contentType,
			);
			ranged.customMetadata = object.customMetadata;
			ranged.range =
				suffixLength === null
					? rangeForFakeR2Offset(offset, stop, length)
					: { suffix: suffixLength };
			ranged.size = object.size;
			return ranged;
		},
	};
}

function rangeForFakeR2Offset(
	offset: number,
	stop: string,
	length: number,
): { offset: number; length?: number } {
	if (stop === "") {
		return { offset };
	}

	return { offset, length };
}

describe("server stores", () => {
	it("mutates POST /api/sessions through an injected in-memory StateStore", async () => {
		const stateStore = new InMemoryStateStore(fixtureState);

		const res = await postSession(validSessionBody, stateStore);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(validSessionBody);

		const state = await stateStore.readState();
		expect(state.sessions).toEqual([validSessionBody]);
		expect(state.children.winni?.current_episode).toBe(1);
	});

	it("serves season metadata through injected StateStore and AssetStore", async () => {
		const stateStore = new InMemoryStateStore({
			...fixtureState,
			children: {
				winni: {
					...fixtureState.children.winni,
					current_episode: 2,
				},
			},
		});
		const assetStore = new InMemoryAssetStore({ seasons: [fixtureSeason] });

		const res = await getSeason("winni", stateStore, assetStore);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			slug: "winni-s1-test",
			total_episodes: 14,
			current_episode: 2,
		});
	});

	it("serves episode audio metadata through an injected AssetStore", async () => {
		const stateStore = new InMemoryStateStore({
			...fixtureState,
			children: {
				winni: {
					...fixtureState.children.winni,
					current_episode: 2,
				},
			},
		});
		const assetStore = new InMemoryAssetStore({
			seasons: [fixtureSeason],
			audio: [audioForEpisode(0)],
		});

		const res = await getEpisodeAudio("winni", 0, stateStore, assetStore);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			season_slug: "winni-s1-test",
			episode_idx: 0,
			audio_url: "/api/children/winni/episodes/0/audio/file",
			duration_seconds: 2,
		});
		expect(body.words.map((word: { text: string }) => word.text)).toEqual([
			"Episode",
			"1",
			"text",
			"for",
			"testing.",
		]);
	});

	it("serves episode audio bytes through an injected AssetStore", async () => {
		const stateStore = new InMemoryStateStore({
			...fixtureState,
			children: {
				winni: {
					...fixtureState.children.winni,
					current_episode: 2,
				},
			},
		});
		const assetStore = new InMemoryAssetStore({
			seasons: [fixtureSeason],
			audio: [audioForEpisode(0)],
		});

		const res = await getEpisodeAudioFile("winni", 0, stateStore, assetStore);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("audio/wav");
		expect(new Uint8Array(await res.arrayBuffer()).slice(0, 4)).toEqual(
			new Uint8Array([82, 73, 70, 70]),
		);
	});

	it("serves R2-only season and episode routes from the bucket binding", async () => {
		const stateStore = new InMemoryStateStore(r2OnlyState);
		const bucket = fakeR2Bucket({
			"seasons/r2-only-season.json": r2JsonObject(r2OnlySeason),
		});

		const seasonRes = await fetch(
			new Request("http://127.0.0.1:3001/api/children/winni/season"),
			{
				APP_STATE_STORE: stateStore,
				ASSETS_BUCKET: bucket,
			},
		);
		const currentEpisodeRes = await fetch(
			new Request("http://127.0.0.1:3001/api/children/winni/current-episode"),
			{
				APP_STATE_STORE: stateStore,
				ASSETS_BUCKET: bucket,
			},
		);
		const episodeRes = await fetch(
			new Request("http://127.0.0.1:3001/api/children/winni/episodes/0"),
			{
				APP_STATE_STORE: stateStore,
				ASSETS_BUCKET: bucket,
			},
		);

		expect(seasonRes.status).toBe(200);
		expect(await seasonRes.json()).toEqual({
			slug: "r2-only-season",
			total_episodes: 14,
			current_episode: 1,
		});
		expect(currentEpisodeRes.status).toBe(200);
		expect(await currentEpisodeRes.json()).toMatchObject({
			text: "R2 Episode 2 text for testing.",
			episode_idx: 1,
			season_slug: "r2-only-season",
		});
		expect(episodeRes.status).toBe(200);
		expect(await episodeRes.json()).toMatchObject({
			text: "R2 Episode 1 text for testing.",
			episode_idx: 0,
			season_slug: "r2-only-season",
		});
	});

	it("serves episode audio metadata from the R2 bucket binding", async () => {
		const stateStore = unlockedEpisodeStateStore();
		const audio = audioForEpisode(0);
		const bucket = fakeR2AudioBucket(audio);

		const res = await fetch(
			new Request("http://127.0.0.1:3001/api/children/winni/episodes/0/audio"),
			{
				APP_STATE_STORE: stateStore,
				ASSETS_BUCKET: bucket,
			},
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			season_slug: "winni-s1-test",
			episode_idx: 0,
			audio_url: "/api/children/winni/episodes/0/audio/file",
			duration_seconds: 2,
		});
		expect(bucket.requestedKeys).toEqual([
			"seasons/winni-s1-test.json",
			"audio/winni-s1-test-e0.wav",
			"audio/winni-s1-test-e0.words.json",
		]);
	});

	it("serves ranged episode audio bytes from the R2 bucket binding", async () => {
		const stateStore = unlockedEpisodeStateStore();
		const audio = audioForEpisode(0);
		const bucket = fakeR2AudioBucket(audio);
		const request = new Request(
			"http://127.0.0.1:3001/api/children/winni/episodes/0/audio/file",
			{ headers: { range: "bytes=12-31" } },
		);

		const res = await fetch(request, {
			APP_STATE_STORE: stateStore,
			ASSETS_BUCKET: bucket,
		});

		expect(res.status).toBe(206);
		expect(res.headers.get("content-type")).toBe("audio/wav");
		expect(res.headers.get("content-range")).toBe(
			`bytes 12-31/${audio.audioBytes.byteLength}`,
		);
		expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(
			Array.from(audio.audioBytes.slice(12, 32)),
		);

		const audioRequests = bucket.requests.filter(
			(read) => read.key === "audio/winni-s1-test-e0.wav",
		);
		expect(audioRequests.at(-1)?.options).toMatchObject({
			range: request.headers,
			onlyIf: request.headers,
		});
	});

	it("serves open-ended ranged episode audio bytes from the R2 bucket binding", async () => {
		const stateStore = unlockedEpisodeStateStore();
		const audio = audioForEpisode(0);
		const bucket = fakeR2AudioBucket(audio);
		const request = new Request(
			"http://127.0.0.1:3001/api/children/winni/episodes/0/audio/file",
			{ headers: { range: "bytes=12-" } },
		);

		const res = await fetch(request, {
			APP_STATE_STORE: stateStore,
			ASSETS_BUCKET: bucket,
		});

		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe(
			`bytes 12-${audio.audioBytes.byteLength - 1}/${audio.audioBytes.byteLength}`,
		);
		expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(
			Array.from(audio.audioBytes.slice(12)),
		);
	});

	it("serves suffix ranged episode audio bytes from the R2 bucket binding", async () => {
		const stateStore = unlockedEpisodeStateStore();
		const audio = audioForEpisode(0);
		const bucket = fakeR2AudioBucket(audio);
		const suffixLength = 16;
		const request = new Request(
			"http://127.0.0.1:3001/api/children/winni/episodes/0/audio/file",
			{ headers: { range: `bytes=-${suffixLength}` } },
		);

		const res = await fetch(request, {
			APP_STATE_STORE: stateStore,
			ASSETS_BUCKET: bucket,
		});

		const firstByte = audio.audioBytes.byteLength - suffixLength;
		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe(
			`bytes ${firstByte}-${audio.audioBytes.byteLength - 1}/${audio.audioBytes.byteLength}`,
		);
		expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(
			Array.from(audio.audioBytes.slice(-suffixLength)),
		);
	});

	it("serves full episode audio bytes from the R2 bucket binding", async () => {
		const stateStore = unlockedEpisodeStateStore();
		const audio = audioForEpisode(0);
		const audioObject = r2BytesObject(audio.audioBytes);
		audioObject.range = { offset: 0, length: audio.audioBytes.byteLength };
		const bucket = fakeR2AudioBucket(audio, {
			audioObject,
		});
		const request = new Request(
			"http://127.0.0.1:3001/api/children/winni/episodes/0/audio/file",
		);

		const res = await fetch(request, {
			APP_STATE_STORE: stateStore,
			ASSETS_BUCKET: bucket,
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("audio/wav");
		expect(res.headers.get("content-length")).toBe(
			String(audio.audioBytes.byteLength),
		);
		expect(res.headers.get("content-range")).toBeNull();
		expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(
			Array.from(audio.audioBytes),
		);
	});

	it("returns EpisodeAudioStale when R2 audio file metadata conflicts with the sidecar", async () => {
		const stateStore = new InMemoryStateStore(fixtureState);
		const audio = audioForEpisode(0);
		const staleSidecar = { ...audio.sidecar, audioHash: "0".repeat(64) };
		const bucket = fakeR2AudioBucket(audio, {
			sidecar: staleSidecar,
		});

		const res = await fetch(
			new Request(
				"http://127.0.0.1:3001/api/children/winni/episodes/0/audio/file",
			),
			{
				APP_STATE_STORE: stateStore,
				ASSETS_BUCKET: bucket,
			},
		);

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "EpisodeAudioStale" });
	});

	it("returns EpisodeAudioStale when R2 sidecar integrity fails", async () => {
		const stateStore = new InMemoryStateStore(fixtureState);
		const audio = audioForEpisode(0);
		const staleSidecar = { ...audio.sidecar, audioHash: "0".repeat(64) };
		const bucket = fakeR2AudioBucket(audio, {
			sidecar: staleSidecar,
		});

		const res = await fetch(
			new Request("http://127.0.0.1:3001/api/children/winni/episodes/0/audio"),
			{
				APP_STATE_STORE: stateStore,
				ASSETS_BUCKET: bucket,
			},
		);

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "EpisodeAudioStale" });
	});
});
