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

		// Seasons choose their own length and structure: some split each story
		// beat into half-session halves (rainbow-door, pixel-garden run 28), while
		// others use self-contained full-session episodes (e.g. Aesop retellings).
		// The universal contract is only that a season has episodes — not a fixed
		// count or a pairing scheme specific to how the first seasons were derived.
		expect(season.episodes.length).toBeGreaterThan(0);

		// Every episode is clean and a sensible single sitting. The floor stays at
		// half the shortest full-session budget so half-split episodes qualify; the
		// ceiling is the largest full-session budget so no episode overruns.
		const singleSittingFloor = Math.floor(selectableStoryBudget.min / 2);
		for (const episode of season.episodes) {
			expect(() => assertCharset(episode.text)).not.toThrow();
			expect(contentBlacklist(episode.text)).toEqual([]);
			const wordCount = wordCountOf(episode.text);
			expect(wordCount).toBeGreaterThanOrEqual(singleSittingFloor);
			expect(wordCount).toBeLessThanOrEqual(selectableStoryBudget.max);
		}
	});
});
