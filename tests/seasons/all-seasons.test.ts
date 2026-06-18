import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertCharset } from "../../src/lib/assertCharset";
import { contentBlacklist } from "../../src/lib/contentBlacklist";
import { seasonSchema } from "../../src/lib/schemas/season";
import { wordCountBudget } from "../../src/lib/wordCountBudget";

const seasonsDir = join(import.meta.dir, "..", "..", "seasons");
const seasonFiles = readdirSync(seasonsDir).filter((f) => f.endsWith(".json"));
// Target WPM range for selectable stories. Previously derived from the
// per-child defaults in the removed data/state.seed.json; inlined here.
const SELECTABLE_TARGET_WPM = [15, 18];
const childBudgets = SELECTABLE_TARGET_WPM.map((targetWpm) =>
	wordCountBudget(targetWpm),
);
const selectableStoryBudget = {
	min: Math.min(...childBudgets.map((budget) => budget.min)),
	max: Math.max(...childBudgets.map((budget) => budget.max)),
};

describe("season JSON files", () => {
	it.each(seasonFiles)("%s parses against seasonSchema", (file) => {
		const raw = readFileSync(join(seasonsDir, file), "utf8");
		expect(() => seasonSchema.parse(JSON.parse(raw))).not.toThrow();
	});

	const wordCountOf = (text: string) =>
		text.split(/\s+/).filter(Boolean).length;

	it.each(
		seasonFiles.filter((file) => !file.includes("-test.")),
	)("%s real season content is clean and in budget", (file) => {
		const raw = readFileSync(join(seasonsDir, file), "utf8");
		const season = seasonSchema.parse(JSON.parse(raw));

		// 28 episodes: each original beat split into two shorter halves so a
		// per-session sitting is roughly halved.
		expect(season.episodes).toHaveLength(28);

		// Each half is clean and a substantial single sitting — at least half the
		// shortest full-session budget, never longer than the largest.
		const halfSessionFloor = Math.floor(selectableStoryBudget.min / 2);
		for (const episode of season.episodes) {
			expect(() => assertCharset(episode.text)).not.toThrow();
			expect(contentBlacklist(episode.text)).toEqual([]);
			const wordCount = wordCountOf(episode.text);
			expect(wordCount).toBeGreaterThanOrEqual(halfSessionFloor);
			expect(wordCount).toBeLessThanOrEqual(selectableStoryBudget.max);
		}

		// A consecutive pair reconstitutes one original beat, so together they
		// stay within the full-session word budget.
		for (let i = 0; i < season.episodes.length; i += 2) {
			const pairWords =
				wordCountOf(season.episodes[i]?.text ?? "") +
				wordCountOf(season.episodes[i + 1]?.text ?? "");
			expect(pairWords).toBeGreaterThanOrEqual(selectableStoryBudget.min);
			expect(pairWords).toBeLessThanOrEqual(selectableStoryBudget.max);
		}
	});
});
