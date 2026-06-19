import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import pixelGardenSeasonData from "../../seasons/pixel-garden-s1.json";
import rainbowDoorSeasonData from "../../seasons/rainbow-door-s1.json";
import { graduationStatus } from "../lib/graduation";
import { lastActiveAt, sessionTotals, wpmTrend } from "../lib/readerStats";
import { rolling3Wpm } from "../lib/rolling3";
import { seasonSchema } from "../lib/schemas/season";
import {
	type Session,
	type SignedInUser,
	type StoryProgress,
	sessionSubmissionSchema,
	signedInUserSchema,
	type UserProfile,
} from "../lib/schemas/state";
import {
	checkStoryText,
	type StoryTextViolation,
} from "../lib/storyTextPolicy";
import { AudioGenerationError, generateEpisodeAudio } from "./audioGeneration";
import { AudioPublishError, publishEpisodeAudio } from "./audioPublish";
import { isAuthConfigured, makeAuth } from "./auth";
import {
	DEFAULT_AUDIO_DIR,
	DEFAULT_PORT,
	DEFAULT_SEASONS_DIR,
	HOSTNAME,
} from "./config";
import { HttpError } from "./httpError";
import type {
	AssetStore,
	ProgressStore,
	Season,
	ServerBindings,
	StoryStore,
} from "./stores";
import {
	D1ProgressStore,
	D1StoryStore,
	DiskAssetStore,
	DiskStoryStore,
	EpisodeAudioError,
	InMemoryAssetStore,
	InMemoryProgressStore,
	InMemoryStoryStore,
	R2AssetStore,
} from "./stores";

const WILDCARD_HOSTNAME = "0.0.0.0";
const LOCAL_ADMIN_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

const adminEpisodeUpdateSchema = z.object({
	text: z.string().min(1),
});

function isBunRuntime(): boolean {
	return typeof Bun !== "undefined";
}

function bunEnv(name: string, fallback: string): string {
	if (!isBunRuntime()) {
		return fallback;
	}
	return Bun.env[name] ?? fallback;
}

function seasonsDir(): string {
	return bunEnv("TYPELING_SEASONS_DIR", DEFAULT_SEASONS_DIR);
}

function audioDir(): string {
	return bunEnv("TYPELING_AUDIO_DIR", DEFAULT_AUDIO_DIR);
}

function stripClientSessionIdentity(body: unknown): unknown {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return body;
	}

	const copy = { ...(body as Record<string, unknown>) };
	delete copy.signed_in_user;
	delete copy.child_id;
	delete copy.email;
	return copy;
}

const bundledSeasons: Season[] = [
	rainbowDoorSeasonData,
	pixelGardenSeasonData,
].map((season) => seasonSchema.parse(season));

type OpenEpisode = {
	progress: StoryProgress;
	season: Season;
	episodeIdx: number;
	episode: Season["episodes"][number];
};
type AdminAudioStatus =
	| {
			status: "ready";
			duration_seconds: number;
			words: number;
	  }
	| { status: "missing" }
	| { status: "stale"; error: string };

type EpisodeAccessCode = "InvalidEpisode" | "EpisodeNotFound" | "EpisodeLocked";

class EpisodeAccessError extends HttpError {
	constructor(code: EpisodeAccessCode, status: 400 | 403 | 404) {
		super(code, status);
		this.name = "EpisodeAccessError";
	}
}

class AdminAccessError extends HttpError {
	constructor(code: string, status: 400 | 403 | 404 | 409 | 422 | 503) {
		super(code, status);
		this.name = "AdminAccessError";
	}
}

class AuthError extends HttpError {
	constructor() {
		super("AuthenticationRequired", 401);
		this.name = "AuthError";
	}
}

export const app = new Hono<{ Bindings: ServerBindings }>();

app.onError((error, c) => {
	if (error instanceof HttpError) {
		return c.json({ error: error.code }, error.status);
	}
	console.error(error);
	return c.json({ error: error.name }, 500);
});

