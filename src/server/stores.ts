import { createHash } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { checkSidecarMatchesEpisodeText } from "../lib/audio/sidecarMatch";
import { seasonSchema } from "../lib/schemas/season";
import {
	type Session,
	type SessionSubmission,
	type SignedInUser,
	type StoryProgress,
	sessionSchema,
	storyProgressSchema,
	type UserProfile,
	userProfileSchema,
} from "../lib/schemas/state";
import {
	type WordTimingSidecar,
	wordTimingSidecarSchema,
} from "../lib/wordTimings";
import { HttpError } from "./httpError";

export type Season = ReturnType<typeof seasonSchema.parse>;
type EpisodeAudioCode = "EpisodeAudioMissing" | "EpisodeAudioStale";

export class SeasonFileNotFoundError extends HttpError {
	constructor(seasonSlug: string) {
		super(
			"StoryNotFound",
			404,
			`Season file not found for slug: ${seasonSlug}`,
		);
		this.name = "SeasonFileNotFoundError";
	}
}

interface D1ResultLike<T = Record<string, unknown>> {
	results?: T[];
	meta?: {
		changes?: number;
	};
}

interface D1PreparedStatementLike {
	bind(...values: unknown[]): D1PreparedStatementLike;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
	run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
	prepare(query: string): D1PreparedStatementLike;
}

interface D1SeasonRow {
	slug: string;
	name: string;
	theme: string;
}

interface D1EpisodeRow {
	idx: number;
	text: string;
}

interface D1UserRow {
	email: string;
	display_name: string;
	name: string | null;
	access_subject: string | null;
	target_wpm: number;
}

interface D1ProgressRow {
	email: string;
	season_slug: string;
	current_episode: number;
}

interface D1SessionRow {
	id: string;
	email: string;
	season_slug: string;
	episode_idx: number;
	wpm: number;
	char_count: number;
	active_ms: number;
	started_at: string;
	finished_at: string;
}

export interface StorySummary {
	slug: string;
	name: string;
	theme: string;
	total_episodes: number;
}

export interface StoryStore {
	listStories(): Promise<StorySummary[]>;
	readSeason(seasonSlug: string): Promise<Season>;
	writeEpisodeText(
		seasonSlug: string,
		episodeIdx: number,
		text: string,
	): Promise<Season>;
}

export class InMemoryStoryStore implements StoryStore {
	#seasons: Map<string, Season>;

	constructor(input: { seasons: Season[] }) {
		this.#seasons = new Map(
			input.seasons.map((season) => {
				const parsed = seasonSchema.parse(structuredClone(season));
				return [parsed.slug, parsed];
			}),
		);
	}

	async listStories(): Promise<StorySummary[]> {
		return [...this.#seasons.values()]
			.map((season) => storySummary(season))
			.sort(compareStorySummaries);
	}

	async readSeason(seasonSlug: string): Promise<Season> {
		const season = this.#seasons.get(seasonSlug);
		if (!season) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}
		return structuredClone(season);
	}

	async writeEpisodeText(
		seasonSlug: string,
		episodeIdx: number,
		text: string,
	): Promise<Season> {
		const season = await this.readSeason(seasonSlug);
		const episode = season.episodes[episodeIdx];
		if (!episode) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}

		const nextSeason = seasonSchema.parse({
			...season,
			episodes: season.episodes.map((current) =>
				current.idx === episodeIdx ? { ...current, text } : current,
			),
		});
		this.#seasons.set(nextSeason.slug, nextSeason);
		return structuredClone(nextSeason);
	}
}

export class DiskStoryStore implements StoryStore {
	#seasonsDir: string;

	constructor(input: { seasonsDir: string }) {
		this.#seasonsDir = input.seasonsDir;
	}

	async listStories(): Promise<StorySummary[]> {
		const stories: StorySummary[] = [];
		const glob = new Bun.Glob("*.json");
		for await (const filePath of glob.scan({
			cwd: this.#seasonsDir,
			absolute: true,
		})) {
			if (filePath.endsWith("-test.json")) {
				continue;
			}
			const season = seasonSchema.parse(await Bun.file(filePath).json());
			stories.push(storySummary(season));
		}
		return stories.sort(compareStorySummaries);
	}

	async readSeason(seasonSlug: string): Promise<Season> {
		const seasonPath = join(this.#seasonsDir, `${seasonSlug}.json`);
		const seasonFile = Bun.file(seasonPath);
		if (!(await seasonFile.exists())) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}
		return seasonSchema.parse(await seasonFile.json());
	}

	async writeEpisodeText(
		seasonSlug: string,
		episodeIdx: number,
		text: string,
	): Promise<Season> {
		const season = await this.readSeason(seasonSlug);
		const episode = season.episodes[episodeIdx];
		if (!episode) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}

