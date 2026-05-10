import { describe, it, expect } from "bun:test";
import { episodeRunnerReducer, IDLE_THRESHOLD } from "../../../src/web/episodeRunner/reducer";

const TS0 = 1715300000000;

describe("episodeRunnerReducer KEY_DOWN", () => {
	const cases = [
		{ name: "advances cursorIdx for correct char", state: { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: null }, key: "h", expected: "h", ts: TS0, repeat: false, wantCursor: 1 },
		{ name: "no-op for wrong char", state: { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: null }, key: "x", expected: "h", ts: TS0, repeat: false, wantCursor: 0 },
		{ name: "case-sensitive: T != t", state: { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: null }, key: "t", expected: "T", ts: TS0, repeat: false, wantCursor: 0 },
		{ name: "advances past first char", state: { cursorIdx: 2, activeMs: 0, lastKeystrokeAt: null }, key: "l", expected: "l", ts: TS0, repeat: false, wantCursor: 3 },
		{ name: "no-op for repeat key even when correct", state: { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: null }, key: "h", expected: "h", ts: TS0, repeat: true, wantCursor: 0 },
	] as const;

	for (const c of cases) {
		it(c.name, () => {
			const next = episodeRunnerReducer(c.state, {
				type: "KEY_DOWN",
				key: c.key,
				expected: c.expected,
				timestamp: c.ts,
				repeat: c.repeat,
			});
			expect(next.cursorIdx).toBe(c.wantCursor);
			expect(next.lastKeystrokeAt).toBe(c.repeat ? null : c.ts);
		});
	}

	const nonTypingKeys = [
		"Shift",
		"Control",
		"Alt",
		"Meta",
		"CapsLock",
		"Tab",
		"ArrowLeft",
		"ArrowRight",
		"ArrowUp",
		"ArrowDown",
		"Backspace",
		"Delete",
		"Escape",
		"F1",
		"F2",
		"F3",
		"F4",
		"F5",
		"F6",
		"F7",
		"F8",
		"F9",
		"F10",
		"F11",
		"F12",
	] as const;

	for (const key of nonTypingKeys) {
		it(`ignores non-typing key: ${key}`, () => {
			const state = { cursorIdx: 5, activeMs: 0, lastKeystrokeAt: null };
			const next = episodeRunnerReducer(state, {
				type: "KEY_DOWN",
				key,
				expected: "a",
				timestamp: TS0,
			});
			expect(next).toBe(state);
		});
	}

	it("ignores empty-string key", () => {
		const state = { cursorIdx: 3, activeMs: 0, lastKeystrokeAt: null };
		const next = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "",
			expected: "a",
			timestamp: TS0,
		});
		expect(next).toBe(state);
	});
});

describe("episodeRunnerReducer activeMs accumulator", () => {
	it("first keystroke: lastKeystrokeAt set, activeMs stays 0", () => {
		const state = { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: null };
		const next = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "h",
			expected: "h",
			timestamp: TS0,
		});
		expect(next.lastKeystrokeAt).toBe(TS0);
		expect(next.activeMs).toBe(0);
	});

	it("second keystroke 1000ms later: activeMs = 1000", () => {
		const state = { cursorIdx: 1, activeMs: 0, lastKeystrokeAt: TS0 };
		const next = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "e",
			expected: "e",
			timestamp: TS0 + 1000,
		});
		expect(next.activeMs).toBe(1000);
		expect(next.lastKeystrokeAt).toBe(TS0 + 1000);
	});

	it("wrong key updates lastKeystrokeAt without accumulating activeMs", () => {
		const state = { cursorIdx: 1, activeMs: 500, lastKeystrokeAt: TS0 };
		const next = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "x",
			expected: "e",
			timestamp: TS0 + 1500,
		});
		expect(next.activeMs).toBe(500);
		expect(next.lastKeystrokeAt).toBe(TS0 + 1500);
		expect(next.cursorIdx).toBe(1);
	});

	it("5-keystroke sequence accumulates only on correct keystrokes", () => {
		let state = { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: null as number | null };

		state = episodeRunnerReducer(state, { type: "KEY_DOWN", key: "h", expected: "h", timestamp: TS0 + 1000 });
		expect(state.activeMs).toBe(0);
		expect(state.lastKeystrokeAt).toBe(TS0 + 1000);
		expect(state.cursorIdx).toBe(1);

		state = episodeRunnerReducer(state, { type: "KEY_DOWN", key: "e", expected: "e", timestamp: TS0 + 2300 });
		expect(state.activeMs).toBe(1300);
		expect(state.lastKeystrokeAt).toBe(TS0 + 2300);
		expect(state.cursorIdx).toBe(2);

		state = episodeRunnerReducer(state, { type: "KEY_DOWN", key: "z", expected: "l", timestamp: TS0 + 3800 });
		expect(state.activeMs).toBe(1300);
		expect(state.lastKeystrokeAt).toBe(TS0 + 3800);
		expect(state.cursorIdx).toBe(2);

		state = episodeRunnerReducer(state, { type: "KEY_DOWN", key: "l", expected: "l", timestamp: TS0 + 5000 });
		expect(state.activeMs).toBe(2500);
		expect(state.lastKeystrokeAt).toBe(TS0 + 5000);
		expect(state.cursorIdx).toBe(3);

		state = episodeRunnerReducer(state, { type: "KEY_DOWN", key: "l", expected: "l", timestamp: TS0 + 6400 });
		expect(state.activeMs).toBe(3900);
		expect(state.lastKeystrokeAt).toBe(TS0 + 6400);
		expect(state.cursorIdx).toBe(4);
	});
});

