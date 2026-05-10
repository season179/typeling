import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fetch from "../../../src/server/index.ts";
import { readState } from "../../../src/server/state";

const fixtureState = {
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

const validSessionBody = {
	id: "test-session-1",
	child_id: "winni",
	season_slug: "winni-s1-test",
	episode_idx: 0,
	wpm: 12,
	char_count: 50,
	active_ms: 30000,
	started_at: "2026-05-10T00:00:00.000Z",
	finished_at: "2026-05-10T00:01:00.000Z",
};

let workDir: string;
let stateFile: string;
let originalStatePath: string | undefined;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "typeling-sessions-"));
	stateFile = join(workDir, "state.json");
	originalStatePath = Bun.env.TYPELING_STATE_PATH;
	Bun.env.TYPELING_STATE_PATH = stateFile;
});

afterEach(async () => {
	if (originalStatePath === undefined) {
		delete Bun.env.TYPELING_STATE_PATH;
	} else {
		Bun.env.TYPELING_STATE_PATH = originalStatePath;
	}
	await rm(workDir, { recursive: true, force: true });
});

const writeState = (state: unknown) =>
	writeFile(stateFile, JSON.stringify(state), "utf8");

const postSession = (body: unknown) =>
	fetch(
		new Request("http://127.0.0.1:3001/api/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);

describe("POST /api/sessions", () => {
	it("returns 200 on valid session body and appends to state.sessions", async () => {
		await writeState(fixtureState);

		const res = await postSession(validSessionBody);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(validSessionBody);

		const onDisk = await readState(stateFile);
		expect(onDisk.sessions).toHaveLength(1);
		expect(onDisk.sessions[0]).toEqual(validSessionBody);
	});

	it("is idempotent by session id — second POST returns same response and does not append", async () => {
		await writeState(fixtureState);

		const res1 = await postSession(validSessionBody);
		const body1 = await res1.json();

		const res2 = await postSession(validSessionBody);
		const body2 = await res2.json();

		expect(res1.status).toBe(200);
		expect(res2.status).toBe(200);
		expect(body2).toEqual(body1);

		const onDisk = await readState(stateFile);
		expect(onDisk.sessions).toHaveLength(1);
		expect(onDisk.sessions[0]).toEqual(validSessionBody);
	});

	it("returns 400 with a named error on an invalid body", async () => {
		await writeState(fixtureState);

		const res = await postSession({});

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("InvalidSession");
	});

	it("returns 400 with a named error on malformed JSON", async () => {
		await writeState(fixtureState);

		const res = await fetch(
			new Request("http://127.0.0.1:3001/api/sessions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "not valid json",
			}),
		);

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("InvalidSession");
	});
});
