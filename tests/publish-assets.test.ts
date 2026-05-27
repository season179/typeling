import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
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

describe("publishAssets", () => {
	const SEASONS_DIR = join(TMP, "seasons");
	const AUDIO_DIR = join(TMP, "data", "audio");

	beforeAll(async () => {
		await mkdir(join(SEASONS_DIR), { recursive: true });
		await mkdir(join(AUDIO_DIR, "winni-s1", "e0"), { recursive: true });
		await writeFile(
			join(SEASONS_DIR, "winni-s1.json"),
			'{"slug":"winni-s1"}',
		);
		await writeFile(
			join(AUDIO_DIR, "winni-s1", "e0", "chapter.wav"),
			"fake-audio",
		);
	});

	afterAll(async () => {
		await rm(TMP, { recursive: true, force: true });
	});

	it("uploads all files on first run", async () => {
		const s = fakeStore();
		const result = await publishAssets({
			store: s,
			seasonsDir: SEASONS_DIR,
			audioDir: AUDIO_DIR,
		});
		expect(result.uploaded.sort()).toEqual([
			"audio/winni-s1/e0/chapter.wav",
			"seasons/winni-s1.json",
		]);
		expect(result.skipped).toEqual([]);
	});

	it("skips unchanged files on second run", async () => {
		const s = fakeStore();
		await publishAssets({
			store: s,
			seasonsDir: SEASONS_DIR,
			audioDir: AUDIO_DIR,
		});
		const result = await publishAssets({
			store: s,
			seasonsDir: SEASONS_DIR,
			audioDir: AUDIO_DIR,
		});
		expect(result.uploaded).toEqual([]);
		expect(result.skipped.sort()).toEqual([
			"audio/winni-s1/e0/chapter.wav",
			"seasons/winni-s1.json",
		]);
	});

	it("uploads only changed file when one changes", async () => {
		const s = fakeStore();
		await publishAssets({
			store: s,
			seasonsDir: SEASONS_DIR,
			audioDir: AUDIO_DIR,
		});
		await writeFile(
			join(SEASONS_DIR, "winni-s1.json"),
			'{"changed":true}',
		);
		const result = await publishAssets({
			store: s,
			seasonsDir: SEASONS_DIR,
			audioDir: AUDIO_DIR,
		});
		expect(result.uploaded).toEqual(["seasons/winni-s1.json"]);
		expect(result.skipped).toEqual(["audio/winni-s1/e0/chapter.wav"]);
	});

	it("dry-run performs zero writes", async () => {
		const s = fakeStore();
		const logs: string[] = [];
		const result = await publishAssets({
			store: s,
			seasonsDir: SEASONS_DIR,
			audioDir: AUDIO_DIR,
			dryRun: true,
			onLog: (msg) => logs.push(msg),
		});
		expect(result.uploaded.sort()).toEqual([
			"audio/winni-s1/e0/chapter.wav",
			"seasons/winni-s1.json",
		]);
		expect(result.skipped).toEqual([]);
		expect(s.store.size).toBe(0);
		expect(logs.every((l) => l.includes("DRY-RUN"))).toBe(true);
	});

	it("returns empty results when audio dir does not exist", async () => {
		const s = fakeStore();
		const result = await publishAssets({
			store: s,
			seasonsDir: SEASONS_DIR,
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

		const s = fakeStore();
		const result = await publishAssets({
			store: s,
			seasonsDir: seasonsDir,
			audioDir: join(dir, "audio"),
		});
		expect(result.uploaded).toEqual(["seasons/winni-s1.json"]);
		expect(result.uploaded).not.toContain("seasons/.DS_Store");
		await rm(dir, { recursive: true, force: true });
	});

	it("returns empty results for empty seasons dir", async () => {
		const dir = join(TMP, "empty");
		const seasonsDir = join(dir, "seasons");
		await mkdir(seasonsDir, { recursive: true });

		const s = fakeStore();
		const result = await publishAssets({
			store: s,
			seasonsDir: seasonsDir,
			audioDir: join(dir, "audio"),
		});
		expect(result.uploaded).toEqual([]);
		expect(result.skipped).toEqual([]);
		await rm(dir, { recursive: true, force: true });
	});
});
