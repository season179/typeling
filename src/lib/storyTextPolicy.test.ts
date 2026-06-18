import { describe, expect, test } from "bun:test";
import { checkStoryText, findForbiddenName } from "./storyTextPolicy";

describe("findForbiddenName", () => {
	test("matches a name as a whole word, case-insensitively", () => {
		expect(findForbiddenName("Then ALEX smiled.", ["Alex"])).toBe("Alex");
	});

	test("does not match a name embedded in another word (word mode)", () => {
		expect(findForbiddenName("They went to the beach.", ["Bea"])).toBeNull();
	});

	test("matches a name embedded in another word in substring mode", () => {
		expect(
			findForbiddenName("Samantha waved hello.", ["Sam"], "substring"),
		).toBe("Sam");
	});

	test("ignores empty or whitespace-only names", () => {
		expect(findForbiddenName("anything", ["", "  "])).toBeNull();
	});

	test("returns null when no name is present", () => {
		expect(findForbiddenName("A quiet afternoon.", ["Alex", "Sam"])).toBeNull();
	});
});

describe("checkStoryText", () => {
	test("accepts clean text with no forbidden names", () => {
		expect(checkStoryText("The cat sat on the mat.")).toBeNull();
	});

	test("reports a charset violation with position and char", () => {
		expect(checkStoryText("Hello\tworld")).toEqual({
			kind: "charset",
			position: 5,
			char: "\t",
		});
	});

	test("reports blacklist hits", () => {
		expect(checkStoryText("There was a scary monster.")).toEqual({
			kind: "blacklist",
			terms: ["scary"],
		});
	});

	test("reports a forbidden name", () => {
		expect(
			checkStoryText("Then Alex ran home.", { forbiddenNames: ["Alex"] }),
		).toEqual({ kind: "forbidden-name", name: "Alex" });
	});

	test("returns the highest-priority violation first (charset over the rest)", () => {
		expect(
			checkStoryText("Alex\tfight now", { forbiddenNames: ["Alex"] }),
		).toEqual({ kind: "charset", position: 4, char: "\t" });
	});

	test("does not flag a forbidden name that only appears as a substring (word mode)", () => {
		expect(
			checkStoryText("They went to the beach.", { forbiddenNames: ["Bea"] }),
		).toBeNull();
	});

	test("flags a name extended into a longer word in substring mode", () => {
		expect(
			checkStoryText("Samantha waved hello.", {
				forbiddenNames: ["Sam"],
				nameMatch: "substring",
			}),
		).toEqual({ kind: "forbidden-name", name: "Sam" });
	});
});
