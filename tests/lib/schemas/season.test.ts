import { describe, expect, it } from "bun:test";
import {
	episodeSchema,
	MAX_EPISODE_IDX,
	MAX_EPISODES_PER_SEASON,
	seasonSchema,
	TARGET_EPISODES_PER_SEASON,
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
	slug: "rainbow-season-01",
	name: "Rainbow Meadow",
	theme: "rainbow-unicorn",
	episodes: makeEpisodes(TARGET_EPISODES_PER_SEASON),
};

describe("episodeSchema", () => {
	it("accepts a valid episode", () => {
		expect(episodeSchema.parse(validEpisode)).toEqual(validEpisode);
	});

	it("accepts the boundary idx values 0 and MAX_EPISODE_IDX", () => {
		expect(episodeSchema.parse({ ...validEpisode, idx: 0 }).idx).toBe(0);
		expect(
			episodeSchema.parse({ ...validEpisode, idx: MAX_EPISODE_IDX }).idx,
		).toBe(MAX_EPISODE_IDX);
	});

	it("rejects negative, fractional, or out-of-range idx", () => {
		expect(() => episodeSchema.parse({ ...validEpisode, idx: -1 })).toThrow();
		expect(() => episodeSchema.parse({ ...validEpisode, idx: 1.5 })).toThrow();
		expect(() =>
			episodeSchema.parse({ ...validEpisode, idx: MAX_EPISODE_IDX + 1 }),
		).toThrow();
	});

	it("rejects empty text and non-string text", () => {
		expect(() => episodeSchema.parse({ ...validEpisode, text: "" })).toThrow();
		expect(() => episodeSchema.parse({ ...validEpisode, text: 42 })).toThrow();
	});

	it.each(["idx", "text"] as const)("rejects an episode missing %s", (key) => {
		const { [key]: _, ...rest } = validEpisode;
		expect(() => episodeSchema.parse(rest)).toThrow();
	});
});

describe("seasonSchema", () => {
	it("accepts a valid season", () => {
		expect(seasonSchema.parse(validSeason)).toEqual(validSeason);
	});

	it.each([
		"slug",
		"name",
		"theme",
		"episodes",
	] as const)("rejects a season missing %s", (key) => {
		const { [key]: _, ...rest } = validSeason;
		expect(() => seasonSchema.parse(rest)).toThrow();
	});

	it("rejects an empty episodes array", () => {
		expect(() =>
			seasonSchema.parse({ ...validSeason, episodes: [] }),
		).toThrow();
	});

	it("accepts any episode count between 1 and MAX_EPISODES_PER_SEASON", () => {
		expect(
			seasonSchema.parse({ ...validSeason, episodes: makeEpisodes(1) })
				.episodes,
		).toHaveLength(1);
		expect(
			seasonSchema.parse({
				...validSeason,
				episodes: makeEpisodes(MAX_EPISODES_PER_SEASON),
			}).episodes,
		).toHaveLength(MAX_EPISODES_PER_SEASON);
	});

	it("rejects more than MAX_EPISODES_PER_SEASON episodes", () => {
		expect(() =>
			seasonSchema.parse({
				...validSeason,
				episodes: makeEpisodes(MAX_EPISODES_PER_SEASON + 1),
			}),
		).toThrow();
	});

	it("strips unknown fields from a season and from each episode", () => {
		const input = {
			...validSeason,
			extra: "ignore me",
			episodes: makeEpisodes(TARGET_EPISODES_PER_SEASON).map((ep, i) =>
				i === 0 ? { ...ep, extra: "also ignore" } : ep,
			),
		};
		const parsed = seasonSchema.parse(input);
		expect(parsed).toEqual(validSeason);
		expect(parsed).not.toHaveProperty("extra");
		expect(parsed.episodes[0]).not.toHaveProperty("extra");
	});

	it("rejects empty strings for slug, name, theme", () => {
		expect(() => seasonSchema.parse({ ...validSeason, slug: "" })).toThrow();
		expect(() => seasonSchema.parse({ ...validSeason, name: "" })).toThrow();
		expect(() => seasonSchema.parse({ ...validSeason, theme: "" })).toThrow();
	});
});
