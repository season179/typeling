import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seasonSchema } from "../../src/lib/schemas/season";

const seasonPath = join(
	import.meta.dir,
	"..",
	"..",
	"seasons",
	"winni-s1-test.json",
);

describe("seasons/winni-s1-test.json", () => {
	it("parses against seasonSchema", () => {
		const raw = readFileSync(seasonPath, "utf8");
		expect(() => seasonSchema.parse(JSON.parse(raw))).not.toThrow();
	});
});