// Better Auth owns the Google OAuth flow and its own session/user tables; this
// catch-all hands every /api/auth/* request to it. Returns 503 when auth is
// unconfigured (tests, D1-less dev:direct) so the route never half-runs.
app.on(["POST", "GET"], "/api/auth/*", (c) => {
	if (!isAuthConfigured(c.env)) {
		return c.json({ error: "AuthNotConfigured" }, 503);
	}
	return makeAuth(c.env).handler(c.req.raw);
});

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
	storySlug: string,
	rawEpisodeIdx: string,
	request: Request,
	env: ServerBindings = {},
): Promise<OpenEpisode> {
	const episodeIdx = parseEpisodeIdx(rawEpisodeIdx);
	const user = await requireUser(request, env);
	const season = await getStoryStore(env).readSeason(storySlug);
	const progress = await getProgressStore(env).ensureStoryProgress(
		user.email,
		season.slug,
	);
	assertEpisodeIsOpen(
		episodeIdx,
		progress.current_episode,
		season.episodes.length,
	);

	const episode = season.episodes[episodeIdx];
	if (!episode) {
		throw new EpisodeAccessError("EpisodeNotFound", 404);
	}

	return { progress, season, episodeIdx, episode };
}

let workerProgressStore: InMemoryProgressStore | undefined;
let workerAssetStore: InMemoryAssetStore | undefined;
let workerStoryStore: InMemoryStoryStore | undefined;

function getDefaultProgressStore(): ProgressStore {
	workerProgressStore ??= new InMemoryProgressStore();
	return workerProgressStore;
}

function getProgressStore(env: ServerBindings): ProgressStore {
	if (env.PROGRESS_STORE) {
		return env.PROGRESS_STORE;
	}
	if (env.STORY_DB) {
		return new D1ProgressStore(env.STORY_DB);
	}
	return getDefaultProgressStore();
}

function getDefaultAssetStore(): AssetStore {
	if (!isBunRuntime()) {
		workerAssetStore ??= new InMemoryAssetStore({});
		return workerAssetStore;
	}

	return new DiskAssetStore({
		audioDir: audioDir(),
	});
}

function getAssetStore(env: ServerBindings): AssetStore {
	if (env.ASSET_STORE) {
		return env.ASSET_STORE;
	}
	if (env.ASSETS_BUCKET) {
		return new R2AssetStore(env.ASSETS_BUCKET);
	}
	return getDefaultAssetStore();
}

function getDefaultStoryStore(): StoryStore {
	if (!isBunRuntime()) {
		workerStoryStore ??= new InMemoryStoryStore({ seasons: bundledSeasons });
		return workerStoryStore;
	}

	return new DiskStoryStore({
		seasonsDir: seasonsDir(),
	});
}

function getStoryStore(env: ServerBindings): StoryStore {
	if (env.STORY_STORE) {
		return env.STORY_STORE;
	}
	if (env.STORY_DB) {
		return new D1StoryStore(env.STORY_DB);
	}
	return getDefaultStoryStore();
}

async function currentIdentityFromRequest(
	request: Request,
	env: ServerBindings,
): Promise<SignedInUser | null> {
	if (env.IDENTITY) return env.IDENTITY;
	return sessionIdentity(request, env);
}

async function sessionIdentity(
	request: Request,
	env: ServerBindings,
): Promise<SignedInUser | null> {
	if (!isAuthConfigured(env)) return null;
	const session = await makeAuth(env).api.getSession({
		headers: request.headers,
	});
	const sessionUser = session?.user;
	if (!sessionUser?.email) return null;

	const name = sessionUser.name?.trim();
	const parsed = signedInUserSchema.safeParse({
		email: sessionUser.email.trim().toLowerCase(),
		display_name: name || sessionUser.email,
		...(name ? { name } : {}),
		...(sessionUser.id ? { access_subject: String(sessionUser.id) } : {}),
	});
	return parsed.success ? parsed.data : null;
}

