import { describe, expect, test } from "bun:test";
import type { EpisodeRunnerState } from "./reducer";
import { episodeRunnerReducer } from "./reducer";

describe("episodeRunnerReducer", () => {
	test("BLUR clears lastKeystrokeAt", () => {
		const state: EpisodeRunnerState = {
			cursorIdx: 5,
			activeMs: 3000,
			lastKeystrokeAt: 1000,
		};
		const next = episodeRunnerReducer(state, { type: "BLUR" });
		expect(next.cursorIdx).toBe(5);
		expect(next.activeMs).toBe(3000);
		expect(next.lastKeystrokeAt).toBeNull();
	});

	test("type, BLUR, type: second type adds no delta from before the blur", () => {
		// Type first char at t=0
		let state = episodeRunnerReducer(
			{ cursorIdx: 0, activeMs: 0, lastKeystrokeAt: null },
			{ type: "KEY_DOWN", key: "H", expected: "H", timestamp: 0 },
		);
		expect(state.cursorIdx).toBe(1);
		expect(state.activeMs).toBe(0);
		expect(state.lastKeystrokeAt).toBe(0);

		// Type second char at t=1000
		state = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "e",
			expected: "e",
			timestamp: 1000,
		});
		expect(state.cursorIdx).toBe(2);
		expect(state.activeMs).toBe(1000);
		expect(state.lastKeystrokeAt).toBe(1000);

		// BLUR — tab hidden
		state = episodeRunnerReducer(state, { type: "BLUR" });
		expect(state.lastKeystrokeAt).toBeNull();
		expect(state.activeMs).toBe(1000);
		expect(state.cursorIdx).toBe(2);

		// Type third char at t=10000 (after coming back)
		state = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "l",
			expected: "l",
			timestamp: 10000,
		});
		expect(state.cursorIdx).toBe(3);
		// activeMs should NOT include the 9000ms gap from before the blur
		expect(state.activeMs).toBe(1000);
		expect(state.lastKeystrokeAt).toBe(10000);
	});
});