		const parsed = seasonSchema.parse({
			...season,
			episodes: season.episodes.map((current) =>
				current.idx === episodeIdx ? { ...current, text } : current,
			),
		});
		const seasonPath = join(this.#seasonsDir, `${parsed.slug}.json`);
		const existing = Bun.file(seasonPath);
		await Bun.write(`${seasonPath}.bak`, existing);
		const tmpPath = `${seasonPath}.tmp`;
		await Bun.write(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`);
		await rename(tmpPath, seasonPath);
		return parsed;
	}
}

export class D1StoryStore implements StoryStore {
	#db: D1DatabaseLike;

	constructor(db: D1DatabaseLike) {
		this.#db = db;
	}

	async listStories(): Promise<StorySummary[]> {
		const stories = await this.#db
			.prepare(
				`
					SELECT seasons.slug, seasons.name, seasons.theme, COUNT(episodes.idx) AS total_episodes
					FROM seasons
					LEFT JOIN episodes ON episodes.season_slug = seasons.slug
					GROUP BY seasons.slug, seasons.name, seasons.theme
					ORDER BY seasons.name ASC, seasons.slug ASC
				`,
			)
			.all<StorySummary>();
		return stories.results ?? [];
	}

	async readSeason(seasonSlug: string): Promise<Season> {
		const season = await this.#db
			.prepare("SELECT slug, name, theme FROM seasons WHERE slug = ?")
			.bind(seasonSlug)
			.first<D1SeasonRow>();
		if (!season) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}

		const episodes = await this.#db
			.prepare(
				"SELECT idx, text FROM episodes WHERE season_slug = ? ORDER BY idx ASC",
			)
			.bind(seasonSlug)
			.all<D1EpisodeRow>();

		return seasonSchema.parse({
			slug: season.slug,
			name: season.name,
			theme: season.theme,
			episodes: (episodes.results ?? []).map((episode) => ({
				idx: episode.idx,
				text: episode.text,
			})),
		});
	}

	async writeEpisodeText(
		seasonSlug: string,
		episodeIdx: number,
		text: string,
	): Promise<Season> {
		const season = await this.readSeason(seasonSlug);
		if (!season.episodes[episodeIdx]) {
			throw new SeasonFileNotFoundError(seasonSlug);
		}

		await this.#db
			.prepare(
				`
					UPDATE episodes
					SET text = ?, text_hash = ?, updated_at = CURRENT_TIMESTAMP
					WHERE season_slug = ? AND idx = ?
				`,
			)
			.bind(text, sha256(text), seasonSlug, episodeIdx)
			.run();

		return this.readSeason(seasonSlug);
	}
}

const DEFAULT_TARGET_WPM = 15;

export class SessionIdConflictError extends HttpError {
	constructor(sessionId: string) {
		super(
			"session_conflict",
			409,
			`Session id belongs to a different user: ${sessionId}`,
		);
		this.name = "SessionIdConflictError";
	}
}

export class ProgressMismatchError extends HttpError {
	constructor() {
		super("episode_mismatch", 409);
		this.name = "ProgressMismatchError";
	}
}

export interface ProgressStore {
	upsertUser(user: SignedInUser): Promise<UserProfile>;
	ensureStoryProgress(
		email: string,
		seasonSlug: string,
	): Promise<StoryProgress>;
	listStoryProgress(email: string): Promise<StoryProgress[]>;
	createSession(email: string, session: SessionSubmission): Promise<Session>;
	listSessions(email: string, seasonSlug?: string): Promise<Session[]>;
	resetStoryProgress(
		email: string,
		seasonSlug: string,
		episodeIdx: number,
	): Promise<StoryProgress>;
}

export class InMemoryProgressStore implements ProgressStore {
	#users = new Map<string, UserProfile>();
	#progress = new Map<string, StoryProgress>();
	#sessions = new Map<string, Session>();
	#queue = Promise.resolve();

	async upsertUser(user: SignedInUser): Promise<UserProfile> {
		return this.#mutate(() => {
			const email = normalizeStoredEmail(user.email);
			const existing = this.#users.get(email);
			const next = userProfileSchema.parse({
				email,
				display_name: user.display_name,
				...(user.name ? { name: user.name } : {}),
				...(user.access_subject ? { access_subject: user.access_subject } : {}),
				target_wpm: existing?.target_wpm ?? DEFAULT_TARGET_WPM,
			});
			this.#users.set(email, next);
			return structuredClone(next);
		});
	}

	async ensureStoryProgress(
		email: string,
		seasonSlug: string,
	): Promise<StoryProgress> {
		return this.#mutate(() => {
			const key = progressKey(email, seasonSlug);
			const existing = this.#progress.get(key);
			if (existing) return structuredClone(existing);
			const progress = storyProgressSchema.parse({
				email: normalizeStoredEmail(email),
				season_slug: seasonSlug,
				current_episode: 0,
			});
			this.#progress.set(key, progress);
			return structuredClone(progress);
		});
	}

	async listStoryProgress(email: string): Promise<StoryProgress[]> {
		const normalized = normalizeStoredEmail(email);
		return [...this.#progress.values()]
			.filter((progress) => progress.email === normalized)
			.map((progress) => structuredClone(progress));
	}

	async createSession(
		email: string,
		session: SessionSubmission,
	): Promise<Session> {
		return this.#mutate(() => {
			const normalized = normalizeStoredEmail(email);
			const existing = this.#sessions.get(session.id);
			if (existing) {
				if (existing.email !== normalized) {
					throw new SessionIdConflictError(session.id);
				}
				return structuredClone(existing);
			}

			const progress = this.#ensureProgressSync(
				normalized,
				session.season_slug,
			);
			if (session.episode_idx > progress.current_episode) {
				throw new ProgressMismatchError();
			}

			const stored = sessionSchema.parse({ ...session, email: normalized });
			this.#sessions.set(stored.id, stored);
			if (session.episode_idx === progress.current_episode) {
				const nextProgress = storyProgressSchema.parse({
					...progress,
					current_episode: session.episode_idx + 1,
				});
				this.#progress.set(
					progressKey(normalized, session.season_slug),
					nextProgress,
				);
			}
			return structuredClone(stored);
		});
	}

	async listSessions(email: string, seasonSlug?: string): Promise<Session[]> {
		const normalized = normalizeStoredEmail(email);
		return [...this.#sessions.values()]
			.filter(
				(session) =>
					session.email === normalized &&
					(seasonSlug === undefined || session.season_slug === seasonSlug),
			)
			.sort((a, b) => b.finished_at.localeCompare(a.finished_at))
			.map((session) => structuredClone(session));
	}

	async resetStoryProgress(
		email: string,
		seasonSlug: string,
		episodeIdx: number,
	): Promise<StoryProgress> {
		return this.#mutate(() => {
			const normalized = normalizeStoredEmail(email);
			const progress = this.#ensureProgressSync(normalized, seasonSlug);
			if (episodeIdx > progress.current_episode) {
				throw new ProgressMismatchError();
			}
			for (const [id, session] of this.#sessions.entries()) {
				if (
					session.email === normalized &&
					session.season_slug === seasonSlug &&
					session.episode_idx >= episodeIdx
				) {
					this.#sessions.delete(id);
				}
			}
			const nextProgress = storyProgressSchema.parse({
				...progress,
				current_episode: episodeIdx,
			});
			this.#progress.set(progressKey(normalized, seasonSlug), nextProgress);
			return structuredClone(nextProgress);
		});
	}

	#ensureProgressSync(email: string, seasonSlug: string): StoryProgress {
		const key = progressKey(email, seasonSlug);
		const existing = this.#progress.get(key);
		if (existing) return existing;
		const progress = storyProgressSchema.parse({
			email,
			season_slug: seasonSlug,
			current_episode: 0,
		});
		this.#progress.set(key, progress);
		return progress;
	}

	#mutate<T>(fn: () => T): Promise<T> {
		const { promise, resolve, reject } = Promise.withResolvers<T>();
		this.#queue = this.#queue.then(() => {
			try {
				resolve(fn());
			} catch (error) {
				reject(error);
			}
		});
		return promise;
	}
}

export class D1ProgressStore implements ProgressStore {
	#db: D1DatabaseLike;

	constructor(db: D1DatabaseLike) {
		this.#db = db;
	}

	async upsertUser(user: SignedInUser): Promise<UserProfile> {
		const email = normalizeStoredEmail(user.email);
		await this.#db
			.prepare(
				`
					INSERT INTO users (email, display_name, name, access_subject)
					VALUES (?, ?, ?, ?)
					ON CONFLICT(email) DO UPDATE SET
						display_name = excluded.display_name,
						name = excluded.name,
						access_subject = excluded.access_subject,
						updated_at = CURRENT_TIMESTAMP
				`,
			)
			.bind(
				email,
				user.display_name,
				user.name ?? null,
				user.access_subject ?? null,
			)
			.run();

		return this.#readUser(email);
	}

	async ensureStoryProgress(
		email: string,
		seasonSlug: string,
	): Promise<StoryProgress> {
		const normalized = normalizeStoredEmail(email);
		await this.#db
			.prepare(
				`
					INSERT OR IGNORE INTO user_story_progress (email, season_slug)
					VALUES (?, ?)
				`,
			)
			.bind(normalized, seasonSlug)
			.run();
		return this.#readStoryProgress(normalized, seasonSlug);
	}

	async listStoryProgress(email: string): Promise<StoryProgress[]> {
		const normalized = normalizeStoredEmail(email);
		const rows = await this.#db
			.prepare(
				`
					SELECT email, season_slug, current_episode
					FROM user_story_progress
					WHERE email = ?
				`,
			)
			.bind(normalized)
			.all<D1ProgressRow>();
		return (rows.results ?? []).map(progressFromRow);
	}

	async createSession(
		email: string,
		session: SessionSubmission,
	): Promise<Session> {
		const normalized = normalizeStoredEmail(email);
		const existing = await this.#readSessionById(session.id);
		if (existing) {
			if (existing.email !== normalized) {
				throw new SessionIdConflictError(session.id);
			}
			return existing;
		}

		const progress = await this.ensureStoryProgress(
			normalized,
			session.season_slug,
		);
		if (session.episode_idx > progress.current_episode) {
			throw new ProgressMismatchError();
		}

		await this.#db
			.prepare(
				`
					INSERT OR IGNORE INTO typing_sessions (
						id,
						email,
						season_slug,
						episode_idx,
						wpm,
						char_count,
						active_ms,
						started_at,
						finished_at
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				`,
			)
			.bind(
				session.id,
				normalized,
				session.season_slug,
				session.episode_idx,
				session.wpm,
				session.char_count,
				session.active_ms,
				session.started_at,
				session.finished_at,
			)
			.run();

		const saved = await this.#readSessionById(session.id);
		if (!saved) {
			throw new Error(`Session was not saved: ${session.id}`);
		}
		if (
			saved.email === normalized &&
			session.episode_idx === progress.current_episode
		) {
			await this.#db
				.prepare(
					`
						UPDATE user_story_progress
						SET current_episode = ?, updated_at = CURRENT_TIMESTAMP
						WHERE email = ? AND season_slug = ?
					`,
				)
				.bind(session.episode_idx + 1, normalized, session.season_slug)
				.run();
		}
		return saved;
	}

	async listSessions(email: string, seasonSlug?: string): Promise<Session[]> {
		const normalized = normalizeStoredEmail(email);
		const rows = seasonSlug
			? await this.#db
					.prepare(
						`
							SELECT id, email, season_slug, episode_idx, wpm, char_count, active_ms, started_at, finished_at
							FROM typing_sessions
							WHERE email = ? AND season_slug = ?
							ORDER BY finished_at DESC
						`,
					)
					.bind(normalized, seasonSlug)
					.all<D1SessionRow>()
			: await this.#db
					.prepare(
						`
							SELECT id, email, season_slug, episode_idx, wpm, char_count, active_ms, started_at, finished_at
							FROM typing_sessions
							WHERE email = ?
							ORDER BY finished_at DESC
						`,
					)
					.bind(normalized)
					.all<D1SessionRow>();
		return (rows.results ?? []).map(sessionFromRow);
	}

	async resetStoryProgress(
		email: string,
		seasonSlug: string,
		episodeIdx: number,
	): Promise<StoryProgress> {
		const normalized = normalizeStoredEmail(email);
		const progress = await this.ensureStoryProgress(normalized, seasonSlug);
		if (episodeIdx > progress.current_episode) {
			throw new ProgressMismatchError();
		}
		await this.#db
			.prepare(
				`
					DELETE FROM typing_sessions
					WHERE email = ? AND season_slug = ? AND episode_idx >= ?
				`,
			)
			.bind(normalized, seasonSlug, episodeIdx)
			.run();
		await this.#db
			.prepare(
				`
					UPDATE user_story_progress
					SET current_episode = ?, updated_at = CURRENT_TIMESTAMP
					WHERE email = ? AND season_slug = ?
				`,
			)
			.bind(episodeIdx, normalized, seasonSlug)
			.run();
		return this.#readStoryProgress(normalized, seasonSlug);
	}

	async #readUser(email: string): Promise<UserProfile> {
		const row = await this.#db
			.prepare(
				"SELECT email, display_name, name, access_subject, target_wpm FROM users WHERE email = ?",
			)
			.bind(normalizeStoredEmail(email))
			.first<D1UserRow>();
		if (!row) {
			throw new Error(`User was not saved: ${email}`);
		}
		return userFromRow(row);
	}

	async #readStoryProgress(
		email: string,
		seasonSlug: string,
	): Promise<StoryProgress> {
		const row = await this.#db
			.prepare(
				`
					SELECT email, season_slug, current_episode
					FROM user_story_progress
					WHERE email = ? AND season_slug = ?
				`,
			)
			.bind(normalizeStoredEmail(email), seasonSlug)
			.first<D1ProgressRow>();
		if (!row) {
			throw new Error(`Progress was not saved: ${email}/${seasonSlug}`);
		}
		return progressFromRow(row);
	}

	async #readSessionById(sessionId: string): Promise<Session | null> {
		const row = await this.#db
			.prepare(
				`
					SELECT id, email, season_slug, episode_idx, wpm, char_count, active_ms, started_at, finished_at
					FROM typing_sessions
					WHERE id = ?
				`,
			)
			.bind(sessionId)
			.first<D1SessionRow>();
		return row ? sessionFromRow(row) : null;
	}
}

function normalizeStoredEmail(email: string): string {
	return email.trim().toLowerCase();
}

function progressKey(email: string, seasonSlug: string): string {
	return `${normalizeStoredEmail(email)}:${seasonSlug}`;
}

function userFromRow(row: D1UserRow): UserProfile {
	return userProfileSchema.parse({
		email: normalizeStoredEmail(row.email),
		display_name: row.display_name,
		...(row.name ? { name: row.name } : {}),
		...(row.access_subject ? { access_subject: row.access_subject } : {}),
		target_wpm: row.target_wpm,
	});
}

function progressFromRow(row: D1ProgressRow): StoryProgress {
	return storyProgressSchema.parse({
		email: normalizeStoredEmail(row.email),
		season_slug: row.season_slug,
		current_episode: row.current_episode,
	});
}

function sessionFromRow(row: D1SessionRow): Session {
	return sessionSchema.parse({
		id: row.id,
		email: normalizeStoredEmail(row.email),
		season_slug: row.season_slug,
		episode_idx: row.episode_idx,
		wpm: row.wpm,
		char_count: row.char_count,
		active_ms: row.active_ms,
		started_at: row.started_at,
		finished_at: row.finished_at,
	});
}

function storySummary(season: Season): StorySummary {
	return {
		slug: season.slug,
		name: season.name,
		theme: season.theme,
		total_episodes: season.episodes.length,
	};
}

function compareStorySummaries(a: StorySummary, b: StorySummary): number {
	return a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
}

export class EpisodeAudioError extends HttpError {
	constructor(code: EpisodeAudioCode, status: 404 | 409) {
		super(code, status);
		this.name = "EpisodeAudioError";
	}
}

export interface EpisodeAudioAsset {
	audioBytes: Uint8Array;
	sidecar: WordTimingSidecar;
	contentType?: string;
}

export interface EpisodeAudioFileAsset {
	body?: ReadableStream | ArrayBuffer;
	contentLength?: number;
	contentRange?: string;
	contentType?: string;
	status: 200 | 206 | 412;
}

interface StoredEpisodeAudioAsset extends EpisodeAudioAsset {
	seasonSlug: string;
	episodeIdx: number;
}

interface R2RangeLike {
	offset?: number;
	length?: number;
	suffix?: number;
}

interface ResolvedByteRange {
	offset: number;
	length: number;
	size: number;
}

interface R2GetOptionsLike {
	onlyIf?: Headers;
	range?: Headers;
}

export interface R2ObjectBodyLike {
	httpMetadata?: {
		contentType?: string;
	};
	customMetadata?: Record<string, string>;
	body?: ReadableStream;
	range?: R2RangeLike;
	size?: number;
	arrayBuffer(): Promise<ArrayBuffer>;
	json<T>(): Promise<T>;
}

export interface R2PutOptionsLike {
	httpMetadata?: { contentType?: string };
	customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
	get(
		key: string,
		options?: R2GetOptionsLike,
	): Promise<R2ObjectBodyLike | null>;
	put(
		key: string,
		value: ArrayBuffer | ArrayBufferView | string,
		options?: R2PutOptionsLike,
	): Promise<unknown>;
	delete(key: string): Promise<void>;
}

export interface AssetStore {
	readEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
	): Promise<EpisodeAudioAsset | null>;
	readEpisodeAudioFile(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		requestHeaders: Headers,
	): Promise<EpisodeAudioFileAsset | null>;
	writeEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		audioBytes: Uint8Array,
		sidecar: WordTimingSidecar,
	): Promise<void>;
}

export class InMemoryAssetStore implements AssetStore {
	#audio: Map<string, EpisodeAudioAsset>;

	constructor(input: {
		audio?: StoredEpisodeAudioAsset[];
		seasons?: Season[];
	}) {
		this.#audio = new Map(
			(input.audio ?? []).map((audio) => [
				audioKey(audio.seasonSlug, audio.episodeIdx),
				cloneAudioAsset(audio),
			]),
		);
	}

	async readEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
	): Promise<EpisodeAudioAsset | null> {
		const audio = this.#audio.get(audioKey(seasonSlug, episodeIdx));
		if (!audio) {
			return null;
		}
		assertSidecarMatchesEpisode(
			audio.sidecar,
			seasonSlug,
			episodeIdx,
			episodeText,
			audio.audioBytes,
		);
		return cloneAudioAsset(audio);
	}

	async readEpisodeAudioFile(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		requestHeaders: Headers,
	): Promise<EpisodeAudioFileAsset | null> {
		const audio = await this.readEpisodeAudio(
			seasonSlug,
			episodeIdx,
			episodeText,
		);
		if (!audio) {
			return null;
		}

		return audioFileFromBytes(
			audio.audioBytes,
			audio.contentType,
			requestHeaders,
		);
	}

	async writeEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		audioBytes: Uint8Array,
		sidecar: WordTimingSidecar,
	): Promise<void> {
		assertSidecarMatchesEpisode(
			sidecar,
			seasonSlug,
			episodeIdx,
			episodeText,
			audioBytes,
		);
		this.#audio.set(
			audioKey(seasonSlug, episodeIdx),
			cloneAudioAsset({ audioBytes, sidecar, contentType: "audio/wav" }),
		);
	}
}

export class R2AssetStore implements AssetStore {
	#bucket: R2BucketLike;

	constructor(bucket: R2BucketLike) {
		this.#bucket = bucket;
	}

	async readEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
	): Promise<EpisodeAudioAsset | null> {
		const baseName = audioBaseName(seasonSlug, episodeIdx);
		const [audioObject, sidecarObject] = await Promise.all([
			this.#bucket.get(`audio/${baseName}.wav`),
			this.#bucket.get(`audio/${baseName}.words.json`),
		]);

		if (!audioObject || !sidecarObject) {
			return null;
		}

		try {
			const sidecar = wordTimingSidecarSchema.parse(await sidecarObject.json());
			const audioBytes = new Uint8Array(await audioObject.arrayBuffer());
			assertSidecarMatchesEpisode(
				sidecar,
				seasonSlug,
				episodeIdx,
				episodeText,
				audioBytes,
			);
			return {
				audioBytes,
				sidecar,
				contentType: audioObject.httpMetadata?.contentType,
			};
		} catch (error) {
			if (error instanceof EpisodeAudioError) {
				throw error;
			}
			throw new EpisodeAudioError("EpisodeAudioStale", 409);
		}
	}

	async readEpisodeAudioFile(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		requestHeaders: Headers,
	): Promise<EpisodeAudioFileAsset | null> {
		const baseName = audioBaseName(seasonSlug, episodeIdx);
		const [audioObject, sidecarObject] = await Promise.all([
			this.#bucket.get(`audio/${baseName}.wav`, {
				range: requestHeaders,
				onlyIf: requestHeaders,
			}),
			this.#bucket.get(`audio/${baseName}.words.json`),
		]);

		if (!audioObject || !sidecarObject) {
			return null;
		}

		try {
			const sidecar = wordTimingSidecarSchema.parse(await sidecarObject.json());
			assertSidecarMatchesEpisodeText(
				sidecar,
				seasonSlug,
				episodeIdx,
				episodeText,
			);
			assertR2AudioMetadataMatchesSidecar(audioObject, sidecar);
			return audioFileFromR2Object(audioObject, requestHeaders.has("range"));
		} catch (error) {
			if (error instanceof EpisodeAudioError) {
				throw error;
			}
			throw new EpisodeAudioError("EpisodeAudioStale", 409);
		}
	}

	async writeEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		audioBytes: Uint8Array,
		sidecar: WordTimingSidecar,
	): Promise<void> {
		assertSidecarMatchesEpisode(
			sidecar,
			seasonSlug,
			episodeIdx,
			episodeText,
			audioBytes,
		);
		const baseName = audioBaseName(seasonSlug, episodeIdx);
		const wavKey = `audio/${baseName}.wav`;
		const sidecarKey = `audio/${baseName}.words.json`;
		const tmpWavKey = `${wavKey}.tmp`;
		const tmpSidecarKey = `${sidecarKey}.tmp`;
		const audioBody = arrayBufferFromBytes(audioBytes);
		const sidecarJson = JSON.stringify(sidecar);
		const wavPut: R2PutOptionsLike = {
			httpMetadata: { contentType: "audio/wav" },
			customMetadata: { sha256: sidecar.audioHash },
		};
		const jsonPut: R2PutOptionsLike = {
			httpMetadata: { contentType: "application/json" },
		};

		// Stage to temp keys and verify the round-trip survives R2 before
		// touching the live keys, so a bad write can't corrupt existing audio.
		await this.#bucket.put(tmpWavKey, audioBody, wavPut);
		await this.#bucket.put(tmpSidecarKey, sidecarJson, jsonPut);
		try {
			const staged = await readR2AudioPair(
				this.#bucket,
				tmpWavKey,
				tmpSidecarKey,
			);
			if (!staged) {
				throw new EpisodeAudioError("EpisodeAudioMissing", 404);
			}
			assertSidecarMatchesEpisode(
				staged.sidecar,
				seasonSlug,
				episodeIdx,
				episodeText,
				staged.audioBytes,
			);

			// Promote: WAV first, sidecar last as the commit marker.
			await this.#bucket.put(wavKey, audioBody, wavPut);
			await this.#bucket.put(sidecarKey, sidecarJson, jsonPut);
		} finally {
			await this.#bucket.delete(tmpWavKey).catch(() => undefined);
			await this.#bucket.delete(tmpSidecarKey).catch(() => undefined);
		}

		const readBack = await this.readEpisodeAudio(
			seasonSlug,
			episodeIdx,
			episodeText,
		);
		if (!readBack) {
			throw new EpisodeAudioError("EpisodeAudioMissing", 404);
		}
	}
}

export class DiskAssetStore implements AssetStore {
	#audioDir: string;

	constructor(input: { audioDir: string; seasonsDir?: string }) {
		this.#audioDir = input.audioDir;
	}

	async readEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
	): Promise<EpisodeAudioAsset | null> {
		const baseName = audioBaseName(seasonSlug, episodeIdx);
		const audioFile = Bun.file(join(this.#audioDir, `${baseName}.wav`));
		const timingsFile = Bun.file(
			join(this.#audioDir, `${baseName}.words.json`),
		);

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
			return { audioBytes, sidecar };
		} catch (error) {
			if (error instanceof EpisodeAudioError) {
				throw error;
			}
			throw new EpisodeAudioError("EpisodeAudioStale", 409);
		}
	}

	async readEpisodeAudioFile(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		requestHeaders: Headers,
	): Promise<EpisodeAudioFileAsset | null> {
		const audio = await this.readEpisodeAudio(
			seasonSlug,
			episodeIdx,
			episodeText,
		);
		if (!audio) {
			return null;
		}

		return audioFileFromBytes(
			audio.audioBytes,
			audio.contentType,
			requestHeaders,
		);
	}

	async writeEpisodeAudio(
		seasonSlug: string,
		episodeIdx: number,
		episodeText: string,
		audioBytes: Uint8Array,
		sidecar: WordTimingSidecar,
	): Promise<void> {
		assertSidecarMatchesEpisode(
			sidecar,
			seasonSlug,
			episodeIdx,
			episodeText,
			audioBytes,
		);
		const baseName = audioBaseName(seasonSlug, episodeIdx);
		const wavPath = join(this.#audioDir, `${baseName}.wav`);
		const sidecarPath = join(this.#audioDir, `${baseName}.words.json`);
		const tmpWavPath = `${wavPath}.tmp`;
		const tmpSidecarPath = `${sidecarPath}.tmp`;

		// Write temp files then rename into place (WAV first, sidecar last).
		try {
			await Bun.write(tmpWavPath, arrayBufferFromBytes(audioBytes));
			await Bun.write(tmpSidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
			await rename(tmpWavPath, wavPath);
			await rename(tmpSidecarPath, sidecarPath);
		} finally {
			// A mid-write failure can leave temp files the renames never consumed;
			// remove any stragglers so they can't be promoted later.
			await rm(tmpWavPath, { force: true }).catch(() => undefined);
			await rm(tmpSidecarPath, { force: true }).catch(() => undefined);
		}

		// Read back so a torn or corrupt write surfaces here, matching
		// R2AssetStore and the orchestrator's "validates, stages, reads back"
		// contract instead of silently reporting success.
		const readBack = await this.readEpisodeAudio(
			seasonSlug,
			episodeIdx,
			episodeText,
		);
		if (!readBack) {
			throw new EpisodeAudioError("EpisodeAudioMissing", 404);
		}
	}
}

function audioKey(seasonSlug: string, episodeIdx: number): string {
	return `${seasonSlug}:e${episodeIdx}`;
}

function audioBaseName(seasonSlug: string, episodeIdx: number): string {
	return `${seasonSlug}-e${episodeIdx}`;
}

async function readR2AudioPair(
	bucket: R2BucketLike,
	wavKey: string,
	sidecarKey: string,
): Promise<{ audioBytes: Uint8Array; sidecar: WordTimingSidecar } | null> {
	const [audioObject, sidecarObject] = await Promise.all([
		bucket.get(wavKey),
		bucket.get(sidecarKey),
	]);
	if (!audioObject || !sidecarObject) {
		return null;
	}
	const sidecar = wordTimingSidecarSchema.parse(await sidecarObject.json());
	const audioBytes = new Uint8Array(await audioObject.arrayBuffer());
	return { audioBytes, sidecar };
}

function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

function cloneAudioAsset(audio: EpisodeAudioAsset): EpisodeAudioAsset {
	return {
		audioBytes: new Uint8Array(audio.audioBytes),
		sidecar: wordTimingSidecarSchema.parse(structuredClone(audio.sidecar)),
		contentType: audio.contentType,
	};
}

function audioFileFromBytes(
	audioBytes: Uint8Array,
	contentType?: string,
	requestHeaders?: Headers,
): EpisodeAudioFileAsset {
	const range = resolveByteRangeHeader(
		requestHeaders?.get("range") ?? null,
		audioBytes.byteLength,
	);
	if (range) {
		const body = audioBytes.slice(range.offset, range.offset + range.length);
		return {
			body: arrayBufferFromBytes(body),
			contentLength: range.length,
			contentRange: contentRangeHeader(range),
			contentType,
			status: 206,
		};
	}

	return {
		body: arrayBufferFromBytes(audioBytes),
		contentLength: audioBytes.byteLength,
		contentType,
		status: 200,
	};
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function audioFileFromR2Object(
	object: R2ObjectBodyLike,
	requestedRange: boolean,
): EpisodeAudioFileAsset {
	const contentType = object.httpMetadata?.contentType;
	if (!object.body) {
		return { contentType, status: 412 };
	}

	const range = object.range;
	if (!requestedRange || !range) {
		return {
			body: object.body,
			contentLength: object.size,
			contentType,
			status: 200,
		};
	}

	const resolvedRange = resolveR2Range(range, object.size);
	if (!resolvedRange) {
		return {
			body: object.body,
			contentType,
			status: 200,
		};
	}

	return {
		body: object.body,
		contentLength: resolvedRange.length,
		contentRange: contentRangeHeader(resolvedRange),
		contentType,
		status: 206,
	};
}

function resolveR2Range(
	range: R2RangeLike,
	size: number | undefined,
): ResolvedByteRange | undefined {
	if (size === undefined) {
		return undefined;
	}

	if (range.offset !== undefined && range.length !== undefined) {
		return { offset: range.offset, length: range.length, size };
	}
	if (range.offset !== undefined) {
		return { offset: range.offset, length: size - range.offset, size };
	}
	if (range.suffix !== undefined) {
		const length = Math.min(range.suffix, size);
		return { offset: size - length, length, size };
	}
	if (range.length !== undefined) {
		return { offset: 0, length: range.length, size };
	}

	return undefined;
}

function resolveByteRangeHeader(
	rangeHeader: string | null,
	size: number,
): ResolvedByteRange | undefined {
	if (!rangeHeader?.startsWith("bytes=") || size === 0) {
		return undefined;
	}

	const parts = rangeHeader.slice("bytes=".length).split("-");
	if (parts.length !== 2) {
		return undefined;
	}

	const startRaw = parts[0];
	const endRaw = parts[1];
	if (startRaw === undefined || endRaw === undefined) {
		return undefined;
	}

	if (startRaw === "" && endRaw === "") {
		return undefined;
	}
	if (startRaw === "") {
		return resolveSuffixByteRange(endRaw, size);
	}
	return resolveOffsetByteRange(startRaw, endRaw, size);
}

function resolveSuffixByteRange(
	suffixRaw: string,
	size: number,
): ResolvedByteRange | undefined {
	const suffixLength = parseRangeInteger(suffixRaw);
	if (suffixLength === undefined || suffixLength <= 0) {
		return undefined;
	}

	const length = Math.min(suffixLength, size);
	return { offset: size - length, length, size };
}

function resolveOffsetByteRange(
	startRaw: string,
	endRaw: string,
	size: number,
): ResolvedByteRange | undefined {
	const start = parseRangeInteger(startRaw);
	if (start === undefined || start >= size) {
		return undefined;
	}

	let end = size - 1;
	if (endRaw !== "") {
		const parsedEnd = parseRangeInteger(endRaw);
		if (parsedEnd === undefined || parsedEnd < start) {
			return undefined;
		}
		end = Math.min(parsedEnd, size - 1);
	}

	return { offset: start, length: end - start + 1, size };
}

function parseRangeInteger(value: string): number | undefined {
	if (!/^\d+$/.test(value)) {
		return undefined;
	}
	return Number.parseInt(value, 10);
}

function contentRangeHeader(range: ResolvedByteRange): string {
	const end = range.offset + range.length - 1;
	return `bytes ${range.offset}-${end}/${range.size}`;
}

function assertSidecarMatchesEpisode(
	sidecar: WordTimingSidecar,
	seasonSlug: string,
	episodeIdx: number,
	episodeText: string,
	audioBytes: Uint8Array,
): void {
	assertSidecarMatchesEpisodeText(sidecar, seasonSlug, episodeIdx, episodeText);
	if (sidecar.audioHash !== sha256(audioBytes)) {
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
	}
}

function assertSidecarMatchesEpisodeText(
	sidecar: WordTimingSidecar,
	seasonSlug: string,
	episodeIdx: number,
	episodeText: string,
): void {
	const result = checkSidecarMatchesEpisodeText(
		sidecar,
		seasonSlug,
		episodeIdx,
		episodeText,
	);
	if (!result.ok) {
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
	}
}

function assertR2AudioMetadataMatchesSidecar(
	object: R2ObjectBodyLike,
	sidecar: WordTimingSidecar,
): void {
	const audioHash = object.customMetadata?.sha256;
	if (audioHash !== undefined && audioHash !== sidecar.audioHash) {
		throw new EpisodeAudioError("EpisodeAudioStale", 409);
	}
}

export interface ServerBindings {
	ASSET_STORE?: AssetStore;
	ASSETS_BUCKET?: R2BucketLike;
	PROGRESS_STORE?: ProgressStore;
	STORY_DB?: D1DatabaseLike;
	STORY_STORE?: StoryStore;
	// Better Auth (Google sign-in) configuration. Present in the Workers runtime
	// via `.dev.vars` (dev) and `wrangler secret` (prod); absent in tests and the
	// D1-less `dev:direct` fallback, where auth is treated as unconfigured.
	BETTER_AUTH_SECRET?: string;
	BETTER_AUTH_URL?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	// Test/override seam: when set, this identity is used directly instead of
	// reading a Better Auth session. Never populated by the Workers runtime.
	IDENTITY?: SignedInUser;
	// Admin-only audio generation (local dev). Present via `.dev.vars`; absent in
	// prod so the generate route stays inert. ALIGNER_URL must be a loopback URL.
	ADMIN_AUDIO_GENERATION_ENABLED?: string;
	ALIGNER_URL?: string;
	GEMINI_API_KEY?: string;
	OPENROUTER_API_KEY?: string;
}
