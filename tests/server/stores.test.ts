import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { extractAlignmentStoryWords } from "../../src/lib/storyWordTokens";
import { pcmToWavBuffer } from "../../src/lib/wav";
import { fetch } from "../../src/server/index";
import {
	D1ProgressStore,
	D1StoryStore,
	InMemoryAssetStore,
	InMemoryProgressStore,
	InMemoryStoryStore,
	ProgressMismatchError,
	SessionIdConflictError,
	type EpisodeAudioAsset,
	type ProgressStore,
} from "../../src/server/stores";
import { fakeD1StoryDatabase } from "../lib/fakeD1Story";

// Identity now comes from the Better Auth session; tests inject it directly via
// the `IDENTITY` binding seam instead of relying on a localhost dev fallback.
const devIdentity = {
	email: "dev@typeling.localhost",
	display_name: "Typeling Dev",
	name: "Typeling Dev",
	access_subject: "local-dev",
};

const fixtureSeason = {
	slug: "winni-s1-test",
	name: "Test Rainbow Story",
	theme: "pink unicorn",
	episodes: Array.from({ length: 14 }, (_, i) => ({
		idx: i,
		text: `Episode ${i + 1} text for testing.`,
	})),
};

const secondSeason = {
	...fixtureSeason,
	slug: "robot-story-test",
	name: "Robot Story Test",
	theme: "blue robot",
	episodes: fixtureSeason.episodes.map((episode) => ({
		...episode,
		text: `Robot ${episode.text}`,
	})),
};

const d1OnlySeason = {
	...fixtureSeason,
	slug: "d1-only-season",
	episodes: fixtureSeason.episodes.map((episode) => ({
		...episode,
		text: `D1 ${episode.text}`,
	})),
};

const user = {
	email: "Season@Example.COM",
	display_name: "Season Saw",
	name: "Season Saw",
	access_subject: "access-user-1",
};

const validSessionBody = {
	id: "test-session-1",
	season_slug: "winni-s1-test",
	episode_idx: 0,
	wpm: 12,
	char_count: 50,
	active_ms: 30000,
	started_at: "2026-05-10T00:00:00.000Z",
	finished_at: "2026-05-10T00:01:00.000Z",
};

const sha256 = (input: string | Uint8Array) =>
	createHash("sha256").update(input).digest("hex");

const testAudioBytes = pcmToWavBuffer(new Uint8Array(24000 * 2 * 2));

const audioForEpisode = (episodeIdx: number): EpisodeAudioAsset & {
	seasonSlug: string;
	episodeIdx: number;
} => {
	const text = fixtureSeason.episodes[episodeIdx]?.text ?? "";
	const words = extractAlignmentStoryWords(text).map((word, index) => ({
		index: word.wordIndex,
		text: word.text,
		start: index * 0.2,
		end: index * 0.2 + 0.1,
	}));

	return {
		seasonSlug: fixtureSeason.slug,
		episodeIdx,
		audioBytes: testAudioBytes,
		sidecar: {
			seasonSlug: fixtureSeason.slug,
			episodeIdx,
			audioPath: `memory://${fixtureSeason.slug}-e${episodeIdx}.wav`,
			sourceTextPath: `memory://${fixtureSeason.slug}-e${episodeIdx}-source.txt`,
			rawAlignmentPath: `memory://${fixtureSeason.slug}-e${episodeIdx}.raw.txt`,
			audioHash: sha256(testAudioBytes),
			textHash: sha256(text),
			alignerModel: "test-aligner",
			durationSeconds: 2,
			generatedAt: "2026-05-20T00:00:00.000Z",
			words,
		},
	};
};

const makeSession = (overrides: Partial<typeof validSessionBody> = {}) => ({
	...validSessionBody,
	...overrides,
});

async function seedUser(store: ProgressStore, email = user.email) {
	return store.upsertUser({ ...user, email });
}

