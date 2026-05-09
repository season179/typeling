import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { GlobalWindow, type Window } from "happy-dom";
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
});
