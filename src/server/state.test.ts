import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, StateParseError } from "./state";

const VALID_STATE = {
	children: {
		reader: {
			name: "Reader",
			theme: "rainbow",
			target_wpm: 10,
			active_season: "rainbow-door-s1",
			current_episode: 0,
			current_session_id: null,
		},
	},
	sessions: [],
};

let dir: string;
let statePath: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "read-state-"));
	statePath = join(dir, "state.json");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("readState", () => {
	test("parses a valid state file", async () => {
		await writeFile(statePath, JSON.stringify(VALID_STATE));
		const state = await readState(statePath);
		expect(state.children.reader?.name).toBe("Reader");
		expect(state.sessions).toEqual([]);
	});

	test("throws StateParseError for invalid JSON", async () => {
		await writeFile(statePath, "{not json");
		await expect(readState(statePath)).rejects.toBeInstanceOf(StateParseError);
	});

	test("throws StateParseError for schema violations", async () => {
		await writeFile(
			statePath,
			JSON.stringify({ children: {}, sessions: "nope" }),
		);
		await expect(readState(statePath)).rejects.toMatchObject({
			name: "StateParseError",
			message: expect.stringContaining("State schema violation"),
		});
	});

	test("throws StateParseError when the file is missing", async () => {
		await expect(readState(statePath)).rejects.toBeInstanceOf(StateParseError);
	});
});
