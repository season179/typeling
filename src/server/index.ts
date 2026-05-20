import { createHash } from "node:crypto";
import { join } from "node:path";
import { Hono } from "hono";
import { MAX_EPISODES, seasonSchema } from "../lib/schemas/season";
import { sessionSchema } from "../lib/schemas/state";
import { extractAlignmentStoryWords } from "../lib/storyWordTokens";
import {
	type WordTimingSidecar,
	wordTimingSidecarSchema,
} from "../lib/wordTimings";
import { createStateQueue, ensureStateFile, readState } from "./state";

export const DEFAULT_PORT = 3001;
export const HOSTNAME = "127.0.0.1";
export const DEFAULT_STATE_PATH = "data/state.json";
export const DEFAULT_SEASONS_DIR = "seasons";
export const DEFAULT_AUDIO_DIR = "data/audio";
const WILDCARD_HOSTNAME = "0.0.0.0";

const statePath = () => Bun.env.TYPELING_STATE_PATH ?? DEFAULT_STATE_PATH;
const seasonsDir = () => Bun.env.TYPELING_SEASONS_DIR ?? DEFAULT_SEASONS_DIR;
const audioDir = () => Bun.env.TYPELING_AUDIO_DIR ?? DEFAULT_AUDIO_DIR;

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
type EpisodeAudioCode = "EpisodeAudioMissing" | "EpisodeAudioStale";

export class EpisodeAccessError extends Error {
	status: 400 | 403 | 404;

	constructor(code: EpisodeAccessCode, status: 400 | 403 | 404) {
		super(code);
		this.name = "EpisodeAccessError";
		this.status = status;
	}
}

export class EpisodeAudioError extends Error {
	status: 404 | 409;

	constructor(code: EpisodeAudioCode, status: 404 | 409) {
		super(code);
		this.name = "EpisodeAudioError";
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

const loadOpenEpisode = async (childId: string, rawEpisodeIdx: string) => {
	const result = await loadChildSeason(childId);
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
};

const audioArtifactPaths = (seasonSlug: string, episodeIdx: number) => {
	const baseName = `${seasonSlug}-e${episodeIdx}`;
	return {
		audioPath: join(audioDir(), `${baseName}.wav`),
		timingsPath: join(audioDir(), `${baseName}.words.json`),
	};
};

const sha256 = (input: string | Uint8Array) =>
	createHash("sha256").update(input).digest("hex");

const assertSidecarMatchesEpisode = (
	sidecar: WordTimingSidecar,
	seasonSlug: string,
	episodeIdx: number,
	episodeText: string,
	audioBytes: Uint8Array,
) => {
	if (
		sidecar.seasonSlug !== seasonSlug ||
		sidecar.episodeIdx !== episodeIdx ||
		sidecar.audioHash !== sha256(audioBytes) ||
		sidecar.textHash !== sha256(episodeText)
	) {
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
	}

	const expectedWords = extractAlignmentStoryWords(episodeText);
	if (sidecar.words.length !== expectedWords.length) {
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
	}

	let previousEnd = 0;
	for (const [index, word] of sidecar.words.entries()) {
		const expected = expectedWords[index];
		if (
			!expected ||
			word.index !== expected.wordIndex ||
			word.text !== expected.text ||
			word.end < word.start ||
			word.start < previousEnd ||
			word.end > sidecar.durationSeconds
		) {
			throw new EpisodeAudioError("EpisodeAudioStale", 409);
		}
		previousEnd = word.end;
	}
};

const loadEpisodeAudio = async (
	seasonSlug: string,
	episodeIdx: number,
	episodeText: string,
) => {
	const paths = audioArtifactPaths(seasonSlug, episodeIdx);
	const audioFile = Bun.file(paths.audioPath);
	const timingsFile = Bun.file(paths.timingsPath);

	if (!(await audioFile.exists()) || !(await timingsFile.exists())) {
		return null;
	}

	try {
		const sidecar = wordTimingSidecarSchema.parse(await timingsFile.json());
		const audioBytes = new Uint8Array(await audioFile.arrayBuffer());
		assertSidecarMatchesEpisode(
			sidecar,
			seasonSlug,
			episodeIdx,
			episodeText,
			audioBytes,
		);
		return { ...paths, sidecar };
	} catch (error) {
		if (error instanceof EpisodeAudioError) {
			throw error;
		}
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
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
		const { child, season, episodeIdx, episode } = await loadOpenEpisode(
			c.req.param("id"),
			c.req.param("episodeIdx"),
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
		);
		const audio = await loadEpisodeAudio(season.slug, episodeIdx, episode.text);
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
		);
		const audio = await loadEpisodeAudio(season.slug, episodeIdx, episode.text);
		if (!audio) {
			return c.json({ error: "EpisodeAudioMissing" }, 404);
		}

		return new Response(Bun.file(audio.audioPath), {
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
