import { createHash } from "node:crypto";
import type { D1DatabaseLike, Season } from "../../src/server/stores";

interface SeasonRow {
	slug: string;
	name: string;
	theme: string;
}

interface EpisodeRow {
	season_slug: string;
	idx: number;
	text: string;
	text_hash: string;
}

interface UserRow {
	email: string;
	display_name: string;
	name: string | null;
	access_subject: string | null;
	target_wpm: number;
}

interface ProgressRow {
	email: string;
	season_slug: string;
	current_episode: number;
}

interface SessionRow {
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

class FakeD1PreparedStatement {
	#db: FakeD1Database;
	#query: string;
	#values: unknown[];

	constructor(db: FakeD1Database, query: string, values: unknown[] = []) {
		this.#db = db;
		this.#query = query;
		this.#values = values;
	}

	bind(...values: unknown[]): FakeD1PreparedStatement {
		return new FakeD1PreparedStatement(this.#db, this.#query, values);
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		const query = normaliseSql(this.#query);
		if (query.startsWith("SELECT SLUG, NAME, THEME FROM SEASONS")) {
			const slug = stringValue(this.#values[0]);
			return (this.#db.seasons.get(slug) ?? null) as T | null;
		}
		if (
			query.startsWith(
				"SELECT EMAIL, DISPLAY_NAME, NAME, ACCESS_SUBJECT, TARGET_WPM FROM USERS WHERE EMAIL = ?",
			)
		) {
			const email = stringValue(this.#values[0]);
			return (this.#db.users.get(email) ?? null) as T | null;
		}
		if (
			query.startsWith(
				"SELECT EMAIL, SEASON_SLUG, CURRENT_EPISODE FROM USER_STORY_PROGRESS WHERE EMAIL = ? AND SEASON_SLUG = ?",
			)
		) {
			const key = progressKey(
				stringValue(this.#values[0]),
				stringValue(this.#values[1]),
			);
			return (this.#db.progress.get(key) ?? null) as T | null;
		}
		if (
			query.startsWith(
				"SELECT ID, EMAIL, SEASON_SLUG, EPISODE_IDX, WPM, CHAR_COUNT, ACTIVE_MS, STARTED_AT, FINISHED_AT FROM TYPING_SESSIONS WHERE ID = ?",
			)
		) {
			const id = stringValue(this.#values[0]);
			return (this.#db.sessions.get(id) ?? null) as T | null;
		}
		throw new Error(`Unsupported fake D1 first query: ${this.#query}`);
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
		const query = normaliseSql(this.#query);
		if (query.startsWith("SELECT SEASONS.SLUG, SEASONS.NAME")) {
			const episodeCounts = new Map<string, number>();
			for (const episode of this.#db.episodes.values()) {
				episodeCounts.set(
					episode.season_slug,
					(episodeCounts.get(episode.season_slug) ?? 0) + 1,
				);
			}
			const results = [...this.#db.seasons.values()]
				.map((season) => ({
					slug: season.slug,
					name: season.name,
					theme: season.theme,
					total_episodes: episodeCounts.get(season.slug) ?? 0,
				}))
				.sort(
					(a, b) =>
						a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug),
				);
			return { results: results as T[] };
		}
		if (query.startsWith("SELECT IDX, TEXT FROM EPISODES")) {
			const seasonSlug = stringValue(this.#values[0]);
			const results = [...this.#db.episodes.values()]
				.filter((episode) => episode.season_slug === seasonSlug)
				.sort((a, b) => a.idx - b.idx)
				.map(({ idx, text }) => ({ idx, text }));
			return { results: results as T[] };
		}
		if (
			query.startsWith(
				"SELECT EMAIL, SEASON_SLUG, CURRENT_EPISODE FROM USER_STORY_PROGRESS WHERE EMAIL = ?",
			)
		) {
			const email = stringValue(this.#values[0]);
			const results = [...this.#db.progress.values()].filter(
				(progress) => progress.email === email,
			);
			return { results: results as T[] };
		}
		if (
			query.startsWith(
				"SELECT ID, EMAIL, SEASON_SLUG, EPISODE_IDX, WPM, CHAR_COUNT, ACTIVE_MS, STARTED_AT, FINISHED_AT FROM TYPING_SESSIONS WHERE EMAIL = ? AND SEASON_SLUG = ?",
			)
		) {
			const email = stringValue(this.#values[0]);
			const seasonSlug = stringValue(this.#values[1]);
			const results = [...this.#db.sessions.values()]
				.filter(
					(session) =>
						session.email === email && session.season_slug === seasonSlug,
				)
				.sort((a, b) => b.finished_at.localeCompare(a.finished_at));
			return { results: results as T[] };
		}
		if (
			query.startsWith(
				"SELECT ID, EMAIL, SEASON_SLUG, EPISODE_IDX, WPM, CHAR_COUNT, ACTIVE_MS, STARTED_AT, FINISHED_AT FROM TYPING_SESSIONS WHERE EMAIL = ?",
			)
		) {
			const email = stringValue(this.#values[0]);
			const results = [...this.#db.sessions.values()]
				.filter((session) => session.email === email)
				.sort((a, b) => b.finished_at.localeCompare(a.finished_at));
			return { results: results as T[] };
		}
		throw new Error(`Unsupported fake D1 all query: ${this.#query}`);
	}

	async run<T = Record<string, unknown>>(): Promise<{
		results: T[];
		meta: { changes: number };
	}> {
		const query = normaliseSql(this.#query);
		if (query.startsWith("UPDATE EPISODES SET TEXT = ?")) {
			const text = stringValue(this.#values[0]);
			const textHash = stringValue(this.#values[1]);
			const seasonSlug = stringValue(this.#values[2]);
			const idx = numberValue(this.#values[3]);
			const key = episodeKey(seasonSlug, idx);
			const current = this.#db.episodes.get(key);
			if (!current) return { results: [], meta: { changes: 0 } };
			this.#db.episodes.set(key, { ...current, text, text_hash: textHash });
			return { results: [], meta: { changes: 1 } };
		}
		if (query.startsWith("INSERT INTO USERS")) {
			const email = stringValue(this.#values[0]);
			const existing = this.#db.users.get(email);
			this.#db.users.set(email, {
				email,
				display_name: stringValue(this.#values[1]),
				name: nullableStringValue(this.#values[2]),
				access_subject: nullableStringValue(this.#values[3]),
				target_wpm: existing?.target_wpm ?? 15,
			});
			return { results: [], meta: { changes: existing ? 0 : 1 } };
		}
		if (query.startsWith("INSERT OR IGNORE INTO USER_STORY_PROGRESS")) {
			const email = stringValue(this.#values[0]);
			const seasonSlug = stringValue(this.#values[1]);
			const key = progressKey(email, seasonSlug);
			if (this.#db.progress.has(key)) {
				return { results: [], meta: { changes: 0 } };
			}
			this.#db.progress.set(key, {
				email,
				season_slug: seasonSlug,
				current_episode: 0,
			});
			return { results: [], meta: { changes: 1 } };
		}
		if (query.startsWith("INSERT OR IGNORE INTO TYPING_SESSIONS")) {
			const id = stringValue(this.#values[0]);
			if (this.#db.sessions.has(id)) {
				return { results: [], meta: { changes: 0 } };
			}
			this.#db.sessions.set(id, {
				id,
				email: stringValue(this.#values[1]),
				season_slug: stringValue(this.#values[2]),
				episode_idx: numberValue(this.#values[3]),
				wpm: numberValue(this.#values[4]),
				char_count: numberValue(this.#values[5]),
				active_ms: numberValue(this.#values[6]),
				started_at: stringValue(this.#values[7]),
				finished_at: stringValue(this.#values[8]),
			});
			return { results: [], meta: { changes: 1 } };
		}
		if (query.startsWith("UPDATE USER_STORY_PROGRESS SET CURRENT_EPISODE = ?")) {
			const currentEpisode = numberValue(this.#values[0]);
			const email = stringValue(this.#values[1]);
			const seasonSlug = stringValue(this.#values[2]);
			const key = progressKey(email, seasonSlug);
			const current = this.#db.progress.get(key);
			if (!current) return { results: [], meta: { changes: 0 } };
			this.#db.progress.set(key, {
				...current,
				current_episode: currentEpisode,
			});
			return { results: [], meta: { changes: 1 } };
		}
		if (query.startsWith("DELETE FROM TYPING_SESSIONS WHERE EMAIL = ?")) {
			const email = stringValue(this.#values[0]);
			const seasonSlug = stringValue(this.#values[1]);
			const episodeIdx = numberValue(this.#values[2]);
			let changes = 0;
			for (const [id, session] of this.#db.sessions.entries()) {
				if (
					session.email === email &&
					session.season_slug === seasonSlug &&
					session.episode_idx >= episodeIdx
				) {
					this.#db.sessions.delete(id);
					changes++;
				}
			}
			return { results: [], meta: { changes } };
		}
		throw new Error(`Unsupported fake D1 run query: ${this.#query}`);
	}
}

export interface FakeD1StoryDatabase extends D1DatabaseLike {
	episodeTextHash(seasonSlug: string, idx: number): string | undefined;
}

class FakeD1Database implements FakeD1StoryDatabase {
	seasons = new Map<string, SeasonRow>();
	episodes = new Map<string, EpisodeRow>();
	users = new Map<string, UserRow>();
	progress = new Map<string, ProgressRow>();
	sessions = new Map<string, SessionRow>();

	prepare(query: string): FakeD1PreparedStatement {
		return new FakeD1PreparedStatement(this, query);
	}

	episodeTextHash(seasonSlug: string, idx: number): string | undefined {
		return this.episodes.get(episodeKey(seasonSlug, idx))?.text_hash;
	}
}

export function fakeD1StoryDatabase(seasons: Season[]): FakeD1StoryDatabase {
	const db = new FakeD1Database();
	for (const season of seasons) {
		db.seasons.set(season.slug, {
			slug: season.slug,
			name: season.name,
			theme: season.theme,
		});
		for (const episode of season.episodes) {
			db.episodes.set(episodeKey(season.slug, episode.idx), {
				season_slug: season.slug,
				idx: episode.idx,
				text: episode.text,
				text_hash: sha256(episode.text),
			});
		}
	}
	return db;
}

function normaliseSql(query: string): string {
	return query.replace(/\s+/g, " ").trim().toUpperCase();
}

function episodeKey(seasonSlug: string, idx: number): string {
	return `${seasonSlug}:${idx}`;
}

function progressKey(email: string, seasonSlug: string): string {
	return `${email}:${seasonSlug}`;
}

function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

function stringValue(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Expected fake D1 string binding");
	}
	return value;
}

function nullableStringValue(value: unknown): string | null {
	if (value === null) return null;
	return stringValue(value);
}

function numberValue(value: unknown): number {
	if (typeof value !== "number") {
		throw new Error("Expected fake D1 number binding");
	}
	return value;
}