async function requireUser(
	request: Request,
	env: ServerBindings,
): Promise<UserProfile> {
	const identity = await currentIdentityFromRequest(request, env);
	if (!identity) {
		throw new AuthError();
	}
	return getProgressStore(env).upsertUser(identity);
}

function normalizeHostname(hostname: string): string {
	const lower = hostname.toLowerCase();
	// `new URL("http://[::1]:8765").hostname` yields the bracketed literal
	// "[::1]"; strip the brackets so IPv6 loopback matches the unbracketed
	// "::1" entry in LOCAL_ADMIN_HOSTNAMES.
	return lower.startsWith("[") && lower.endsWith("]")
		? lower.slice(1, -1)
		: lower;
}

function isLocalAdminHostname(hostname: string | null | undefined): boolean {
	if (!hostname) return false;
	const normalized = normalizeHostname(hostname);
	return (
		LOCAL_ADMIN_HOSTNAMES.has(normalized) || normalized.endsWith(".localhost")
	);
}

function isLocalAdminRequest(request: Request): boolean {
	const url = new URL(request.url);
	if (isLocalAdminHostname(url.hostname)) return true;

	const host = request.headers.get("host")?.split(":")[0];
	return isLocalAdminHostname(host);
}

function assertLocalAdminRequest(request: Request): void {
	if (!isLocalAdminRequest(request)) {
		throw new AdminAccessError("AdminLocalOnly", 403);
	}
}

function assertLocalDiskAdmin(env: ServerBindings): void {
	if (!isBunRuntime() || env.ASSETS_BUCKET || env.STORY_DB) {
		throw new AdminAccessError("AdminLocalDiskOnly", 403);
	}
}

function assertStoryWriteAllowed(env: ServerBindings): void {
	if (env.STORY_DB || env.STORY_STORE) return;
	assertLocalDiskAdmin(env);
}

interface AudioGenerationConfig {
	geminiApiKey: string;
	openRouterApiKey: string;
	alignerUrl: string;
}

function isAudioGenerationEnabled(env: ServerBindings): boolean {
	const flag = env.ADMIN_AUDIO_GENERATION_ENABLED?.trim().toLowerCase();
	return flag === "1" || flag === "true" || flag === "yes";
}

function assertAudioGenerationEnabled(env: ServerBindings): void {
	// Checked BEFORE any secret is read: when the feature flag is off the route
	// never touches GEMINI_API_KEY / OPENROUTER_API_KEY. The flag lives in
	// .dev.vars only, so this route is inert in production.
	if (!isAudioGenerationEnabled(env)) {
		throw new AdminAccessError("AudioGenerationDisabled", 403);
	}
}

function isLoopbackUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	return LOCAL_ADMIN_HOSTNAMES.has(normalizeHostname(url.hostname));
}

function readAudioGenerationConfig(env: ServerBindings): AudioGenerationConfig {
	const geminiApiKey = env.GEMINI_API_KEY?.trim();
	const openRouterApiKey = env.OPENROUTER_API_KEY?.trim();
	const alignerUrl = env.ALIGNER_URL?.trim();
	if (!geminiApiKey || !openRouterApiKey || !alignerUrl) {
		throw new AdminAccessError("AudioGenerationNotConfigured", 503);
	}
	// Defence in depth: the aligner is a local-only service. Never let the
	// Worker POST generated audio to a non-loopback address.
	if (!isLoopbackUrl(alignerUrl)) {
		throw new AdminAccessError("AlignerUrlNotLoopback", 403);
	}
	return { geminiApiKey, openRouterApiKey, alignerUrl };
}

function isAudioPublishEnabled(env: ServerBindings): boolean {
	const flag = env.ADMIN_AUDIO_PUBLISH_ENABLED?.trim().toLowerCase();
	return flag === "1" || flag === "true" || flag === "yes";
}

