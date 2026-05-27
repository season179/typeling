import { describe, expect, it } from "bun:test";
import { fetch, StateStore } from "../../src/server/index";
import type { State } from "../../src/lib/schemas/state";
import type { DurableObjectNamespaceBinding } from "../../src/server/stores";

const validSessionBody = {
	id: "test-session-1",
	child_id: "winni",
	season_slug: "winni-s1",
	episode_idx: 0,
	wpm: 12,
	char_count: 50,
	active_ms: 30000,
	started_at: "2026-05-10T00:00:00.000Z",
	finished_at: "2026-05-10T00:01:00.000Z",
};

class FakeSqlStorage {
	#rows = new Map<string, string>();

	exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]) {
		const sql = query.trimStart();

		if (sql.startsWith("CREATE TABLE")) {
			return new FakeSqlCursor<T>([]);
		}

		if (sql.startsWith("SELECT json FROM app_state")) {
			const rowId = String(bindings[0]);
			const json = this.#rows.get(rowId);
			return new FakeSqlCursor<T>((json ? [{ json }] : []) as T[]);
		}

		if (sql.startsWith("INSERT INTO app_state")) {
			this.#rows.set(String(bindings[0]), String(bindings[1]));
			return new FakeSqlCursor<T>([]);
		}

		throw new Error(`Unexpected SQL query: ${query}`);
	}
}

class FakeSqlCursor<T> {
	constructor(private rows: T[]) {}

	toArray(): T[] {
		return this.rows;
	}

	one(): T {
		if (this.rows.length !== 1) {
			throw new Error(`Expected one row, received ${this.rows.length}`);
		}
		return this.rows[0] as T;
	}
}

class FakeStateStoreNamespace implements DurableObjectNamespaceBinding {
	#instance: StateStore;

	constructor() {
		this.#instance = new StateStore({
			storage: {
				sql: new FakeSqlStorage(),
				transactionSync(callback) {
					return callback();
				},
			},
			blockConcurrencyWhile(callback) {
				void callback();
			},
		});
	}

	idFromName(name: string): string {
		return name;
	}

	get(_id: unknown) {
		return this.#instance;
	}

	readState(): Promise<State> {
		return this.#instance.readState();
	}
}

const postSession = (body: unknown, stateStore: FakeStateStoreNamespace) =>
	fetch(
		new Request("https://typeling.localhost/api/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
		{ STATE_STORE: stateStore },
	);

const resetEpisode = (
	childId: string,
	episodeIdx: number,
	stateStore: FakeStateStoreNamespace,
) =>
	fetch(
		new Request(
			`https://typeling.localhost/api/children/${childId}/episodes/${episodeIdx}/reset`,
			{ method: "POST" },
		),
		{ STATE_STORE: stateStore },
	);

describe("StateStore Durable Object", () => {
	it("persists POST /api/sessions through the bound Durable Object", async () => {
		const stateStore = new FakeStateStoreNamespace();

		const res = await postSession(validSessionBody, stateStore);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(validSessionBody);

		const state = await stateStore.readState();
		expect(state.sessions).toEqual([validSessionBody]);
		expect(state.children.winni?.current_episode).toBe(1);
	});

	it("keeps session POST idempotent by session id", async () => {
		const stateStore = new FakeStateStoreNamespace();

		const first = await postSession(validSessionBody, stateStore);
		const second = await postSession(validSessionBody, stateStore);

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual(validSessionBody);

		const state = await stateStore.readState();
		expect(state.sessions).toEqual([validSessionBody]);
		expect(state.children.winni?.current_episode).toBe(1);
	});

	it("preserves the session mismatch 409 responses", async () => {
		const cases = [
			{
				body: { ...validSessionBody, child_id: "unknown" },
				error: "child_not_found",
			},
			{
				body: { ...validSessionBody, season_slug: "wrong-season" },
				error: "season_mismatch",
			},
			{
				body: { ...validSessionBody, episode_idx: 1 },
				error: "episode_mismatch",
			},
		];

		for (const testCase of cases) {
			const stateStore = new FakeStateStoreNamespace();
			const res = await postSession(testCase.body, stateStore);

			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({ error: testCase.error });
		}
	});

	it("keeps current_episode advancement rules unchanged", async () => {
		const stateStore = new FakeStateStoreNamespace();

		await postSession(validSessionBody, stateStore);
		await postSession(
			{ ...validSessionBody, id: "replay-session", episode_idx: 0 },
			stateStore,
		);
		await postSession(
			{ ...validSessionBody, id: "next-session", episode_idx: 1 },
			stateStore,
		);

		const state = await stateStore.readState();
		expect(state.sessions.map((session) => session.id)).toEqual([
			"test-session-1",
			"replay-session",
			"next-session",
		]);
		expect(state.children.winni?.current_episode).toBe(2);
	});

	it("preserves reset rewind rules through the Durable Object", async () => {
		const stateStore = new FakeStateStoreNamespace();

		await postSession(validSessionBody, stateStore);
		await postSession(
			{ ...validSessionBody, id: "episode-1-session", episode_idx: 1 },
			stateStore,
		);

		const res = await resetEpisode("winni", 1, stateStore);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ current_episode: 1 });

		const state = await stateStore.readState();
		expect(state.children.winni?.current_episode).toBe(1);
		expect(state.sessions.map((session) => session.id)).toEqual([
			"test-session-1",
		]);
	});
});
