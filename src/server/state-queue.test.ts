import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { State } from "../lib/schemas/state";
import { createStateQueue, readState, writeStateAtomic } from "./state";

const SEED: State = {
	children: {
		winni: {
			name: "Winni",
			theme: "rainbow-unicorn",
			target_wpm: 10,
			active_season: "winni-season-01",
			current_episode: 0,
			current_session_id: null,
		},
	},
	sessions: [],
};

const makeSession = (id: string) => ({
	id,
	child_id: "winni",
	season_slug: "winni-season-01",
	episode_idx: 0,
	wpm: 10,
	char_count: 50,
	active_ms: 60000,
	started_at: "2026-01-01T00:00:00.000Z",
	finished_at: "2026-01-01T00:01:00.000Z",
});

let dir: string;
let statePath: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "state-queue-"));
	statePath = join(dir, "state.json");
	await writeStateAtomic(SEED, statePath);
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("createStateQueue", () => {
	test("mutateState runs callback with current state and writes result", async () => {
		const { mutateState } = createStateQueue(statePath);

		const result = await mutateState((state) => ({
			...state,
			sessions: [...state.sessions, makeSession("s1")],
		}));

		expect(result.sessions).toHaveLength(1);
		expect(result.sessions[0]?.id).toBe("s1");

		const onDisk = await readState(statePath);
		expect(onDisk.sessions).toHaveLength(1);
		expect(onDisk.sessions[0]?.id).toBe("s1");
	});

	test("3 concurrent mutateState calls execute serially — final file reflects last write", async () => {
		const { mutateState, readState: read } = createStateQueue(statePath);

		const [r1, r2, r3] = await Promise.all([
			mutateState((s) => ({
				...s,
				sessions: [...s.sessions, makeSession("a")],
			})),
			mutateState((s) => ({
				...s,
				sessions: [...s.sessions, makeSession("b")],
			})),
			mutateState((s) => ({
				...s,
				sessions: [...s.sessions, makeSession("c")],
			})),
		]);

		// Each mutation sees the result of the previous one
		expect(r1.sessions).toHaveLength(1);
		expect(r2.sessions).toHaveLength(2);
		expect(r3.sessions).toHaveLength(3);

		// On-disk state should reflect all 3 writes
		const onDisk = await read();
		expect(onDisk.sessions).toHaveLength(3);
		expect(onDisk.sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
	});

	test("readState is NOT queued — reads bypass the write queue", async () => {
		const { mutateState, readState: read } = createStateQueue(statePath);

		// Start a mutation but don't await it yet
		const mutationPromise = mutateState((s) => ({
			...s,
			sessions: [...s.sessions, makeSession("queued")],
		}));

		// readState should return immediately with the pre-mutation state
		// (not blocked by the pending write)
		const beforeMutation = await read();
		expect(beforeMutation.sessions).toHaveLength(0);

		// Now await the mutation and verify it completed
		const afterMutation = await mutationPromise;
		expect(afterMutation.sessions).toHaveLength(1);
	});

	test("failed mutation rejects its caller but queue continues", async () => {
		const { mutateState, readState: read } = createStateQueue(statePath);

		const [r1, r2] = await Promise.allSettled([
			mutateState(() => {
				throw new Error("boom");
			}),
			mutateState((s) => ({
				...s,
				sessions: [...s.sessions, makeSession("after-fail")],
			})),
		]);

		// First mutation rejects
		expect(r1.status).toBe("rejected");
		if (r1.status === "rejected") {
			expect((r1.reason as Error).message).toBe("boom");
		}

		// Second mutation succeeds despite the prior failure
		expect(r2.status).toBe("fulfilled");

		// On-disk state reflects only the successful mutation
		const onDisk = await read();
		expect(onDisk.sessions).toHaveLength(1);
		expect(onDisk.sessions[0]?.id).toBe("after-fail");
	});
});