function assertAudioPublishEnabled(env: ServerBindings): void {
	// Checked BEFORE the loopback URL is read: when the feature flag is off the
	// route never touches the publisher. The flag lives in `.dev.vars` only, so
	// this route is inert in production.
	if (!isAudioPublishEnabled(env)) {
		throw new AdminAccessError("AudioPublishDisabled", 403);
	}
}

function readAudioPublishConfig(env: ServerBindings): { publisherUrl: string } {
	const publisherUrl = env.ALIGNER_URL?.trim();
	if (!publisherUrl) {
		throw new AdminAccessError("AudioPublishNotConfigured", 503);
	}
	// Defence in depth: the publisher sidecar is a local-only service. Never let
	// the Worker POST audio to a non-loopback address.
	if (!isLoopbackUrl(publisherUrl)) {
		throw new AdminAccessError("PublishUrlNotLoopback", 403);
	}
	return { publisherUrl };
}

function adminStoryViolationCode(violation: StoryTextViolation): string {
	switch (violation.kind) {
		case "charset":
			return "InvalidStoryCharset";
		case "blacklist":
			return "UnsafeStoryText";
		case "forbidden-name":
			return "RealChildNameInStory";
		default: {
			const _exhaustive: never = violation;
			return _exhaustive;
		}
	}
}

function assertAdminStoryText(text: string): void {
	const violation = checkStoryText(text);
	if (violation) {
		throw new AdminAccessError(adminStoryViolationCode(violation), 422);
	}
}

async function loadAdminAudioStatus(
	assetStore: AssetStore,
	season: Season,
	episodeIdx: number,
	episodeText: string,
): Promise<AdminAudioStatus> {
	try {
		const audio = await assetStore.readEpisodeAudio(
			season.slug,
			episodeIdx,
			episodeText,
		);
		if (!audio) {
			return { status: "missing" };
		}
		return {
			status: "ready",
			duration_seconds: audio.sidecar.durationSeconds,
			words: audio.sidecar.words.length,
		};
	} catch (error) {
		if (error instanceof EpisodeAudioError) {
			return { status: "stale", error: error.message };
		}
		throw error;
	}
}

async function loadAdminSeason(
	seasonSlug: string,
	env: ServerBindings,
): Promise<
	Season & {
		episodes: Array<
			Season["episodes"][number] & {
				audio: AdminAudioStatus;
				char_count: number;
				word_count: number;
			}
		>;
	}
> {
	const assetStore = getAssetStore(env);
	const season = await getStoryStore(env).readSeason(seasonSlug);
	const episodes = await Promise.all(
		season.episodes.map(async (episode) => ({
			...episode,
			char_count: episode.text.length,
			word_count: episode.text.split(/\s+/).filter(Boolean).length,
			audio: await loadAdminAudioStatus(
				assetStore,
				season,
				episode.idx,
				episode.text,
			),
		})),
	);
	return { ...season, episodes };
}

function formatVttTimestamp(seconds: number): string {
	const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
	const hours = Math.floor(totalMilliseconds / 3_600_000);
	const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
	const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
	const millis = totalMilliseconds % 1000;
	return `${hours.toString().padStart(2, "0")}:${minutes
		.toString()
		.padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${millis
		.toString()
		.padStart(3, "0")}`;
}

function buildEpisodeCaptions(
	episodeText: string,
	durationSeconds: number,
): string {
	const safeText = episodeText
		.replace(/\r\n?/g, "\n")
		.replaceAll("-->", "->")
		.trim();
	const end = formatVttTimestamp(Math.max(0.001, durationSeconds));
	return `WEBVTT\n\n${formatVttTimestamp(0)} --> ${end}\n${safeText}\n`;
}

