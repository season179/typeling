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
					totals: {
						count: 0,
						total_active_ms: 0,
						best_wpm: null,
						avg_wpm: null,
					},
					trend: [],
					last_active_at: null,
					recent_sessions: [],
				},
			],
		},
	],
};

function stubFetch(response: Response) {
	globalThis.fetch = (() =>
		Promise.resolve(response)) as unknown as typeof fetch;
}

async function renderLoadedParentView() {
	const original = globalThis.fetch;
	stubFetch(
		new Response(JSON.stringify(familyPayload), {
			headers: { "content-type": "application/json" },
		}),
	);
	try {
		const view = render(<ParentView />);
		await waitFor(() => view.getByText("Ava"));
		return {
			view,
			restoreFetch: () => {
				globalThis.fetch = original;
			},
		};
	} catch (error) {
		globalThis.fetch = original;
		throw error;
	}
}

describe("ParentView", () => {
	it("lists each reader with display name, email, and target WPM", async () => {
		const { view, restoreFetch } = await renderLoadedParentView();
		try {
			const { getByText, getAllByText } = view;
			expect(getByText("Ben")).toBeDefined();
			expect(
				getByText("2 readers · who did what across every story"),
			).toBeDefined();
			expect(getByText("ava@example.com · target 15 WPM")).toBeDefined();
			expect(getByText("ben@example.com · target 15 WPM")).toBeDefined();
			expect(getAllByText("Test Rainbow Story").length).toBe(2);
		} finally {
			restoreFetch();
		}
	});

	it("shows graduated on a story card when rolling-3 meets the target WPM", async () => {
		const { view, restoreFetch } = await renderLoadedParentView();
		try {
			const { container, getByText, getByRole } = view;
			expect(getByText("graduated")).toBeDefined();
			expect(container.textContent).toContain("Rolling 3:");
			expect(
				getByRole("img", { name: "WPM trend across 3 sessions" }),
			).toBeDefined();
			expect(container.textContent).toContain("0:30");
		} finally {
			restoreFetch();
		}
	});

	it("shows no sessions yet and an empty session log when a reader has none", async () => {
		const { view, restoreFetch } = await renderLoadedParentView();
		try {
			const { getByText } = view;
			expect(getByText("no sessions yet")).toBeDefined();
			expect(getByText("No sessions completed yet.")).toBeDefined();
		} finally {
			restoreFetch();
		}
	});

	it("shows the parent allowlist message when the API returns 403", async () => {
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
