import { describe, it, expect } from "bun:test";
import { episodeRunnerReducer } from "../../../src/web/episodeRunner/reducer";

describe("episodeRunnerReducer KEY_DOWN", () => {
	const cases = [
		{ name: "advances cursorIdx for correct char", state: { cursorIdx: 0 }, key: "h", expected: "h", want: 1 },
		{ name: "no-op for wrong char", state: { cursorIdx: 0 }, key: "x", expected: "h", want: 0 },
		{ name: "case-sensitive: T != t", state: { cursorIdx: 0 }, key: "t", expected: "T", want: 0 },
		{ name: "advances past first char", state: { cursorIdx: 2 }, key: "l", expected: "l", want: 3 },
	] as const;

	for (const c of cases) {
		it(c.name, () => {
			const next = episodeRunnerReducer(c.state, {
				type: "KEY_DOWN",
				key: c.key,
				expected: c.expected,
			});
			expect(next.cursorIdx).toBe(c.want);
		});
	}
});
