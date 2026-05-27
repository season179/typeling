import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetch } from "../../../src/server/index.ts";

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
		zack: {
			name: "Zack",
			theme: "dragon-quest",
			target_wpm: 20,
			active_season: "zack-s1-test",
			current_episode: 0,
			current_session_id: null,
		},
	},
	sessions: [
		{
			id: "s1",
			child_id: "winni",
			season_slug: "winni-s1-test",
			episode_idx: 0,
			wpm: 12,
			char_count: 50,
			active_ms: 30000,
			started_at: "2026-05-10T00:00:00.000Z",
			finished_at: "2026-05-10T00:01:00.000Z",
		},
		{
			id: "s2",
			child_id: "winni",
			season_slug: "winni-s1-test",
			episode_idx: 0,
			wpm: 15,
			char_count: 80,
			active_ms: 45000,
			started_at: "2026-05-10T00:02:00.000Z",
			finished_at: "2026-05-10T00:03:00.000Z",
		},
		{
			id: "s3",
			child_id: "zack",
			season_slug: "zack-s1-test",
			episode_idx: 0,
			wpm: 18,
			char_count: 60,
			active_ms: 35000,
			started_at: "2026-05-10T00:04:00.000Z",
			finished_at: "2026-05-10T00:05:00.000Z",
		},
	],
};

let workDir: string;
let stateFile: string;
let originalStatePath: string | undefined;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "typeling-child-sessions-"));
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

const getChildSessions = (childId: string) =>
	fetch(
		new Request(
			`http://127.0.0.1:3001/api/children/${childId}/sessions`,
		),
	);

describe("GET /api/children/:id/sessions", () => {
	it("returns 200 with sessions sorted by finished_at descending (newest first)", async () => {
		await writeState(fixtureState);

		const res = await getChildSessions("winni");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toBeArray();
		expect(body).toHaveLength(2);
		expect(body[0].id).toBe("s2");
		expect(body[1].id).toBe("s1");
	});

	it("returns 404 when the child id is not in state", async () => {
		await writeState(fixtureState);

		const res = await getChildSessions("nonexistent");

		expect(res.status).toBe(404);
	});

	it("returns 200 with an empty array for a child with no sessions", async () => {
		await writeState({ ...fixtureState, sessions: [] });

		const res = await getChildSessions("winni");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	it("excludes sessions from other children", async () => {
		await writeState(fixtureState);

		const res = await getChildSessions("zack");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toBeArray();
		expect(body).toHaveLength(1);
		expect(body[0].id).toBe("s3");
	});

	it("returns 500 with a named error when readState throws", async () => {
		await writeFile(stateFile, "{ not valid json", "utf8");
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});

		try {
			const res = await getChildSessions("winni");

			expect(res.status).toBe(500);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe("StateParseError");
			expect(errorSpy).toHaveBeenCalledTimes(1);
		} finally {
			errorSpy.mockRestore();
		}
	});
});
