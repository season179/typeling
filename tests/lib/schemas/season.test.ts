import { describe, expect, it } from "bun:test";
import {
	episodeSchema,
	MAX_EPISODES,
	seasonSchema,
} from "../../../src/lib/schemas/season";

const validEpisode = {
	idx: 0,
	text: "Once upon a time, a small dragon learnt to type.",
};

const makeEpisodes = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		idx: i,
		text: `Episode ${i + 1} text.`,
	}));

const validSeason = {
	slug: "winni-season-01",
	child_id: "winni",
	theme: "rainbow-unicorn",
	episodes: makeEpisodes(MAX_EPISODES),
};

describe("episodeSchema", () => {
	it("accepts a valid episode", () => {
		expect(episodeSchema.parse(validEpisode)).toEqual(validEpisode);
	});

	it("accepts the boundary idx values 0 and 13", () => {
		expect(episodeSchema.parse({ ...validEpisode, idx: 0 }).idx).toBe(0);
		expect(episodeSchema.parse({ ...validEpisode, idx: 13 }).idx).toBe(13);
	});

	it("rejects negative, fractional, or out-of-range idx", () => {
		expect(() => episodeSchema.parse({ ...validEpisode, idx: -1 })).toThrow();
		expect(() => episodeSchema.parse({ ...validEpisode, idx: 1.5 })).toThrow();
		expect(() => episodeSchema.parse({ ...validEpisode, idx: 14 })).toThrow();
	});

	it("rejects empty text and non-string text", () => {
		expect(() => episodeSchema.parse({ ...validEpisode, text: "" })).toThrow();
		expect(() => episodeSchema.parse({ ...validEpisode, text: 42 })).toThrow();
	});

	it.each(["idx", "text"] as const)(
		"rejects an episode missing %s",
		(key) => {
			const { [key]: _, ...rest } = validEpisode;
			expect(() => episodeSchema.parse(rest)).toThrow();
		},
	);
});

describe("seasonSchema", () => {
	it("accepts a valid season", () => {
		expect(seasonSchema.parse(validSeason)).toEqual(validSeason);
	});

	it.each(["slug", "child_id", "theme", "episodes"] as const)(
		"rejects a season missing %s",
		(key) => {
			const { [key]: _, ...rest } = validSeason;
			expect(() => seasonSchema.parse(rest)).toThrow();
		},
	);

	it("rejects an empty episodes array", () => {
		expect(() =>
			seasonSchema.parse({ ...validSeason, episodes: [] }),
		).toThrow();
	});

	it("rejects when episodes count is not exactly MAX_EPISODES", () => {
		expect(() =>
			seasonSchema.parse({
				...validSeason,
				episodes: makeEpisodes(MAX_EPISODES - 1),
			}),
		).toThrow();
		expect(() =>
			seasonSchema.parse({
				...validSeason,
				episodes: makeEpisodes(MAX_EPISODES + 1),
			}),
		).toThrow();
	});

	it("strips unknown fields from a season and from each episode", () => {
		const input = {
			...validSeason,
			extra: "ignore me",
			episodes: makeEpisodes(MAX_EPISODES).map((ep, i) =>
				i === 0 ? { ...ep, extra: "also ignore" } : ep,
			),
		};
		const parsed = seasonSchema.parse(input);
		expect(parsed).toEqual(validSeason);
		expect(parsed).not.toHaveProperty("extra");
		expect(parsed.episodes[0]).not.toHaveProperty("extra");
	});

	it("rejects empty strings for slug, child_id, theme", () => {
		expect(() => seasonSchema.parse({ ...validSeason, slug: "" })).toThrow();
		expect(() =>
			seasonSchema.parse({ ...validSeason, child_id: "" }),
		).toThrow();
		expect(() => seasonSchema.parse({ ...validSeason, theme: "" })).toThrow();
	});
});
