import { describe, expect, test } from "bun:test";
import { graduationStatus } from "./graduation";

describe("graduationStatus", () => {
	test("returns 'no sessions yet' when rolling3 is null", () => {
		expect(graduationStatus(null, 20)).toBe("no sessions yet");
	});

	test("returns 'in progress' when rolling3 is below target", () => {
		expect(graduationStatus(19, 20)).toBe("in progress");
	});

	test("returns 'graduated' when rolling3 equals target", () => {
		expect(graduationStatus(20, 20)).toBe("graduated");
	});

	test("returns 'graduated' when rolling3 exceeds target", () => {
		expect(graduationStatus(21, 20)).toBe("graduated");
	});
});
