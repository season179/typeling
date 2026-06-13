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
		throw new Error(`Unsupported fake D1 run query: ${this.#query}`);
	}
}

export interface FakeD1StoryDatabase extends D1DatabaseLike {
	episodeTextHash(seasonSlug: string, idx: number): string | undefined;
}

class FakeD1Database implements FakeD1StoryDatabase {
	seasons = new Map<string, SeasonRow>();
	episodes = new Map<string, EpisodeRow>();

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

function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

function stringValue(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Expected fake D1 string binding");
	}
	return value;
}

function numberValue(value: unknown): number {
	if (typeof value !== "number") {
		throw new Error("Expected fake D1 number binding");
	}
	return value;
}
