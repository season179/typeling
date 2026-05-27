import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { extractAlignmentStoryWords } from "../lib/storyWordTokens";
import type { WordTimingSidecar } from "../lib/wordTimings";
import {
	type EpisodeAudioAsset,
	EpisodeAudioError,
	InMemoryAssetStore,
	R2AssetStore,
	SeasonFileNotFoundError,
} from "./stores";

// ── Helpers ──────────────────────────────────────────────────────────

const SEASON_SLUG = "test-season";
const EPISODE_IDX = 0;
const EPISODE_TEXT = "The cat sat on the mat.";

const VALID_SEASON = {
	slug: SEASON_SLUG,
	child_id: "child-1",
	theme: "adventure",
	episodes: Array.from({ length: 14 }, (_, i) => ({
		idx: i,
		text: i === EPISODE_IDX ? EPISODE_TEXT : `Episode ${i} text.`,
	})),
};

function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

const AUDIO_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

function makeValidSidecar(): WordTimingSidecar {
	const alignmentWords = extractAlignmentStoryWords(EPISODE_TEXT);
	return {
		seasonSlug: SEASON_SLUG,
		episodeIdx: EPISODE_IDX,
		audioPath: "audio/test.wav",
		sourceTextPath: "text/test.txt",
		rawAlignmentPath: "alignment/test.json",
		audioHash: sha256(AUDIO_BYTES),
		textHash: sha256(EPISODE_TEXT),
		alignerModel: "test-aligner",
		durationSeconds: 10,
		generatedAt: "2026-01-01T00:00:00Z",
		words: alignmentWords.map((w, i) => ({
			index: w.wordIndex,
			text: w.text,
			start: i * 0.5,
			end: i * 0.5 + 0.4,
		})),
	};
}

function makeStoreWithAudio(
	sidecarOverrides?: Partial<WordTimingSidecar>,
	audioOverrides?: Partial<EpisodeAudioAsset>,
): InMemoryAssetStore {
	const sidecar = { ...makeValidSidecar(), ...sidecarOverrides };
	const asset: EpisodeAudioAsset = {
		audioBytes: AUDIO_BYTES,
		sidecar,
		...audioOverrides,
	};
	return new InMemoryAssetStore({
		seasons: [VALID_SEASON],
		audio: [{ ...asset, seasonSlug: SEASON_SLUG, episodeIdx: EPISODE_IDX }],
	});
}

function readAudio(store: InMemoryAssetStore) {
	return store.readEpisodeAudio(SEASON_SLUG, EPISODE_IDX, EPISODE_TEXT);
}

function expectStale(fn: () => Promise<unknown>) {
	return expect(fn).toThrow(new EpisodeAudioError("EpisodeAudioStale", 409));
}

function tamperWord(
	words: WordTimingSidecar["words"],
	idx: number,
	override: Partial<(typeof words)[number]>,
): typeof words {
	return words.map((w, i) => (i === idx ? { ...w, ...override } : w));
}

function r2Object(body: unknown) {
	return {
		async json<T>(): Promise<T> {
			return structuredClone(body) as T;
		},
		async arrayBuffer(): Promise<ArrayBuffer> {
			return new TextEncoder().encode(JSON.stringify(body)).buffer;
		},
	};
}

function fakeR2Bucket(objects: Record<string, ReturnType<typeof r2Object>>) {
	return {
		requestedKeys: [] as string[],
		async get(key: string) {
			this.requestedKeys.push(key);
			return objects[key] ?? null;
		},
	};
}

// ── readSeason ───────────────────────────────────────────────────────

describe("InMemoryAssetStore.readSeason", () => {
	test("returns season when it exists", async () => {
		const store = new InMemoryAssetStore({ seasons: [VALID_SEASON] });
		const season = await store.readSeason(SEASON_SLUG);
		expect(season.slug).toBe(SEASON_SLUG);
		expect(season.episodes).toHaveLength(14);
	});

	test("throws SeasonFileNotFoundError when season missing", async () => {
		const store = new InMemoryAssetStore({ seasons: [VALID_SEASON] });
		expect(store.readSeason("no-such-season")).rejects.toThrow(
			SeasonFileNotFoundError,
		);
	});
});

