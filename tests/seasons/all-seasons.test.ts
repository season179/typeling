import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertCharset } from "../../src/lib/assertCharset";
import { contentBlacklist } from "../../src/lib/contentBlacklist";
import { seasonSchema } from "../../src/lib/schemas/season";
import { stateSchema } from "../../src/lib/schemas/state";
import { wordCountBudget } from "../../src/lib/wordCountBudget";

const seasonsDir = join(import.meta.dir, "..", "..", "seasons");
const seasonFiles = readdirSync(seasonsDir).filter((f) => f.endsWith(".json"));
const seedPath = join(import.meta.dir, "..", "..", "data", "state.seed.json");
const seed = stateSchema.parse(JSON.parse(readFileSync(seedPath, "utf8")));

describe("season JSON files", () => {
	it.each(seasonFiles)("%s parses against seasonSchema", (file) => {
		const raw = readFileSync(join(seasonsDir, file), "utf8");
		expect(() => seasonSchema.parse(JSON.parse(raw))).not.toThrow();
	});

	it.each(seasonFiles.filter((file) => !file.includes("-test.")))(
		"%s real season content is clean and in budget",
		(file) => {
			const raw = readFileSync(join(seasonsDir, file), "utf8");
			const season = seasonSchema.parse(JSON.parse(raw));
			const child = seed.children[season.child_id];
			expect(child).toBeDefined();
			if (!child) return;

			const budget = wordCountBudget(child.target_wpm);
			expect(season.episodes).toHaveLength(14);
			for (const episode of season.episodes) {
				expect(() => assertCharset(episode.text)).not.toThrow();
				expect(contentBlacklist(episode.text)).toEqual([]);
				const wordCount = episode.text.split(/\s+/).filter(Boolean).length;
				expect(wordCount).toBeGreaterThanOrEqual(budget.min);
				expect(wordCount).toBeLessThanOrEqual(budget.max);
			}
		},
	);
});
