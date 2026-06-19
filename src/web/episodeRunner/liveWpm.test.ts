import { describe, expect, test } from "bun:test";
import {
	initialLiveWpmState,
	type LiveWpmState,
	liveWpmReducer,
	MIN_SAMPLES,
	WINDOW,
} from "./liveWpm";
import { IDLE_THRESHOLD } from "./reducer";

/** Feed a sequence of keystroke timestamps through the reducer. */
function tickAll(times: number[], from = initialLiveWpmState): LiveWpmState {
	return times.reduce(
		(state, now) => liveWpmReducer(state, { type: "TICK", now }),
		from,
	);
}

/** A steady cadence: MIN_SAMPLES keystrokes, `gap` ms apart, starting at 0. */
function steadyStart(gap: number): { state: LiveWpmState; lastNow: number } {
	const times = Array.from({ length: MIN_SAMPLES }, (_, i) => i * gap);
	return { state: tickAll(times), lastNow: (MIN_SAMPLES - 1) * gap };
}

describe("liveWpmReducer", () => {
	test("stays in warmup until MIN_SAMPLES keystrokes", () => {
		let state = initialLiveWpmState;
		for (let i = 0; i < MIN_SAMPLES - 1; i++) {
			state = liveWpmReducer(state, { type: "TICK", now: i * 300 });
			expect(state.trend).toBe("warmup");
		}
		// The MIN_SAMPLES-th keystroke promotes out of warmup.
		state = liveWpmReducer(state, {
			type: "TICK",
			now: (MIN_SAMPLES - 1) * 300,
		});
		expect(state.trend).not.toBe("warmup");
	});

	test("provisional wpm is exposed during warmup", () => {
		// Two keystrokes 600ms apart => 1 char over 0.01 min => 20 wpm.
		const state = tickAll([0, 600]);
		expect(state.trend).toBe("warmup");
		expect(state.wpm).toBeCloseTo(20, 5);
	});

	test("speeding up reports trend 'up'", () => {
		const { state, lastNow } = steadyStart(600); // baseline ~20 wpm
		expect(state.trend).toBe("steady");
		const faster = liveWpmReducer(state, { type: "TICK", now: lastNow + 150 });
		expect(faster.trend).toBe("up");
		expect(faster.wpm).toBeGreaterThan(state.wpm);
	});

	test("slowing down reports trend 'down'", () => {
		const { state, lastNow } = steadyStart(600); // baseline ~20 wpm
		const slower = liveWpmReducer(state, { type: "TICK", now: lastNow + 2000 });
		expect(slower.trend).toBe("down");
		expect(slower.wpm).toBeLessThan(state.wpm);
	});

	test("holding the same cadence stays 'steady'", () => {
		const { state, lastNow } = steadyStart(600);
		const same = liveWpmReducer(state, { type: "TICK", now: lastNow + 600 });
		expect(same.trend).toBe("steady");
	});

	test("a pause longer than IDLE_THRESHOLD resets the window, not 'down'", () => {
		const { state, lastNow } = steadyStart(300);
		const resumed = liveWpmReducer(state, {
			type: "TICK",
			now: lastNow + IDLE_THRESHOLD + 1000,
		});
		expect(resumed.times).toHaveLength(1);
		expect(resumed.trend).toBe("warmup");
		expect(resumed.trend).not.toBe("down");
	});

	test("RESET clears the window but keeps baseline and best", () => {
		const seeded: LiveWpmState = {
			times: [0, 100, 200],
			wpm: 30,
			baseline: 25,
			best: 42,
			justBeatBest: true,
			trend: "up",
		};
		const reset = liveWpmReducer(seeded, { type: "RESET" });
		expect(reset.times).toHaveLength(0);
		expect(reset.trend).toBe("warmup");
		expect(reset.justBeatBest).toBe(false);
		expect(reset.baseline).toBe(25);
		expect(reset.best).toBe(42);
		expect(reset.wpm).toBe(30);
	});

	test("the window never grows beyond WINDOW", () => {
		const times = Array.from({ length: WINDOW + 8 }, (_, i) => i * 200);
		const state = tickAll(times);
		expect(state.times).toHaveLength(WINDOW);
	});

	test("best tracks the maximum windowed wpm seen", () => {
		const { state, lastNow } = steadyStart(600); // ~20 wpm
		const faster = liveWpmReducer(state, { type: "TICK", now: lastNow + 100 });
		expect(faster.best).toBeGreaterThanOrEqual(faster.wpm);
		expect(faster.best).toBeGreaterThan(20);
		expect(faster.justBeatBest).toBe(true);
	});
});
