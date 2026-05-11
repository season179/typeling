import { describe, it, expect } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import CompleteEpisode from "../../src/web/CompleteEpisode";
import ParentView from "../../src/web/ParentView";
import PlayEpisode from "../../src/web/PlayEpisode";
import { setupDom } from "./setup";

setupDom();

describe("Router /play/:childId", () => {
	it("renders PlayEpisode when path is /play/winni", async () => {
		const originalFetch = globalThis.fetch;
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						text: "The fox jumped over the fence.",
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
					<Route path="/play/:childId" component={PlayEpisode} />
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-char").textContent).toBe("T");
			});
			expect(requestedUrls).toContain("/api/children/winni/current-episode");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("Router /play/:childId/complete/:episodeIdx", () => {
	it("renders CompleteEpisode at the completion route", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						winni: { name: "Winni" },
					}),
					{ headers: { "content-type": "application/json" } },
				),
			)) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/complete/0" });

		try {
			const { getByTestId } = render(
				<Router hook={hook}>
					<Route
						path="/play/:childId/complete/:episodeIdx"
						component={CompleteEpisode}
					/>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("complete-episode")).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("Router /parent", () => {
	it("renders ParentView at /parent", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/api/children/")) {
				return Promise.resolve(
					new Response("[]", {
						headers: { "content-type": "application/json" },
					}),
				);
			}
			return Promise.resolve(
				new Response(
					JSON.stringify({
						winni: {
							name: "Winni",
							theme: "rainbow-unicorn",
							target_wpm: 15,
							active_season: "winni-s1-test",
						},
					}),
					{ headers: { "content-type": "application/json" } },
				),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/parent" });

		try {
			const { getByText } = render(
				<Router hook={hook}>
					<Route path="/parent" component={ParentView} />
				</Router>,
			);

			await waitFor(() => {
				expect(getByText("Parent View")).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
