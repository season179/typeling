import { describe, expect, it } from "bun:test";
import { MAX_CURRENT_EPISODE } from "../../../src/lib/schemas/season";
import {
	childSchema,
	sessionSchema,
	sessionSubmissionSchema,
	stateSchema,
	storyProgressSchema,
	userProfileSchema,
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
	season_slug: "winni-season-01",
	episode_idx: 0,
	wpm: 12.4,
	char_count: 187,
	active_ms: 60500,
	started_at: "2026-05-09T10:00:00.000Z",
	finished_at: "2026-05-09T10:01:01.000Z",
};

const storedSession = {
	...validSession,
	email: "season@example.com",
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
		expect(() => childSchema.parse({ ...validChild, target_wpm: 0 })).toThrow();
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
			childSchema.parse({
				...validChild,
				current_episode: MAX_CURRENT_EPISODE + 1,
			}),
		).toThrow();
	});
});

describe("sessionSubmissionSchema", () => {
	it("accepts a valid client-submitted session without identity", () => {
		expect(sessionSubmissionSchema.parse(validSession)).toEqual(validSession);
	});

	it("strips client-provided identity fields", () => {
		const session = {
			...validSession,
			child_id: "winni",
			email: "client@example.com",
			signed_in_user: {
				email: "season@example.com",
				name: "Season Saw",
				display_name: "Season Saw",
				access_subject: "access-user-1",
			},
		};

		expect(sessionSubmissionSchema.parse(session)).toEqual(validSession);
	});

	it("rejects negative wpm, episode_idx, char_count, active_ms", () => {
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, wpm: -1 }),
		).toThrow();
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, episode_idx: -1 }),
		).toThrow();
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, char_count: -1 }),
		).toThrow();
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, active_ms: -1 }),
		).toThrow();
	});

	it("rejects fractional integer fields", () => {
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, episode_idx: 0.5 }),
		).toThrow();
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, char_count: 187.5 }),
		).toThrow();
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, active_ms: 60500.5 }),
		).toThrow();
	});

	it("rejects empty id/season_slug", () => {
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, id: "" }),
		).toThrow();
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, season_slug: "" }),
		).toThrow();
	});

	it("rejects wpm above the sensible upper bound", () => {
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, wpm: 1001 }),
		).toThrow();
	});

	it("rejects char_count and active_ms above their sensible upper bounds", () => {
		expect(() =>
			sessionSubmissionSchema.parse({ ...validSession, char_count: 10_001 }),
		).toThrow();
		expect(() =>
			sessionSubmissionSchema.parse({
				...validSession,
				active_ms: 24 * 60 * 60 * 1000 + 1,
			}),
		).toThrow();
	});

	it("rejects finished_at earlier than started_at", () => {
		expect(() =>
			sessionSubmissionSchema.parse({
				...validSession,
				started_at: "2026-05-09T10:01:01.000Z",
				finished_at: "2026-05-09T10:00:00.000Z",
			}),
		).toThrow();
	});

	it("rejects non-ISO-8601 datetimes for started_at/finished_at", () => {
		expect(() =>
			sessionSubmissionSchema.parse({
				...validSession,
				started_at: "yesterday",
			}),
		).toThrow();
		expect(() =>
			sessionSubmissionSchema.parse({
				...validSession,
				finished_at: 1715000000000,
			}),
		).toThrow();
	});
});

describe("sessionSchema", () => {
	it("accepts a server-stored session with email", () => {
		expect(sessionSchema.parse(storedSession)).toEqual(storedSession);
	});

	it("rejects an invalid stored email", () => {
		expect(() =>
			sessionSchema.parse({
				...validSession,
				email: "not-an-email",
			}),
		).toThrow();
	});
});

describe("userProfileSchema", () => {
	it("accepts a signed-in user profile with target_wpm", () => {
		expect(
			userProfileSchema.parse({
				email: "season@example.com",
				display_name: "Season Saw",
				name: "Season Saw",
				access_subject: "access-user-1",
				target_wpm: 15,
			}),
		).toEqual({
			email: "season@example.com",
			display_name: "Season Saw",
			name: "Season Saw",
			access_subject: "access-user-1",
			target_wpm: 15,
		});
	});

	it("rejects target_wpm below 1", () => {
		expect(() =>
			userProfileSchema.parse({
				email: "season@example.com",
				display_name: "Season Saw",
				target_wpm: 0,
			}),
		).toThrow();
	});
});

describe("storyProgressSchema", () => {
	it("accepts email-scoped story progress", () => {
		expect(
			storyProgressSchema.parse({
				email: "season@example.com",
				season_slug: "winni-season-01",
				current_episode: 1,
			}),
		).toEqual({
			email: "season@example.com",
			season_slug: "winni-season-01",
			current_episode: 1,
		});
	});

	it("rejects invalid email and future progress", () => {
		expect(() =>
			storyProgressSchema.parse({
				email: "not-an-email",
				season_slug: "winni-season-01",
				current_episode: 1,
			}),
		).toThrow();
		expect(() =>
			storyProgressSchema.parse({
				email: "season@example.com",
				season_slug: "winni-season-01",
				current_episode: MAX_CURRENT_EPISODE + 1,
			}),
		).toThrow();
	});
});

describe("stateSchema", () => {
	it("accepts a valid state with children record and sessions array", () => {
		const state = {
			children: { winni: validChild },
			sessions: [storedSession],
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
