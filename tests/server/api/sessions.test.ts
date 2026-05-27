import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetch } from "../../../src/server/index.ts";
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

	it("returns 409 with child_not_found when child_id is unknown", async () => {
		await writeState(fixtureState);

		const res = await postSession({
			...validSessionBody,
			child_id: "nonexistent",
		});

		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("child_not_found");
	});

	it("returns 409 with episode_mismatch when episode_idx is ahead of child.current_episode", async () => {
		await writeState(fixtureState);

		const res = await postSession({
			...validSessionBody,
			episode_idx: 1,
		});

		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("episode_mismatch");
	});

	it("accepts replay sessions for completed earlier episodes without moving progress backward", async () => {
		const state = {
			...fixtureState,
			children: {
				winni: {
					...fixtureState.children.winni,
					current_episode: 2,
				},
			},
		};
		await writeState(state);

		const res = await postSession({
			...validSessionBody,
			episode_idx: 0,
		});

		expect(res.status).toBe(200);

		const onDisk = await readState(stateFile);
		expect(onDisk.children.winni!.current_episode).toBe(2);
		expect(onDisk.sessions).toHaveLength(1);
	});

	it("returns 409 with season_mismatch when season_slug doesn't match child.active_season", async () => {
		await writeState(fixtureState);

		const res = await postSession({
			...validSessionBody,
			season_slug: "different-season",
		});

		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("season_mismatch");
	});

	it("idempotency check still succeeds even if child state has advanced (idempotency before mismatch)", async () => {
		const state = {
			...fixtureState,
			children: {
				winni: {
					...fixtureState.children.winni,
					current_episode: 1,
				},
			},
			sessions: [validSessionBody],
		};
		await writeState(state);

		const res = await postSession(validSessionBody);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual(validSessionBody);
	});

	it("advances child.current_episode to episode_idx + 1 on success", async () => {
		await writeState(fixtureState);

		await postSession(validSessionBody);

		const onDisk = await readState(stateFile);
		expect(onDisk.children.winni!.current_episode).toBe(1);
	});

	it("advances child.current_episode to 14 after final episode (idx 13)", async () => {
		const state = {
			...fixtureState,
			children: {
				winni: {
					...fixtureState.children.winni,
					current_episode: 13,
				},
			},
		};
		await writeState(state);

		await postSession({
			...validSessionBody,
			episode_idx: 13,
		});

		const onDisk = await readState(stateFile);
		expect(onDisk.children.winni!.current_episode).toBe(14);
		expect(onDisk.sessions).toHaveLength(1);
	});

	it("idempotent retry does not double-advance current_episode", async () => {
		await writeState(fixtureState);

		await postSession(validSessionBody);
		await postSession(validSessionBody);

		const onDisk = await readState(stateFile);
		expect(onDisk.children.winni!.current_episode).toBe(1);
		expect(onDisk.sessions).toHaveLength(1);
	});
});
