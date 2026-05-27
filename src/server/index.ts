import { join } from "node:path";
import { Hono } from "hono";
import seedStateData from "../../data/state.seed.json";
import winniSeasonData from "../../seasons/winni-s1.json";
import zackSeasonData from "../../seasons/zack-s1.json";
import { MAX_EPISODES, seasonSchema } from "../lib/schemas/season";
import { type State, sessionSchema, stateSchema } from "../lib/schemas/state";
import {
	DEFAULT_AUDIO_DIR,
	DEFAULT_PORT,
	DEFAULT_SEASONS_DIR,
	DEFAULT_STATE_PATH,
	HOSTNAME,
} from "./config";
import { ensureStateFile, type MutateFn } from "./state";
import type {
	AssetStore,
	Season,
	ServerBindings,
	StateStore as StateStoreBackend,
} from "./stores";
import {
	DiskAssetStore,
	DiskStateStore,
	EpisodeAudioError,
	InMemoryAssetStore,
	InMemoryStateStore,
} from "./stores";

const WILDCARD_HOSTNAME = "0.0.0.0";
const STATE_STORE_OBJECT_NAME = "typeling";
const STATE_STORE_ROW_ID = "state";

interface DurableObjectContext {
	storage: {
		sql: SqlStorage;
		transactionSync<T>(callback: () => T): T;
	};
	blockConcurrencyWhile(callback: () => Promise<void> | void): void;
}

interface SqlStorage {
	exec<T = Record<string, unknown>>(
		query: string,
		...bindings: unknown[]
	): SqlStorageCursor<T>;
}

interface SqlStorageCursor<T> {
	toArray(): T[];
	one(): T;
}

interface StoredStateRow {
	json: string;
}

function isBunRuntime(): boolean {
	return typeof Bun !== "undefined";
}

function bunEnv(name: string, fallback: string): string {
	if (!isBunRuntime()) {
		return fallback;
	}
	return Bun.env[name] ?? fallback;
}

function statePath(): string {
	return bunEnv("TYPELING_STATE_PATH", DEFAULT_STATE_PATH);
}

function seasonsDir(): string {
	return bunEnv("TYPELING_SEASONS_DIR", DEFAULT_SEASONS_DIR);
}

function audioDir(): string {
	return bunEnv("TYPELING_AUDIO_DIR", DEFAULT_AUDIO_DIR);
}

const bundledState = stateSchema.parse(seedStateData);
const bundledSeasons: Season[] = [winniSeasonData, zackSeasonData].map(
	(season) => seasonSchema.parse(season),
);

type MismatchCode = "child_not_found" | "season_mismatch" | "episode_mismatch";
type Child = State["children"][string];
type ChildSeasonResult =
	| { child: Child; season: Season }
	| { error: "ChildNotFound"; status: 404 };
type OpenEpisode = {
	child: Child;
	season: Season;
	episodeIdx: number;
	episode: Season["episodes"][number];
};

class SessionMismatchError extends Error {
	constructor(code: MismatchCode) {
		super(code);
		this.name = "SessionMismatchError";
	}
}

type EpisodeAccessCode =
	| "ChildNotFound"
	| "InvalidEpisode"
	| "EpisodeNotFound"
	| "EpisodeLocked";

class EpisodeAccessError extends Error {
	status: 400 | 403 | 404;

	constructor(code: EpisodeAccessCode, status: 400 | 403 | 404) {
		super(code);
		this.name = "EpisodeAccessError";
		this.status = status;
	}
}

const app = new Hono<{ Bindings: ServerBindings }>();

app.onError((error, c) => {
	console.error(error);
	return c.json({ error: error.name }, 500);
});

async function loadChildSeason(
	childId: string,
	env: ServerBindings = {},
): Promise<ChildSeasonResult> {
	const state = await getStateStore(env).readState();
	const child = state.children[childId];
	if (!child) {
		return { error: "ChildNotFound" as const, status: 404 as const };
	}

	const season = await getAssetStore(env).readSeason(child.active_season);

	return { child, season };
}

function parseEpisodeIdx(raw: string): number {
	const episodeIdx = Number.parseInt(raw, 10);
	if (!Number.isInteger(episodeIdx) || String(episodeIdx) !== raw) {
		throw new EpisodeAccessError("InvalidEpisode", 400);
	}
	return episodeIdx;
}

function assertEpisodeIsOpen(
	episodeIdx: number,
	currentEpisode: number,
	totalEpisodes: number,
): void {
	if (episodeIdx < 0 || episodeIdx >= totalEpisodes) {
		throw new EpisodeAccessError("EpisodeNotFound", 404);
	}
	if (episodeIdx > currentEpisode) {
		throw new EpisodeAccessError("EpisodeLocked", 403);
	}
}

