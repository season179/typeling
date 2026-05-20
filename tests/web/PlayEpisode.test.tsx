import { describe, it, expect } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import PlayEpisode from "../../src/web/PlayEpisode";
import { setupDom } from "./setup";

setupDom();

const defaultEpisode = {
	text: "Episode text for testing.",
	episode_idx: 0,
	current_episode: 0,
	season_slug: "winni-s1-test",
	total_episodes: 14,
};

function episodeResponse(overrides: Partial<typeof defaultEpisode> = {}) {
	return new Response(JSON.stringify({ ...defaultEpisode, ...overrides }), {
		headers: { "content-type": "application/json" },
	});
}

describe("PlayEpisode", () => {
	it("fetches the current episode and renders the text in monospaced font", async () => {
		const originalFetch = globalThis.fetch;
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			return Promise.resolve(
				episodeResponse({
					text: "The pink unicorn skipped through the meadow.",
				}),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni" });

		try {
			const { getByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-char").textContent).toBe("T");
			});
			expect(requestedUrls).toContain("/api/children/winni/current-episode");

			const typed = getByTestId("typed-region");
			expect(typed.className).toContain("text-stone-300");
			expect(typed.textContent).toBe("");

			const cursor = getByTestId("cursor-char");
			expect(cursor.className).toContain("border-b-");
			expect(cursor.className).toContain("border-amber-400");

			const untyped = getByTestId("untyped-region");
			expect(untyped.className).toContain("text-stone-800");
			expect(untyped.textContent).toBe(
				"he pink unicorn skipped through the meadow.",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("opens a selected completed episode in reading mode by default", async () => {
		const originalFetch = globalThis.fetch;
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			return Promise.resolve(
				episodeResponse({
					text: "Episode 2 text for testing.\nA second paragraph.",
					episode_idx: 1,
					current_episode: 2,
				}),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/episode/1" });

		try {
			const { getByTestId, getAllByTestId, queryByTestId, getByRole } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/episode/:episodeIdx">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("story-reader").textContent).toContain(
					"Episode 2 text for testing.",
				);
			});

			expect(requestedUrls).toContain("/api/children/winni/episodes/1");
			expect(getAllByTestId("chapter-jump")[3]?.dataset.status).toBe("locked");
			expect(getAllByTestId("chapter-jump")[2]?.dataset.status).toBe("latest");
			expect(queryByTestId("cursor-char")).toBeNull();
			expect(
				getByRole("button", { name: "Read story" }).getAttribute(
					"aria-pressed",
				),
			).toBe("true");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("plays completed chapter narration, highlights by audio time, and locks scroll only while playing", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith("/audio")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							audio_url: "/api/children/zack/episodes/0/audio/file",
							duration_seconds: 2,
							words: [
								{ index: 0, text: "Hello", start: 0, end: 0.2 },
								{ index: 1, text: "bright", start: 0.5, end: 0.8 },
								{ index: 2, text: "world.", start: 1, end: 1.4 },
							],
						}),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(
				episodeResponse({
					text: "Hello bright world.",
					episode_idx: 0,
					current_episode: 1,
					season_slug: "zack-s1-test",
				}),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/zack/episode/0" });

		try {
			const { container, getByRole, getByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/episode/:episodeIdx">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByRole("button", { name: "Play narration" })).toBeDefined();
			});

			const audio = container.querySelector("audio");
			if (!audio) {
				throw new Error("Expected audio element");
			}
			audio.currentTime = 0.55;
			audio.play = (() => {
				fireEvent.play(audio);
				return Promise.resolve();
			}) as typeof audio.play;
			audio.pause = (() => {
				fireEvent.pause(audio);
			}) as typeof audio.pause;

			fireEvent.click(getByRole("button", { name: "Play narration" }));

			await waitFor(() => {
				expect(getByTestId("story-word-1").dataset.active).toBe("true");
			});
			audio.currentTime = 1.1;
			fireEvent.seeked(audio);
			await waitFor(() => {
				expect(getByTestId("story-word-2").dataset.active).toBe("true");
			});

			const reader = getByTestId("story-reader");
			const playingWheel = new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
			});
			reader.dispatchEvent(playingWheel);
			expect(playingWheel.defaultPrevented).toBe(true);

			fireEvent.click(getByRole("button", { name: "Pause narration" }));

			await waitFor(() => {
				expect(
					getByRole("button", { name: "Play narration" }).getAttribute(
						"aria-pressed",
					),
				).toBe("false");
			});
			const pausedWheel = new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
			});
			reader.dispatchEvent(pausedWheel);
			expect(pausedWheel.defaultPrevented).toBe(false);

			fireEvent.click(getByRole("button", { name: "Play narration" }));
			await waitFor(() => {
				expect(getByTestId("story-word-2").dataset.active).toBe("true");
			});
			fireEvent.ended(audio);
			await waitFor(() => {
				expect(getByRole("button", { name: "Replay narration" })).toBeDefined();
			});
			expect(getByTestId("story-word-2").dataset.active).toBeUndefined();
			const endedWheel = new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
			});
			reader.dispatchEvent(endedWheel);
			expect(endedWheel.defaultPrevented).toBe(false);

			fireEvent.click(getByRole("button", { name: "Replay narration" }));
			await waitFor(() => {
				expect(getByTestId("story-word-0").dataset.active).toBe("true");
			});
			expect(audio.currentTime).toBe(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("keeps completed chapters readable when narration artifacts are missing", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith("/audio")) {
				return Promise.resolve(
					new Response(JSON.stringify({ error: "EpisodeAudioMissing" }), {
						status: 404,
						headers: { "content-type": "application/json" },
					}),
				);
			}
			return Promise.resolve(
				episodeResponse({
					text: "Episode 2 text for testing.",
					episode_idx: 1,
					current_episode: 2,
				}),
			);
		}) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/episode/1" });

		try {
			const { getByRole, getByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/episode/:episodeIdx">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("story-reader").textContent).toContain("Episode 2");
			});
			await waitFor(() => {
				expect(
					getByRole("button", { name: "Narration unavailable" }),
				).toBeDefined();
			});
			expect(
				(
					getByRole("button", {
						name: "Narration unavailable",
					}) as HTMLButtonElement
				).disabled,
			).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("lets a child type a completed episode again after choosing Type again", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				episodeResponse({
					text: "Episode 2 text for testing.",
					episode_idx: 1,
					current_episode: 2,
				}),
			)) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/episode/1" });

		try {
			const { getByTestId, getByRole, queryByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/episode/:episodeIdx">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("story-reader").textContent).toContain("Episode 2");
			});

			fireEvent.click(getByRole("button", { name: "Type again" }));

			await waitFor(() => {
				expect(getByTestId("cursor-char").textContent).toBe("E");
			});
			expect(queryByTestId("story-reader")).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("opens the latest episode in typing mode", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				episodeResponse({
					text: "Episode 3 text for testing.",
					episode_idx: 2,
					current_episode: 2,
				}),
			)) as unknown as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/winni/episode/2" });

		try {
			const { getByTestId, queryByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:childId/episode/:episodeIdx">
						<PlayEpisode />
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-char").textContent).toBe("E");
			});
			expect(queryByTestId("story-reader")).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
