import { describe, expect, it } from "bun:test";
import { fetch } from "../../src/server/index.ts";
import { readIdentityFromEnv } from "../../src/server/devIdentity";

describe("readIdentityFromEnv", () => {
	it("returns undefined when TYPELING_IDENTITY is unset", () => {
		expect(readIdentityFromEnv({})).toBeUndefined();
	});

	it("parses and lowercases a valid identity payload", () => {
		expect(
			readIdentityFromEnv({
				TYPELING_IDENTITY: JSON.stringify({
					email: "E2E@Typeling.dev",
					display_name: "E2E",
				}),
			}),
		).toEqual({
			email: "e2e@typeling.dev",
			display_name: "E2E",
		});
	});

	it("returns undefined for invalid JSON or schema", () => {
		expect(
			readIdentityFromEnv({ TYPELING_IDENTITY: "not-json" }),
		).toBeUndefined();
		expect(
			readIdentityFromEnv({
				TYPELING_IDENTITY: JSON.stringify({ display_name: "No email" }),
			}),
		).toBeUndefined();
	});
});

describe("TYPELING_IDENTITY dev seam", () => {
	it("does not apply process.env identity to fetch() without explicit bindings", async () => {
		const previous = process.env.TYPELING_IDENTITY;
		process.env.TYPELING_IDENTITY = JSON.stringify({
			email: "e2e@typeling.dev",
			display_name: "E2E",
		});
		try {
			const res = await fetch(new Request("http://127.0.0.1:3001/api/me"));
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ authenticated: false });
		} finally {
			if (previous === undefined) {
				delete process.env.TYPELING_IDENTITY;
			} else {
				process.env.TYPELING_IDENTITY = previous;
			}
		}
	});
});
