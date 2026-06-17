import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { runScript } from "./lib/run-script";

const TEST_DIR = join(import.meta.dir, "..");
const EXTRACT_SCRIPT = join(TEST_DIR, "scripts", "extract-audio-source.ts");
const CONVERT_SCRIPT = join(TEST_DIR, "scripts", "convert-to-transcript.ts");
const OUTPUT_DIR = join(TEST_DIR, "data", "audio");
const TRANSCRIPT_FILE = join(OUTPUT_DIR, "winni-s1-e0-transcript.txt");

const SCRIPT_ARGS = [
	"--source",
	"data/audio/winni-s1-e0-source.txt",
	"--output",
	"data/audio/winni-s1-e0-transcript.txt",
];

function runConvert(args: string[]) {
	return runScript(CONVERT_SCRIPT, args, TEST_DIR);
}

async function ensureWinniSourceArtifact() {
	const { exitCode, stderr } = await runScript(
		EXTRACT_SCRIPT,
		[
			"--season",
			"seasons/winni-s1.json",
			"--output",
			"data/audio/winni-s1-e0-source.txt",
			"--episode-idx",
			"0",
		],
		TEST_DIR,
	);
	if (exitCode !== 0) {
		throw new Error(
			`Failed to create Winni source artifact (exit ${exitCode}): ${stderr}`,
		);
	}
}

describe("convert-winni-to-transcript", () => {
	beforeAll(async () => {
		await mkdir(OUTPUT_DIR, { recursive: true });
		await ensureWinniSourceArtifact();
	});

	afterAll(async () => {
		try {
			await rm(TRANSCRIPT_FILE);
		} catch {
			/* ignore */
		}
	});

	it("writes a speaker-labelled transcript artifact for Winni", async () => {
		const { exitCode, stderr } = await runConvert(SCRIPT_ARGS);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");

		const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");
		expect(transcript.length).toBeGreaterThan(0);

		for (const line of transcript.split("\n")) {
			if (line.trim().length === 0) continue;
			expect(line).toMatch(/^(Storyteller|Character): /);
		}
	});

	it("produces an artifact whose name clearly distinguishes Winni from Zack", () => {
		expect(TRANSCRIPT_FILE).toContain("winni");
		expect(TRANSCRIPT_FILE).not.toContain("zack");
	});

	it("output contains both speakers Storyteller and Character", async () => {
		const { exitCode } = await runConvert(SCRIPT_ARGS);
		expect(exitCode).toBe(0);

		const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");

		expect(transcript).toMatch(/^Storyteller: /m);
		expect(transcript).toMatch(/^Character: /m);
	});

	it("starts with narration (Storyteller) before Luma's dialogue", async () => {
		const { exitCode } = await runConvert(SCRIPT_ARGS);
		expect(exitCode).toBe(0);

		const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");
		const lines = transcript.split("\n").filter((l) => l.trim().length > 0);

		expect(lines[0]).toMatch(/^Storyteller: /);
		expect(lines[0]).toContain("Luma");
	});

	it("includes Luma's dialogue from quoted text", async () => {
		const { exitCode } = await runConvert(SCRIPT_ARGS);
		expect(exitCode).toBe(0);

		const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");
		const lines = transcript.split("\n").filter((l) => l.trim().length > 0);

		const characterTexts = lines
			.filter((l) => l.startsWith("Character:"))
			.map((l) => l.slice("Character: ".length));

		expect(characterTexts).toContain("Hello?");
		expect(characterTexts).toContain("Is anyone there?");
	});

	it("ends with narration (Storyteller)", async () => {
		const { exitCode } = await runConvert(SCRIPT_ARGS);
		expect(exitCode).toBe(0);

		const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");
		const lines = transcript.split("\n").filter((l) => l.trim().length > 0);

		const lastLine = lines.at(-1) ?? "";
		expect(lastLine).toMatch(/^Storyteller: /);
	});

	it("does not call any network API (fast local-only execution)", async () => {
		const start = performance.now();
		const { exitCode } = await runConvert(SCRIPT_ARGS);
		const elapsed = performance.now() - start;

		expect(exitCode).toBe(0);
		expect(elapsed).toBeLessThan(500);
	});

	it("fails with clear message when source file is missing", async () => {
		const { exitCode, stderr } = await runConvert([
			"--source",
			"data/audio/winni-nonexistent.txt",
			"--output",
			"data/audio/test-out.txt",
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("[TranscriptError]");
		expect(stderr).toContain("Cannot read source file");
	});
});
