import { describe, expect, it } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import App from "../../src/web/App";
import CompleteEpisode from "../../src/web/CompleteEpisode";
import Greeting from "../../src/web/Greeting";
import ParentView from "../../src/web/ParentView";
import PlayEpisode from "../../src/web/PlayEpisode";
import { setupDom } from "./setup";

setupDom();

const user = {
	email: "season@example.com",
	display_name: "Season Saw",
	target_wpm: 15,
};

const progressPayload = {
	user,
	stories: [
		{
			slug: "rainbow-door-s1-test",
			name: "Test Rainbow Story",
			theme: "rainbow-unicorn",
			total_episodes: 14,
			current_episode: 1,
			target_wpm: 15,
			rolling3: 18,
			status: "graduated",
			recent_sessions: [
				{
					id: "session-1",
					email: "season@example.com",
					season_slug: "rainbow-door-s1-test",
					episode_idx: 0,
					wpm: 18,
					char_count: 50,
					active_ms: 60000,
					started_at: new Date(Date.now() - 120000).toISOString(),
					finished_at: new Date(Date.now() - 60000).toISOString(),
				},
			],
		},
	],
};

function withMockFetch(
	handler: (url: string) => Response | Promise<Response>,
	run: () => Promise<void>,
) {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = ((input: RequestInfo | URL) => {
		const url = input instanceof Request ? input.url : String(input);
		return Promise.resolve(handler(url));
	}) as typeof fetch;
	return run().finally(() => {
		globalThis.fetch = originalFetch;
	});
}

describe("email-scoped story web flow", () => {
	it("renders story cards from /api/progress and starts a story by slug", async () => {
		await withMockFetch(
			(url) => {
				expect(url).toBe("/api/progress");
				return new Response(JSON.stringify(progressPayload), {
					headers: { "content-type": "application/json" },
				});
			},
			async () => {
				const { hook, history } = memoryLocation({ path: "/", record: true });
				const { getByRole, getByText } = render(
					<Router hook={hook}>
						<Route path="/" component={App} />
						<Route path="/play/:storySlug">Playing</Route>
					</Router>,
				);

				await waitFor(() => {
					expect(getByText("Test Rainbow Story")).toBeDefined();
				});

				fireEvent.click(getByRole("button", { name: "Start" }));

				await waitFor(() => {
					expect(history.at(-1)).toBe("/play/rainbow-door-s1-test");
				});
			},
		);
	});

	it("loads the current story episode and passes the signed-in email to autosave", async () => {
		const requested: string[] = [];

		await withMockFetch(
			(url) => {
				requested.push(url);
				if (url === "/api/me") {
					return new Response(
						JSON.stringify({ authenticated: true, user }),
						{ headers: { "content-type": "application/json" } },
					);
				}
				if (url === "/api/stories/rainbow-door-s1-test/current-episode") {
					return new Response(
						JSON.stringify({
							text: "abc",
							episode_idx: 0,
							current_episode: 0,
							season_slug: "rainbow-door-s1-test",
							total_episodes: 14,
						}),
						{ headers: { "content-type": "application/json" } },
					);
				}
				return new Response("not found", { status: 404 });
			},
			async () => {
				const { hook } = memoryLocation({ path: "/play/rainbow-door-s1-test" });
				const { getByTestId } = render(
					<Router hook={hook}>
						<Route path="/play/:storySlug" component={PlayEpisode} />
					</Router>,
				);

				await waitFor(() => {
					expect(getByTestId("cursor-char").textContent).toBe("a");
				});
				expect(requested).toContain(
					"/api/stories/rainbow-door-s1-test/current-episode",
				);
				expect(requested).toContain("/api/me");
			},
		);
	});

	it("renders completion by story slug and starts the next chapter", async () => {
		await withMockFetch(
			(url) => {
				expect(url).toBe("/api/progress");
				return new Response(JSON.stringify(progressPayload), {
					headers: { "content-type": "application/json" },
				});
			},
			async () => {
				const { hook, history } = memoryLocation({
					path: "/play/rainbow-door-s1-test/complete/0",
					record: true,
				});
				const { getByRole, getByText } = render(
					<Router hook={hook}>
						<Route
							path="/play/:storySlug/complete/:episodeIdx"
							component={CompleteEpisode}
						/>
						<Route path="/play/:storySlug">Playing</Route>
					</Router>,
				);

				await waitFor(() => {
					expect(getByText(/episode 1 complete/i)).toBeDefined();
					expect(getByText("Test Rainbow Story")).toBeDefined();
				});

				fireEvent.click(getByRole("button", { name: /start next/i }));

				await waitFor(() => {
					expect(history.at(-1)).toBe("/play/rainbow-door-s1-test");
				});
			},
		);
	});

	it("renders the signed-in progress page with recent sessions", async () => {
		await withMockFetch(
			(url) => {
				expect(url).toBe("/api/progress");
				return new Response(JSON.stringify(progressPayload), {
					headers: { "content-type": "application/json" },
				});
			},
			async () => {
				const { getAllByText, getByText } = render(<ParentView />);

				await waitFor(() => {
					expect(getByText("Story Progress")).toBeDefined();
					expect(getByText("Test Rainbow Story")).toBeDefined();
					expect(getByText("season@example.com")).toBeDefined();
					expect(getAllByText("18").length).toBeGreaterThan(0);
				});
			},
		);
	});

	it("greets the signed-in reader by first name from /api/me", async () => {
		await withMockFetch(
			(url) => {
				expect(url).toBe("/api/me");
				return new Response(JSON.stringify({ authenticated: true, user }), {
					headers: { "content-type": "application/json" },
				});
			},
			async () => {
				const { getByText } = render(<Greeting />);

				await waitFor(() => {
					expect(getByText(/Hi, Season/)).toBeDefined();
				});
			},
		);
	});

	it("renders no greeting when nobody is signed in", async () => {
		let meRequested = false;
		await withMockFetch(
			(url) => {
				if (url === "/api/me") meRequested = true;
				return new Response(JSON.stringify({ authenticated: false }), {
					headers: { "content-type": "application/json" },
				});
			},
			async () => {
				const { container, queryByText } = render(<Greeting />);

				// Greeting renders null before the fetch resolves too, so asserting
				// "absent" up front would pass vacuously. Wait until /api/me has
				// actually been requested, then confirm the unauthenticated reply
				// kept the greeting absent.
				await waitFor(() => expect(meRequested).toBe(true));
				expect(container.querySelector(".user-greeting")).toBeNull();
				expect(queryByText(/Hi,/)).toBeNull();
			},
		);
	});
});
