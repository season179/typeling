import { describe, expect, it, afterAll } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dir, "..");
const OUTPUT_PATH = join(TEST_DIR, "seasons", "rainbow-door-s1-fixture-test.json");
const SCRIPT = join(TEST_DIR, "scripts", "gen-season.ts");

const PROFILE_ARGS = [
	"--theme",
	"rainbow",
	"--target-wpm",
	"15",
	"--forbidden-name",
	"Reader",
];

async function runGen(args: string[]): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	const proc = Bun.spawn(["bun", "run", SCRIPT, ...args], {
		cwd: TEST_DIR,
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { exitCode, stdout, stderr };
}

describe("gen-season (fixture mode)", () => {
	afterAll(async () => {
		try {
			await rm(OUTPUT_PATH);
		} catch {
			/* ignore */
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
			...PROFILE_ARGS,
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
			...PROFILE_ARGS,
			"--slug",
			"rainbow-door-s1",
			"--fixture",
			`fixtures/${fixture}`,
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain(`[${error}]`);
		if (extra) expect(stderr).toContain(extra);
	});

	it("fails with SeasonFixtureError when fixture path is missing", async () => {
		const { exitCode, stderr } = await runGen([
			...PROFILE_ARGS,
			"--slug",
			"rainbow-door-s1",
			"--fixture",
			"fixtures/does-not-exist.txt",
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("[SeasonFixtureError]");
	});

	it("fails when required profile flags are missing", async () => {
		const { exitCode, stderr } = await runGen(["--slug", "rainbow-door-s1"]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("Usage:");
	});
});
