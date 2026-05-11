import { describe, expect, it } from "bun:test";
import { sentenceBoundaries } from "./sentenceBoundaries";

describe("sentenceBoundaries", () => {
	it("returns single sentence for plain text without punctuation", () => {
		const bounds = sentenceBoundaries("Hello");
		expect(bounds).toEqual([{ start: 0, end: 5 }]);
	});

	it("returns empty array for empty string", () => {
		expect(sentenceBoundaries("")).toEqual([]);
	});

	it("splits on period followed by space and capital", () => {
		const bounds = sentenceBoundaries("Hello. World.");
		expect(bounds).toEqual([
			{ start: 0, end: 7 },
			{ start: 7, end: 13 },
		]);
	});

	it("splits on exclamation and question marks", () => {
		const bounds = sentenceBoundaries("Hi there! How are you? I am fine.");
		expect(bounds).toEqual([
			{ start: 0, end: 10 },
			{ start: 10, end: 23 },
			{ start: 23, end: 33 },
		]);
	});

	it("handles closing quotes after punctuation", () => {
		const bounds = sentenceBoundaries('She said "Hello." Then she left.');
		expect(bounds.length).toBe(2);
		expect(bounds[0]).toEqual({ start: 0, end: 18 }); // includes closing quote + trailing space
	});

	it("does not split on abbreviations like Dr.", () => {
		const bounds = sentenceBoundaries("Dr Luna smiled. It was nice.");
		expect(bounds).toEqual([
			{ start: 0, end: 16 },
			{ start: 16, end: 28 },
		]);
	});

	it("handles text with no sentence-ending punctuation as single sentence", () => {
		const bounds = sentenceBoundaries("no punctuation here at all");
		expect(bounds).toEqual([{ start: 0, end: 26 }]);
	});

	it("includes closing quotes in the sentence that ends them", () => {
		const bounds = sentenceBoundaries('"Hello!" she said.');
		expect(bounds).toEqual([{ start: 0, end: 18 }]);
	});

	it("handles multiple consecutive spaces between sentences", () => {
		const bounds = sentenceBoundaries("First.  Second.");
		expect(bounds).toEqual([
			{ start: 0, end: 8 },
			{ start: 8, end: 15 },
		]);
	});
});
