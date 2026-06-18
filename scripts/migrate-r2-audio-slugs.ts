#!/usr/bin/env bun
/**
 * One-off R2 migration: copy published episode audio from the old story slugs
 * to the new ones, rewriting each sidecar's `seasonSlug` so the served audio is
 * not rejected as stale by src/lib/audio/sidecarMatch.ts.
 *
 * Per-episode R2 layout (see src/server/stores.ts):
 *   audio/<slug>-e<idx>.wav         (content-type audio/wav)
 *   audio/<slug>-e<idx>.words.json  (content-type application/json)
 *
 * The WAV bytes are copied verbatim, so the sidecar's audioHash (sha256 of the
 * WAV) and textHash stay valid; only `seasonSlug` is changed. episodeIdx, words
 * and hashes are untouched.
 *
 * The NEW keys are written; the OLD keys are deliberately LEFT IN PLACE. That is
 * what keeps the deploy gap-free: the new audio exists before the D1 slug rename
 * (0006) flips navigation, and the old audio stays readable for any tab opened
 * against the old slug until it reloads. Delete the old keys only after the
 * rename is verified.
 *
 * Object listing is not available through `wrangler r2 object`, so we probe a
 * generous episode range and skip anything that 404s. This is a one-off, so the
 * extra HEAD-like GETs are acceptable.
 *
 * Usage:
 *   bun run scripts/migrate-r2-audio-slugs.ts            # dry run (no writes)
 *   bun run scripts/migrate-r2-audio-slugs.ts --execute  # perform the copies
 *   bun run scripts/migrate-r2-audio-slugs.ts --local    # target the local R2
 *
 * Defaults to the REMOTE (production) bucket. Nothing is written without
 * --execute. Old keys are never deleted by this script.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wordTimingSidecarSchema } from "../src/lib/wordTimings";

const BUCKET = "typeling-prod-assets";

// old slug -> new slug
const RENAMES: ReadonlyArray<readonly [string, string]> = [
	["winni-s1", "rainbow-door-s1"],
	["zack-s1", "pixel-garden-s1"],
];

// Inclusive upper bound on episode index to probe. Seasons currently hold 28
// episodes (0..27); 39 matches the typing_sessions episode_idx CHECK ceiling and
// leaves headroom without being wasteful.
const MAX_EPISODE_IDX = 39;

const args = new Set(Bun.argv.slice(2));
const EXECUTE = args.has("--execute");
const LOCATION_FLAG = args.has("--local") ? "--local" : "--remote";

interface WranglerResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function wrangler(cmd: string[]): Promise<WranglerResult> {
	const proc = Bun.spawn(["wrangler", ...cmd], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { exitCode, stdout, stderr };
}

function looksLikeMissing(result: WranglerResult): boolean {
	const haystack = `${result.stdout}\n${result.stderr}`.toLowerCase();
	return (
		haystack.includes("does not exist") ||
		haystack.includes("not found") ||
		haystack.includes("404") ||
		haystack.includes("the specified key")
	);
}

/** GET an object into `file`. Returns false when the key is absent. */
async function getObject(key: string, file: string): Promise<boolean> {
	const result = await wrangler([
		"r2",
		"object",
		"get",
		`${BUCKET}/${key}`,
		"--file",
		file,
		LOCATION_FLAG,
	]);
	if (result.exitCode === 0) return true;
	if (looksLikeMissing(result)) return false;
	throw new Error(
		`wrangler r2 object get ${key} failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
	);
}

async function putObject(
	key: string,
	file: string,
	contentType: string,
): Promise<void> {
	const result = await wrangler([
		"r2",
		"object",
		"put",
		`${BUCKET}/${key}`,
		"--file",
		file,
		"--content-type",
		contentType,
		LOCATION_FLAG,
	]);
	if (result.exitCode !== 0) {
		throw new Error(
			`wrangler r2 object put ${key} failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
		);
	}
}

async function main() {
	console.log(
		`R2 audio slug migration — bucket=${BUCKET} target=${LOCATION_FLAG} mode=${EXECUTE ? "EXECUTE" : "DRY RUN"}`,
	);
	console.log("Old keys are preserved; nothing is deleted.\n");

	const work = await mkdtemp(join(tmpdir(), "r2-audio-migrate-"));
	let copied = 0;
	let skipped = 0;

	try {
		for (const [oldSlug, newSlug] of RENAMES) {
			console.log(`# ${oldSlug} -> ${newSlug}`);
			for (let idx = 0; idx <= MAX_EPISODE_IDX; idx++) {
				const wavOld = `audio/${oldSlug}-e${idx}.wav`;
				const wavNew = `audio/${newSlug}-e${idx}.wav`;
				const sideOld = `audio/${oldSlug}-e${idx}.words.json`;
				const sideNew = `audio/${newSlug}-e${idx}.words.json`;

				const wavTmp = join(work, `${oldSlug}-e${idx}.wav`);
				const sideTmp = join(work, `${oldSlug}-e${idx}.words.json`);

				const hasWav = await getObject(wavOld, wavTmp);
				if (!hasWav) {
					skipped++;
					continue;
				}

				const hasSidecar = await getObject(sideOld, sideTmp);
				if (!hasSidecar) {
					// A WAV without its sidecar cannot be served (sidecarMatch needs
					// it). Surface it loudly rather than silently copying half.
					throw new Error(
						`Found ${wavOld} but no sidecar ${sideOld}; refusing to copy a half-published episode.`,
					);
				}

				// Validate the sidecar, then rewrite its slug-bearing fields. Only
				// seasonSlug is enforced at serve time (see checkSidecarMatchesEpisodeText);
				// audioPath/sourceTextPath are provenance, but are reconstructed so the
				// sidecar holds no stale references. textHash/words/audioHash are left
				// untouched and stay valid because the episode text and WAV bytes are
				// identical after the slug rename.
				const raw = await readFile(sideTmp, "utf-8");
				const sidecar = wordTimingSidecarSchema.parse(JSON.parse(raw));
				const rewritten = {
					...sidecar,
					seasonSlug: newSlug,
					audioPath: `audio/${newSlug}-e${idx}.wav`,
					sourceTextPath: `d1://seasons/${newSlug}/episodes/${idx}`,
				};
				const rewrittenTmp = join(work, `${newSlug}-e${idx}.words.json`);
				await writeFile(rewrittenTmp, JSON.stringify(rewritten));

				console.log(
					`  e${idx}: ${wavOld} -> ${wavNew}, ${sideOld} -> ${sideNew} (seasonSlug ${sidecar.seasonSlug} -> ${newSlug})`,
				);

				if (EXECUTE) {
					await putObject(wavNew, wavTmp, "audio/wav");
					await putObject(sideNew, rewrittenTmp, "application/json");
				}
				copied++;
			}
		}
	} finally {
		await rm(work, { recursive: true, force: true });
	}

	console.log(
		`\nDone. ${copied} episode(s) ${EXECUTE ? "copied" : "would be copied"}, ${skipped} probe(s) had no audio.`,
	);
	if (!EXECUTE) {
		console.log("Re-run with --execute to perform the copies.");
	}
}

main().catch((err) => {
	console.error(`\n[R2MigrationError] ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
