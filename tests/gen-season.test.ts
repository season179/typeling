import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dir, "..");
const OUTPUT_PATH = join(TEST_DIR, "seasons", "winni-s1.json");
const STATE_PATH = join(TEST_DIR, "data", "state.test.json");
const SEED_PATH = join(TEST_DIR, "data", "state.seed.json");
const SCRIPT = join(TEST_DIR, "scripts", "gen-season.ts");

async function runGen(args: string[]): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	const proc = Bun.spawn(
		["bun", "run", SCRIPT, ...args],
		{
			cwd: TEST_DIR,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, TYPELING_STATE_PATH: STATE_PATH },
		},
	);
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { exitCode, stdout, stderr };
}

describe("gen-season (fixture mode)", () => {
	beforeAll(async () => {
		await writeFile(STATE_PATH, await readFile(SEED_PATH));
	});

	afterAll(async () => {
		for (const path of [OUTPUT_PATH, STATE_PATH]) {
			try {
				await rm(path);
			} catch {
				/* ignore */
			}
		}
	});

	it("produces seasons/<slug>.json from a valid fixture", async () => {
		await mkdir(join(TEST_DIR, "seasons"), { recursive: true });
		try { await rm(OUTPUT_PATH); } catch { /* ignore */ }

		const { exitCode, stderr } = await runGen([
			"--child", "winni",
			"--slug", "winni-s1",
			"--fixture", "fixtures/sample-season.txt",
		]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");

		const raw = await readFile(OUTPUT_PATH, "utf-8");
		const parsed = JSON.parse(raw);
		expect(parsed.slug).toBe("winni-s1");
		expect(parsed.child_id).toBe("winni");
		expect(parsed.episodes.length).toBe(14);

		// Verify text went through asciiNormalize + usToBritish pipeline
		expect(parsed.episodes[2].text).toContain("colour");
	});

	it.each([
		{ fixture: "bad-json.txt", error: "SeasonFixtureError", extra: "JSON" },
		{ fixture: "bad-schema.txt", error: "SeasonSchemaError" },
		{ fixture: "bad-charset.txt", error: "CharsetError" },
		{ fixture: "bad-blacklist.txt", error: "ContentBlacklistError" },
		{ fixture: "bad-wordcount.txt", error: "WordCountError" },
	])("fails with $error on $fixture", async ({ fixture, error, extra }) => {
		const { exitCode, stderr } = await runGen([
			"--child", "winni",
			"--slug", "winni-s1",
			"--fixture", `fixtures/${fixture}`,
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain(`[${error}]`);
		if (extra) expect(stderr).toContain(extra);
	});

	it("fails with SeasonFixtureError when child is not found", async () => {
		const { exitCode, stderr } = await runGen([
			"--child", "nonexistent",
			"--slug", "winni-s1",
			"--fixture", "fixtures/sample-season.txt",
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("[SeasonFixtureError]");
		expect(stderr).toContain('"nonexistent" not found');
	});

	it("fails with StateParseError when state file is missing", async () => {
		try { await rm(STATE_PATH); } catch { /* ignore */ }

		const { exitCode, stderr } = await runGen([
			"--child", "winni",
			"--slug", "winni-s1",
			"--fixture", "fixtures/sample-season.txt",
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("[StateParseError]");

		// Restore state file for subsequent tests
		await writeFile(STATE_PATH, await readFile(SEED_PATH));
	});
});