describe("D1StoryStore", () => {
	it("lists independent stories with names", async () => {
		const store = new D1StoryStore(fakeD1StoryDatabase([fixtureSeason]));

		await expect(store.listStories()).resolves.toEqual([
			{
				slug: "winni-s1-test",
				name: "Test Rainbow Story",
				theme: "pink unicorn",
				total_episodes: 14,
			},
		]);
	});

	it("returns a season with ordered episodes", async () => {
		const shuffledSeason = {
			...fixtureSeason,
			episodes: [...fixtureSeason.episodes].reverse(),
		};
		const store = new D1StoryStore(fakeD1StoryDatabase([shuffledSeason]));

		const season = await store.readSeason(fixtureSeason.slug);

		expect(season.slug).toBe("winni-s1-test");
		expect(season.name).toBe("Test Rainbow Story");
		expect(season.episodes).toHaveLength(14);
		expect(season.episodes.map((episode) => episode.idx)).toEqual(
			Array.from({ length: 14 }, (_, i) => i),
		);
	});

	it("throws SeasonFileNotFoundError when a D1 season is missing", async () => {
		const store = new D1StoryStore(fakeD1StoryDatabase([fixtureSeason]));

		await expect(store.readSeason("no-such-season")).rejects.toThrow(
			"Season file not found for slug: no-such-season",
		);
	});

	it("validates D1 season output through the season schema", async () => {
		const incompleteSeason = {
			...fixtureSeason,
			episodes: fixtureSeason.episodes.slice(0, 13),
		};
		const store = new D1StoryStore(
			fakeD1StoryDatabase([incompleteSeason as typeof fixtureSeason]),
		);

		await expect(store.readSeason(fixtureSeason.slug)).rejects.toThrow();
	});

	it("updates episode text and text hash through D1", async () => {
		const store = new D1StoryStore(fakeD1StoryDatabase([fixtureSeason]));
		const nextText = "Luma found a careful little test sentence.";

		const season = await store.writeEpisodeText(
			fixtureSeason.slug,
			0,
			nextText,
		);

		expect(season.episodes[0]?.text).toBe(nextText);
	});
});

