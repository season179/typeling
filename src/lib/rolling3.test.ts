import { describe, expect, test } from "bun:test";
import { rolling3Wpm } from "./rolling3";

function makeSession(
	overrides: Partial<{
		wpm: number;
		season_slug: string;
		finished_at: string;
	}> = {},
) {
	return {
		id: crypto.randomUUID(),
		child_id: "test-child",
		season_slug: "test-season-01",
		episode_idx: 0,
		wpm: 10,
		char_count: 50,
		active_ms: 60000,
		started_at: "2026-01-01T00:00:00.000Z",
		finished_at: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("rolling3Wpm", () => {
	test("returns null when fewer than 3 sessions", () => {
		expect(rolling3Wpm([])).toBeNull();

		const two = [makeSession(), makeSession()];
		expect(rolling3Wpm(two)).toBeNull();
	});

	test("returns average of 3 most recent sessions by finished_at", () => {
		const sessions = [
			makeSession({ wpm: 10, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 20, finished_at: "2026-01-02T00:00:00.000Z" }),
			makeSession({ wpm: 30, finished_at: "2026-01-03T00:00:00.000Z" }),
		];
		expect(rolling3Wpm(sessions)).toBe(20);
	});

	test("with >3 sessions, takes the 3 most recent by finished_at", () => {
		const sessions = [
			makeSession({ wpm: 100, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 100, finished_at: "2026-01-02T00:00:00.000Z" }),
			makeSession({ wpm: 10, finished_at: "2026-01-03T00:00:00.000Z" }),
			makeSession({ wpm: 20, finished_at: "2026-01-04T00:00:00.000Z" }),
			makeSession({ wpm: 30, finished_at: "2026-01-05T00:00:00.000Z" }),
		];
		expect(rolling3Wpm(sessions)).toBe(20);
	});

	test("seasonSlug filter includes only matching sessions", () => {
		const sessions = [
			makeSession({ wpm: 100, season_slug: "other" }),
			makeSession({ wpm: 100, season_slug: "other" }),
			makeSession({ wpm: 100, season_slug: "other" }),
			makeSession({
				wpm: 10,
				season_slug: "target",
				finished_at: "2026-01-01T00:00:00.000Z",
			}),
			makeSession({
				wpm: 20,
				season_slug: "target",
				finished_at: "2026-01-02T00:00:00.000Z",
			}),
			makeSession({
				wpm: 30,
				season_slug: "target",
				finished_at: "2026-01-03T00:00:00.000Z",
			}),
		];
		expect(rolling3Wpm(sessions, { seasonSlug: "target" })).toBe(20);
	});

	test("seasonSlug filter returns null when filtered < 3", () => {
		const sessions = [
			makeSession({ wpm: 100, season_slug: "other" }),
			makeSession({ wpm: 100, season_slug: "other" }),
			makeSession({ wpm: 10, season_slug: "target" }),
			makeSession({ wpm: 20, season_slug: "target" }),
		];
		expect(rolling3Wpm(sessions, { seasonSlug: "target" })).toBeNull();
	});

	test("no seasonSlug means no filter", () => {
		const sessions = [
			makeSession({
				wpm: 10,
				season_slug: "a",
				finished_at: "2026-01-01T00:00:00.000Z",
			}),
			makeSession({
				wpm: 20,
				season_slug: "b",
				finished_at: "2026-01-02T00:00:00.000Z",
			}),
			makeSession({
				wpm: 30,
				season_slug: "c",
				finished_at: "2026-01-03T00:00:00.000Z",
			}),
		];
		expect(rolling3Wpm(sessions)).toBe(20);
	});

	test("empty opts object behaves same as no opts", () => {
		const sessions = [
			makeSession({ wpm: 10, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 20, finished_at: "2026-01-02T00:00:00.000Z" }),
			makeSession({ wpm: 30, finished_at: "2026-01-03T00:00:00.000Z" }),
		];
		expect(rolling3Wpm(sessions, {})).toBe(20);
	});

	test("all sessions with WPM 0 returns 0, not null", () => {
		const sessions = [
			makeSession({ wpm: 0, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 0, finished_at: "2026-01-02T00:00:00.000Z" }),
			makeSession({ wpm: 0, finished_at: "2026-01-03T00:00:00.000Z" }),
		];
		expect(rolling3Wpm(sessions)).toBe(0);
	});
});