app.post("/api/sessions", async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = sessionSubmissionSchema.safeParse(
		stripClientSessionIdentity(body),
	);
	if (!parsed.success) {
		return c.json({ error: "InvalidSession" }, 400);
	}

	const user = await requireUser(c.req.raw, c.env);
	const season = await getStoryStore(c.env).readSeason(parsed.data.season_slug);
	if (!season.episodes[parsed.data.episode_idx]) {
		throw new EpisodeAccessError("EpisodeNotFound", 404);
	}
	const session = await getProgressStore(c.env).createSession(
		user.email,
		parsed.data,
	);
	return c.json(session, 200);
});

app.get("/api/health", (c) => {
	return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
	const identity = await currentIdentityFromRequest(c.req.raw, c.env);
	if (!identity) {
		return c.json({ authenticated: false });
	}
	const user = await getProgressStore(c.env).upsertUser(identity);
	return c.json({ authenticated: true, user });
});

app.get("/api/stories", async (c) => {
	return c.json(await getStoryStore(c.env).listStories());
});

app.get("/api/progress", async (c) => {
	const user = await requireUser(c.req.raw, c.env);
	const [stories, progressRows, sessions] = await Promise.all([
		getStoryStore(c.env).listStories(),
		getProgressStore(c.env).listStoryProgress(user.email),
		getProgressStore(c.env).listSessions(user.email),
	]);
	const progressByStory = new Map(
		progressRows.map((progress) => [progress.season_slug, progress]),
	);
	const sessionsByStory = new Map<string, Session[]>();
	for (const session of sessions) {
		const storySessions = sessionsByStory.get(session.season_slug) ?? [];
		storySessions.push(session);
		sessionsByStory.set(session.season_slug, storySessions);
	}

	return c.json({
		user,
		stories: stories.map((story) => {
			const storySessions = sessionsByStory.get(story.slug) ?? [];
			const rolling3 = rolling3Wpm(storySessions, {
				seasonSlug: story.slug,
			});
			return {
				...story,
				current_episode: progressByStory.get(story.slug)?.current_episode ?? 0,
				target_wpm: user.target_wpm,
				rolling3,
				status: graduationStatus(rolling3, user.target_wpm),
				recent_sessions: storySessions.slice(0, 10),
			};
		}),
	});
});

// Parent stats dashboard. Every Google account is a kid, so this aggregates
// across ALL accounts and is gated by the `parent_viewers` allowlist (managed
// only via local wrangler commands -- the app never writes it). 401 when not
// signed in, 403 when the signed-in account is not an allowlisted viewer.
app.get("/api/parent/family", async (c) => {
	const viewer = await requireUser(c.req.raw, c.env);
	const progressStore = getProgressStore(c.env);
	if (!(await progressStore.isParentViewer(viewer.email))) {
		throw new HttpError("ParentViewOnly", 403);
	}

	const [stories, users] = await Promise.all([
		getStoryStore(c.env).listStories(),
		progressStore.listUsers(),
	]);

	// Exclude parent-viewer accounts so a viewing parent isn't listed as an
	// empty "reader" alongside the kids.
	const readerFlags = await Promise.all(
		users.map((user) => progressStore.isParentViewer(user.email)),
	);
	const readerUsers = users.filter((_, i) => !readerFlags[i]);

	const readers = await Promise.all(
		readerUsers.map(async (user) => {
			const [progressRows, sessions] = await Promise.all([
				progressStore.listStoryProgress(user.email),
				progressStore.listSessions(user.email),
			]);
			const progressByStory = new Map(
				progressRows.map((progress) => [progress.season_slug, progress]),
			);
			return {
				email: user.email,
				display_name: user.display_name,
				target_wpm: user.target_wpm,
				stories: stories.map((story) => {
					const storySessions = sessions.filter(
						(session) => session.season_slug === story.slug,
					);
					const rolling3 = rolling3Wpm(storySessions, {
						seasonSlug: story.slug,
					});
					return {
						...story,
						current_episode:
							progressByStory.get(story.slug)?.current_episode ?? 0,
						target_wpm: user.target_wpm,
						rolling3,
						status: graduationStatus(rolling3, user.target_wpm),
						totals: sessionTotals(storySessions),
						trend: wpmTrend(storySessions),
						last_active_at: lastActiveAt(storySessions),
						recent_sessions: storySessions.slice(0, 10),
					};
				}),
			};
		}),
	);

	readers.sort((a, b) => a.display_name.localeCompare(b.display_name));
	return c.json({ readers });
});