async function loadOpenEpisode(
	childId: string,
	rawEpisodeIdx: string,
	env: ServerBindings = {},
): Promise<OpenEpisode> {
	const result = await loadChildSeason(childId, env);
	if ("error" in result) {
		throw new EpisodeAccessError("ChildNotFound", 404);
	}

	const episodeIdx = parseEpisodeIdx(rawEpisodeIdx);
	const { child, season } = result;
	assertEpisodeIsOpen(
		episodeIdx,
		child.current_episode,
		season.episodes.length,
	);

	const episode = season.episodes[episodeIdx];
	if (!episode) {
		throw new EpisodeAccessError("EpisodeNotFound", 404);
	}

	return { child, season, episodeIdx, episode };
}

const localStateStores = new Map<string, DiskStateStore>();
let workerStateStore: InMemoryStateStore | undefined;
let workerAssetStore: InMemoryAssetStore | undefined;

function getDefaultStateStore(): StateStoreBackend {
	if (!isBunRuntime()) {
		workerStateStore ??= new InMemoryStateStore(bundledState);
		return workerStateStore;
	}

	const path = statePath();
	let store = localStateStores.get(path);
	if (!store) {
		store = new DiskStateStore(path);
		localStateStores.set(path, store);
	}
	return store;
}

function getStateStore(env: ServerBindings): StateStoreBackend {
	return env.APP_STATE_STORE ?? getDefaultStateStore();
}

function hasBoundStateStore(env: ServerBindings): boolean {
	return env.APP_STATE_STORE === undefined && env.STATE_STORE !== undefined;
}

function fetchFromBoundStateStore(
	request: Request,
	env: ServerBindings,
): Response | Promise<Response> {
	const namespace = env.STATE_STORE;
	if (!namespace) {
		throw new Error("STATE_STORE binding is missing");
	}

	const id = namespace.idFromName(STATE_STORE_OBJECT_NAME);
	return namespace.get(id).fetch(request);
}

function getDefaultAssetStore(): AssetStore {
	if (!isBunRuntime()) {
		workerAssetStore ??= new InMemoryAssetStore({ seasons: bundledSeasons });
		return workerAssetStore;
	}

	return new DiskAssetStore({
		seasonsDir: seasonsDir(),
		audioDir: audioDir(),
	});
}

function getAssetStore(env: ServerBindings): AssetStore {
	return env.ASSET_STORE ?? getDefaultAssetStore();
}

app.post("/api/sessions", async (c) => {
	const stateStore = getStateStore(c.env);

	const body = await c.req.json().catch(() => null);
	const parsed = sessionSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "InvalidSession" }, 400);
	}

	try {
		const nextState = await stateStore.mutateState((current) => {
			if (current.sessions.some((s) => s.id === parsed.data.id)) return current;

			const child = current.children[parsed.data.child_id];
			if (!child) {
				throw new SessionMismatchError("child_not_found");
			}
			if (parsed.data.season_slug !== child.active_season) {
				throw new SessionMismatchError("season_mismatch");
			}
			if (parsed.data.episode_idx > child.current_episode) {
				throw new SessionMismatchError("episode_mismatch");
			}

			return {
				...current,
				children: {
					...current.children,
					[parsed.data.child_id]: {
						...child,
						current_episode:
							parsed.data.episode_idx === child.current_episode
								? parsed.data.episode_idx + 1
								: child.current_episode,
					},
				},
				sessions: [...current.sessions, parsed.data],
			};
		});

		const session = nextState.sessions.find((s) => s.id === parsed.data.id);
		return c.json(session, 200);
	} catch (error) {
		if (error instanceof SessionMismatchError) {
			return c.json({ error: error.message }, 409);
		}
		throw error;
	}
});

app.get("/api/health", (c) => {
	return c.json({ ok: true });
});

app.get("/api/children", async (c) => {
	const state = await getStateStore(c.env).readState();
	return c.json(state.children);
});

app.get("/api/children/:id/sessions", async (c) => {
	const childId = c.req.param("id");
	const state = await getStateStore(c.env).readState();
	const child = state.children[childId];
	if (!child) {
		return c.json({ error: "ChildNotFound" }, 404);
	}

	const childSessions = state.sessions
		.filter((s) => s.child_id === childId)
		.sort((a, b) => b.finished_at.localeCompare(a.finished_at));

	return c.json(childSessions);
});

