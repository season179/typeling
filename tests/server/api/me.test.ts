import { describe, expect, it } from "bun:test";
import { fetch } from "../../../src/server/index.ts";

const accessJwt = (payload: Record<string, unknown>) => {
	const bytes = new TextEncoder().encode(JSON.stringify(payload));
	const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
		"",
	);
	const encodedPayload = btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
	return `e30.${encodedPayload}.signature`;
};

const getMe = (headers: Record<string, string> = {}) =>
	fetch(
		new Request("http://127.0.0.1:3001/api/me", {
			headers,
		}),
	);

describe("GET /api/me", () => {
	it("returns unauthenticated when Cloudflare Access has not added a token", async () => {
		const res = await getMe();

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ authenticated: false });
	});

	it("returns email and name from the Access JWT when present", async () => {
		const res = await getMe({
			"cf-access-jwt-assertion": accessJwt({
				email: "season@example.com",
				name: "Season Saw",
				sub: "access-user-1",
			}),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			authenticated: true,
			user: {
				email: "season@example.com",
				name: "Season Saw",
				display_name: "Season Saw",
				access_subject: "access-user-1",
			},
		});
	});

	it("falls back to OIDC name fields and then email", async () => {
		const withOidcName = await getMe({
			"cf-access-jwt-assertion": accessJwt({
				email: "parent@example.com",
				oidc_fields: {
					given_name: "Story",
					family_name: "Parent",
				},
			}),
		});

		expect(await withOidcName.json()).toEqual({
			authenticated: true,
			user: {
				email: "parent@example.com",
				name: "Story Parent",
				display_name: "Story Parent",
			},
		});

		const emailOnly = await getMe({
			"cf-access-jwt-assertion": accessJwt({
				email: "email-only@example.com",
			}),
		});

		expect(await emailOnly.json()).toEqual({
			authenticated: true,
			user: {
				email: "email-only@example.com",
				display_name: "email-only@example.com",
			},
		});
	});
});