app.get("/api/admin/stories", async (c) => {
	assertLocalAdminRequest(c.req.raw);
	const stories = await getStoryStore(c.env).listStories();
	const seasons = await Promise.all(
		stories.map(async (story) => loadAdminSeason(story.slug, c.env)),
	);

	return c.json({
		admin: {
			access: "local-only",
		},
		stories: seasons,
	});
});

app.put("/api/admin/seasons/:slug/episodes/:episodeIdx", async (c) => {
	assertLocalAdminRequest(c.req.raw);
	assertStoryWriteAllowed(c.env);

	const body = await c.req.json().catch(() => null);
	const parsed = adminEpisodeUpdateSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "InvalidAdminEpisodeUpdate" }, 400);
	}

	const slug = c.req.param("slug");
	const episodeIdx = parseEpisodeIdx(c.req.param("episodeIdx"));
	const storyStore = getStoryStore(c.env);
	const season = await storyStore.readSeason(slug);
	const episode = season.episodes[episodeIdx];
	if (!episode) {
		throw new AdminAccessError("EpisodeNotFound", 404);
	}

	assertAdminStoryText(parsed.data.text);

	const savedSeason = await storyStore.writeEpisodeText(
		slug,
		episodeIdx,
		parsed.data.text,
	);
	const savedEpisode = savedSeason.episodes[episodeIdx];
	if (!savedEpisode) {
		throw new AdminAccessError("EpisodeNotFound", 404);
	}

	return c.json({
		episode: {
			...savedEpisode,
			char_count: savedEpisode.text.length,
			word_count: savedEpisode.text.split(/\s+/).filter(Boolean).length,
			audio: await loadAdminAudioStatus(
				getAssetStore(c.env),
				savedSeason,
				episodeIdx,
				savedEpisode.text,
			),
		},
		season_slug: savedSeason.slug,
	});
});

app.get(
	"/api/admin/seasons/:slug/episodes/:episodeIdx/audio/file",
	async (c) => {
		assertLocalAdminRequest(c.req.raw);

		const slug = c.req.param("slug");
		const episodeIdx = parseEpisodeIdx(c.req.param("episodeIdx"));
		const assetStore = getAssetStore(c.env);
		const season = await getStoryStore(c.env).readSeason(slug);
		const episode = season.episodes[episodeIdx];
		if (!episode) {
			throw new AdminAccessError("EpisodeNotFound", 404);
		}

		const audio = await assetStore.readEpisodeAudioFile(
			season.slug,
			episodeIdx,
			episode.text,
			c.req.raw.headers,
		);
		if (!audio) {
			return c.json({ error: "EpisodeAudioMissing" }, 404);
		}

		return new Response(audio.body, {
			status: audio.status,
			headers: audioFileHeaders(audio),
		});
	},
);

app.get(
	"/api/admin/seasons/:slug/episodes/:episodeIdx/audio/captions.vtt",
	async (c) => {
		assertLocalAdminRequest(c.req.raw);

		const slug = c.req.param("slug");
		const episodeIdx = parseEpisodeIdx(c.req.param("episodeIdx"));
		const assetStore = getAssetStore(c.env);
		const season = await getStoryStore(c.env).readSeason(slug);
		const episode = season.episodes[episodeIdx];
		if (!episode) {
			throw new AdminAccessError("EpisodeNotFound", 404);
		}

		const audio = await assetStore.readEpisodeAudio(
			season.slug,
			episodeIdx,
			episode.text,
		);
		if (!audio) {
			return c.json({ error: "EpisodeAudioMissing" }, 404);
		}

		return new Response(
			buildEpisodeCaptions(episode.text, audio.sidecar.durationSeconds),
			{
				headers: {
					"content-type": "text/vtt; charset=utf-8",
				},
			},
		);
	},
);

