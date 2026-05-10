import { describe, expect, test } from "bun:test";
import { contentBlacklist, TERMS } from "./contentBlacklist";

describe("contentBlacklist", () => {
	test("returns empty array for clean text", () => {
		expect(
			contentBlacklist("The quick brown fox jumps over the lazy dog."),
		).toEqual([]);
	});

	test("matches an exact term", () => {
		expect(contentBlacklist("death")).toEqual(["death"]);
	});

	test("matches case-insensitively", () => {
		expect(contentBlacklist("DEATH")).toEqual(["death"]);
		expect(contentBlacklist("Death")).toEqual(["death"]);
	});

	test("matches term at word start but not mid-word", () => {
		expect(contentBlacklist("killer")).toEqual(["kill"]);
		expect(contentBlacklist("skill")).toEqual([]);
	});

	test("covers every term with positive and negative cases", () => {
		// Negatives: term appears mid-word (no leading word boundary).
		const negatives: Record<string, string> = {
			death: "predeath",
			died: "undied",
			dying: "undying",
			kill: "skill",
			killed: "skilled",
			killing: "skilling",
			hate: "chateau",
			scary: "unscary",
			scared: "unscared",
			blood: "blueblood",
			bloody: "unbloody",
			gore: "begored",
			weapon: "sweapons",
			gun: "begun",
			knife: "penknife",
			war: "dwarf",
			fight: "dogfight",
			fighting: "dogfighting",
			evil: "bedevil",
			demon: "pandemonium",
			devil: "bedevil",
			hell: "shell",
		};

		for (const term of TERMS) {
			expect(contentBlacklist(term)).toEqual([term]);
			const negative = negatives[term];
			if (negative === undefined)
				throw new Error(`missing negative for term: ${term}`);
			expect(contentBlacklist(negative)).toEqual([]);
		}
	});

	test("matches terms adjacent to punctuation", () => {
		expect(contentBlacklist("death, death. and death!")).toEqual([
			"death",
			"death",
			"death",
		]);
	});

	test("returns multiple occurrences", () => {
		expect(contentBlacklist("death death DEATH")).toEqual([
			"death",
			"death",
			"death",
		]);
	});

	test("handles empty string", () => {
		expect(contentBlacklist("")).toEqual([]);
	});

	test("matches terms after newlines", () => {
		expect(contentBlacklist("\nkill")).toEqual(["kill"]);
		expect(contentBlacklist("kill\n")).toEqual(["kill"]);
		expect(contentBlacklist("a\nkill\nb")).toEqual(["kill"]);
	});

	test("matches terms adjacent to quotes and parentheses", () => {
		expect(contentBlacklist('"kill"')).toEqual(["kill"]);
		expect(contentBlacklist("(kill)")).toEqual(["kill"]);
	});

	test("matches multiple different terms in the same text", () => {
		expect(contentBlacklist("kill death war")).toEqual([
			"kill",
			"death",
			"war",
		]);
	});
});
