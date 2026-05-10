import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { seasonSchema } from "../../src/lib/schemas/season";

const seasonsDir = join(import.meta.dir, "..", "..", "seasons");
const seasonFiles = readdirSync(seasonsDir).filter((f) => f.endsWith(".json"));

describe("season JSON files", () => {
	it.each(seasonFiles)("%s parses against seasonSchema", (file) => {
		const raw = readFileSync(join(seasonsDir, file), "utf8");
		expect(() => seasonSchema.parse(JSON.parse(raw))).not.toThrow();
	});
});
