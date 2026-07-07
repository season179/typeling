import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { GlobalWindow, KeyboardEvent, type Window } from "happy-dom";
import ClipboardEvent from "happy-dom/lib/event/events/ClipboardEvent";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import EpisodeRunner from "../../src/web/EpisodeRunner";
import { clearDraft, saveDraft } from "../../src/web/episodeRunner/autosave";

const window = new GlobalWindow() as unknown as Window & typeof globalThis;

const defaultProps = {
	episodeText: "Hello world.",
	storySlug: "test-story",
	draftOwnerId: "test@example.com",
	seasonSlug: "test-season",
	episodeIdx: 0,
} as const;

function renderWithRouter(ui: React.ReactElement) {
	const { hook } = memoryLocation({ path: "/play/test-story" });
	return {
		...render(<Router hook={hook}>{ui}</Router>),
	};
}

describe("EpisodeRunner", () => {
	beforeAll(() => {
		// @ts-expect-error happy-dom globals
		globalThis.window = window;
		globalThis.document = window.document;
		globalThis.navigator = window.navigator;
		globalThis.localStorage = window.localStorage;
		// happy-dom doesn't provide crypto.randomUUID; stub it
		if (!globalThis.crypto) {
			(globalThis as any).crypto = {};
		}
		if (!globalThis.crypto.randomUUID) {
			(globalThis as any).crypto.randomUUID = () =>
				"00000000-0000-0000-0000-000000000001" as `${string}-${string}-${string}-${string}-${string}`;
		}
	});

	afterAll(() => {
		window.close();
	});

	afterEach(() => {
		cleanup();
		window.localStorage.clear();
	});

	it("generates a sessionId via crypto.randomUUID on mount", async () => {
		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="Hello world." />,
		);

		await waitFor(() => {
			const el = getByTestId("session-id");
			expect(el.textContent).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
		});
	});

	it("advances cursorIdx on correct keydown and ignores wrong keys", async () => {
		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="abc" />,
		);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
			expect(getByTestId("active-ms").textContent).toBe("0");
		});

		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "x", bubbles: true }) as unknown as Event,
			);
		});
		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
		});

		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "a", bubbles: true }) as unknown as Event,
			);
		});
		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("1");
			expect(getByTestId("active-ms").textContent).not.toBe("0");
		});
	});

	it("shows live speed: warms up, then displays a number and a non-warmup trend", async () => {
		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="abcdefgh" />,
		);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
		});

		// Before any typing, speed is warming up (placeholder, neutral trend).
		expect(getByTestId("live-wpm").textContent).toBe("…");
		expect(
			getByTestId("live-wpm").closest(".wpm-panel")?.className,
		).toContain("wpm-warmup");

		// Type correct characters with small real gaps so the window has
		// non-zero spans (synchronous dispatch would all share one timestamp).
		for (const key of ["a", "b", "c", "d", "e", "f"]) {
			act(() => {
				document.dispatchEvent(
					new KeyboardEvent("keydown", {
						key,
						bubbles: true,
					}) as unknown as Event,
				);
			});
			await new Promise((r) => setTimeout(r, 8));
		}

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("6");
			// Speed now shows a concrete number and has left the warmup state.
			expect(getByTestId("live-wpm").textContent).toMatch(/^\d+$/);
			const cls = getByTestId("live-wpm").closest(".wpm-panel")?.className ?? "";
			expect(cls).not.toContain("wpm-warmup");
			expect(cls).toMatch(/wpm-(up|steady|down)/);
		});
	});

	it("renders typed region dimmed and untyped region with full contrast", () => {
		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="Hello" />,
		);

		const typed = getByTestId("typed-region");
		expect(typed.className).toContain("text-stone-300");
		expect(typed.textContent).toBe("");

		const cursor = getByTestId("cursor-char");
		expect(cursor.className).toContain("border-b-");
		expect(cursor.className).toContain("border-amber-400");
		expect(cursor.textContent).toBe("H");

		const untyped = getByTestId("untyped-region");
		expect(untyped.className).toContain("text-stone-800");
		expect(untyped.textContent).toBe("ello");
	});

	it("moves cursor and updates regions after correct keystroke", async () => {
		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="abc" />,
		);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
		});

		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "a", bubbles: true }) as unknown as Event,
			);
		});

		await waitFor(() => {
			expect(getByTestId("typed-region").textContent).toBe("a");
			expect(getByTestId("cursor-char").textContent).toBe("b");
			expect(getByTestId("untyped-region").textContent).toBe("c");
		});
	});

	it("prevents default on paste events", async () => {
		const { getByTestId } = renderWithRouter(<EpisodeRunner {...defaultProps} episodeText="abc" />);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
		});

		const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true });

		act(() => {
			document.dispatchEvent(pasteEvent as unknown as Event);
		});

		expect(pasteEvent.defaultPrevented).toBe(true);
	});

	it("prevents default browser scroll on space key", async () => {
		const { getByTestId } = renderWithRouter(<EpisodeRunner {...defaultProps} episodeText="abc" />);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
		});

		const spaceEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });

		act(() => {
			document.dispatchEvent(spaceEvent as unknown as Event);
		});

		expect(spaceEvent.defaultPrevented).toBe(true);
	});

	it("pauses activeMs accumulation when tab becomes hidden", async () => {
		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="abc" />,
		);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
		});

		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "a", bubbles: true }) as unknown as Event,
			);
		});

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("1");
		});
		const activeMsAfterFirst = Number(getByTestId("active-ms").textContent);

		// Simulate tab hidden
		act(() => {
			Object.defineProperty(document, "visibilityState", {
				value: "hidden",
				configurable: true,
			});
			document.dispatchEvent(
				new (window as any).Event("visibilitychange", { bubbles: true }) as Event,
			);
		});

		// Type second char after returning — activeMs should NOT include hidden time
		act(() => {
			Object.defineProperty(document, "visibilityState", {
				value: "visible",
				configurable: true,
			});
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "b", bubbles: true }) as unknown as Event,
			);
		});

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("2");
			const finalMs = Number(getByTestId("active-ms").textContent);
			expect(finalMs).toBeGreaterThanOrEqual(activeMsAfterFirst);
			// Delta should be tiny — synchronous execution, not accumulated hidden time
			expect(finalMs - activeMsAfterFirst).toBeLessThan(5000);
		});
	});

	it("POSTs /api/sessions on completion and navigates on 200", async () => {
		const originalFetch = globalThis.fetch;
		let fetchBody: unknown = null;
		let fetchUrl = "";
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			fetchUrl = String(input);
			fetchBody = JSON.parse(init?.body as string);
			return Promise.resolve(new Response("{}", { status: 200 }));
		}) as typeof fetch;

		const { hook, history } = memoryLocation({
			path: "/play/rainbow-story",
			record: true,
		});

		try {
			const { getByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:storySlug">
						<EpisodeRunner
							episodeText="ab"
							storySlug="rainbow-story"
							draftOwnerId="reader@example.com"
							seasonSlug="rainbow-door-s1"
							episodeIdx={0}
						/>
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-idx").textContent).toBe("0");
			});

			// Type first char
			act(() => {
				document.dispatchEvent(
					new KeyboardEvent("keydown", { key: "a", bubbles: true }) as unknown as Event,
				);
			});
			await waitFor(() => {
				expect(getByTestId("cursor-idx").textContent).toBe("1");
			});

			// Type second char to complete
			act(() => {
				document.dispatchEvent(
					new KeyboardEvent("keydown", { key: "b", bubbles: true }) as unknown as Event,
				);
			});

			await waitFor(() => {
				expect(fetchUrl).toBe("/api/sessions");
			});

			expect(fetchBody).toMatchObject({
				id: expect.any(String) as string,
				season_slug: "rainbow-door-s1",
				episode_idx: 0,
				wpm: expect.any(Number) as number,
				char_count: 2,
				active_ms: expect.any(Number) as number,
				started_at: expect.any(String) as string,
				finished_at: expect.any(String) as string,
			});

			// Navigation should have happened
			await waitFor(() => {
				expect(history[history.length - 1]).toBe(
					"/play/rainbow-story/complete/0",
				);
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("shows error on non-200 response and does not navigate", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(new Response("{}", { status: 400 }))) as unknown as typeof fetch;

		const { hook, history } = memoryLocation({
			path: "/play/rainbow-story",
			record: true,
		});

		try {
			const { getByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:storySlug">
						<EpisodeRunner
							episodeText="a"
							storySlug="rainbow-story"
							draftOwnerId="reader@example.com"
							seasonSlug="rainbow-door-s1"
							episodeIdx={0}
						/>
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-idx").textContent).toBe("0");
			});

			act(() => {
				document.dispatchEvent(
					new KeyboardEvent("keydown", { key: "a", bubbles: true }) as unknown as Event,
				);
			});

			await waitFor(() => {
				expect(getByTestId("session-error").textContent).toBe(
					"Failed to save session (400)",
				);
			});

			// Navigation should NOT have happened
			expect(history.length).toBe(1);
			expect(history[0]).toBe("/play/rainbow-story");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("redirects to sign-in when the session expired on completion (401)", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response("{}", { status: 401 }),
			)) as unknown as typeof fetch;

		const { hook, history } = memoryLocation({
			path: "/play/rainbow-story",
			record: true,
		});

		try {
			const { getByTestId, queryByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:storySlug">
						<EpisodeRunner
							episodeText="a"
							storySlug="rainbow-story"
							draftOwnerId="reader@example.com"
							seasonSlug="rainbow-door-s1"
							episodeIdx={0}
						/>
					</Route>
					<Route path="/">signed out</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-idx").textContent).toBe("0");
			});

			act(() => {
				document.dispatchEvent(
					new KeyboardEvent("keydown", { key: "a", bubbles: true }) as unknown as Event,
				);
			});

			// The expired session sends the reader to sign in rather than surfacing
			// a silent, dead-end error.
			await waitFor(() => {
				expect(history.at(-1)).toBe("/");
			});
			expect(queryByTestId("session-error")).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("prevents double-fire of POST on completion", async () => {
		const originalFetch = globalThis.fetch;
		let fetchCount = 0;
		globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
			fetchCount++;
			return Promise.resolve(new Response("{}", { status: 200 }));
		}) as typeof fetch;

		const { hook } = memoryLocation({ path: "/play/rainbow-story" });

		try {
			const { getByTestId } = render(
				<Router hook={hook}>
					<Route path="/play/:storySlug">
						<EpisodeRunner
							episodeText="a"
							storySlug="rainbow-story"
							draftOwnerId="reader@example.com"
							seasonSlug="rainbow-door-s1"
							episodeIdx={0}
						/>
					</Route>
				</Router>,
			);

			await waitFor(() => {
				expect(getByTestId("cursor-idx").textContent).toBe("0");
			});

			// Complete the episode
			act(() => {
				document.dispatchEvent(
					new KeyboardEvent("keydown", { key: "a", bubbles: true }) as unknown as Event,
				);
			});

			await waitFor(() => {
				expect(getByTestId("cursor-idx").textContent).toBe("1");
			});

			// Allow the effect to fire
			await new Promise((r) => setTimeout(r, 50));

			// Dispatch another key after completion - should not trigger second POST
			act(() => {
				document.dispatchEvent(
					new KeyboardEvent("keydown", { key: "b", bubbles: true }) as unknown as Event,
				);
			});

			await new Promise((r) => setTimeout(r, 50));

			expect(fetchCount).toBe(1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("removes visibilitychange listener on unmount", () => {
		const addSpy = {
			calls: [] as Array<{ type: string; handler: EventListener }>,
		};
		const removeSpy = {
			calls: [] as Array<{ type: string; handler: EventListener }>,
		};

		const origAdd = document.addEventListener.bind(document);
		const origRemove = document.removeEventListener.bind(document);

		document.addEventListener = (
			type: string,
			handler: EventListenerOrEventListenerObject,
		) => {
			addSpy.calls.push({ type, handler: handler as EventListener });
			return origAdd(type, handler);
		};
		document.removeEventListener = (
			type: string,
			handler: EventListenerOrEventListenerObject,
		) => {
			removeSpy.calls.push({ type, handler: handler as EventListener });
			return origRemove(type, handler);
		};

		try {
			const { unmount } = renderWithRouter(<EpisodeRunner {...defaultProps} episodeText="abc" />);

			const visAddCalls = addSpy.calls.filter((c) => c.type === "visibilitychange");
			expect(visAddCalls.length).toBe(1);

			unmount();

			const visRemoveCalls = removeSpy.calls.filter((c) => c.type === "visibilitychange");
			expect(visRemoveCalls.length).toBe(1);
			expect(visRemoveCalls[0]!.handler).toBe(visAddCalls[0]!.handler);
		} finally {
			document.addEventListener = origAdd;
			document.removeEventListener = origRemove;
		}
	});

	it("restores cursorIdx from localStorage draft on mount", async () => {
		saveDraft(
			defaultProps.draftOwnerId,
			defaultProps.seasonSlug,
			defaultProps.episodeIdx,
			{
				sessionId: "draft-session-uuid",
				cursorIdx: 6,
				activeMs: 5000,
				lastKeystrokeAt: 1715300000000,
			},
		);

		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="Hello world." />,
		);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("6");
		});
	});

	it("restores activeMs from localStorage draft on mount", async () => {
		saveDraft(
			defaultProps.draftOwnerId,
			defaultProps.seasonSlug,
			defaultProps.episodeIdx,
			{
				sessionId: "draft-session-uuid",
				cursorIdx: 3,
				activeMs: 9999,
				lastKeystrokeAt: 1715300000000,
			},
		);

		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="Hello world." />,
		);

		await waitFor(() => {
			expect(getByTestId("active-ms").textContent).toBe("9999");
		});
	});

	it("restores sessionId from localStorage draft on mount", async () => {
		saveDraft(
			defaultProps.draftOwnerId,
			defaultProps.seasonSlug,
			defaultProps.episodeIdx,
			{
				sessionId: "existing-session-id",
				cursorIdx: 0,
				activeMs: 0,
				lastKeystrokeAt: null,
			},
		);

		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="Hello world." />,
		);

		await waitFor(() => {
			expect(getByTestId("session-id").textContent).toBe("existing-session-id");
		});
	});

	it("starts fresh when no draft exists", async () => {
		clearDraft(
			defaultProps.draftOwnerId,
			defaultProps.seasonSlug,
			defaultProps.episodeIdx,
		);

		const { getByTestId } = renderWithRouter(
			<EpisodeRunner {...defaultProps} episodeText="Hello world." />,
		);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
			expect(getByTestId("active-ms").textContent).toBe("0");
		});
	});
});
