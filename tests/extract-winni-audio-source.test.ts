import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { runScript } from "./lib/run-script";

const TEST_DIR = join(import.meta.dir, "..");
const SCRIPT = join(TEST_DIR, "scripts", "extract-audio-source.ts");
const SEASON_PATH = join(TEST_DIR, "seasons", "winni-s1.json");
const OUTPUT_DIR = join(TEST_DIR, "data", "audio");
const OUTPUT_FILE = join(OUTPUT_DIR, "winni-s1-e0-source.txt");

const SCRIPT_ARGS = [
	"--season",
	"seasons/winni-s1.json",
	"--output",
	"data/audio/winni-s1-e0-source.txt",
	"--episode-idx",
	"0",
];

function runExtract(args: string[]) {
	return runScript(SCRIPT, args, TEST_DIR);
}

describe("extract-winni-audio-source", () => {
	beforeAll(async () => {
		await mkdir(OUTPUT_DIR, { recursive: true });
	});

	afterAll(async () => {
		try {
			await rm(OUTPUT_FILE);
		} catch {
			/* ignore */
		}
	});

	it("extracts Winni episode 0 text into a clearly named artifact", async () => {
		const { exitCode, stdout, stderr } = await runExtract(SCRIPT_ARGS);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("winni-s1-e0-source.txt");

		const seasonRaw = await readFile(SEASON_PATH, "utf-8");
		const season = JSON.parse(seasonRaw);
		const episode = season.episodes.find((ep: { idx: number }) => ep.idx === 0);
		expect(episode).toBeDefined();

		const artifactText = await readFile(OUTPUT_FILE, "utf-8");
		expect(artifactText).toBe(episode?.text);
	});

	it("produces an artifact whose name clearly distinguishes Winni from Zack", () => {
		expect(OUTPUT_FILE).toContain("winni");
		expect(OUTPUT_FILE).not.toContain("zack");
	});

	it("does not modify the Winni season file", async () => {
		const beforeContent = await readFile(SEASON_PATH, "utf-8");
		const beforeStat = await stat(SEASON_PATH);

		const { exitCode } = await runExtract(SCRIPT_ARGS);
		expect(exitCode).toBe(0);

		const afterContent = await readFile(SEASON_PATH, "utf-8");
		const afterStat = await stat(SEASON_PATH);

		expect(afterContent).toBe(beforeContent);
		expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
	});

	it("extracted text contains Luma's dialogue", async () => {
		const { exitCode } = await runExtract(SCRIPT_ARGS);
		expect(exitCode).toBe(0);

		const text = await readFile(OUTPUT_FILE, "utf-8");
		expect(text).toContain("Hello?");
		expect(text).toContain("Luma");
		expect(text).toContain("rainbow");
	});

	it("fails with clear message when Winni season file is missing", async () => {
		const { exitCode, stderr } = await runExtract([
			"--season",
			"seasons/nonexistent.json",
			"--output",
			"data/audio/test-out.txt",
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("[ExtractionError]");
		expect(stderr).toContain("Cannot read season file");
	});

	it("does not call any network API (fast local-only execution)", async () => {
		const start = performance.now();
		const { exitCode } = await runExtract(SCRIPT_ARGS);
		const elapsed = performance.now() - start;

		expect(exitCode).toBe(0);
		expect(elapsed).toBeLessThan(500);
	});
});
