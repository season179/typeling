import { describe, it, expect } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import App from "../src/web/App";
import { setupDom } from "./web/setup";

setupDom();

const defaultStories = [
	{
		slug: "rainbow-story",
		name: "Rainbow Meadow",
		theme: "rainbow",
		total_episodes: 14,
	},
	{
		slug: "robot-story",
		name: "Robot Garden",
		theme: "robot",
		total_episodes: 14,
	},
];

const unauthenticatedResponse = () =>
	new Response(JSON.stringify({ authenticated: false }), {
		headers: { "content-type": "application/json" },
	});

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
		globalThis.fetch = ((input: RequestInfo | URL) => {
			if (String(input).includes("/api/me")) {
				return Promise.resolve(unauthenticatedResponse());
			}
			if (String(input).includes("/api/stories")) {
				return Promise.resolve(
					new Response(JSON.stringify(defaultStories), {
						headers: { "content-type": "application/json" },
					}),
				);
			}
			return new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			});
		}) as unknown as typeof fetch;

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

	it("renders a card for each child with selectable stories", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) =>
			Promise.resolve(
				new Response(
					JSON.stringify(
						String(input).includes("/api/me")
							? { authenticated: false }
							: String(input).includes("/api/stories")
								? defaultStories
								: {
										winni: {
											name: "Winni",
											theme: "rainbow-unicorn",
											active_season: "rainbow-story",
										},
										zack: {
											name: "Zack",
											theme: "robot-builders",
											active_season: "robot-story",
										},
									},
					),
					{ headers: { "content-type": "application/json" } },
				),
			)) as unknown as typeof fetch;

		try {
			const { getAllByText, getByText } = renderApp();
			await waitFor(() => {
				expect(getByText("Winni")).toBeDefined();
				expect(getByText("Zack")).toBeDefined();
				expect(getAllByText("Rainbow Meadow").length).toBeGreaterThan(0);
				expect(getAllByText("Robot Garden").length).toBeGreaterThan(0);
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows empty state when no children exist", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) =>
			Promise.resolve(
				new Response(
					JSON.stringify(
						String(input).includes("/api/me")
							? { authenticated: false }
							: String(input).includes("/api/stories")
								? []
								: {},
					),
					{
						headers: { "content-type": "application/json" },
					},
				),
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

	it("pressing Start navigates to /play/:childId", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) =>
			Promise.resolve(
				new Response(
					JSON.stringify(
						String(input).includes("/api/me")
							? { authenticated: false }
							: String(input).includes("/api/stories")
								? defaultStories
								: {
										winni: {
											name: "Winni",
											theme: "rainbow-unicorn",
											active_season: "rainbow-story",
										},
									},
					),
					{ headers: { "content-type": "application/json" } },
				),
			)) as unknown as typeof fetch;

		try {
			const { getByRole, getByText, getByTestId } = renderApp();
			await waitFor(() => {
				expect(getByText("Winni")).toBeDefined();
			});

			fireEvent.click(getByRole("button", { name: "Start" }));

			await waitFor(() => {
				expect(getByTestId("play-page")).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("updates the child story before starting when a new story is selected", async () => {
		const originalFetch = globalThis.fetch;
		const requests: Array<{ url: string; method: string; body?: string }> = [];
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			requests.push({
				url,
				method,
				body: typeof init?.body === "string" ? init.body : undefined,
			});
			if (url.includes("/api/me")) {
				return Promise.resolve(unauthenticatedResponse());
			}
			if (url.includes("/api/stories")) {
				return Promise.resolve(
					new Response(JSON.stringify(defaultStories), {
						headers: { "content-type": "application/json" },
					}),
				);
			}
			if (method === "PUT") {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							child: {
								id: "winni",
								name: "Winni",
								theme: "rainbow-unicorn",
								target_wpm: 15,
								active_season: "robot-story",
								current_episode: 0,
								current_session_id: null,
							},
							story: defaultStories[1],
						}),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(
				new Response(
					JSON.stringify({
						winni: {
							name: "Winni",
							theme: "rainbow-unicorn",
							active_season: "rainbow-story",
						},
					}),
					{ headers: { "content-type": "application/json" } },
				),
			);
		}) as unknown as typeof fetch;

		try {
			const { getByLabelText, getByRole, getByText, getByTestId } = renderApp();
			await waitFor(() => {
				expect(getByText("Winni")).toBeDefined();
			});

			fireEvent.change(getByLabelText("Winni story"), {
				target: { value: "robot-story" },
			});
			fireEvent.click(getByRole("button", { name: "Start" }));

			await waitFor(() => {
				expect(getByTestId("play-page")).toBeDefined();
			});
			expect(requests).toContainEqual({
				url: "/api/children/winni/story",
				method: "PUT",
				body: JSON.stringify({ story_slug: "robot-story" }),
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