describe.each([
	["InMemoryProgressStore", () => new InMemoryProgressStore()],
	[
		"D1ProgressStore",
		() => new D1ProgressStore(fakeD1StoryDatabase([fixtureSeason])),
	],
])("%s", (_name, makeStore) => {
	it("upserts users by normalized email with the default target", async () => {
		const store = makeStore();

		const saved = await store.upsertUser(user);
		const updated = await store.upsertUser({
			...user,
			email: " season@example.com ",
			display_name: "Season Updated",
			name: undefined,
		});

		expect(saved).toEqual({
			email: "season@example.com",
			display_name: "Season Saw",
			name: "Season Saw",
			access_subject: "access-user-1",
			target_wpm: 15,
		});
		expect(updated).toMatchObject({
			email: "season@example.com",
			display_name: "Season Updated",
			target_wpm: 15,
		});
	});

	it("creates independent per-story progress rows", async () => {
		const store = makeStore();
		await seedUser(store);

		await store.ensureStoryProgress(user.email, fixtureSeason.slug);
		await store.ensureStoryProgress(user.email, secondSeason.slug);

		expect(await store.listStoryProgress(user.email)).toEqual([
			{
				email: "season@example.com",
				season_slug: fixtureSeason.slug,
				current_episode: 0,
			},
			{
				email: "season@example.com",
				season_slug: secondSeason.slug,
				current_episode: 0,
			},
		]);
	});

	it("inserts sessions idempotently by id and advances current_episode once", async () => {
		const store = makeStore();
		await seedUser(store);

		const first = await store.createSession(user.email, makeSession());
		const replay = await store.createSession(user.email, makeSession());
		const [progress] = await store.listStoryProgress(user.email);

		expect(first).toEqual(replay);
		expect(progress).toMatchObject({
			season_slug: fixtureSeason.slug,
			current_episode: 1,
		});
		expect(await store.listSessions(user.email, fixtureSeason.slug)).toHaveLength(
			1,
		);
	});

	it("rejects duplicate session ids across emails", async () => {
		const store = makeStore();
		await seedUser(store, "first@example.com");
		await seedUser(store, "second@example.com");
		await store.createSession("first@example.com", makeSession());

		await expect(
			store.createSession("second@example.com", makeSession()),
		).rejects.toThrow(SessionIdConflictError);
	});

	it("rejects future locked episodes", async () => {
		const store = makeStore();
		await seedUser(store);

		await expect(
			store.createSession(user.email, makeSession({ episode_idx: 1 })),
		).rejects.toThrow(ProgressMismatchError);
	});

	it("accepts replay sessions without moving progress backward", async () => {
		const store = makeStore();
		await seedUser(store);

		await store.createSession(user.email, makeSession({ id: "episode-0" }));
		await store.createSession(
			user.email,
			makeSession({
				id: "episode-0-replay",
				episode_idx: 0,
				finished_at: "2026-05-10T00:02:00.000Z",
			}),
		);

		const [progress] = await store.listStoryProgress(user.email);
		expect(progress?.current_episode).toBe(1);
		expect(
			(await store.listSessions(user.email, fixtureSeason.slug)).map(
				(session) => session.id,
			),
		).toEqual(["episode-0-replay", "episode-0"]);
	});

	it("rewinds progress and removes reset chapter plus later sessions", async () => {
		const store = makeStore();
		await seedUser(store);

		await store.createSession(user.email, makeSession({ id: "episode-0" }));
		await store.createSession(
			user.email,
			makeSession({
				id: "episode-1",
				episode_idx: 1,
				finished_at: "2026-05-10T00:02:00.000Z",
			}),
		);

		const progress = await store.resetStoryProgress(
			user.email,
			fixtureSeason.slug,
			1,
		);

		expect(progress.current_episode).toBe(1);
		expect(
			(await store.listSessions(user.email, fixtureSeason.slug)).map(
				(session) => session.id,
			),
		).toEqual(["episode-0"]);
	});
});

