import { describe, it, expect } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import PlayEpisode from "../../src/web/PlayEpisode";
import { setupDom } from "./setup";

setupDom();

describe("PlayEpisode error state", () => {
	it("shows an error message when the fetch fails", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.reject(new Error("Network down"))) as unknown as typeof fetch;

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
				expect(getByText(/error/i)).toBeDefined();
				expect(getByText(/network down/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows an error message when the server returns a non-ok status", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(new Response("Not Found", { status: 404 }))) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/unknown" });

		try {
			const { getByText } = render(
				<Router hook={hook}>
					<Route path="/play/:childId">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByText(/error/i)).toBeDefined();
				expect(getByText(/404/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