app.post("/api/admin/seasons/:slug/episodes/:episodeIdx/audio", async (c) => {
	assertLocalAdminRequest(c.req.raw);
	// Gate on the feature flag before reading any secrets.
	assertAudioGenerationEnabled(c.env);
	const { geminiApiKey, openRouterApiKey, alignerUrl } =
		readAudioGenerationConfig(c.env);

	const slug = c.req.param("slug");
	const episodeIdx = parseEpisodeIdx(c.req.param("episodeIdx"));
	const storyStore = getStoryStore(c.env);
	const season = await storyStore.readSeason(slug);
	const episode = season.episodes[episodeIdx];
	if (!episode) {
		throw new AdminAccessError("EpisodeNotFound", 404);
	}

	const assetStore = getAssetStore(c.env);
	try {
		await generateEpisodeAudio({
			seasonSlug: season.slug,
			episodeIdx,
			episodeText: episode.text,
			geminiApiKey,
			openRouterApiKey,
			alignerUrl,
			assetStore,
		});
	} catch (error) {
		if (error instanceof AudioGenerationError) {
			return c.json(
				{ error: error.code, detail: error.message },
				error.status as ContentfulStatusCode,
			);
		}
		throw error;
	}

	return c.json({
		episode: {
			idx: episodeIdx,
			audio: await loadAdminAudioStatus(
				assetStore,
				season,
				episodeIdx,
				episode.text,
			),
		},
		season_slug: season.slug,
	});
});

app.post(
	"/api/admin/seasons/:slug/episodes/:episodeIdx/audio/publish",
	async (c) => {
		assertLocalAdminRequest(c.req.raw);
		// Gate on the feature flag before reading the loopback URL.
		assertAudioPublishEnabled(c.env);
		const { publisherUrl } = readAudioPublishConfig(c.env);

		const slug = c.req.param("slug");
		const episodeIdx = parseEpisodeIdx(c.req.param("episodeIdx"));
		const storyStore = getStoryStore(c.env);
		const season = await storyStore.readSeason(slug);
		const episode = season.episodes[episodeIdx];
		if (!episode) {
			throw new AdminAccessError("EpisodeNotFound", 404);
		}

		const assetStore = getAssetStore(c.env);
		try {
			const publish = await publishEpisodeAudio({
				seasonSlug: season.slug,
				episodeIdx,
				episodeText: episode.text,
				assetStore,
				publisherUrl,
			});
			return c.json({
				season_slug: season.slug,
				episode: { idx: episodeIdx, publish },
			});
		} catch (error) {
			if (error instanceof AudioPublishError) {
				return c.json(
					{ error: error.code, detail: error.message },
					error.status as ContentfulStatusCode,
				);
			}
			throw error;
		}
	},
);

app.get("/api/stories/:storySlug/current-episode", async (c) => {
	const user = await requireUser(c.req.raw, c.env);
	const season = await getStoryStore(c.env).readSeason(
		c.req.param("storySlug"),
	);
	const progress = await getProgressStore(c.env).ensureStoryProgress(
		user.email,
		season.slug,
	);

	if (progress.current_episode >= season.episodes.length) {
		return c.json({
			complete: true,
			current_episode: progress.current_episode,
			season_slug: season.slug,
			story_name: season.name,
			total_episodes: season.episodes.length,
		});
	}

	const episode = season.episodes[progress.current_episode];
	if (!episode) {
		return c.json({
			complete: true,
			current_episode: progress.current_episode,
			season_slug: season.slug,
			story_name: season.name,
			total_episodes: season.episodes.length,
		});
	}

	return c.json({
		text: episode.text,
		episode_idx: progress.current_episode,
		current_episode: progress.current_episode,
		season_slug: season.slug,
		story_name: season.name,
		total_episodes: season.episodes.length,
	});
});

