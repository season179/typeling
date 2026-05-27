import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type PublishOptions,
	publishAssets,
	type R2ObjectStore,
} from "../src/lib/asset-publisher";

const TMP = join(import.meta.dir, "__publish_tmp__");

/** In-memory fake R2 store for testing */
function fakeStore(): R2ObjectStore & {
	store: Map<string, { body: Uint8Array; metadata: Record<string, string> }>;
} {
	const store = new Map<
		string,
		{ body: Uint8Array; metadata: Record<string, string> }
	>();
	return {
		store,
		async head(key) {
			const obj = store.get(key);
			return obj ? { metadata: obj.metadata } : null;
		},
		async put(key, body, metadata) {
			store.set(key, { body, metadata });
		},
	};
}

const SEASONS_DIR = join(TMP, "seasons");
const AUDIO_DIR = join(TMP, "data", "audio");

/** Sorted keys for the two test fixture files. */
const ALL_KEYS = ["audio/winni-s1/e0/chapter.wav", "seasons/winni-s1.json"];

/** Publish with default test fixtures, overriding only specific opts. */
function publish(
	s: ReturnType<typeof fakeStore>,
	overrides?: Partial<PublishOptions>,
) {
	return publishAssets({
		store: s,
		seasonsDir: SEASONS_DIR,
		audioDir: AUDIO_DIR,
		...overrides,
	});
}

describe("publishAssets", () => {
	beforeAll(async () => {
		await mkdir(SEASONS_DIR, { recursive: true });
		await mkdir(join(AUDIO_DIR, "winni-s1", "e0"), { recursive: true });
		await writeFile(join(SEASONS_DIR, "winni-s1.json"), '{"slug":"winni-s1"}');
		await writeFile(
			join(AUDIO_DIR, "winni-s1", "e0", "chapter.wav"),
			"fake-audio",
		);
	});

	afterAll(async () => {
		await rm(TMP, { recursive: true, force: true });
	});

	it("uploads all files on first run", async () => {
		const result = await publish(fakeStore());
		expect(result.uploaded.sort()).toEqual(ALL_KEYS);
		expect(result.skipped).toEqual([]);
	});

	it("skips unchanged files on second run", async () => {
		const s = fakeStore();
		await publish(s);
		const result = await publish(s);
		expect(result.uploaded).toEqual([]);
		expect(result.skipped.sort()).toEqual(ALL_KEYS);
	});

	it("uploads only changed file when one changes", async () => {
		const s = fakeStore();
		await publish(s);
		await writeFile(join(SEASONS_DIR, "winni-s1.json"), '{"changed":true}');
		const result = await publish(s);
		expect(result.uploaded).toEqual(["seasons/winni-s1.json"]);
		expect(result.skipped).toEqual(["audio/winni-s1/e0/chapter.wav"]);
	});

	it("dry-run performs zero writes", async () => {
		const s = fakeStore();
		const logs: string[] = [];
		const result = await publish(s, {
			dryRun: true,
			onLog: (msg) => logs.push(msg),
		});
		expect(result.uploaded.sort()).toEqual(ALL_KEYS);
		expect(result.skipped).toEqual([]);
		expect(s.store.size).toBe(0);
		expect(logs.every((l) => l.includes("DRY-RUN"))).toBe(true);
	});

	it("returns empty results when audio dir does not exist", async () => {
		const result = await publish(fakeStore(), {
			audioDir: join(TMP, "nonexistent-audio"),
		});
		expect(result.uploaded).toEqual(["seasons/winni-s1.json"]);
		expect(result.skipped).toEqual([]);
	});
});

describe("publishAssets edge cases", () => {
	it("skips dotfiles like .DS_Store", async () => {
		const dir = join(TMP, "dotfiles");
		const seasonsDir = join(dir, "seasons");
		await mkdir(seasonsDir, { recursive: true });
		await writeFile(join(seasonsDir, "winni-s1.json"), "{}");
		await writeFile(join(seasonsDir, ".DS_Store"), "junk");

		const result = await publish(fakeStore(), {
			seasonsDir,
			audioDir: join(dir, "audio"),
		});
		expect(result.uploaded).toEqual(["seasons/winni-s1.json"]);
		await rm(dir, { recursive: true, force: true });
	});

	it("returns empty results for empty seasons dir", async () => {
		const dir = join(TMP, "empty");
		const seasonsDir = join(dir, "seasons");
		await mkdir(seasonsDir, { recursive: true });

		const result = await publish(fakeStore(), {
			seasonsDir,
			audioDir: join(dir, "audio"),
		});
		expect(result.uploaded).toEqual([]);
		expect(result.skipped).toEqual([]);
		await rm(dir, { recursive: true, force: true });
	});
});
