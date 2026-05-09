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
		let requestedUrl: string | undefined;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			requestedUrl = String(input);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						text: "The pink unicorn skipped through the meadow.",
						episode_idx: 0,
						season_slug: "winni-s1-test",
					}),
					{ headers: { "content-type": "application/json" } },
				),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni" });

		try {
			const { getByText } = render(
				<Router hook={hook}>
					<Route path="/play/:childId">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(
					getByText("The pink unicorn skipped through the meadow."),
				).toBeDefined();
			});
			expect(requestedUrl).toBe("/api/children/winni/current-episode");

			const textEl = getByText("The pink unicorn skipped through the meadow.");
			expect(textEl.className).toContain("font-mono");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
