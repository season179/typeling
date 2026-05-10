import { describe, it, expect } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import CompleteEpisode from "../../src/web/CompleteEpisode";
import { setupDom } from "./setup";

setupDom();

describe("CompleteEpisode success state", () => {
	it("renders child name and 1-indexed episode number", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "/api/children") {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							winni: { name: "Winni" },
							zack: { name: "Zack" },
						}),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(new Response("Not Found", { status: 404 }));
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/complete/0" });

		try {
			const { getByText } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByText(/episode 1 complete/i)).toBeDefined();
				expect(getByText(/winni/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("displays episodeIdx 2 as Episode 3", async () => {
		const originalFetch = globalThis.fetch;

		globalThis.fetch = (() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						zack: { name: "Zack" },
					}),
					{ headers: { "content-type": "application/json" } },
				),
			)) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/zack/complete/2" });

		try {
			const { getByText } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByText(/episode 3 complete/i)).toBeDefined();
				expect(getByText(/zack/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows error when child is not found in API response", async () => {
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

		const { hook } = memoryLocation({ path: "/play/unknown/complete/0" });

		try {
			const { getByText } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByText(/error/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("treats non-numeric episodeIdx as Episode 1", async () => {
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

		const { hook } = memoryLocation({ path: "/play/winni/complete/abc" });

		try {
			const { getByText } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByText(/episode 1 complete/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