describe("episodeRunnerReducer idle pause", () => {
	it("delta within IDLE_THRESHOLD is added to activeMs", () => {
		const state = { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: 0 as number | null };
		const next = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "T",
			expected: "T",
			timestamp: IDLE_THRESHOLD,
		});
		expect(next.activeMs).toBe(IDLE_THRESHOLD);
		expect(next.cursorIdx).toBe(1);
	});

	it("delta exceeding IDLE_THRESHOLD is not added but lastKeystrokeAt still updates", () => {
		const state = { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: 0 as number | null };
		const next = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "T",
			expected: "T",
			timestamp: IDLE_THRESHOLD + 1,
		});
		expect(next.activeMs).toBe(0);
		expect(next.cursorIdx).toBe(1);
		expect(next.lastKeystrokeAt).toBe(IDLE_THRESHOLD + 1);
	});

	it("AC sequence: activeMs = 2000 after t=0,1000,10000,11000", () => {
		let s = { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: null as number | null };

		// t=0: first keystroke
		s = episodeRunnerReducer(s, { type: "KEY_DOWN", key: "T", expected: "T", timestamp: 0 });
		expect(s.activeMs).toBe(0);
		expect(s.cursorIdx).toBe(1);

		// t=1000: delta 1000, within threshold
		s = episodeRunnerReducer(s, { type: "KEY_DOWN", key: "h", expected: "h", timestamp: 1000 });
		expect(s.activeMs).toBe(1000);
		expect(s.cursorIdx).toBe(2);

		// t=10000: delta 9000 > 5000, excluded
		s = episodeRunnerReducer(s, { type: "KEY_DOWN", key: "e", expected: "e", timestamp: 10000 });
		expect(s.activeMs).toBe(1000);
		expect(s.cursorIdx).toBe(3);

		// t=11000: delta 1000, within threshold
		s = episodeRunnerReducer(s, { type: "KEY_DOWN", key: " ", expected: " ", timestamp: 11000 });
		expect(s.activeMs).toBe(2000);
		expect(s.cursorIdx).toBe(4);
	});

	it("30s idle: activeMs excludes the idle gap", () => {
		let s = { cursorIdx: 0, activeMs: 0, lastKeystrokeAt: 0 as number | null };

		s = episodeRunnerReducer(s, { type: "KEY_DOWN", key: "a", expected: "a", timestamp: 1000 });
		expect(s.activeMs).toBe(1000);
		expect(s.cursorIdx).toBe(1);

		s = episodeRunnerReducer(s, { type: "KEY_DOWN", key: "b", expected: "b", timestamp: 31000 });
		expect(s.activeMs).toBe(1000);
		expect(s.cursorIdx).toBe(2);

		s = episodeRunnerReducer(s, { type: "KEY_DOWN", key: "c", expected: "c", timestamp: 32000 });
		expect(s.activeMs).toBe(2000);
		expect(s.cursorIdx).toBe(3);
	});
});
