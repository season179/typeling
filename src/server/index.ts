import { join } from "node:path";
import { Hono } from "hono";
import { MAX_EPISODES, seasonSchema } from "../lib/schemas/season";
import { sessionSchema } from "../lib/schemas/state";
import { createStateQueue, ensureStateFile, readState } from "./state";

export const DEFAULT_PORT = 3001;
export const HOSTNAME = "127.0.0.1";
export const DEFAULT_STATE_PATH = "data/state.json";
export const DEFAULT_SEASONS_DIR = "seasons";
const WILDCARD_HOSTNAME = "0.0.0.0";

const statePath = () => Bun.env.TYPELING_STATE_PATH ?? DEFAULT_STATE_PATH;
const seasonsDir = () => Bun.env.TYPELING_SEASONS_DIR ?? DEFAULT_SEASONS_DIR;

export class SeasonFileNotFoundError extends Error {
	constructor(seasonSlug: string) {
		super(`Season file not found for slug: ${seasonSlug}`);
		this.name = "SeasonFileNotFoundError";
	}
}

export type MismatchCode =
	| "child_not_found"
	| "season_mismatch"
	| "episode_mismatch";

export class SessionMismatchError extends Error {
	constructor(code: MismatchCode) {
		super(code);
		this.name = "SessionMismatchError";
	}
}

export type EpisodeAccessCode =
	| "ChildNotFound"
	| "InvalidEpisode"
	| "EpisodeNotFound"
	| "EpisodeLocked";

export class EpisodeAccessError extends Error {
	status: 400 | 403 | 404;

	constructor(code: EpisodeAccessCode, status: 400 | 403 | 404) {
		super(code);
		this.name = "EpisodeAccessError";
		this.status = status;
	}
}

export const app = new Hono();

app.onError((error, c) => {
	console.error(error);
	return c.json({ error: error.name }, 500);
});

async function loadChildSeason(childId: string) {
	const state = await readState(statePath());
	const child = state.children[childId];
	if (!child) {
		return { error: "ChildNotFound" as const, status: 404 as const };
	}

	const seasonPath = join(seasonsDir(), `${child.active_season}.json`);
	const seasonFile = Bun.file(seasonPath);
	if (!(await seasonFile.exists())) {
		throw new SeasonFileNotFoundError(child.active_season);
	}
	const season = seasonSchema.parse(await seasonFile.json());

	return { child, season };
}

const parseEpisodeIdx = (raw: string) => {
	const episodeIdx = Number.parseInt(raw, 10);
	if (!Number.isInteger(episodeIdx) || String(episodeIdx) !== raw) {
		throw new EpisodeAccessError("InvalidEpisode", 400);
	}
	return episodeIdx;
};

const assertEpisodeIsOpen = (
	episodeIdx: number,
	currentEpisode: number,
	totalEpisodes: number,
) => {
	if (episodeIdx < 0 || episodeIdx >= totalEpisodes) {
		throw new EpisodeAccessError("EpisodeNotFound", 404);
	}
	if (episodeIdx > currentEpisode) {
		throw new EpisodeAccessError("EpisodeLocked", 403);
	}
};

const stateQueues = new Map<string, ReturnType<typeof createStateQueue>>();

const getStateQueue = () => {
	const path = statePath();
	let q = stateQueues.get(path);
	if (!q) {
		q = createStateQueue(path);
		stateQueues.set(path, q);
	}
	return q;
};

app.post("/api/sessions", async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = sessionSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "InvalidSession" }, 400);
	}

	try {
		const nextState = await getStateQueue().mutateState((current) => {
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
	const state = await readState(statePath());
	return c.json(state.children);
});

app.get("/api/children/:id/sessions", async (c) => {
	const childId = c.req.param("id");
	const state = await readState(statePath());
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
	const result = await loadChildSeason(c.req.param("id"));
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
	const result = await loadChildSeason(c.req.param("id"));
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
		const result = await loadChildSeason(c.req.param("id"));
		if ("error" in result) {
			return c.json({ error: result.error }, result.status);
		}

		const episodeIdx = parseEpisodeIdx(c.req.param("episodeIdx"));
		const { child, season } = result;
		assertEpisodeIsOpen(
			episodeIdx,
			child.current_episode,
			season.episodes.length,
		);

		const episode = season.episodes[episodeIdx];
		if (!episode) {
			return c.json({ error: "EpisodeNotFound" }, 404);
		}

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

app.post("/api/children/:id/episodes/:episodeIdx/reset", async (c) => {
	try {
		const childId = c.req.param("id");
		const episodeIdx = parseEpisodeIdx(c.req.param("episodeIdx"));

		const nextState = await getStateQueue().mutateState((current) => {
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

const readPort = () => {
	const value = Bun.env.PORT;
	if (value === undefined || value === "") {
		return DEFAULT_PORT;
	}

	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT: ${value}`);
	}

	return port;
};

const isWildcardAddressRequest = (request: Request) => {
	const urlHostname = new URL(request.url).hostname;
	const hostHeader = request.headers.get("host")?.split(":")[0];
	return urlHostname === WILDCARD_HOSTNAME || hostHeader === WILDCARD_HOSTNAME;
};

export const fetch = (request: Request) => {
	if (isWildcardAddressRequest(request)) {
		return Response.error();
	}

	return app.fetch(request);
};

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

export default fetch;
