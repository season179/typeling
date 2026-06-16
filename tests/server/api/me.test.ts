import { describe, expect, it } from "bun:test";
import type { SignedInUser } from "../../../src/lib/schemas/state.ts";
import { fetch } from "../../../src/server/index.ts";

// Identity is resolved from the Better Auth session in production. Tests inject
// it directly via the `IDENTITY` binding seam (never set by the Workers runtime),
// so they exercise the route logic without standing up a real OAuth session.
const identity: SignedInUser = {
	email: "season@example.com",
	name: "Season Saw",
	display_name: "Season Saw",
	access_subject: "google-user-1",
};

const getMe = (
	env: { IDENTITY?: SignedInUser } = {},
	url = "http://127.0.0.1:3001/api/me",
) => fetch(new Request(url), env);

describe("GET /api/me", () => {
	it("returns the signed-in user from the session identity", async () => {
		const res = await getMe({ IDENTITY: identity });

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			authenticated: true,
			user: {
				email: "season@example.com",
				name: "Season Saw",
				display_name: "Season Saw",
				access_subject: "google-user-1",
				target_wpm: 15,
			},
		});
	});

	it("returns unauthenticated when there is no session", async () => {
		const res = await getMe();

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ authenticated: false });
	});
});
