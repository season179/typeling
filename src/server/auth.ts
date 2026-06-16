import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import type { ServerBindings } from "./stores";

/**
 * Better Auth owns the Google OAuth flow and its own `user` / `session` /
 * `account` / `verification` tables in D1. Workers are stateless per request, so
 * the auth instance is built per request from the request's env bindings rather
 * than cached as a module singleton.
 *
 * Identity still flows into the existing email-scoped domain model: callers read
 * the Better Auth session, map it to a `SignedInUser`, and upsert it into the
 * `users` table (see `src/server/index.ts`). Better Auth's `user` table is
 * distinct from our domain `users` table — they do not collide.
 */
export function makeAuth(env: ServerBindings) {
	return betterAuth({
		// D1 is auto-detected by Better Auth's Kysely adapter, which duck-types the
		// binding (batch/exec/prepare) and wraps it in its D1 SQLite dialect. The
		// cast bridges our minimal `D1DatabaseLike` type to the real binding type.
		database: env.STORY_DB as unknown as D1Database,
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		socialProviders: {
			google: {
				clientId: env.GOOGLE_CLIENT_ID ?? "",
				clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
			},
		},
		trustedOrigins: env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : [],
		advanced: {
			useSecureCookies: env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
		},
	});
}

/**
 * Whether the request env carries enough configuration to run Better Auth.
 * False in tests and the D1-less `dev:direct` fallback, where authenticated
 * routes return 401 and `/api/auth/*` returns 503.
 */
export function isAuthConfigured(env: ServerBindings): boolean {
	return Boolean(env.STORY_DB && env.BETTER_AUTH_SECRET && env.BETTER_AUTH_URL);
}
