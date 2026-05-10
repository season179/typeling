import { describe, expect, test } from "bun:test";
import type { EpisodeRunnerState } from "./reducer";
import { episodeRunnerReducer } from "./reducer";

const base: EpisodeRunnerState = {
	cursorIdx: 0,
	activeMs: 0,
	lastKeystrokeAt: null,
	flashUntil: null,
	startedAt: null,
};

describe("episodeRunnerReducer", () => {
	test("first keystroke sets startedAt", () => {
		const next = episodeRunnerReducer(base, {
			type: "KEY_DOWN",
			key: "a",
			expected: "a",
			now: 1000,
		});
		expect(next.startedAt).toBe(1000);
	});

	test("startedAt persists through subsequent keystrokes", () => {
		let state = episodeRunnerReducer(base, {
			type: "KEY_DOWN",
			key: "a",
			expected: "a",
			now: 1000,
		});
		expect(state.startedAt).toBe(1000);

		state = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "b",
			expected: "b",
			now: 2000,
		});
		expect(state.startedAt).toBe(1000);
	});

	test("wrong first keystroke sets startedAt", () => {
		const next = episodeRunnerReducer(base, {
			type: "KEY_DOWN",
			key: "x",
			expected: "a",
			now: 1000,
		});
		expect(next.startedAt).toBe(1000);
	});

	test("BLUR does not clear startedAt", () => {
		const state: EpisodeRunnerState = {
			cursorIdx: 5,
			activeMs: 3000,
			lastKeystrokeAt: 1000,
			flashUntil: null,
			startedAt: 500,
		};
		const next = episodeRunnerReducer(state, { type: "BLUR" });
		expect(next.startedAt).toBe(500);
	});

	test("repeat key does not set startedAt", () => {
		const next = episodeRunnerReducer(base, {
			type: "KEY_DOWN",
			key: "a",
			expected: "a",
			now: 1000,
			repeat: true,
		});
		expect(next.startedAt).toBeNull();
	});

	test("non-printable key does not set startedAt", () => {
		const next = episodeRunnerReducer(base, {
			type: "KEY_DOWN",
			key: "Shift",
			expected: "S",
			now: 1000,
		});
		expect(next.startedAt).toBeNull();
	});

	test("BLUR clears lastKeystrokeAt", () => {
		const state: EpisodeRunnerState = {
			cursorIdx: 5,
			activeMs: 3000,
			lastKeystrokeAt: 1000,
			flashUntil: null,
			startedAt: null,
		};
		const next = episodeRunnerReducer(state, { type: "BLUR" });
		expect(next.cursorIdx).toBe(5);
		expect(next.activeMs).toBe(3000);
		expect(next.lastKeystrokeAt).toBeNull();
	});

	test("type, BLUR, type: second type adds no delta from before the blur", () => {
		let state = episodeRunnerReducer(
			{ ...base, cursorIdx: 0 },
			{ type: "KEY_DOWN", key: "H", expected: "H", now: 0 },
		);
		expect(state.cursorIdx).toBe(1);
		expect(state.activeMs).toBe(0);
		expect(state.lastKeystrokeAt).toBe(0);

		state = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "e",
			expected: "e",
			now: 1000,
		});
		expect(state.cursorIdx).toBe(2);
		expect(state.activeMs).toBe(1000);
		expect(state.lastKeystrokeAt).toBe(1000);

		state = episodeRunnerReducer(state, { type: "BLUR" });
		expect(state.lastKeystrokeAt).toBeNull();
		expect(state.activeMs).toBe(1000);
		expect(state.cursorIdx).toBe(2);

		state = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "l",
			expected: "l",
			now: 10000,
		});
		expect(state.cursorIdx).toBe(3);
		expect(state.activeMs).toBe(1000);
		expect(state.lastKeystrokeAt).toBe(10000);
	});

	test("sets flashUntil on wrong key", () => {
		const now = 1000;
		const next = episodeRunnerReducer(base, {
			type: "KEY_DOWN",
			key: "x",
			expected: "a",
			now,
		});
		expect(next.flashUntil).toBe(1200);
	});

	test("clears flashUntil on correct key after wrong", () => {
		const withFlash: EpisodeRunnerState = {
			...base,
			cursorIdx: 0,
			flashUntil: 1200,
		};
		const next = episodeRunnerReducer(withFlash, {
			type: "KEY_DOWN",
			key: "a",
			expected: "a",
			now: 1100,
		});
		expect(next.flashUntil).toBe(null);
	});

	test("first correct key leaves flashUntil null", () => {
		const next = episodeRunnerReducer(base, {
			type: "KEY_DOWN",
			key: "a",
			expected: "a",
			now: 1000,
		});
		expect(next.flashUntil).toBe(null);
	});

	test("wrong key re-ups flashUntil", () => {
		const withFlash: EpisodeRunnerState = {
			...base,
			flashUntil: 1200,
		};
		const next = episodeRunnerReducer(withFlash, {
			type: "KEY_DOWN",
			key: "y",
			expected: "a",
			now: 1500,
		});
		expect(next.flashUntil).toBe(1700);
	});

	test("repeat key does not change flashUntil", () => {
		const next = episodeRunnerReducer(base, {
			type: "KEY_DOWN",
			key: "x",
			expected: "a",
			now: 1000,
			repeat: true,
		});
		expect(next.flashUntil).toBe(null);
	});

	test("non-printable key does not change flashUntil", () => {
		const next = episodeRunnerReducer(base, {
			type: "KEY_DOWN",
			key: "Shift",
			expected: "S",
			now: 1000,
		});
		expect(next.flashUntil).toBe(null);
	});

	test("wrong key does not advance cursorIdx", () => {
		const next = episodeRunnerReducer(
			{ ...base, cursorIdx: 3 },
			{ type: "KEY_DOWN", key: "x", expected: "a", now: 1000 },
		);
		expect(next.cursorIdx).toBe(3);
	});
});
