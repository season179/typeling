import type { Session } from "./schemas/state";

/**
 * Lifetime stats and trend helpers for the parent dashboard. Pure functions
 * over a list of completed sessions (already scoped by the caller to a single
 * reader, and usually a single story). Kept separate from `rolling3` so each
 * metric is independently testable.
 */

export interface SessionTotals {
	/** Number of completed sessions. */
	count: number;
	/** Sum of active typing time across sessions, in milliseconds. */
	total_active_ms: number;
	/** Highest WPM across sessions, or null when there are none. */
	best_wpm: number | null;
	/** Mean WPM across sessions, or null when there are none. */
	avg_wpm: number | null;
}

export function sessionTotals(sessions: Session[]): SessionTotals {
	if (sessions.length === 0) {
		return { count: 0, total_active_ms: 0, best_wpm: null, avg_wpm: null };
	}
	let totalActiveMs = 0;
	let bestWpm = Number.NEGATIVE_INFINITY;
	let sumWpm = 0;
	for (const session of sessions) {
		totalActiveMs += session.active_ms;
		sumWpm += session.wpm;
		if (session.wpm > bestWpm) bestWpm = session.wpm;
	}
	return {
		count: sessions.length,
		total_active_ms: totalActiveMs,
		best_wpm: bestWpm,
		avg_wpm: sumWpm / sessions.length,
	};
}

/**
 * The WPM of the most recent `limit` sessions, ordered oldest -> newest so it
 * reads left-to-right as a progress trend (for a sparkline).
 */
export function wpmTrend(sessions: Session[], limit = 12): number[] {
	return [...sessions]
		.sort((a, b) => a.finished_at.localeCompare(b.finished_at))
		.slice(-limit)
		.map((session) => session.wpm);
}

/** ISO timestamp of the most recently finished session, or null when none. */
export function lastActiveAt(sessions: Session[]): string | null {
	let latest: string | null = null;
	for (const session of sessions) {
		if (latest === null || session.finished_at > latest) {
			latest = session.finished_at;
		}
	}
	return latest;
}
