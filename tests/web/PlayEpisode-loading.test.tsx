import { describe, it, expect } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import PlayEpisode from "../../src/web/PlayEpisode";
import { setupDom } from "./setup";

setupDom();

describe("PlayEpisode loading state", () => {
	it("shows a loading indicator while the fetch is in-flight", async () => {
		const originalFetch = globalThis.fetch;
		let resolveFetch!: (v: Response) => void;
		globalThis.fetch = (() => {
			return new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			});
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni" });

		try {
			const { getByText, queryByText } = render(
				<Router hook={hook}>
					<Route path="/play/:childId">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			// loading indicator is visible immediately
			expect(getByText(/loading/i)).toBeDefined();

			// now resolve the fetch
			resolveFetch(
				new Response(
					JSON.stringify({
						text: "Hello world.",
						episode_idx: 0,
						current_episode: 0,
						season_slug: "winni-s1-test",
						total_episodes: 14,
					}),
					{ headers: { "content-type": "application/json" } },
				),
			);

			// loading indicator disappears
			await waitFor(() => {
				expect(queryByText(/loading/i)).toBeNull();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