app.get("/api/stories/:storySlug/episodes/:episodeIdx", async (c) => {
	const { progress, season, episodeIdx, episode } = await loadOpenEpisode(
		c.req.param("storySlug"),
		c.req.param("episodeIdx"),
		c.req.raw,
		c.env,
	);

	return c.json({
		text: episode.text,
		episode_idx: episodeIdx,
		current_episode: progress.current_episode,
		season_slug: season.slug,
		story_name: season.name,
		total_episodes: season.episodes.length,
	});
});

app.get("/api/stories/:storySlug/episodes/:episodeIdx/audio", async (c) => {
	const storySlug = c.req.param("storySlug");
	const { season, episodeIdx, episode } = await loadOpenEpisode(
		storySlug,
		c.req.param("episodeIdx"),
		c.req.raw,
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
		audio_url: `/api/stories/${encodeURIComponent(
			storySlug,
		)}/episodes/${episodeIdx}/audio/file`,
		duration_seconds: audio.sidecar.durationSeconds,
		words: audio.sidecar.words,
	});
});

app.get(
	"/api/stories/:storySlug/episodes/:episodeIdx/audio/file",
	async (c) => {
		const { season, episodeIdx, episode } = await loadOpenEpisode(
			c.req.param("storySlug"),
			c.req.param("episodeIdx"),
			c.req.raw,
			c.env,
		);
		const audio = await getAssetStore(c.env).readEpisodeAudioFile(
			season.slug,
			episodeIdx,
			episode.text,
			c.req.raw.headers,
		);
		if (!audio) {
			return c.json({ error: "EpisodeAudioMissing" }, 404);
		}

		return new Response(audio.body, {
			status: audio.status,
			headers: audioFileHeaders(audio),
		});
	},
);

function audioFileHeaders(audio: {
	contentLength?: number;
	contentRange?: string;
	contentType?: string;
}): Headers {
	const headers = new Headers({
		"accept-ranges": "bytes",
		"content-type": audio.contentType ?? "audio/wav",
	});

	if (audio.contentLength !== undefined) {
		headers.set("content-length", String(audio.contentLength));
	}
	if (audio.contentRange) {
		headers.set("content-range", audio.contentRange);
	}

	return headers;
}

app.post("/api/stories/:storySlug/episodes/:episodeIdx/reset", async (c) => {
	const user = await requireUser(c.req.raw, c.env);
	const storySlug = c.req.param("storySlug");
	const episodeIdx = parseEpisodeIdx(c.req.param("episodeIdx"));
	const season = await getStoryStore(c.env).readSeason(storySlug);
	const progress = await getProgressStore(c.env).ensureStoryProgress(
		user.email,
		season.slug,
	);
	assertEpisodeIsOpen(
		episodeIdx,
		progress.current_episode,
		season.episodes.length,
	);
	const nextProgress = await getProgressStore(c.env).resetStoryProgress(
		user.email,
		season.slug,
		episodeIdx,
	);
	return c.json({ current_episode: nextProgress.current_episode });
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
		("ASSET_STORE" in value ||
			"STORY_DB" in value ||
			"STORY_STORE" in value ||
			"PROGRESS_STORE" in value ||
			"ASSETS_BUCKET" in value ||
			"IDENTITY" in value ||
			"ADMIN_AUDIO_GENERATION_ENABLED" in value ||
			"ADMIN_AUDIO_PUBLISH_ENABLED" in value ||
			"ALIGNER_URL" in value ||
			"GEMINI_API_KEY" in value ||
			"OPENROUTER_API_KEY" in value)
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
	return app.fetch(request, env);
}

if (import.meta.main) {
	const port = readPort();

	Bun.serve({
		fetch,
		hostname: HOSTNAME,
		port,
	});
	console.log(`Server running on http://${HOSTNAME}:${port}`);
}

export default { fetch };
