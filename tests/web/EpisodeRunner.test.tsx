import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { GlobalWindow, KeyboardEvent, type Window } from "happy-dom";
import ClipboardEvent from "happy-dom/lib/event/events/ClipboardEvent";
import EpisodeRunner from "../../src/web/EpisodeRunner";

const window = new GlobalWindow() as unknown as Window & typeof globalThis;

describe("EpisodeRunner", () => {
	beforeAll(() => {
		// @ts-expect-error happy-dom globals
		globalThis.window = window;
		globalThis.document = window.document;
		globalThis.navigator = window.navigator;
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
	});

	it("generates a sessionId via crypto.randomUUID on mount", async () => {
		const { getByTestId } = render(
			<EpisodeRunner episodeText="Hello world." />,
		);

		await waitFor(() => {
			const el = getByTestId("session-id");
			expect(el.textContent).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
		});
	});

	it("advances cursorIdx on correct keydown and ignores wrong keys", async () => {
		const { getByTestId } = render(
			<EpisodeRunner episodeText="abc" />,
		);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
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
		});
	});

	it("renders typed region dimmed and untyped region with full contrast", () => {
		const { getByTestId } = render(
			<EpisodeRunner episodeText="Hello" />,
		);

		const typed = getByTestId("typed-region");
		expect(typed.className).toContain("text-gray-400");
		expect(typed.textContent).toBe("");

		const cursor = getByTestId("cursor-char");
		expect(cursor.className).toContain("border-b-2");
		expect(cursor.className).toContain("border-black");
		expect(cursor.className).toContain("animate-pulse");
		expect(cursor.textContent).toBe("H");

		const untyped = getByTestId("untyped-region");
		expect(untyped.className).toContain("text-gray-900");
		expect(untyped.textContent).toBe("ello");
	});

	it("moves cursor and updates regions after correct keystroke", async () => {
		const { getByTestId } = render(
			<EpisodeRunner episodeText="abc" />,
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
		const { getByTestId } = render(<EpisodeRunner episodeText="abc" />);

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
		const { getByTestId } = render(<EpisodeRunner episodeText="abc" />);

		await waitFor(() => {
			expect(getByTestId("cursor-idx").textContent).toBe("0");
		});

		const spaceEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });

		act(() => {
			document.dispatchEvent(spaceEvent as unknown as Event);
		});

		expect(spaceEvent.defaultPrevented).toBe(true);
	});
});
