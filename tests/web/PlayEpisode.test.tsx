import { describe, it, expect } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import PlayEpisode from "../../src/web/PlayEpisode";
import { setupDom } from "./setup";

setupDom();

const defaultEpisode = {
	text: "Episode text for testing.",
	episode_idx: 0,
	current_episode: 0,
	season_slug: "winni-s1-test",
	total_episodes: 14,
};

function episodeResponse(overrides: Partial<typeof defaultEpisode> = {}) {
	return new Response(JSON.stringify({ ...defaultEpisode, ...overrides }), {
		headers: { "content-type": "application/json" },
	});
}

describe("PlayEpisode", () => {
	it("fetches the current episode and renders the text in monospaced font", async () => {
		const originalFetch = globalThis.fetch;
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			return Promise.resolve(
				episodeResponse({
					text: "The pink unicorn skipped through the meadow.",
				}),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni" });

		try {
			const { getByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-char").textContent).toBe("T");
			});
			expect(requestedUrls).toContain("/api/children/winni/current-episode");

			const typed = getByTestId("typed-region");
			expect(typed.className).toContain("text-stone-300");
			expect(typed.textContent).toBe("");

			const cursor = getByTestId("cursor-char");
			expect(cursor.className).toContain("border-b-");
			expect(cursor.className).toContain("border-amber-400");

			const untyped = getByTestId("untyped-region");
			expect(untyped.className).toContain("text-stone-800");
			expect(untyped.textContent).toBe(
				"he pink unicorn skipped through the meadow.",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("opens a selected completed episode in reading mode by default", async () => {
		const originalFetch = globalThis.fetch;
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			return Promise.resolve(
				episodeResponse({
					text: "Episode 2 text for testing.\nA second paragraph.",
					episode_idx: 1,
					current_episode: 2,
				}),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/episode/1" });

		try {
			const { getByTestId, getAllByTestId, queryByTestId, getByRole } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/episode/:episodeIdx">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("story-reader").textContent).toContain(
					"Episode 2 text for testing.",
				);
			});

			expect(requestedUrls).toContain("/api/children/winni/episodes/1");
			expect(getAllByTestId("chapter-jump")[3]?.dataset.status).toBe("locked");
			expect(getAllByTestId("chapter-jump")[2]?.dataset.status).toBe("latest");
			expect(queryByTestId("cursor-char")).toBeNull();
			expect(getByRole("button", { name: "Read story" }).getAttribute("aria-pressed")).toBe(
				"true",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("lets a child type a completed episode again after choosing Type again", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				episodeResponse({
					text: "Episode 2 text for testing.",
					episode_idx: 1,
					current_episode: 2,
				}),
			)) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/episode/1" });

		try {
			const { getByTestId, getByRole, queryByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/episode/:episodeIdx">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("story-reader").textContent).toContain("Episode 2");
			});

			fireEvent.click(getByRole("button", { name: "Type again" }));

			await waitFor(() => {
				expect(getByTestId("cursor-char").textContent).toBe("E");
			});
			expect(queryByTestId("story-reader")).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("opens the latest episode in typing mode", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				episodeResponse({
					text: "Episode 3 text for testing.",
					episode_idx: 2,
					current_episode: 2,
				}),
			)) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/episode/2" });

		try {
			const { getByTestId, queryByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/episode/:episodeIdx">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-char").textContent).toBe("E");
			});
			expect(queryByTestId("story-reader")).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
