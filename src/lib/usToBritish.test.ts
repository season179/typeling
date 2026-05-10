import { describe, expect, test } from "bun:test";
import { ENTRIES, usToBritish } from "./usToBritish";

describe("usToBritish", () => {
	test("replaces a known American word with British equivalent", () => {
		expect(usToBritish("The color is blue")).toBe("The colour is blue");
	});

	test("uses word-boundary matching so substrings are not replaced", () => {
		expect(usToBritish("skill is a useful skill")).toBe(
			"skill is a useful skill",
		);
	});

	test("handles punctuation-adjacent words", () => {
		expect(usToBritish("color, color. and color!")).toBe(
			"colour, colour. and colour!",
		);
	});

	test("replaces multiple occurrences in the same text", () => {
		expect(usToBritish("color color color")).toBe("colour colour colour");
	});

	test("preserves lowercase", () => {
		expect(usToBritish("color")).toBe("colour");
	});

	test("preserves Title Case (first letter capital)", () => {
		expect(usToBritish("Color")).toBe("Colour");
		expect(usToBritish("Favorite")).toBe("Favourite");
	});

	test("preserves UPPERCASE", () => {
		expect(usToBritish("COLOR")).toBe("COLOUR");
		expect(usToBritish("DEFENSE")).toBe("DEFENCE");
	});

	test("preserves case within a sentence", () => {
		expect(usToBritish("The Color is BLUE and the meter runs")).toBe(
			"The Colour is BLUE and the metre runs",
		);
	});

	test("covers every dictionary entry", () => {
		for (const [us, gb] of ENTRIES) {
			expect(usToBritish(us)).toBe(gb);
			expect(usToBritish(`The ${us} is good.`)).toBe(`The ${gb} is good.`);
		}
	});

	test("longer words match before shorter substrings", () => {
		expect(usToBritish("organized organize")).toBe("organised organise");
		expect(usToBritish("recognized recognize")).toBe("recognised recognise");
		expect(usToBritish("analyzed analyze")).toBe("analysed analyse");
	});

	test("does not modify text with no American spellings", () => {
		const text = "The quick brown fox jumps over the lazy dog.";
		expect(usToBritish(text)).toBe(text);
	});

	test("handles empty string", () => {
		expect(usToBritish("")).toBe("");
	});

	test("handles hyphenated compounds and possessives", () => {
		expect(usToBritish("color-coded")).toBe("colour-coded");
		expect(usToBritish("color's")).toBe("colour's");
		expect(usToBritish("the favourite's color")).toBe("the favourite's colour");
	});
});
