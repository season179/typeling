import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dir, "..");
const OUTPUT_PATH = join(TEST_DIR, "seasons", "rainbow-door-s1-fixture-test.json");
const STATE_PATH = join(TEST_DIR, "data", "state.test.json");
const SCRIPT = join(TEST_DIR, "scripts", "gen-season.ts");

// Self-contained neutral state (the committed data/state.seed.json was removed).
// gen-season looks children up by id; this child's name must stay absent from
// the fixture text, and target_wpm 15 matches the fixture's word budget.
const STATE_FIXTURE = {
	children: {
		reader: {
			name: "Reader",
			theme: "rainbow",
			target_wpm: 15,
			active_season: "rainbow-door-s1",
			current_episode: 0,
			current_session_id: null,
		},
	},
	sessions: [],
};
const STATE_JSON = `${JSON.stringify(STATE_FIXTURE, null, 2)}\n`;

async function runGen(args: string[]): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	const proc = Bun.spawn(["bun", "run", SCRIPT, ...args], {
		cwd: TEST_DIR,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, TYPELING_STATE_PATH: STATE_PATH },
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { exitCode, stdout, stderr };
}

describe("gen-season (fixture mode)", () => {
	beforeAll(async () => {
		await writeFile(STATE_PATH, STATE_JSON);
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
		try {
			await rm(OUTPUT_PATH);
		} catch {
			/* ignore */
		}

		const { exitCode, stderr } = await runGen([
			"--child",
			"reader",
			"--slug",
			"rainbow-door-s1-fixture-test",
			"--fixture",
			"fixtures/sample-season.txt",
		]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");

		const raw = await readFile(OUTPUT_PATH, "utf-8");
		const parsed = JSON.parse(raw);
		expect(parsed.slug).toBe("rainbow-door-s1");
		expect(parsed.name).toBe("Rainbow Fixture");
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
			"--child",
			"reader",
			"--slug",
			"rainbow-door-s1",
			"--fixture",
			`fixtures/${fixture}`,
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain(`[${error}]`);
		if (extra) expect(stderr).toContain(extra);
	});

	it("fails with SeasonFixtureError when child is not found", async () => {
		const { exitCode, stderr } = await runGen([
			"--child",
			"nonexistent",
			"--slug",
			"rainbow-door-s1",
			"--fixture",
			"fixtures/sample-season.txt",
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("[SeasonFixtureError]");
		expect(stderr).toContain('"nonexistent" not found');
	});

	it("fails with StateParseError when state file is missing", async () => {
		try {
			await rm(STATE_PATH);
		} catch {
			/* ignore */
		}

		const { exitCode, stderr } = await runGen([
			"--child",
			"reader",
			"--slug",
			"rainbow-door-s1",
			"--fixture",
			"fixtures/sample-season.txt",
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("[StateParseError]");

		// Restore state file for subsequent tests
		await writeFile(STATE_PATH, STATE_JSON);
	});
});
