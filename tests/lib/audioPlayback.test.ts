import { describe, expect, it } from "bun:test";
import { findActiveWordIndex } from "../../src/lib/audioPlayback";

const WORDS = [
	{ index: 0, start: 0.1, end: 0.3 },
	{ index: 1, start: 0.5, end: 0.5 },
	{ index: 2, start: 0.9, end: 1.2 },
];

describe("audio playback helpers", () => {
	it("returns null before the first word starts", () => {
		expect(findActiveWordIndex(WORDS, 0)).toBeNull();
	});

	it("finds the latest word at or before the audio time", () => {
		expect(findActiveWordIndex(WORDS, 0.1)).toBe(0);
		expect(findActiveWordIndex(WORDS, 0.55)).toBe(1);
		expect(findActiveWordIndex(WORDS, 1.1)).toBe(2);
	});

	it("handles empty or invalid timing inputs", () => {
		expect(findActiveWordIndex([], 1)).toBeNull();
		expect(findActiveWordIndex(WORDS, Number.NaN)).toBeNull();
	});
});