app.get("/api/children/:id/season", async (c) => {
	const result = await loadChildSeason(c.req.param("id"), c.env);
	if ("error" in result) {
		return c.json({ error: result.error }, result.status);
	}

	return c.json({
		slug: result.season.slug,
		total_episodes: result.season.episodes.length,
		current_episode: result.child.current_episode,
	});
});

app.get("/api/children/:id/current-episode", async (c) => {
	const result = await loadChildSeason(c.req.param("id"), c.env);
	if ("error" in result) {
		return c.json({ error: result.error }, result.status);
	}

	const { child, season } = result;

	if (child.current_episode >= season.episodes.length) {
		return c.json({
			complete: true,
			current_episode: child.current_episode,
			season_slug: season.slug,
			total_episodes: season.episodes.length,
		});
	}

	const episode = season.episodes[child.current_episode];
	if (!episode) {
		return c.json({
			complete: true,
			current_episode: child.current_episode,
			season_slug: season.slug,
			total_episodes: season.episodes.length,
		});
	}

	return c.json({
		text: episode.text,
		episode_idx: child.current_episode,
		current_episode: child.current_episode,
		season_slug: season.slug,
		total_episodes: season.episodes.length,
	});
});

app.get("/api/children/:id/episodes/:episodeIdx", async (c) => {
	try {
		const { child, season, episodeIdx, episode } = await loadOpenEpisode(
			c.req.param("id"),
			c.req.param("episodeIdx"),
			c.env,
		);

		return c.json({
			text: episode.text,
			episode_idx: episodeIdx,
			current_episode: child.current_episode,
			season_slug: season.slug,
			total_episodes: season.episodes.length,
		});
	} catch (error) {
		if (error instanceof EpisodeAccessError) {
			return c.json({ error: error.message }, error.status);
		}
		throw error;
	}
});

app.get("/api/children/:id/episodes/:episodeIdx/audio", async (c) => {
	try {
		const childId = c.req.param("id");
		const { season, episodeIdx, episode } = await loadOpenEpisode(
			childId,
			c.req.param("episodeIdx"),
			c.env,
		);
		const audio = await getAssetStore(c.env).readEpisodeAudio(
			season.slug,
			episodeIdx,
			episode.text,
		);
		if (!audio) {
			return c.json({ error: "EpisodeAudioMissing" }, 404);
		}

		return c.json({
			season_slug: season.slug,
			episode_idx: episodeIdx,
			audio_url: `/api/children/${encodeURIComponent(
				childId,
			)}/episodes/${episodeIdx}/audio/file`,
			duration_seconds: audio.sidecar.durationSeconds,
			words: audio.sidecar.words,
		});
	} catch (error) {
		if (error instanceof EpisodeAccessError) {
			return c.json({ error: error.message }, error.status);
		}
		if (error instanceof EpisodeAudioError) {
			return c.json({ error: error.message }, error.status);
		}
		throw error;
	}
});

app.get("/api/children/:id/episodes/:episodeIdx/audio/file", async (c) => {
	try {
		const { season, episodeIdx, episode } = await loadOpenEpisode(
			c.req.param("id"),
			c.req.param("episodeIdx"),
			c.env,
		);
		const audio = await getAssetStore(c.env).readEpisodeAudio(
			season.slug,
			episodeIdx,
			episode.text,
		);
		if (!audio) {
			return c.json({ error: "EpisodeAudioMissing" }, 404);
		}

		const audioBody = audio.audioBytes.buffer.slice(
			audio.audioBytes.byteOffset,
			audio.audioBytes.byteOffset + audio.audioBytes.byteLength,
		) as ArrayBuffer;

		return new Response(audioBody, {
			headers: { "content-type": "audio/wav" },
		});
	} catch (error) {
		if (error instanceof EpisodeAccessError) {
			return c.json({ error: error.message }, error.status);
		}
		if (error instanceof EpisodeAudioError) {
			return c.json({ error: error.message }, error.status);
		}
		throw error;
	}
});

