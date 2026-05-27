import { describe, expect, test } from "bun:test";
import type { Session, State } from "../lib/schemas/state";
import { InMemoryStateStore } from "./stores";

// ── Helpers ──────────────────────────────────────────────────────────

type MismatchCode = "child_not_found" | "season_mismatch" | "episode_mismatch";

class SessionMismatchError extends Error {
	constructor(code: MismatchCode) {
		super(code);
		this.name = "SessionMismatchError";
	}
}

const SEED: State = {
	children: {
		winni: {
			name: "Winni",
			theme: "rainbow-unicorn",
			target_wpm: 15,
			active_season: "winni-s1",
			current_episode: 0,
			current_session_id: null,
		},
	},
	sessions: [],
};

function getChild(state: State, id: string) {
	const child = state.children[id];
	if (!child) throw new Error(`no child '${id}' in state`);
	return child;
}

function expectMismatch(code: MismatchCode) {
	return (error: unknown) => {
		expect(error).toBeInstanceOf(SessionMismatchError);
		expect((error as SessionMismatchError).message).toBe(code);
	};
}

function resetToEpisode(
	store: InMemoryStateStore,
	childId: string,
	targetIdx: number,
) {
	return store.mutateState((current) => {
		const child = current.children[childId];
		if (!child) return current;

		return {
			...current,
			children: {
				...current.children,
				[childId]: {
					...child,
					current_episode: targetIdx,
					current_session_id: null,
				},
			},
			sessions: current.sessions.filter(
				(s) =>
					s.child_id !== childId ||
					s.season_slug !== child.active_season ||
					s.episode_idx < targetIdx,
			),
		};
	});
}

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: "session-1",
		child_id: "winni",
		season_slug: "winni-s1",
		episode_idx: 0,
		wpm: 12,
		char_count: 120,
		active_ms: 30_000,
		started_at: "2026-01-01T10:00:00.000Z",
		finished_at: "2026-01-01T10:02:00.000Z",
		...overrides,
	};
}

async function postSession(
	store: InMemoryStateStore,
	session: Session,
): Promise<{ state: State; session: Session }> {
	const state = await store.mutateState((current) => {
		const existing = current.sessions.find((s) => s.id === session.id);
		if (existing) return current;

		const child = current.children[session.child_id];
		if (!child) throw new SessionMismatchError("child_not_found");
		if (session.season_slug !== child.active_season)
			throw new SessionMismatchError("season_mismatch");
		if (session.episode_idx > child.current_episode)
			throw new SessionMismatchError("episode_mismatch");

		const advanced = session.episode_idx === child.current_episode;
		return {
			...current,
			children: {
				...current.children,
				[session.child_id]: {
					...child,
					current_episode: advanced
						? session.episode_idx + 1
						: child.current_episode,
				},
			},
			sessions: [...current.sessions, session],
		};
	});

	const stored = state.sessions.find((s) => s.id === session.id);
	if (!stored) throw new Error(`session ${session.id} not found after mutate`);
	return { state, session: stored };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("StateStore contract: POST /api/sessions mutate", () => {
	test("idempotent — same sessionId stored once, returned on replay", async () => {
		const store = new InMemoryStateStore(SEED);
		const session = makeSession();

		const first = await postSession(store, session);
		expect(first.session).toEqual(session);
		expect(first.state.sessions).toHaveLength(1);
		expect(getChild(first.state, "winni").current_episode).toBe(1);

		const second = await postSession(store, session);
		expect(second.session).toEqual(session);
		expect(second.state.sessions).toHaveLength(1);
		expect(getChild(second.state, "winni").current_episode).toBe(1);
	});

	test("409 child_not_found — session references unknown child", async () => {
		const store = new InMemoryStateStore(SEED);

		try {
			await postSession(store, makeSession({ child_id: "ghost" }));
			expect.unreachable("should have thrown");
		} catch (error) {
			expectMismatch("child_not_found")(error);
		}

		const state = await store.readState();
		expect(state.sessions).toHaveLength(0);
	});

	test("409 season_mismatch — session references wrong season", async () => {
		const store = new InMemoryStateStore(SEED);

		try {
			await postSession(store, makeSession({ season_slug: "zack-s1" }));
			expect.unreachable("should have thrown");
		} catch (error) {
			expectMismatch("season_mismatch")(error);
		}

		const state = await store.readState();
		expect(state.sessions).toHaveLength(0);
		expect(getChild(state, "winni").current_episode).toBe(0);
	});

	test("409 episode_mismatch — session references future episode", async () => {
		const store = new InMemoryStateStore(SEED);

		try {
			await postSession(store, makeSession({ episode_idx: 5 }));
			expect.unreachable("should have thrown");
		} catch (error) {
			expectMismatch("episode_mismatch")(error);
		}

		const state = await store.readState();
		expect(state.sessions).toHaveLength(0);
		expect(getChild(state, "winni").current_episode).toBe(0);
	});

	test("current_episode advances only on fresh episode completion", async () => {
		const store = new InMemoryStateStore(SEED);

		const r0 = await postSession(
			store,
			makeSession({ id: "s0", episode_idx: 0 }),
		);
		expect(getChild(r0.state, "winni").current_episode).toBe(1);

		// Replay episode 0 — no further advance
		const r0replay = await postSession(
			store,
			makeSession({ id: "s0-replay", episode_idx: 0 }),
		);
		expect(getChild(r0replay.state, "winni").current_episode).toBe(1);

		// Complete episode 1 — advances to 2
		const r1 = await postSession(
			store,
			makeSession({ id: "s1", episode_idx: 1 }),
		);
		expect(getChild(r1.state, "winni").current_episode).toBe(2);
	});

	test("reset rewinds current_episode and keeps earlier sessions", async () => {
		const store = new InMemoryStateStore(SEED);

		await postSession(store, makeSession({ id: "s0", episode_idx: 0 }));
		await postSession(store, makeSession({ id: "s1", episode_idx: 1 }));

		let state = await store.readState();
		expect(getChild(state, "winni").current_episode).toBe(2);
		expect(state.sessions).toHaveLength(2);

		// Reset to episode 1 — keeps episode 0 session, drops episode 1+
		state = await resetToEpisode(store, "winni", 1);

		expect(getChild(state, "winni").current_episode).toBe(1);
		expect(state.sessions).toHaveLength(1);
		expect(state.sessions[0]?.id).toBe("s0");
	});

	test("reset to episode 0 drops all season sessions", async () => {
		const store = new InMemoryStateStore(SEED);

		await postSession(store, makeSession({ id: "s0", episode_idx: 0 }));
		await postSession(store, makeSession({ id: "s1", episode_idx: 1 }));

		const state = await resetToEpisode(store, "winni", 0);

		expect(getChild(state, "winni").current_episode).toBe(0);
		expect(state.sessions).toHaveLength(0);
	});
});