describe("email/story API routes", () => {
	it("returns progress for all stories scoped to the signed-in user", async () => {
		const progressStore = new InMemoryProgressStore();
		const storyStore = new InMemoryStoryStore({
			seasons: [fixtureSeason, secondSeason],
		});

		const res = await fetch(new Request("http://127.0.0.1:3001/api/progress"), {
			IDENTITY: devIdentity,
			PROGRESS_STORE: progressStore,
			STORY_STORE: storyStore,
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			user: {
				email: "dev@typeling.localhost",
				target_wpm: 15,
			},
			stories: [
				{
					slug: secondSeason.slug,
					current_episode: 0,
					target_wpm: 15,
				},
				{
					slug: fixtureSeason.slug,
					current_episode: 0,
					target_wpm: 15,
				},
			],
		});
	});

	it("serves current episode, rejects locked future episodes, then advances after a session", async () => {
		const progressStore = new InMemoryProgressStore();
		const storyStore = new InMemoryStoryStore({ seasons: [fixtureSeason] });
		const env = {
			IDENTITY: devIdentity,
			PROGRESS_STORE: progressStore,
			STORY_STORE: storyStore,
		};

		const current = await fetch(
			new Request(
				`http://127.0.0.1:3001/api/stories/${fixtureSeason.slug}/current-episode`,
			),
			env,
		);
		const locked = await fetch(
			new Request(
				`http://127.0.0.1:3001/api/stories/${fixtureSeason.slug}/episodes/1`,
			),
			env,
		);
		const session = await fetch(
			new Request("http://127.0.0.1:3001/api/sessions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(makeSession()),
			}),
			env,
		);
		const unlocked = await fetch(
			new Request(
				`http://127.0.0.1:3001/api/stories/${fixtureSeason.slug}/episodes/1`,
			),
			env,
		);

		expect(current.status).toBe(200);
		expect(await current.json()).toMatchObject({
			text: "Episode 1 text for testing.",
			episode_idx: 0,
			season_slug: fixtureSeason.slug,
		});
		expect(locked.status).toBe(403);
		expect(await locked.json()).toEqual({ error: "EpisodeLocked" });
		expect(session.status).toBe(200);
		expect(await session.json()).toMatchObject({
			id: "test-session-1",
			email: "dev@typeling.localhost",
			season_slug: fixtureSeason.slug,
		});
		expect(unlocked.status).toBe(200);
		expect(await unlocked.json()).toMatchObject({
			text: "Episode 2 text for testing.",
			episode_idx: 1,
			current_episode: 1,
		});
	});

	it("serves episode audio metadata and bytes through story routes", async () => {
		const progressStore = new InMemoryProgressStore();
		await progressStore.upsertUser({
			email: "dev@typeling.localhost",
			display_name: "Typeling Dev",
		});
		await progressStore.createSession(
			"dev@typeling.localhost",
			makeSession({ id: "open-chapter-one" }),
		);
		const env = {
			IDENTITY: devIdentity,
			PROGRESS_STORE: progressStore,
			STORY_STORE: new InMemoryStoryStore({ seasons: [fixtureSeason] }),
			ASSET_STORE: new InMemoryAssetStore({
				audio: [audioForEpisode(0)],
			}),
		};

		const metadata = await fetch(
			new Request(
				`http://127.0.0.1:3001/api/stories/${fixtureSeason.slug}/episodes/0/audio`,
			),
			env,
		);
		const audio = await fetch(
			new Request(
				`http://127.0.0.1:3001/api/stories/${fixtureSeason.slug}/episodes/0/audio/file`,
			),
			env,
		);

		expect(metadata.status).toBe(200);
		const metadataBody = await metadata.json();
		expect(metadataBody).toMatchObject({
			season_slug: fixtureSeason.slug,
			episode_idx: 0,
			audio_url: `/api/stories/${fixtureSeason.slug}/episodes/0/audio/file`,
			duration_seconds: 2,
		});
		expect(metadataBody.words.map((word: { text: string }) => word.text)).toEqual(
			["Episode", "1", "text", "for", "testing."],
		);
		expect(audio.status).toBe(200);
		expect(audio.headers.get("content-type")).toBe("audio/wav");
		expect(new Uint8Array(await audio.arrayBuffer()).slice(0, 4)).toEqual(
			new Uint8Array([82, 73, 70, 70]),
		);
	});

	it("uses the STORY_DB binding for both story content and progress", async () => {
		const storyDb = fakeD1StoryDatabase([d1OnlySeason]);
		const env = { IDENTITY: devIdentity, STORY_DB: storyDb };

		const first = await fetch(
			new Request(
				`http://127.0.0.1:3001/api/stories/${d1OnlySeason.slug}/current-episode`,
			),
			env,
		);
		const session = await fetch(
			new Request("http://127.0.0.1:3001/api/sessions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...validSessionBody,
					season_slug: d1OnlySeason.slug,
				}),
			}),
			env,
		);
		const next = await fetch(
			new Request(
				`http://127.0.0.1:3001/api/stories/${d1OnlySeason.slug}/current-episode`,
			),
			env,
		);

		expect(first.status).toBe(200);
		expect(await first.json()).toMatchObject({
			text: "D1 Episode 1 text for testing.",
			episode_idx: 0,
		});
		expect(session.status).toBe(200);
		expect(next.status).toBe(200);
		expect(await next.json()).toMatchObject({
			text: "D1 Episode 2 text for testing.",
			episode_idx: 1,
			current_episode: 1,
		});
	});
});
