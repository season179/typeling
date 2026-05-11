import { describe, it, expect } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import CompleteEpisode from "../../src/web/CompleteEpisode";
import { MAX_EPISODES } from "../../src/lib/schemas/season";
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

		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "/api/children") {
				return Promise.resolve(
					new Response(
						JSON.stringify({ zack: { name: "Zack" } }),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(new Response("Not Found", { status: 404 }));
		}) as unknown as typeof fetch;

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

	it("clamps out-of-range episodeIdx to the final episode", async () => {
		const { getByText, getAllByTestId, restoreFetch } = stubAndRender(
			7,
			"winni",
			999,
		);
		try {
			await waitFor(() => {
				expect(getByText(/episode 7 complete/i)).toBeDefined();
				expect(getAllByTestId("chapter-cell")).toHaveLength(7);
			});
		} finally {
			restoreFetch();
		}
	});
});

describe("CompleteEpisode chapter map", () => {
	it(`renders ${MAX_EPISODES} chapter cells with episode 0 completed`, async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "/api/children") {
				return Promise.resolve(
					new Response(
						JSON.stringify({ winni: { name: "Winni" } }),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(new Response("Not Found", { status: 404 }));
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/complete/0" });

		try {
			const { getAllByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				const cells = getAllByTestId("chapter-cell");
				expect(cells).toHaveLength(MAX_EPISODES);

				// Cell 0 is completed
				expect(cells[0]!.getAttribute("data-status")).toBe("completed");

				// Remaining cells are upcoming
				for (let i = 1; i < MAX_EPISODES; i++) {
					expect(cells[i]!.getAttribute("data-status")).toBe("upcoming");
				}
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("fills cells up to episodeIdx as completed", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "/api/children") {
				return Promise.resolve(
					new Response(
						JSON.stringify({ zack: { name: "Zack" } }),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(new Response("Not Found", { status: 404 }));
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/zack/complete/3" });

		try {
			const { getAllByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				const cells = getAllByTestId("chapter-cell");
				expect(cells).toHaveLength(MAX_EPISODES);

				// Cells 0-3 are completed
				for (let i = 0; i <= 3; i++) {
					expect(cells[i]!.getAttribute("data-status")).toBe("completed");
				}

				// Remaining cells are upcoming
				for (let i = 4; i < MAX_EPISODES; i++) {
					expect(cells[i]!.getAttribute("data-status")).toBe("upcoming");
				}
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("highlights the just-completed episode cell", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "/api/children") {
				return Promise.resolve(
					new Response(
						JSON.stringify({ winni: { name: "Winni" } }),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(new Response("Not Found", { status: 404 }));
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/complete/2" });

		try {
			const { getAllByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				const cells = getAllByTestId("chapter-cell");

				// Cell 2 is the current (just-completed) one
				expect(cells[2]!.getAttribute("data-current")).toBe("true");

				// Other completed cells (0, 1) are NOT current
				expect(cells[0]!.getAttribute("data-current")).toBeNull();
				expect(cells[1]!.getAttribute("data-current")).toBeNull();

				// Upcoming cells (3+) are NOT current
				expect(cells[3]!.getAttribute("data-current")).toBeNull();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("uses season.episodes.length for grid size when season data is fetched", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "/api/children") {
				return Promise.resolve(
					new Response(
						JSON.stringify({ winni: { name: "Winni" } }),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			if (url === "/api/children/winni/season") {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							slug: "winni-s1",
							total_episodes: 7,
						}),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(new Response("Not Found", { status: 404 }));
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/complete/0" });

		try {
			const { getAllByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				const cells = getAllByTestId("chapter-cell");
				expect(cells).toHaveLength(7);
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it(`defaults to ${MAX_EPISODES} cells when season fetch fails`, async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "/api/children") {
				return Promise.resolve(
					new Response(
						JSON.stringify({ winni: { name: "Winni" } }),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(new Response("Not Found", { status: 404 }));
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/complete/0" });

		try {
			const { getAllByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				const cells = getAllByTestId("chapter-cell");
				expect(cells).toHaveLength(MAX_EPISODES);
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it(`defaults to ${MAX_EPISODES} cells when season payload is missing total_episodes`, async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "/api/children") {
				return Promise.resolve(
					new Response(
						JSON.stringify({ winni: { name: "Winni" } }),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			if (url === "/api/children/winni/season") {
				return Promise.resolve(
					new Response(
						JSON.stringify({ slug: "winni-s1" }),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(new Response("Not Found", { status: 404 }));
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/complete/0" });

		try {
			const { getAllByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/complete/:episodeIdx">
						<CompleteEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				const cells = getAllByTestId("chapter-cell");
				expect(cells).toHaveLength(MAX_EPISODES);
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

function stubFetchForComplete(totalEpisodes: number, childId: string) {
	return ((input: RequestInfo | URL) => {
		const url = String(input);
		if (url === "/api/children") {
			return Promise.resolve(
				new Response(
					JSON.stringify({ [childId]: { name: "Winni" } }),
					{ headers: { "content-type": "application/json" } },
				),
			);
		}
		if (url === `/api/children/${childId}/season`) {
			return Promise.resolve(
				new Response(
					JSON.stringify({ slug: `${childId}-s1`, total_episodes: totalEpisodes }),
					{ headers: { "content-type": "application/json" } },
				),
			);
		}
		return Promise.resolve(new Response("Not Found", { status: 404 }));
	}) as unknown as typeof fetch;
}

function renderCompleteWithStub(childId: string, episodeIdx: number) {
	const { hook } = memoryLocation({
		path: `/play/${childId}/complete/${episodeIdx}`,
	});
	const result = render(
		<Router hook={hook}>
			<Route path="/play/:childId/complete/:episodeIdx">
				<CompleteEpisode />
			</Route>
			<Route path="/play/:childId">
				<div data-testid="play-page">Playing</div>
			</Route>
			<Route path="/play/:childId/episode/:episodeIdx">
				<div data-testid="episode-page">Reading</div>
			</Route>
		</Router>,
	);
	return { ...result, hook };
}

function stubAndRender(
	totalEpisodes: number,
	childId: string,
	episodeIdx: number,
) {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = stubFetchForComplete(totalEpisodes, childId);
	const rendered = renderCompleteWithStub(childId, episodeIdx);
	return {
		...rendered,
		restoreFetch() {
			globalThis.fetch = originalFetch;
		},
	};
}

describe("CompleteEpisode start-next CTA", () => {
	it("renders a Start next button for non-final completion", async () => {
		const { getByRole, restoreFetch } = stubAndRender(7, "winni", 0);
		try {
			await waitFor(() => {
				expect(getByRole("button", { name: /start next/i })).toBeDefined();
			});
		} finally {
			restoreFetch();
		}
	});

	it("clicking Start next navigates to /play/:childId", async () => {
		const { getByRole, getByTestId, restoreFetch } = stubAndRender(
			7,
			"winni",
			0,
		);
		try {
			await waitFor(() => {
				expect(getByRole("button", { name: /start next/i })).toBeDefined();
			});

			fireEvent.click(getByRole("button", { name: /start next/i }));

			await waitFor(() => {
				expect(getByTestId("play-page")).toBeDefined();
			});
		} finally {
			restoreFetch();
		}
	});

	it("shows celebration text and no button for final-episode completion", async () => {
		const { getByText, queryByRole, restoreFetch } = stubAndRender(
			3,
			"winni",
			2,
		);
		try {
			await waitFor(() => {
				expect(getByText(/you finished the whole season/i)).toBeDefined();
			});

			expect(
				queryByRole("button", { name: /start next/i }),
			).toBeNull();
		} finally {
			restoreFetch();
		}
	});
});

describe("CompleteEpisode chapter replay", () => {
	it("navigates to a completed chapter when its chapter cell is clicked", async () => {
		const { getByRole, getByTestId, restoreFetch } = stubAndRender(
			7,
			"winni",
			3,
		);
		try {
			await waitFor(() => {
				expect(getByRole("button", { name: "Read chapter 2" })).toBeDefined();
			});

			fireEvent.click(getByRole("button", { name: "Read chapter 2" }));

			await waitFor(() => {
				expect(getByTestId("episode-page")).toBeDefined();
			});
		} finally {
			restoreFetch();
		}
	});

	it("keeps unread future chapters disabled", async () => {
		const { getAllByTestId, restoreFetch } = stubAndRender(7, "winni", 3);
		try {
			await waitFor(() => {
				const cells = getAllByTestId("chapter-cell");
				expect(cells[4]).toBeDefined();
				expect((cells[4] as HTMLButtonElement).disabled).toBe(true);
				expect(cells[4]!.getAttribute("aria-label")).toBe("Chapter 5 locked");
			});
		} finally {
			restoreFetch();
		}
	});
});
