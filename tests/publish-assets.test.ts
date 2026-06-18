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

/** Sorted keys for the audio test fixture files. */
const ALL_KEYS = ["audio/rainbow-door-s1/e0/chapter.wav"];

/** Publish with default test fixtures, overriding only specific opts. */
function publish(
	s: ReturnType<typeof fakeStore>,
	overrides?: Partial<PublishOptions>,
) {
	return publishAssets({
		store: s,
		audioDir: AUDIO_DIR,
		...overrides,
	});
}

describe("publishAssets", () => {
	beforeAll(async () => {
		await mkdir(SEASONS_DIR, { recursive: true });
		await mkdir(join(AUDIO_DIR, "rainbow-door-s1", "e0"), { recursive: true });
		await writeFile(join(SEASONS_DIR, "rainbow-door-s1.json"), '{"slug":"rainbow-door-s1"}');
		await writeFile(
			join(AUDIO_DIR, "rainbow-door-s1", "e0", "chapter.wav"),
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

	it("ignores changed season JSON because story text now seeds D1", async () => {
		const s = fakeStore();
		await publish(s);
		await writeFile(join(SEASONS_DIR, "rainbow-door-s1.json"), '{"changed":true}');
		const result = await publish(s);
		expect(result.uploaded).toEqual([]);
		expect(result.skipped).toEqual(["audio/rainbow-door-s1/e0/chapter.wav"]);
	});

	it("dry-run performs zero writes for audio uploads", async () => {
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
		expect(result.uploaded).toEqual([]);
		expect(result.skipped).toEqual([]);
	});
});

describe("publishAssets edge cases", () => {
	it("skips dotfiles like .DS_Store in audio artifacts", async () => {
		const dir = join(TMP, "dotfiles");
		const audioDir = join(dir, "audio");
		await mkdir(audioDir, { recursive: true });
		await writeFile(join(audioDir, "chapter.wav"), "fake-audio");
		await writeFile(join(audioDir, ".DS_Store"), "junk");

		const result = await publish(fakeStore(), {
			audioDir,
		});
		expect(result.uploaded).toEqual(["audio/chapter.wav"]);
		await rm(dir, { recursive: true, force: true });
	});

	it("returns empty results for empty audio dir", async () => {
		const dir = join(TMP, "empty");
		const audioDir = join(dir, "audio");
		await mkdir(audioDir, { recursive: true });

		const result = await publish(fakeStore(), {
			audioDir,
		});
		expect(result.uploaded).toEqual([]);
		expect(result.skipped).toEqual([]);
		await rm(dir, { recursive: true, force: true });
	});
});
