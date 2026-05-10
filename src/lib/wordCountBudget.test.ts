import { describe, expect, test } from "bun:test";
import { wordCountBudget } from "./wordCountBudget";

describe("wordCountBudget", () => {
	test("targetWpm 5 clamps min to 50", () => {
		expect(wordCountBudget(5)).toEqual({ min: 50, max: 75 });
	});

	test("targetWpm 15 returns unscaled values", () => {
		expect(wordCountBudget(15)).toEqual({ min: 75, max: 225 });
	});

	test("targetWpm 30 clamps max to 400", () => {
		expect(wordCountBudget(30)).toEqual({ min: 150, max: 400 });
	});

	test("targetWpm 100 clamps both to 400", () => {
		expect(wordCountBudget(100)).toEqual({ min: 400, max: 400 });
	});

	test("targetWpm 0 clamps both to floor", () => {
		expect(wordCountBudget(0)).toEqual({ min: 50, max: 50 });
	});

	test("targetWpm 200 saturates both to ceiling", () => {
		expect(wordCountBudget(200)).toEqual({ min: 400, max: 400 });
	});

	test("negative targetWpm clamps to floor", () => {
		expect(wordCountBudget(-1)).toEqual({ min: 50, max: 50 });
	});
});
