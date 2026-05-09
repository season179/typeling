import { describe, expect, it } from "bun:test";
import {
	childSchema,
	sessionSchema,
	stateSchema,
} from "../../../src/lib/schemas/state";

const validChild = {
	name: "Winni",
	theme: "rainbow-unicorn",
	target_wpm: 10,
	active_season: "winni-season-01",
	current_episode: 0,
	current_session_id: null,
};

const validSession = {
	id: "11111111-2222-3333-4444-555555555555",
	child_id: "winni",
	season_slug: "winni-season-01",
	episode_idx: 0,
	wpm: 12.4,
	char_count: 187,
	active_ms: 60500,
	started_at: "2026-05-09T10:00:00.000Z",
	finished_at: "2026-05-09T10:01:01.000Z",
};

describe("childSchema", () => {
	it("accepts a valid child", () => {
		expect(childSchema.parse(validChild)).toEqual(validChild);
	});

	it("accepts a string current_session_id and rejects a numeric one", () => {
		expect(
			childSchema.parse({ ...validChild, current_session_id: "abc-123" })
				.current_session_id,
		).toBe("abc-123");
		expect(() =>
			childSchema.parse({ ...validChild, current_session_id: 7 }),
		).toThrow();
	});

	it("rejects current_episode below 0", () => {
		expect(() =>
			childSchema.parse({ ...validChild, current_episode: -1 }),
		).toThrow();
	});

	it("rejects target_wpm below 1", () => {
		expect(() =>
			childSchema.parse({ ...validChild, target_wpm: 0 }),
		).toThrow();
	});

	it("rejects fractional integer fields", () => {
		expect(() =>
			childSchema.parse({ ...validChild, target_wpm: 10.5 }),
		).toThrow();
		expect(() =>
			childSchema.parse({ ...validChild, current_episode: 1.5 }),
		).toThrow();
	});

	it("rejects empty strings for name/theme/active_season", () => {
		expect(() => childSchema.parse({ ...validChild, name: "" })).toThrow();
		expect(() => childSchema.parse({ ...validChild, theme: "" })).toThrow();
		expect(() =>
			childSchema.parse({ ...validChild, active_season: "" }),
		).toThrow();
	});

	it("rejects current_episode above the max episode index", () => {
		expect(() =>
			childSchema.parse({ ...validChild, current_episode: 14 }),
		).toThrow();
	});
});

describe("sessionSchema", () => {
	it("accepts a valid session", () => {
		expect(sessionSchema.parse(validSession)).toEqual(validSession);
	});

	it("rejects negative wpm, episode_idx, char_count, active_ms", () => {
		expect(() => sessionSchema.parse({ ...validSession, wpm: -1 })).toThrow();
		expect(() =>
			sessionSchema.parse({ ...validSession, episode_idx: -1 }),
		).toThrow();
		expect(() =>
			sessionSchema.parse({ ...validSession, char_count: -1 }),
		).toThrow();
		expect(() =>
			sessionSchema.parse({ ...validSession, active_ms: -1 }),
		).toThrow();
	});

	it("rejects fractional integer fields", () => {
		expect(() =>
			sessionSchema.parse({ ...validSession, episode_idx: 0.5 }),
		).toThrow();
		expect(() =>
			sessionSchema.parse({ ...validSession, char_count: 187.5 }),
		).toThrow();
		expect(() =>
			sessionSchema.parse({ ...validSession, active_ms: 60500.5 }),
		).toThrow();
	});

	it("rejects empty id/child_id/season_slug", () => {
		expect(() => sessionSchema.parse({ ...validSession, id: "" })).toThrow();
		expect(() =>
			sessionSchema.parse({ ...validSession, child_id: "" }),
		).toThrow();
		expect(() =>
			sessionSchema.parse({ ...validSession, season_slug: "" }),
		).toThrow();
	});

	it("rejects wpm above the sensible upper bound", () => {
		expect(() =>
			sessionSchema.parse({ ...validSession, wpm: 1001 }),
		).toThrow();
	});

	it("rejects char_count and active_ms above their sensible upper bounds", () => {
		expect(() =>
			sessionSchema.parse({ ...validSession, char_count: 10_001 }),
		).toThrow();
		expect(() =>
			sessionSchema.parse({
				...validSession,
				active_ms: 24 * 60 * 60 * 1000 + 1,
			}),
		).toThrow();
	});

	it("rejects finished_at earlier than started_at", () => {
		expect(() =>
			sessionSchema.parse({
				...validSession,
				started_at: "2026-05-09T10:01:01.000Z",
				finished_at: "2026-05-09T10:00:00.000Z",
			}),
		).toThrow();
	});

	it("rejects non-ISO-8601 datetimes for started_at/finished_at", () => {
		expect(() =>
			sessionSchema.parse({ ...validSession, started_at: "yesterday" }),
		).toThrow();
		expect(() =>
			sessionSchema.parse({ ...validSession, finished_at: 1715000000000 }),
		).toThrow();
	});
});

describe("stateSchema", () => {
	it("accepts a valid state with children record and sessions array", () => {
		const state = {
			children: { winni: validChild },
			sessions: [validSession],
		};

		expect(stateSchema.parse(state)).toEqual(state);
	});

	it("accepts an empty children record and empty sessions array", () => {
		expect(stateSchema.parse({ children: {}, sessions: [] })).toEqual({
			children: {},
			sessions: [],
		});
	});

	it("rejects a state with an invalid child entry", () => {
		const state = {
			children: { winni: { ...validChild, target_wpm: 0 } },
			sessions: [],
		};

		expect(() => stateSchema.parse(state)).toThrow();
	});

	it("rejects a state missing the sessions key", () => {
		expect(() => stateSchema.parse({ children: {} })).toThrow();
	});

	it("rejects an empty-string child id key", () => {
		expect(() =>
			stateSchema.parse({
				children: { "": validChild },
				sessions: [],
			}),
		).toThrow();
	});
});
