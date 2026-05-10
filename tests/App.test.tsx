import { describe, it, expect } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import App from "../src/web/App";
import { setupDom } from "./web/setup";

setupDom();

function renderApp(initialPath = "/") {
	const { hook } = memoryLocation({ path: initialPath });
	const result = render(
		<Router hook={hook}>
			<Route path="/" component={App} />
			<Route path="/play/:childId">
				<div data-testid="play-page">Playing</div>
			</Route>
		</Router>,
	);
	return result;
}

describe("App (ProfileSelect)", () => {
	it("shows loading state while fetching children", async () => {
		const originalFetch = globalThis.fetch;
		let resolveFetch: (value: Response) => void;
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			})) as unknown as typeof fetch;

		try {
			const { getByText, queryByText } = renderApp();
			expect(getByText(/loading/i)).toBeDefined();

			resolveFetch!(
				new Response(JSON.stringify({}), {
					headers: { "content-type": "application/json" },
				}),
			);
			await waitFor(() => {
				expect(queryByText(/loading/i)).toBeNull();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows error state when fetch fails", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.reject(new Error("network error"))) as unknown as typeof fetch;

		try {
			const { getByText } = renderApp();
			await waitFor(() => {
				expect(getByText(/error/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("renders a card for each child with name and theme", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						winni: { name: "Winni", theme: "rainbow-unicorn" },
						zack: { name: "Zack", theme: "robot-builders" },
					}),
					{ headers: { "content-type": "application/json" } },
				),
			)) as unknown as typeof fetch;

		try {
			const { getByText } = renderApp();
			await waitFor(() => {
				expect(getByText("Winni")).toBeDefined();
				expect(getByText("Zack")).toBeDefined();
				expect(getByText("rainbow-unicorn")).toBeDefined();
				expect(getByText("robot-builders")).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows empty state when no children exist", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response(JSON.stringify({}), {
					headers: { "content-type": "application/json" },
				}),
			)) as unknown as typeof fetch;

		try {
			const { getByText } = renderApp();
			await waitFor(() => {
				expect(getByText(/no children/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows error when server returns non-ok status", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response("Internal Server Error", { status: 500 }),
			)) as unknown as typeof fetch;

		try {
			const { getByText } = renderApp();
			await waitFor(() => {
				expect(getByText(/error/i)).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("clicking a child card navigates to /play/:childId", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						winni: { name: "Winni", theme: "rainbow-unicorn" },
					}),
					{ headers: { "content-type": "application/json" } },
				),
			)) as unknown as typeof fetch;

		try {
			const { getByText, getByTestId } = renderApp();
			await waitFor(() => {
				expect(getByText("Winni")).toBeDefined();
			});

			getByText("Winni").click();

			await waitFor(() => {
				expect(getByTestId("play-page")).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
