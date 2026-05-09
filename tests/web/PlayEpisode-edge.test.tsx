import { describe, it, expect } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import PlayEpisode from "../../src/web/PlayEpisode";
import { setupDom } from "./setup";

setupDom();

describe("PlayEpisode edge cases", () => {
	it("shows an error when rendered without a matching route param", async () => {
		// Render PlayEpisode outside a Route — useParams returns {}
		const originalFetch = globalThis.fetch;
		const fetchSpy = (() => {
			throw new Error("fetch should not be called");
		}) as unknown as typeof fetch;
		globalThis.fetch = fetchSpy;

		const { hook } = memoryLocation({ path: "/other" });

		try {
			const { getByText } = render(
				<Router hook={hook}>
					<PlayEpisode />
				</Router>,
			);

			await waitFor(() => {
				expect(getByText(/error/i)).toBeDefined();
				expect(getByText(/missing child id/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
