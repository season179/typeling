import { describe, expect, test } from "bun:test";
import { checkStoryText, findForbiddenName } from "./storyTextPolicy";

describe("findForbiddenName", () => {
	test("matches a name as a whole word, case-insensitively", () => {
		expect(findForbiddenName("Then ZACK smiled.", ["Zack"])).toBe("Zack");
	});

	test("does not match a name embedded in another word (word mode)", () => {
		expect(findForbiddenName("They went to the beach.", ["Bea"])).toBeNull();
	});

	test("matches a name embedded in another word in substring mode", () => {
		expect(
			findForbiddenName("Winnie waved hello.", ["Winni"], "substring"),
		).toBe("Winni");
	});

	test("ignores empty or whitespace-only names", () => {
		expect(findForbiddenName("anything", ["", "  "])).toBeNull();
	});

	test("returns null when no name is present", () => {
		expect(
			findForbiddenName("A quiet afternoon.", ["Zack", "Winni"]),
		).toBeNull();
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
			checkStoryText("Then Zack ran home.", { forbiddenNames: ["Zack"] }),
		).toEqual({ kind: "forbidden-name", name: "Zack" });
	});

	test("returns the highest-priority violation first (charset over the rest)", () => {
		expect(
			checkStoryText("Zack\tfight now", { forbiddenNames: ["Zack"] }),
		).toEqual({ kind: "charset", position: 4, char: "\t" });
	});

	test("does not flag a forbidden name that only appears as a substring (word mode)", () => {
		expect(
			checkStoryText("They went to the beach.", { forbiddenNames: ["Bea"] }),
		).toBeNull();
	});

	test("flags a real name extended into a longer word in substring mode", () => {
		expect(
			checkStoryText("Winnie waved hello.", {
				forbiddenNames: ["Winni"],
				nameMatch: "substring",
			}),
		).toEqual({ kind: "forbidden-name", name: "Winni" });
	});
});
