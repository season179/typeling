import { describe, it, expect } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import PlayEpisode from "../../src/web/PlayEpisode";
import { setupDom } from "./setup";

setupDom();

describe("PlayEpisode", () => {
	it("fetches the current episode and renders the text in monospaced font", async () => {
		const originalFetch = globalThis.fetch;
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						text: "The pink unicorn skipped through the meadow.",
						episode_idx: 0,
						current_episode: 0,
						season_slug: "winni-s1-test",
						total_episodes: 14,
					}),
					{ headers: { "content-type": "application/json" } },
				),
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

	it("fetches a selected completed episode and marks future chapters locked", async () => {
		const originalFetch = globalThis.fetch;
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						text: "Episode 2 text for testing.",
						episode_idx: 1,
						current_episode: 2,
						season_slug: "winni-s1-test",
						total_episodes: 14,
					}),
					{ headers: { "content-type": "application/json" } },
				),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/episode/1" });

		try {
			const { getByTestId, getAllByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/episode/:episodeIdx">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-char").textContent).toBe("E");
			});

			expect(requestedUrls).toContain("/api/children/winni/episodes/1");
			expect(getAllByTestId("chapter-jump")[3]?.dataset.status).toBe("locked");
			expect(getAllByTestId("chapter-jump")[2]?.dataset.status).toBe("latest");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
