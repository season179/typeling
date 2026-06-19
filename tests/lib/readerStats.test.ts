import { describe, expect, it } from "bun:test";
import {
	lastActiveAt,
	sessionTotals,
	wpmTrend,
} from "../../src/lib/readerStats";
import type { Session } from "../../src/lib/schemas/state";

function s(overrides: Partial<Session>): Session {
	return {
		id: overrides.id ?? "s1",
		season_slug: overrides.season_slug ?? "rainbow-door-s1",
		episode_idx: overrides.episode_idx ?? 0,
		wpm: overrides.wpm ?? 10,
		char_count: overrides.char_count ?? 50,
		active_ms: overrides.active_ms ?? 30_000,
		started_at: overrides.started_at ?? "2026-06-01T10:00:00.000Z",
		finished_at: overrides.finished_at ?? "2026-06-01T10:01:00.000Z",
	};
}

const threeSessions = [
	s({ id: "a", wpm: 10, active_ms: 30_000 }),
	s({ id: "b", wpm: 20, active_ms: 60_000 }),
	s({ id: "c", wpm: 30, active_ms: 90_000 }),
];

describe("sessionTotals", () => {
	it("returns zero count and null WPM stats when there are no sessions", () => {
		expect(sessionTotals([])).toEqual({
			count: 0,
			total_active_ms: 0,
			best_wpm: null,
			avg_wpm: null,
		});
	});

	it("counts every session in the list", () => {
		expect(sessionTotals(threeSessions).count).toBe(3);
	});

	it("sums active_ms across all sessions", () => {
		expect(sessionTotals(threeSessions).total_active_ms).toBe(180_000);
	});

	it("returns the highest WPM as best_wpm", () => {
		expect(sessionTotals(threeSessions).best_wpm).toBe(30);
	});

	it("returns the mean WPM as avg_wpm", () => {
		expect(sessionTotals(threeSessions).avg_wpm).toBe(20);
	});
});

describe("wpmTrend", () => {
	it("orders WPMs oldest -> newest regardless of input order", () => {
		const trend = wpmTrend([
			s({ id: "c", wpm: 30, finished_at: "2026-06-03T10:00:00.000Z" }),
			s({ id: "a", wpm: 10, finished_at: "2026-06-01T10:00:00.000Z" }),
			s({ id: "b", wpm: 20, finished_at: "2026-06-02T10:00:00.000Z" }),
		]);
		expect(trend).toEqual([10, 20, 30]);
	});

	it("keeps only the most recent sessions up to the limit", () => {
		const sessions = Array.from({ length: 15 }, (_, i) =>
			s({
				id: `s${i}`,
				wpm: i,
				finished_at: `2026-06-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
			}),
		);
		const trend = wpmTrend(sessions, 3);
		expect(trend).toEqual([12, 13, 14]);
	});

	it("returns an empty trend when there are no sessions", () => {
		expect(wpmTrend([])).toEqual([]);
	});
});

describe("lastActiveAt", () => {
	it("returns the latest finished_at timestamp regardless of list order", () => {
		expect(
			lastActiveAt([
				s({ id: "a", finished_at: "2026-06-01T10:00:00.000Z" }),
				s({ id: "b", finished_at: "2026-06-05T10:00:00.000Z" }),
				s({ id: "c", finished_at: "2026-06-03T10:00:00.000Z" }),
			]),
		).toBe("2026-06-05T10:00:00.000Z");
	});

	it("returns null last-active when there are no sessions", () => {
		expect(lastActiveAt([])).toBeNull();
	});
});
