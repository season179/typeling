#!/usr/bin/env bun
/**
 * publish-assets.ts — Upload data/audio/ to Cloudflare R2
 * with content-hash idempotency.
 *
 * Required env vars:
 *   CLOUDFLARE_ACCOUNT_ID  — R2 account ID
 *   R2_ACCESS_KEY_ID       — R2 API token access key
 *   R2_SECRET_ACCESS_KEY   — R2 API token secret key
 *   R2_BUCKET              — Bucket name (default: typeling-prod-assets)
 *
 * Usage:
 *   bun run scripts/publish-assets.ts            # upload changed files
 *   bun run scripts/publish-assets.ts --dry-run  # preview only, no writes
 *
 * No secrets are stored in the repo. Set env vars in your shell or .env.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { publishAssets } from "../src/lib/asset-publisher";
import { r2ClientFromEnv } from "../src/lib/r2-s3-client";

// ─── CLI ──────────────────────────────────────────────────────────────

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			"dry-run": { type: "boolean", default: false },
		},
		strict: true,
	});

	const projectRoot = resolve(import.meta.dir, "..");
	const { client: store } = r2ClientFromEnv();

	const result = await publishAssets({
		store,
		audioDir: resolve(projectRoot, "data", "audio"),
		dryRun: values["dry-run"],
		onLog: (msg) => console.log(msg),
	});

	console.log(
		`\nDone: ${result.uploaded.length} uploaded, ${result.skipped.length} skipped.`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
