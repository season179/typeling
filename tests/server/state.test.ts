import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	StateParseError,
	ensureStateFile,
	readState,
} from "../../src/server/state";

const validState = {
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

let workDir: string;
let stateFile: string;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "typeling-state-"));
	stateFile = join(workDir, "state.json");
});

afterEach(async () => {
	await rm(workDir, { recursive: true, force: true });
});

describe("readState", () => {
	it("round-trips a valid state file", async () => {
		await writeFile(stateFile, JSON.stringify(validState), "utf8");

		const result = await readState(stateFile);

		expect(result).toEqual(validState);
	});

	it("loads the committed data/state.seed.json with Winni-only defaults", async () => {
		const seed = await readState("data/state.seed.json");

		expect(Object.keys(seed.children)).toEqual(["winni"]);
		expect(seed.children.winni).toMatchObject({
			target_wpm: 15,
			active_season: "winni-s1-test",
			current_episode: 0,
			current_session_id: null,
		});
		expect(seed.sessions).toEqual([]);
	});

	it("throws StateParseError naming the offending field on schema violation", async () => {
		const malformed = {
			...validState,
			children: {
				winni: {
					...validState.children.winni,
					target_wpm: -1,
				},
			},
		};
		await writeFile(stateFile, JSON.stringify(malformed), "utf8");

		let caught: unknown;
		try {
			await readState(stateFile);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(StateParseError);
		const err = caught as StateParseError;
		expect(err.field).toBe("children.winni.target_wpm");
		expect(err.message).toContain("target_wpm");
	});
});

describe("ensureStateFile", () => {
	it("copies the seed to the state path when state is missing", async () => {
		const seedPath = join(workDir, "seed.json");
		await writeFile(seedPath, JSON.stringify(validState), "utf8");

		const created = await ensureStateFile(stateFile, seedPath);

		expect(created).toBe(true);
		expect(await readState(stateFile)).toEqual(validState);
	});

	it("leaves no .tmp file behind after a successful seed copy", async () => {
		const seedPath = join(workDir, "seed.json");
		await writeFile(seedPath, JSON.stringify(validState), "utf8");

		await ensureStateFile(stateFile, seedPath);

		const entries = await readdir(workDir);
		expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false);
	});

	it("leaves an existing state file untouched", async () => {
		const seedPath = join(workDir, "seed.json");
		await writeFile(stateFile, '{"existing":true}', "utf8");
		await writeFile(seedPath, JSON.stringify(validState), "utf8");

		const created = await ensureStateFile(stateFile, seedPath);

		expect(created).toBe(false);
		expect(await Bun.file(stateFile).text()).toBe('{"existing":true}');
	});
});
