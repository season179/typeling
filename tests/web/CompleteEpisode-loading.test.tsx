import { describe, it, expect } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import CompleteEpisode from "../../src/web/CompleteEpisode";
import { setupDom } from "./setup";

setupDom();

describe("CompleteEpisode loading state", () => {
	it("shows a loading indicator while the fetch is in-flight and hides it after", async () => {
		const originalFetch = globalThis.fetch;
		let resolveFetch!: (v: Response) => void;
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			})) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/complete/0" });

		try {
			const { getByText, queryByText } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			expect(getByText(/loading/i)).toBeDefined();

			resolveFetch(
				new Response(
					JSON.stringify({
						winni: { name: "Winni" },
					}),
					{ headers: { "content-type": "application/json" } },
				),
			);

			await waitFor(() => {
				expect(queryByText(/loading/i)).toBeNull();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
