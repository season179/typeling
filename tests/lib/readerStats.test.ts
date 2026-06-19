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

describe("sessionTotals", () => {
	it("returns zeros and nulls for an empty list", () => {
		expect(sessionTotals([])).toEqual({
			count: 0,
			total_active_ms: 0,
			best_wpm: null,
			avg_wpm: null,
		});
	});

	it("sums time and computes best/avg WPM", () => {
		const totals = sessionTotals([
			s({ id: "a", wpm: 10, active_ms: 30_000 }),
			s({ id: "b", wpm: 20, active_ms: 60_000 }),
			s({ id: "c", wpm: 30, active_ms: 90_000 }),
		]);
		expect(totals.count).toBe(3);
		expect(totals.total_active_ms).toBe(180_000);
		expect(totals.best_wpm).toBe(30);
		expect(totals.avg_wpm).toBe(20);
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

	it("keeps only the most recent `limit` sessions", () => {
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

	it("is empty for no sessions", () => {
		expect(wpmTrend([])).toEqual([]);
	});
});

describe("lastActiveAt", () => {
	it("returns the most recent finished_at", () => {
		expect(
			lastActiveAt([
				s({ id: "a", finished_at: "2026-06-01T10:00:00.000Z" }),
				s({ id: "b", finished_at: "2026-06-05T10:00:00.000Z" }),
				s({ id: "c", finished_at: "2026-06-03T10:00:00.000Z" }),
			]),
		).toBe("2026-06-05T10:00:00.000Z");
	});

	it("is null for no sessions", () => {
		expect(lastActiveAt([])).toBeNull();
	});
});
