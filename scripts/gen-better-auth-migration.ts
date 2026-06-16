#!/usr/bin/env bun
/**
 * gen-better-auth-migration.ts — Emit Better Auth's core SQL schema
 * (`user` / `session` / `account` / `verification`) as D1-compatible
 * CREATE TABLE statements.
 *
 * The runtime auth instance is a per-request factory that needs Workers
 * bindings, so it can't be introspected by the Better Auth CLI. Instead we build
 * a throwaway in-memory SQLite instance with the same provider config and let
 * Better Auth compile its migration SQL. SQLite DDL is D1-compatible.
 *
 * Usage:
 *   bun run scripts/gen-better-auth-migration.ts            # print SQL to stdout
 *
 * Capture the output into a numbered migrations/*.sql file and apply via
 * `bun run db:migrate:local` / `db:migrate:remote`. Re-run when Better Auth is
 * upgraded or provider config changes the schema, then diff the migration.
 */
import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";

const auth = betterAuth({
	database: new Database(":memory:"),
	secret: "generate-only-not-a-real-secret",
	baseURL: "http://localhost",
	socialProviders: {
		google: { clientId: "generate-only", clientSecret: "generate-only" },
	},
});

const { compileMigrations } = await getMigrations(auth.options);
const sql = await compileMigrations();
process.stdout.write(`${sql.trim()}\n`);
