import { describe, expect, it } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import ParentView from "../../src/web/ParentView";
import { setupDom } from "./setup";

setupDom();

const familyPayload = {
	readers: [
		{
			email: "ava@example.com",
			display_name: "Ava",
			target_wpm: 15,
			stories: [
				{
					slug: "rainbow-door-s1-test",
					name: "Test Rainbow Story",
					theme: "rainbow-unicorn",
					total_episodes: 14,
					current_episode: 3,
					target_wpm: 15,
					rolling3: 15,
					status: "graduated",
					totals: {
						count: 3,
						total_active_ms: 90_000,
						best_wpm: 20,
						avg_wpm: 15,
					},
					trend: [10, 15, 20],
					last_active_at: "2026-06-03T10:01:00.000Z",
					recent_sessions: [
						{
							id: "ava-2",
							season_slug: "rainbow-door-s1-test",
							episode_idx: 2,
							wpm: 20,
							char_count: 50,
							active_ms: 30_000,
							started_at: "2026-06-03T10:00:00.000Z",
							finished_at: "2026-06-03T10:01:00.000Z",
						},
					],
				},
			],
		},
		{
			email: "ben@example.com",
			display_name: "Ben",
			target_wpm: 15,
			stories: [
				{
					slug: "rainbow-door-s1-test",
					name: "Test Rainbow Story",
					theme: "rainbow-unicorn",
					total_episodes: 14,
					current_episode: 0,
					target_wpm: 15,
					rolling3: null,
					status: "no sessions yet",
					totals: { count: 0, total_active_ms: 0, best_wpm: null, avg_wpm: null },
					trend: [],
					last_active_at: null,
					recent_sessions: [],
				},
			],
		},
	],
};

function stubFetch(response: Response) {
	globalThis.fetch = (() => Promise.resolve(response)) as unknown as typeof fetch;
}

describe("ParentView", () => {
	it("renders every reader with their stats", async () => {
		const original = globalThis.fetch;
		stubFetch(
			new Response(JSON.stringify(familyPayload), {
				headers: { "content-type": "application/json" },
			}),
		);
		try {
			const { getByText, getAllByText } = render(<ParentView />);
			await waitFor(() => getByText("Ava"));
			expect(getByText("Ben")).toBeDefined();
			// Both readers list the same story.
			expect(getAllByText("Test Rainbow Story").length).toBe(2);
			// Ava's graduated badge and a completed session WPM are shown.
			expect(getByText("graduated")).toBeDefined();
			expect(getByText("ava@example.com · target 15 WPM")).toBeDefined();
		} finally {
			globalThis.fetch = original;
		}
	});

	it("shows a parents-only message on 403", async () => {
		const original = globalThis.fetch;
		stubFetch(new Response("{}", { status: 403 }));
		try {
			const { getByText } = render(<ParentView />);
			await waitFor(() => getByText("This account can't view stats"));
		} finally {
			globalThis.fetch = original;
		}
	});
});
