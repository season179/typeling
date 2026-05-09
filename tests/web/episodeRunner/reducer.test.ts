import { describe, it, expect } from "bun:test";
import { episodeRunnerReducer } from "../../../src/web/episodeRunner/reducer";

describe("episodeRunnerReducer KEY_DOWN", () => {
	const cases = [
		{ name: "advances cursorIdx for correct char", state: { cursorIdx: 0 }, key: "h", expected: "h", repeat: false, want: 1 },
		{ name: "no-op for wrong char", state: { cursorIdx: 0 }, key: "x", expected: "h", repeat: false, want: 0 },
		{ name: "case-sensitive: T != t", state: { cursorIdx: 0 }, key: "t", expected: "T", repeat: false, want: 0 },
		{ name: "advances past first char", state: { cursorIdx: 2 }, key: "l", expected: "l", repeat: false, want: 3 },
		{ name: "no-op for repeat key even when correct", state: { cursorIdx: 0 }, key: "h", expected: "h", repeat: true, want: 0 },
	] as const;

	for (const c of cases) {
		it(c.name, () => {
			const next = episodeRunnerReducer(c.state, {
				type: "KEY_DOWN",
				key: c.key,
				expected: c.expected,
				repeat: c.repeat,
			});
			expect(next.cursorIdx).toBe(c.want);
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
			const state = { cursorIdx: 5 };
			const next = episodeRunnerReducer(state, {
				type: "KEY_DOWN",
				key,
				expected: "a",
			});
			expect(next).toBe(state);
		});
	}

	it("ignores empty-string key", () => {
		const state = { cursorIdx: 3 };
		const next = episodeRunnerReducer(state, {
			type: "KEY_DOWN",
			key: "",
			expected: "a",
		});
		expect(next).toBe(state);
	});
});
