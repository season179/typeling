import { describe, expect, it } from "bun:test";
import type { SignedInUser } from "../../../src/lib/schemas/state.ts";
import { fetch } from "../../../src/server/index.ts";
import {
	InMemoryProgressStore,
	InMemoryStoryStore,
} from "../../../src/server/stores.ts";

const parent: SignedInUser = {
	email: "parent@example.com",
	display_name: "Parent Viewer",
	name: "Parent Viewer",
	access_subject: "google-parent",
};

const ava: SignedInUser = {
	email: "ava@example.com",
	display_name: "Ava",
	name: "Ava",
	access_subject: "google-ava",
};

const ben: SignedInUser = {
	email: "ben@example.com",
	display_name: "Ben",
	name: "Ben",
	access_subject: "google-ben",
};

const fixtureSeason = {
	slug: "rainbow-door-s1-test",
	name: "Test Rainbow Story",
	theme: "rainbow-unicorn",
	episodes: Array.from({ length: 14 }, (_, i) => ({
		idx: i,
		text: `Episode ${i + 1} text for testing.`,
	})),
};

async function seedReaders() {
	const progressStore = new InMemoryProgressStore();
	const storyStore = new InMemoryStoryStore({ seasons: [fixtureSeason] });

	progressStore.addParentViewer(parent.email);
	await progressStore.upsertUser(ava);
	await progressStore.upsertUser(ben);

	// Ava completes three episodes in order (rolling-3 becomes available).
	for (let i = 0; i < 3; i++) {
		await progressStore.createSession(ava.email, {
			id: `ava-${i}`,
			season_slug: fixtureSeason.slug,
			episode_idx: i,
			wpm: 10 + i * 5,
			char_count: 50,
			active_ms: 30_000,
			started_at: `2026-06-0${i + 1}T10:00:00.000Z`,
			finished_at: `2026-06-0${i + 1}T10:01:00.000Z`,
		});
	}
	// Ben completes just one.
	await progressStore.createSession(ben.email, {
		id: "ben-0",
		season_slug: fixtureSeason.slug,
		episode_idx: 0,
		wpm: 8,
		char_count: 40,
		active_ms: 25_000,
		started_at: "2026-06-01T11:00:00.000Z",
		finished_at: "2026-06-01T11:01:00.000Z",
	});

	return { progressStore, storyStore };
}

const url = "https://typeling.example.com/api/parent/family";

describe("GET /api/parent/family", () => {
	it("401s when there is no signed-in user", async () => {
		const res = await fetch(new Request(url), {});
		expect(res.status).toBe(401);
	});

	it("403s when the signed-in account is not an allowlisted viewer", async () => {
		const { progressStore, storyStore } = await seedReaders();
		const res = await fetch(new Request(url), {
			IDENTITY: ava,
			PROGRESS_STORE: progressStore,
			STORY_STORE: storyStore,
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "ParentViewOnly" });
	});

	it("aggregates every kid for an allowlisted viewer, excluding viewers", async () => {
		const { progressStore, storyStore } = await seedReaders();
		const res = await fetch(new Request(url), {
			IDENTITY: parent,
			PROGRESS_STORE: progressStore,
			STORY_STORE: storyStore,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			readers: Array<{
				email: string;
				display_name: string;
				target_wpm: number;
				stories: Array<{
					slug: string;
					current_episode: number;
					rolling3: number | null;
					status: string;
					totals: { count: number; best_wpm: number | null };
					trend: number[];
					last_active_at: string | null;
					recent_sessions: unknown[];
				}>;
			}>;
		};

		// The parent viewer is not listed as a reader; kids are, sorted by name.
		expect(body.readers.map((r) => r.email)).toEqual([
			"ava@example.com",
			"ben@example.com",
		]);

		const avaStory = body.readers[0]?.stories.find(
			(s) => s.slug === fixtureSeason.slug,
		);
		expect(avaStory?.totals.count).toBe(3);
		expect(avaStory?.current_episode).toBe(3);
		expect(avaStory?.rolling3).toBe(15); // (10 + 15 + 20) / 3
		expect(avaStory?.status).toBe("graduated"); // 15 >= target 15
		expect(avaStory?.trend).toEqual([10, 15, 20]);
		expect(avaStory?.totals.best_wpm).toBe(20);
		expect(avaStory?.recent_sessions).toHaveLength(3);

		const benStory = body.readers[1]?.stories.find(
			(s) => s.slug === fixtureSeason.slug,
		);
		expect(benStory?.totals.count).toBe(1);
		expect(benStory?.rolling3).toBeNull(); // fewer than 3 sessions
		expect(benStory?.status).toBe("no sessions yet");
	});
});
