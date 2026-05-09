import { join } from "node:path";
import { Hono } from "hono";
import { seasonSchema } from "../lib/schemas/season";
import { readState } from "./state";

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

export class EpisodeIndexOutOfRangeError extends Error {
	constructor(seasonSlug: string, episodeIdx: number, episodeCount: number) {
		super(
			`Episode index ${episodeIdx} is past the end of season ${seasonSlug} (${episodeCount} episodes)`,
		);
		this.name = "EpisodeIndexOutOfRangeError";
	}
}

export const app = new Hono();

app.onError((error, c) => {
	console.error(error);
	return c.json({ error: error.name }, 500);
});

app.get("/api/health", (c) => {
	return c.json({ ok: true });
});

app.get("/api/children", async (c) => {
	const state = await readState(statePath());
	return c.json(state.children);
});

app.get("/api/children/:id/current-episode", async (c) => {
	const childId = c.req.param("id");
	const state = await readState(statePath());
	const child = state.children[childId];
	if (!child) {
		return c.json({ error: "ChildNotFound" }, 404);
	}

	const seasonPath = join(seasonsDir(), `${child.active_season}.json`);
	const seasonFile = Bun.file(seasonPath);
	if (!(await seasonFile.exists())) {
		throw new SeasonFileNotFoundError(child.active_season);
	}
	const season = seasonSchema.parse(await seasonFile.json());
	const episode = season.episodes[child.current_episode];
	if (!episode) {
		throw new EpisodeIndexOutOfRangeError(
			season.slug,
			child.current_episode,
			season.episodes.length,
		);
	}

	return c.json({
		text: episode.text,
		episode_idx: child.current_episode,
		season_slug: season.slug,
	});
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
	const port = readPort();

	Bun.serve({
		fetch,
		hostname: HOSTNAME,
		port,
	});
	console.log(`Server running on http://${HOSTNAME}:${port}`);
}

export default fetch;
