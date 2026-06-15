#!/usr/bin/env bun
/**
 * seed-assets-r2.ts — Upload built audio artifacts in data/audio/ to the LOCAL
 * R2 bucket so `bun run dev` (the Workers runtime, which reads ASSETS_BUCKET)
 * can serve narration. Local-only by design: for remote R2 use
 * scripts/publish-assets.ts, which is content-hash idempotent.
 *
 * The dev worker reads each episode from `audio/{season}-e{idx}.wav` and
 * `audio/{season}-e{idx}.words.json`, so an episode is only uploaded when both
 * files exist; a lone .wav without its sidecar is skipped.
 *
 * Usage:
 *   bun run scripts/seed-assets-r2.ts --local            # upload all artifacts
 *   bun run scripts/seed-assets-r2.ts --local --dry-run  # preview only
 */
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const BUCKET = "typeling-prod-assets";
const AUDIO_DIR = "data/audio";

function usage(): never {
	console.error(
		[
			"Usage: bun run scripts/seed-assets-r2.ts --local [--dry-run]",
			"Uploads data/audio/ narration to the LOCAL R2 bucket.",
			"For remote R2, use scripts/publish-assets.ts.",
		].join("\n"),
	);
	process.exit(1);
}

interface Asset {
	key: string;
	file: string;
	contentType: string;
}

async function collectAssets(audioDir: string): Promise<Asset[]> {
	const entries = await readdir(audioDir);
	const wavFiles = entries.filter((name) => name.endsWith(".wav")).sort();
	const assets: Asset[] = [];

	for (const wav of wavFiles) {
		const base = wav.slice(0, -".wav".length);
		const sidecar = `${base}.words.json`;
		if (!(await Bun.file(resolve(audioDir, sidecar)).exists())) {
			console.warn(`skip ${base}: missing ${sidecar}`);
			continue;
		}
		assets.push({
			key: `audio/${wav}`,
			file: resolve(audioDir, wav),
			contentType: "audio/wav",
		});
		assets.push({
			key: `audio/${sidecar}`,
			file: resolve(audioDir, sidecar),
			contentType: "application/json",
		});
	}

	return assets;
}

async function putObject(asset: Asset): Promise<void> {
	const proc = Bun.spawn(
		[
			"bunx",
			"wrangler",
			"r2",
			"object",
			"put",
			`${BUCKET}/${asset.key}`,
			"--local",
			"--file",
			asset.file,
			"--content-type",
			asset.contentType,
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		process.exit(exitCode);
	}
}

async function main() {
	const args = new Set(process.argv.slice(2));
	if (!args.has("--local")) usage();
	const dryRun = args.has("--dry-run");

	const projectRoot = resolve(import.meta.dir, "..");
	const assets = await collectAssets(resolve(projectRoot, AUDIO_DIR));

	if (assets.length === 0) {
		console.log("No audio artifacts found in data/audio/.");
		return;
	}

	for (const asset of assets) {
		if (dryRun) {
			console.log(`would put ${asset.key} (${asset.contentType})`);
			continue;
		}
		console.log(`put ${asset.key}`);
		await putObject(asset);
	}

	console.log(
		dryRun
			? `Dry run: ${assets.length} object(s) would be seeded into ${BUCKET}.`
			: `Seeded ${assets.length} object(s) into local R2 bucket ${BUCKET}.`,
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
