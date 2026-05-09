import { describe, it, expect } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import PlayEpisode from "../../src/web/PlayEpisode";
import { setupDom } from "./setup";

setupDom();

describe("Router /play/:childId", () => {
	it("renders PlayEpisode when path is /play/winni", async () => {
		const originalFetch = globalThis.fetch;
		let requestedUrl: string | undefined;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			requestedUrl = String(input);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						text: "The fox jumped over the fence.",
						episode_idx: 0,
						season_slug: "winni-s1-test",
					}),
					{ headers: { "content-type": "application/json" } },
				),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni" });

		try {
			const { getByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId" component={PlayEpisode} />
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-char").textContent).toBe("T");
			});
			expect(requestedUrl).toBe("/api/children/winni/current-episode");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
