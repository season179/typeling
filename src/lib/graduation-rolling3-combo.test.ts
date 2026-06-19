import { describe, expect, test } from "bun:test";
import { graduationStatus } from "./graduation";
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
		season_slug: "test-season",
		episode_idx: 0,
		wpm: 10,
		char_count: 50,
		active_ms: 60000,
		started_at: "2026-01-01T00:00:00.000Z",
		finished_at: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("graduationStatus + rolling3Wpm combo", () => {
	test("returns 'no sessions yet' with empty sessions", () => {
		const rolling3 = rolling3Wpm([], { seasonSlug: "s1" });
		expect(graduationStatus(rolling3, 20)).toBe("no sessions yet");
	});

	test("returns 'no sessions yet' with fewer than 3 sessions", () => {
		const sessions = [
			makeSession({ wpm: 25, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 25, finished_at: "2026-01-02T00:00:00.000Z" }),
		];
		const rolling3 = rolling3Wpm(sessions);
		expect(graduationStatus(rolling3, 20)).toBe("no sessions yet");
	});

	test("returns 'in progress' when rolling-3 is below target", () => {
		const sessions = [
			makeSession({ wpm: 18, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 19, finished_at: "2026-01-02T00:00:00.000Z" }),
			makeSession({ wpm: 20, finished_at: "2026-01-03T00:00:00.000Z" }),
		];
		const rolling3 = rolling3Wpm(sessions);
		expect(rolling3).toBe(19);
		expect(graduationStatus(rolling3, 20)).toBe("in progress");
	});

	test("returns 'graduated' when rolling-3 reaches target exactly", () => {
		const sessions = [
			makeSession({ wpm: 20, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 20, finished_at: "2026-01-02T00:00:00.000Z" }),
			makeSession({ wpm: 20, finished_at: "2026-01-03T00:00:00.000Z" }),
		];
		const rolling3 = rolling3Wpm(sessions);
		expect(rolling3).toBe(20);
		expect(graduationStatus(rolling3, 20)).toBe("graduated");
	});

	test("returns 'graduated' when rolling-3 exceeds target", () => {
		const sessions = [
			makeSession({ wpm: 21, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 22, finished_at: "2026-01-02T00:00:00.000Z" }),
			makeSession({ wpm: 23, finished_at: "2026-01-03T00:00:00.000Z" }),
		];
		const rolling3 = rolling3Wpm(sessions);
		expect(rolling3).toBe(22);
		expect(graduationStatus(rolling3, 20)).toBe("graduated");
	});

	test("flips from 'in progress' to 'graduated' when third session crosses threshold", () => {
		// First two sessions below target, third pushes rolling-3 above
		const below = [
			makeSession({ wpm: 10, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 10, finished_at: "2026-01-02T00:00:00.000Z" }),
		];
		// rolling-3 is null (only 2 sessions)
		expect(graduationStatus(rolling3Wpm(below), 20)).toBe("no sessions yet");

		// Add third session that pushes rolling-3 to 20
		const crossing = [
			...below,
			makeSession({ wpm: 40, finished_at: "2026-01-03T00:00:00.000Z" }),
		];
		const rolling3 = rolling3Wpm(crossing);
		expect(rolling3).toBe(20);
		expect(graduationStatus(rolling3, 20)).toBe("graduated");
	});

	test("flips from 'graduated' to 'in progress' when old good session drops out of window", () => {
		// Three sessions: old high-WPM one drops out, lower ones remain
		const sessions = [
			makeSession({ wpm: 5, finished_at: "2026-01-01T00:00:00.000Z" }),
			makeSession({ wpm: 10, finished_at: "2026-01-02T00:00:00.000Z" }),
			makeSession({ wpm: 45, finished_at: "2026-01-03T00:00:00.000Z" }),
		];
		// rolling-3 = (5+10+45)/3 = 20 → graduated at target 20
		expect(graduationStatus(rolling3Wpm(sessions), 20)).toBe("graduated");

		// Fourth session with low WPM drops the 45 out
		const withNew = [
			...sessions,
			makeSession({ wpm: 1, finished_at: "2026-01-04T00:00:00.000Z" }),
		];
		const rolling3 = rolling3Wpm(withNew);
		// most recent 3: [1(Jan4), 45(Jan3), 10(Jan2)] = 56/3 ≈ 18.67
		expect(rolling3).toBe((1 + 45 + 10) / 3);
		expect(graduationStatus(rolling3, 20)).toBe("in progress");
	});
});
