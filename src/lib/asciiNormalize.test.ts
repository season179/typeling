import { describe, expect, test } from "bun:test";
import { asciiNormalize } from "./asciiNormalize";

describe("asciiNormalize", () => {
	test("maps smart quotes to straight quotes", () => {
		expect(asciiNormalize("\u201Chello\u201D")).toBe('"hello"');
		expect(asciiNormalize("\u2018world\u2019")).toBe("'world'");
	});

	test("maps em dash and en dash to hyphen", () => {
		expect(asciiNormalize("foo\u2014bar")).toBe("foo-bar");
		expect(asciiNormalize("foo\u2013bar")).toBe("foo-bar");
	});

	test("maps ellipsis to three dots", () => {
		expect(asciiNormalize("wait\u2026")).toBe("wait...");
		expect(asciiNormalize("\u2026and")).toBe("...and");
	});

	test("reduces accented letters to ASCII base", () => {
		expect(asciiNormalize("caf\u00E9")).toBe("cafe");
		expect(asciiNormalize("r\u00E9sum\u00E9")).toBe("resume");
		expect(asciiNormalize("ni\u00F1o")).toBe("nino");
	});

	test("strips emoji and other non-ASCII symbols", () => {
		expect(asciiNormalize("hello \uD83D\uDC4D world")).toBe("hello  world");
		expect(asciiNormalize("\u2764 love")).toBe(" love");
	});

	test("is idempotent", () => {
		const mixed = "caf\u00E9 \u201Cfresh\u201D \u2014 \u2026";
		const once = asciiNormalize(mixed);
		const twice = asciiNormalize(once);
		expect(twice).toBe(once);
	});

	test("passes ASCII text through unchanged", () => {
		const ascii = "Hello, world! It's a fine day - isn't it?";
		expect(asciiNormalize(ascii)).toBe(ascii);
	});
});
