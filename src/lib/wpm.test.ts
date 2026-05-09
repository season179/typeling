import { describe, expect, test } from "bun:test";
import { wpmFromCharsAndMs } from "./wpm";

describe("wpmFromCharsAndMs", () => {
	test("returns 0 when charCount is 0 and activeMs is 0", () => {
		expect(wpmFromCharsAndMs(0, 0)).toBe(0);
	});

	test("returns 0 when charCount is 0", () => {
		expect(wpmFromCharsAndMs(0, 60000)).toBe(0);
	});

	test("returns 0 when activeMs is 0", () => {
		expect(wpmFromCharsAndMs(50, 0)).toBe(0);
	});

	test("50 chars in 60 seconds is 10 wpm", () => {
		expect(wpmFromCharsAndMs(50, 60000)).toBe(10);
	});

	test("100 chars in 30 seconds is 40 wpm", () => {
		expect(wpmFromCharsAndMs(100, 30000)).toBe(40);
	});
});
