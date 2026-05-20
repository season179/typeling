import { describe, expect, it } from "bun:test";
import {
	extractAlignmentStoryWords,
	extractStoryWordTexts,
	storyTokensToText,
	tokenizeStoryText,
} from "../../src/lib/storyWordTokens";

describe("story word tokens", () => {
	it("preserves the original story text when tokens are joined", () => {
		const text = `"Oh," said Pixel.\nDon't touch the blue-green wire.`;

		expect(storyTokensToText(tokenizeStoryText(text))).toBe(text);
	});

	it("assigns stable indexes only to visible words", () => {
		const tokens = tokenizeStoryText("Pixel, Pixel!");
		const words = tokens.filter((token) => token.kind === "word");

		expect(words).toEqual([
			{ kind: "word", text: "Pixel", wordIndex: 0 },
			{ kind: "word", text: "Pixel", wordIndex: 1 },
		]);
	});

	it("treats contractions and hyphenated story words as one word", () => {
		expect(extractStoryWordTexts("Don't re-open the blue-green box.")).toEqual([
			"Don't",
			"re-open",
			"the",
			"blue-green",
			"box",
		]);
	});

	it("builds alignment words from the same display tokenizer", () => {
		expect(extractAlignmentStoryWords(`"Oh," said Pixel.`)).toEqual([
			{ wordIndex: 0, text: `"Oh,"` },
			{ wordIndex: 1, text: "said" },
			{ wordIndex: 2, text: "Pixel." },
		]);
	});
});
