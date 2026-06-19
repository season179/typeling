#!/usr/bin/env bun
/**
 * Re-slice existing per-episode audio into the post-split episodes (14 -> 28),
 * reusing the original word timings — zero TTS, zero re-alignment.
 *
 * For each old episode `i` that has local audio, the old `.wav` + `.words.json`
 * are cut at the sentence-final boundary that produced the new episodes `2i`
 * and `2i+1` in the season JSON, writing fresh `.wav`, `.words.json`, and
 * `-source.txt` for each half. Every half is checked with the exact serve-time
 * staleness check before anything is written.
 *
 * Usage:
 *   bun run scripts/reslice-episodes.ts            # verify only (no writes)
 *   bun run scripts/reslice-episodes.ts --write    # write halves into data/audio
 *   bun run scripts/reslice-episodes.ts --write rainbow-door-s1
 *
 * After --write, publish to R2 with `bun run scripts/publish-assets.ts`
 * (needs R2 credentials). Old build intermediates (-transcript.txt,
 * -styled-transcript.txt, .meta.json, .qwen-align.raw.txt) for the touched base
 * names are removed under --write since they cannot be regenerated here and
 * would otherwise publish as stale.
 */
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { resliceEpisodeToTexts } from "../src/lib/audio/reslice";
import { seasonSchema } from "../src/lib/schemas/season";
import { wordTimingSidecarSchema } from "../src/lib/wordTimings";

const AUDIO_DIR = "data/audio";
const STALE_INTERMEDIATE_EXT = [
	"-transcript.txt",
	"-styled-transcript.txt",
	".meta.json",
	".qwen-align.raw.txt",
];

const argv = process.argv.slice(2);
const write = argv.includes("--write");
const slugArgs = argv.filter((arg) => !arg.startsWith("--"));
const slugs = slugArgs.length > 0 ? slugArgs : ["rainbow-door-s1", "pixel-garden-s1"];
const generatedAt = new Date().toISOString();

const baseName = (slug: string, idx: number) => `${slug}-e${idx}`;
const wavPath = (slug: string, idx: number) =>
	join(AUDIO_DIR, `${baseName(slug, idx)}.wav`);
const sidecarPath = (slug: string, idx: number) =>
	join(AUDIO_DIR, `${baseName(slug, idx)}.words.json`);
const sourcePath = (slug: string, idx: number) =>
	join(AUDIO_DIR, `${baseName(slug, idx)}-source.txt`);
const rawAlignPath = (slug: string, idx: number) =>
	join(AUDIO_DIR, `${baseName(slug, idx)}.qwen-align.raw.txt`);

function part(slug: string, idx: number) {
	return {
		episodeIdx: idx,
		audioPath: wavPath(slug, idx),
		sourceTextPath: sourcePath(slug, idx),
		rawAlignmentPath: rawAlignPath(slug, idx),
	};
}

async function resliceSeason(slug: string): Promise<void> {
	const season = seasonSchema.parse(
		await Bun.file(`seasons/${slug}.json`).json(),
	);
	const oldCount = season.episodes.length / 2;
	if (!Number.isInteger(oldCount)) {
		throw new Error(
			`${slug}: ${season.episodes.length} episodes is not a split (even) count.`,
		);
	}

	// Phase 1: read every existing old input into memory BEFORE any write, so
	// writing new e1 cannot clobber old e1 (the source for new e2/e3).
	const jobs: {
		oldIdx: number;
		sourceAudio: Uint8Array;
		sourceSidecar: ReturnType<typeof wordTimingSidecarSchema.parse>;
		textA: string;
		textB: string;
	}[] = [];

	for (let i = 0; i < oldCount; i++) {
		const wav = Bun.file(wavPath(slug, i));
		const sidecar = Bun.file(sidecarPath(slug, i));
		if (!(await wav.exists()) || !(await sidecar.exists())) {
			console.log(`  ${baseName(slug, i)}: no local audio — skipped`);
			continue;
		}
		jobs.push({
			oldIdx: i,
			sourceAudio: new Uint8Array(await wav.arrayBuffer()),
			sourceSidecar: wordTimingSidecarSchema.parse(await sidecar.json()),
			textA: season.episodes[i * 2]?.text ?? "",
			textB: season.episodes[i * 2 + 1]?.text ?? "",
		});
	}

	// Phase 2: compute + acceptance-check every half (throws on any failure).
	const results = jobs.map((job) => {
		const idxA = job.oldIdx * 2;
		const idxB = idxA + 1;
		const result = resliceEpisodeToTexts({
			sourceSidecar: job.sourceSidecar,
			sourceAudio: job.sourceAudio,
			textA: job.textA,
			textB: job.textB,
			partA: part(slug, idxA),
			partB: part(slug, idxB),
			generatedAt,
		});
		console.log(
			`  ${baseName(slug, job.oldIdx)} → e${idxA} (${result.a.sidecar.durationSeconds.toFixed(
				2,
			)}s, ${result.a.sidecar.words.length}w) + e${idxB} (${result.b.sidecar.durationSeconds.toFixed(
				2,
			)}s, ${result.b.sidecar.words.length}w)  [acceptance OK]`,
		);
		return { idxA, idxB, result };
	});

	if (!write) return;

	// Phase 3: write all halves, then drop stale intermediates for touched bases.
	const touched = new Set<number>();
	for (const { idxA, idxB, result } of results) {
		for (const [idx, half] of [
			[idxA, result.a],
			[idxB, result.b],
		] as const) {
			await Bun.write(wavPath(slug, idx), half.audio);
			await Bun.write(
				sidecarPath(slug, idx),
				`${JSON.stringify(half.sidecar, null, 2)}\n`,
			);
			await Bun.write(sourcePath(slug, idx), half.text);
			touched.add(idx);
		}
	}

	for (const idx of touched) {
		for (const ext of STALE_INTERMEDIATE_EXT) {
			const path = join(AUDIO_DIR, `${baseName(slug, idx)}${ext}`);
			if (await Bun.file(path).exists()) {
				await unlink(path);
				console.log(`  removed stale ${baseName(slug, idx)}${ext}`);
			}
		}
	}
}

for (const slug of slugs) {
	console.log(`${slug}:`);
	await resliceSeason(slug);
}

console.log(
	write
		? "\nWrote re-sliced halves. Next: bun run scripts/publish-assets.ts (needs R2 credentials)."
		: "\nVerified only (no writes). Re-run with --write to apply.",
);