describe("R2AssetStore.readSeason", () => {
	test("reads season JSON from R2", async () => {
		const bucket = fakeR2Bucket({
			[`seasons/${SEASON_SLUG}.json`]: r2Object(VALID_SEASON),
		});
		const store = new R2AssetStore(bucket);

		const season = await store.readSeason(SEASON_SLUG);

		expect(season.slug).toBe(SEASON_SLUG);
		expect(bucket.requestedKeys).toEqual([`seasons/${SEASON_SLUG}.json`]);
	});

	test("throws SeasonFileNotFoundError when season missing from R2", async () => {
		const store = new R2AssetStore(fakeR2Bucket({}));

		expect(store.readSeason("no-such-season")).rejects.toThrow(
			SeasonFileNotFoundError,
		);
	});
});

// ── readEpisodeAudio: happy paths ────────────────────────────────────

describe("InMemoryAssetStore.readEpisodeAudio", () => {
	test("returns audio asset when sidecar matches episode", async () => {
		const result = await readAudio(makeStoreWithAudio());

		expect(result).not.toBeNull();
		expect(result?.audioBytes).toEqual(AUDIO_BYTES);
		expect(result?.sidecar.seasonSlug).toBe(SEASON_SLUG);
	});

	test("returns null when no audio stored for episode", async () => {
		const store = new InMemoryAssetStore({ seasons: [VALID_SEASON] });
		expect(await readAudio(store)).toBeNull();
	});
});

// ── readEpisodeAudio: sidecar identity mismatches ────────────────────

describe("InMemoryAssetStore.readEpisodeAudio integrity (identity)", () => {
	test("throws when sidecar seasonSlug mismatches", async () => {
		await expectStale(() =>
			readAudio(makeStoreWithAudio({ seasonSlug: "wrong-season" })),
		);
	});

	test("throws when sidecar episodeIdx mismatches", async () => {
		await expectStale(() => readAudio(makeStoreWithAudio({ episodeIdx: 99 })));
	});

	test("throws when audioHash mismatches (audio bytes changed)", async () => {
		await expectStale(() =>
			readAudio(makeStoreWithAudio({ audioHash: "a".repeat(64) })),
		);
	});

	test("throws when textHash mismatches (episode text changed)", async () => {
		await expectStale(() =>
			readAudio(makeStoreWithAudio({ textHash: "b".repeat(64) })),
		);
	});
});

// ── readEpisodeAudio: word alignment integrity ──────────────────────

describe("InMemoryAssetStore.readEpisodeAudio integrity (words)", () => {
	test("throws when word count mismatches", async () => {
		const words = makeValidSidecar().words.slice(0, 3);
		await expectStale(() => readAudio(makeStoreWithAudio({ words })));
	});

	test("throws when word index mismatches", async () => {
		const words = tamperWord(makeValidSidecar().words, 2, { index: 99 });
		await expectStale(() => readAudio(makeStoreWithAudio({ words })));
	});

	test("throws when word text mismatches", async () => {
		const words = tamperWord(makeValidSidecar().words, 2, { text: "WRONG" });
		await expectStale(() => readAudio(makeStoreWithAudio({ words })));
	});

	test("throws when word timing is non-monotonic", async () => {
		const words = tamperWord(makeValidSidecar().words, 3, { start: 0.1 });
		await expectStale(() => readAudio(makeStoreWithAudio({ words })));
	});

	test("throws when word end exceeds durationSeconds", async () => {
		const { words } = makeValidSidecar();
		const tampered = tamperWord(words, words.length - 1, { end: 999 });
		await expectStale(() => readAudio(makeStoreWithAudio({ words: tampered })));
	});

	test("throws when word end is before word start", async () => {
		const words = tamperWord(makeValidSidecar().words, 2, { end: 0 });
		await expectStale(() => readAudio(makeStoreWithAudio({ words })));
	});
});
