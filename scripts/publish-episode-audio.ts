#!/usr/bin/env bun
/**
 * publish-episode-audio.ts — Promote audio generated locally (via the /admin
 * "Generate audio" button) up to the production R2 bucket.
 *
 * The admin button runs the full pipeline inside the dev Worker and writes the
 * result to the LOCAL R2 emulation (`.wrangler/state`), never to remote R2 and
 * never to disk. This script bridges that gap in two steps:
 *
 *   1. Export `audio/{season}-e{idx}.wav` + `.words.json` from local R2 into
 *      data/audio/ (via `wrangler r2 object get --local`).
 *   2. Upload exactly those files to remote R2 with content-hash idempotency and
 *      the `sha256` custom metadata the serving path checks. Only the requested
 *      episode is touched — unrelated episodes and intermediate transcripts are
 *      never published.
 *
 * Remote writes stay an explicit terminal command — they never happen from the
 * browser — mirroring `db:migrate:remote`.
 *
 * Required env vars for step 2 (auto-loaded from .env by Bun):
 *   CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *
 * Usage:
 *   bun run scripts/publish-episode-audio.ts --season rainbow-door-s1 --episode-idx 0
 *   bun run scripts/publish-episode-audio.ts --season rainbow-door-s1 --episode-idx 0 --episode-idx 1
 *   bun run scripts/publish-episode-audio.ts --season rainbow-door-s1 --episode-idx 0 --dry-run
 */
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type FileEntry, publishEntries } from "../src/lib/asset-publisher";
import { r2ClientFromEnv } from "../src/lib/r2-s3-client";

// The local R2 bucket name is the binding's bucket_name in wrangler.jsonc.
const LOCAL_BUCKET = "typeling-prod-assets";
const AUDIO_DIR = "data/audio";

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function parseEpisodeIndices(raw: string[]): number[] {
	const indices = raw.map((value) => {
		const idx = Number(value);
		if (!Number.isInteger(idx) || idx < 0) {
			fail(`Invalid --episode-idx "${value}": expected a non-negative integer.`);
		}
		return idx;
	});
	return [...new Set(indices)].sort((a, b) => a - b);
}

/** `wrangler r2 object get <bucket>/<key> --local --file <dest>` */
async function exportFromLocalR2(key: string, file: string): Promise<void> {
	const proc = Bun.spawn(
		[
			"bunx",
			"wrangler",
			"r2",
			"object",
			"get",
			`${LOCAL_BUCKET}/${key}`,
			"--local",
			"--file",
			file,
		],
		{ stdout: "ignore", stderr: "pipe" },
	);
	const [stderr, exitCode] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		// wrangler creates the destination file before it discovers a missing
		// key — remove the empty stub so it can't be published later.
		await rm(file, { force: true }).catch(() => undefined);
		fail(
			`Could not export ${key} from the local R2 bucket.\n` +
				`Generate it first with the /admin "Generate audio" button while ` +
				`\`bun run dev\` is running, then re-run this command.\n\n` +
				stderr.trim(),
		);
	}
}

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			season: { type: "string" },
			"episode-idx": { type: "string", multiple: true },
			"dry-run": { type: "boolean", default: false },
		},
		strict: true,
	});

	const season = values.season;
	if (!season) {
		fail(
			"Missing --season.\n" +
				"Usage: bun run scripts/publish-episode-audio.ts --season <slug> --episode-idx <n> [--episode-idx <n> ...] [--dry-run]",
		);
	}

	const rawIndices = values["episode-idx"] ?? [];
	if (rawIndices.length === 0) {
		fail("Missing --episode-idx (at least one required).");
	}
	const episodeIndices = parseEpisodeIndices(rawIndices);

	const projectRoot = resolve(import.meta.dir, "..");
	const audioDir = resolve(projectRoot, AUDIO_DIR);

	// Step 1 — export each episode's WAV + sidecar from local R2 to data/audio/,
	// collecting the exact entries to publish (never the whole directory).
	const entries: FileEntry[] = [];
	for (const idx of episodeIndices) {
		const base = `${season}-e${idx}`;
		for (const name of [`${base}.wav`, `${base}.words.json`]) {
			const key = `audio/${name}`;
			const file = resolve(audioDir, name);
			console.log(`export ${key} → ${AUDIO_DIR}/`);
			await exportFromLocalR2(key, file);
			entries.push({ localPath: file, key });
		}
	}

	// Step 2 — upload just those files to remote R2 (idempotent; sets the
	// sha256 metadata the serving path checks).
	console.log(
		`\npublishing to remote R2${values["dry-run"] ? " (dry run)" : ""}…`,
	);
	const { client, bucket } = r2ClientFromEnv();
	const result = await publishEntries({
		store: client,
		entries,
		dryRun: values["dry-run"],
		onLog: (msg) => console.log(msg),
	});

	console.log(
		`\nDone (${bucket}): ${result.uploaded.length} uploaded, ${result.skipped.length} skipped.`,
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
