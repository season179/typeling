import { wpmFromCharsAndMs } from "../../lib/wpm";
import { IDLE_THRESHOLD } from "./reducer";

export type WpmTrend = "warmup" | "up" | "steady" | "down";

export interface LiveWpmState {
	/** Timestamps (ms) of recent correct keystrokes, oldest first. */
	times: number[];
	/** Most recent windowed WPM, for the kid-facing display. */
	wpm: number;
	/** Smoothed baseline the trend is measured against. */
	baseline: number;
	/** Best windowed WPM seen this episode. */
	best: number;
	/** True on the tick that set a fresh personal best (post-warmup). */
	justBeatBest: boolean;
	trend: WpmTrend;
}

export type LiveWpmAction = { type: "TICK"; now: number } | { type: "RESET" };

/** How many recent keystrokes the sliding window keeps. */
export const WINDOW = 12;
/** Keystrokes needed before a trend (other than warmup) is shown. */
export const MIN_SAMPLES = 5;
/** EMA smoothing factor for the baseline (higher = chases recent faster). */
export const EMA_ALPHA = 0.3;
/** Deadband around the baseline; outside it the trend flips up/down. */
export const BAND = 0.08;
/**
 * Ceiling for the kid-facing number. A burst of near-simultaneous keystrokes
 * (synthetic input, or two characters from one physical action) spans only a
 * millisecond or two and would otherwise compute to thousands of WPM; no child
 * — or adult — sustains anywhere near this, so clamp it out.
 */
export const MAX_LIVE_WPM = 250;

export const initialLiveWpmState: LiveWpmState = {
	times: [],
	wpm: 0,
	baseline: 0,
	best: 0,
	justBeatBest: false,
	trend: "warmup",
};

/**
 * Tracks a responsive, kid-facing typing speed from correct keystrokes only.
 *
 * This is intentionally separate from the canonical lifetime WPM that gets
 * submitted to the server: it reads a recent sliding window so the number
 * stays alive late in long episodes, and exposes a trend so the UI can cheer
 * the child on when they speed up and stay gentle when they ease off. A pause
 * longer than IDLE_THRESHOLD clears the window so stopping never reads as
 * "slowing down".
 */
export function liveWpmReducer(
	state: LiveWpmState,
	action: LiveWpmAction,
): LiveWpmState {
	if (action.type === "RESET") {
		// Drop the window so a pause/return never reads as slowing down, but
		// keep the displayed number, baseline, and best so progress carries over.
		return { ...state, times: [], justBeatBest: false, trend: "warmup" };
	}

	// TICK — one correct keystroke at action.now.
	const last = state.times[state.times.length - 1];
	const afterIdle = last != null && action.now - last > IDLE_THRESHOLD;
	const base = afterIdle ? [] : state.times;

	const times = [...base, action.now];
	if (times.length > WINDOW) times.shift();

	// The last entry is always `action.now`; the window spans from its oldest.
	// A zero/negative span — two keystrokes inside the same millisecond — divides
	// to a meaningless 0 that would blank the kid-facing number, so keep the last
	// reading instead. Clamp the result so a near-simultaneous burst can never
	// surface an absurd figure.
	const oldest = times[0] ?? action.now;
	const span = action.now - oldest;
	const recentWpm =
		span > 0
			? Math.min(wpmFromCharsAndMs(times.length - 1, span), MAX_LIVE_WPM)
			: state.wpm;

	// Not enough samples yet: show a provisional number but no real trend. These
	// few-sample readings are noisy, so they must not touch `best` — otherwise an
	// inflated warmup spike becomes a bar no steady pace can clear and "New best!"
	// never fires.
	if (times.length < MIN_SAMPLES) {
		return {
			...state,
			times,
			wpm: recentWpm,
			baseline: recentWpm,
			justBeatBest: false,
			trend: "warmup",
		};
	}

	const seeded = state.baseline === 0;
	const prevBaseline = seeded ? recentWpm : state.baseline;
	let trend: WpmTrend = "steady";
	if (recentWpm > prevBaseline * (1 + BAND)) trend = "up";
	else if (recentWpm < prevBaseline * (1 - BAND)) trend = "down";

	const baseline = seeded
		? recentWpm
		: state.baseline + (recentWpm - state.baseline) * EMA_ALPHA;

	return {
		times,
		wpm: recentWpm,
		baseline,
		best: Math.max(state.best, recentWpm),
		justBeatBest: recentWpm > state.best,
		trend,
	};
}