app.post("/api/children/:id/episodes/:episodeIdx/reset", async (c) => {
	const stateStore = getStateStore(c.env);

	try {
		const childId = c.req.param("id");
		const episodeIdx = parseEpisodeIdx(c.req.param("episodeIdx"));

		const nextState = await stateStore.mutateState((current) => {
			const child = current.children[childId];
			if (!child) {
				throw new EpisodeAccessError("ChildNotFound", 404);
			}
			assertEpisodeIsOpen(episodeIdx, child.current_episode, MAX_EPISODES);

			const nextSessions = current.sessions.filter(
				(s) =>
					s.child_id !== childId ||
					s.season_slug !== child.active_season ||
					s.episode_idx < episodeIdx,
			);
			if (
				child.current_episode === episodeIdx &&
				child.current_session_id === null &&
				nextSessions.length === current.sessions.length
			) {
				return current;
			}

			return {
				...current,
				children: {
					...current.children,
					[childId]: {
						...child,
						current_episode: episodeIdx,
						current_session_id: null,
					},
				},
				sessions: nextSessions,
			};
		});

		const child = nextState.children[childId];
		return c.json({ current_episode: child?.current_episode ?? episodeIdx });
	} catch (error) {
		if (error instanceof EpisodeAccessError) {
			return c.json({ error: error.message }, error.status);
		}
		throw error;
	}
});

function readPort(): number {
	const value = Bun.env.PORT;
	if (value === undefined || value === "") {
		return DEFAULT_PORT;
	}

	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT: ${value}`);
	}

	return port;
}

function isWildcardAddressRequest(request: Request): boolean {
	const urlHostname = new URL(request.url).hostname;
	const hostHeader = request.headers.get("host")?.split(":")[0];
	return urlHostname === WILDCARD_HOSTNAME || hostHeader === WILDCARD_HOSTNAME;
}

function isServerBindings(value: unknown): value is ServerBindings {
	return (
		typeof value === "object" &&
		value !== null &&
		("APP_STATE_STORE" in value ||
			"ASSET_STORE" in value ||
			"STATE_STORE" in value)
	);
}

export function fetch(
	request: Request,
	env?: ServerBindings,
): Response | Promise<Response>;
export function fetch(
	request: Request,
	envOrServer?: unknown,
): Response | Promise<Response>;
export function fetch(request: Request, envOrServer?: unknown) {
	if (isWildcardAddressRequest(request)) {
		return Response.error();
	}

	const env = isServerBindings(envOrServer) ? envOrServer : {};
	if (hasBoundStateStore(env)) {
		return fetchFromBoundStateStore(request, env);
	}
	return app.fetch(request, env);
}

export class StateStore implements StateStoreBackend {
	#ctx: DurableObjectContext;
	#env: ServerBindings;

	constructor(ctx: DurableObjectContext, env: ServerBindings = {}) {
		this.#ctx = ctx;
		this.#env = env;
		this.#ctx.blockConcurrencyWhile(() => {
			this.#initializeStorage();
		});
	}

	async readState(): Promise<State> {
		return this.#readStoredState();
	}

	async mutateState(fn: MutateFn): Promise<State> {
		return this.#ctx.storage.transactionSync(() => {
			const current = this.#readStoredState();
			const next = fn(current);
			const parsed = stateSchema.parse(structuredClone(next));
			if (next !== current) {
				this.#writeState(parsed);
			}
			return structuredClone(parsed);
		});
	}

	fetch(request: Request): Response | Promise<Response> {
		return app.fetch(request, {
			...this.#env,
			APP_STATE_STORE: this,
		});
	}

	#initializeStorage(): void {
		this.#ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS app_state (
				id TEXT PRIMARY KEY,
				json TEXT NOT NULL
			)
		`);

		const rows = this.#ctx.storage.sql
			.exec<StoredStateRow>(
				"SELECT json FROM app_state WHERE id = ?",
				STATE_STORE_ROW_ID,
			)
			.toArray();
		if (rows.length === 0) {
			this.#writeState(bundledState);
		}
	}

	#readStoredState(): State {
		const row = this.#ctx.storage.sql
			.exec<StoredStateRow>(
				"SELECT json FROM app_state WHERE id = ?",
				STATE_STORE_ROW_ID,
			)
			.one();
		return stateSchema.parse(JSON.parse(row.json));
	}

	#writeState(state: State): void {
		this.#ctx.storage.sql.exec(
			`
				INSERT INTO app_state (id, json)
				VALUES (?, ?)
				ON CONFLICT(id) DO UPDATE SET json = excluded.json
			`,
			STATE_STORE_ROW_ID,
			JSON.stringify(stateSchema.parse(structuredClone(state))),
		);
	}
}

if (import.meta.main) {
	const seedPath = join(import.meta.dir, "..", "..", "data", "state.seed.json");
	const seeded = await ensureStateFile(statePath(), seedPath);
	if (seeded) {
		console.log(`Seeded state from ${seedPath}`);
	}

	const port = readPort();

	Bun.serve({
		fetch,
		hostname: HOSTNAME,
		port,
	});
	console.log(`Server running on http://${HOSTNAME}:${port}`);
}

export default { fetch };
