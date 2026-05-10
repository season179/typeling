import { describe, expect, test } from "bun:test";
import { assertCharset, CharsetError } from "./assertCharset";

describe("assertCharset", () => {
	test("does not throw for valid text within the allowed charset", () => {
		const valid =
			"Hello, world! It's a fine day - isn't it?\nLet's (test) this: cool; yes?";
		expect(() => assertCharset(valid)).not.toThrow();
	});

	test("throws CharsetError with position and char for invalid characters", () => {
		try {
			assertCharset("hello\u00E9");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CharsetError);
			const ce = err as CharsetError;
			expect(ce.position).toBe(5);
			expect(ce.char).toBe("\u00E9");
		}
	});

	test("reports position of first invalid character only", () => {
		try {
			assertCharset("ab\u00E9\u00F1cd");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CharsetError);
			const ce = err as CharsetError;
			expect(ce.position).toBe(2);
			expect(ce.char).toBe("\u00E9");
		}
	});

	test("does not throw for empty string", () => {
		expect(() => assertCharset("")).not.toThrow();
	});

	test("throws with position 0 when first character is invalid", () => {
		try {
			assertCharset("\u00E9abc");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CharsetError);
			const ce = err as CharsetError;
			expect(ce.position).toBe(0);
			expect(ce.char).toBe("\u00E9");
		}
	});
});
