#!/usr/bin/env bun
/**
 * Split a season's episodes in half at sentence-final boundaries (14 → 28),
 * keeping the whole story arc but halving per-session typing.
 *
 * Deterministic and reproducible: the same `chooseEpisodeSplit` logic drives
 * both this text split and the audio re-slice (`scripts/reslice-episodes.ts`),
 * so episode `2i`/`2i+1` text always matches the re-sliced `2i`/`2i+1` audio.
 *
 * Usage:
 *   bun run scripts/split-season.ts [--dry-run] [file ...]
 *
 * With no files, processes the two real seasons. The `*-test.json` fixtures are
 * single-sentence-per-episode toys with no interior boundary to cut on (and are
 * not loaded by the app or any test), so they are left at their original shape.
 *
 * @see docs/episode-split-and-admin-generation-plan.md §1.3, §1.10b
 */
import { chooseEpisodeSplit } from "../src/lib/audio/reslice";
import { seasonSchema } from "../src/lib/schemas/season";
import { checkStoryText } from "../src/lib/storyTextPolicy";

const DEFAULT_FILES = ["seasons/rainbow-door-s1.json", "seasons/pixel-garden-s1.json"];

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const files = argv.filter((arg) => !arg.startsWith("--"));
const targets = files.length > 0 ? files : DEFAULT_FILES;

function firstWords(text: string, count: number): string {
	return text.split(/\s+/).slice(0, count).join(" ");
}

function lastWords(text: string, count: number): string {
	return text.split(/\s+/).slice(-count).join(" ");
}

async function splitSeasonFile(relPath: string): Promise<void> {
	const season = seasonSchema.parse(await Bun.file(relPath).json());
	const sorted = [...season.episodes].sort((a, b) => a.idx - b.idx);

	const newEpisodes: { idx: number; text: string }[] = [];
	for (const [i, episode] of sorted.entries()) {
		const split = chooseEpisodeSplit(episode.text);
		const halves = [
			episode.text.slice(0, split.charIndex).trim(),
			episode.text.slice(split.charIndex).trim(),
		];

		for (const [offset, half] of halves.entries()) {
			const violation = checkStoryText(half);
			if (violation) {
				throw new Error(
					`${relPath} episode ${i} half ${offset} violates story policy: ${JSON.stringify(
						violation,
					)}`,
				);
			}
			const idx = i * 2 + offset;
			newEpisodes.push({ idx, text: half });
			if (dryRun) {
				console.log(
					`  e${idx} (from old ${i}, k=${offset === 0 ? split.wordIndex : "rest"}): "${firstWords(
						half,
						6,
					)} … ${lastWords(half, 6)}"`,
				);
			}
		}
	}

	const nextSeason = seasonSchema.parse({ ...season, episodes: newEpisodes });
	console.log(
		`${relPath}: ${sorted.length} → ${nextSeason.episodes.length} episodes`,
	);

	if (!dryRun) {
		await Bun.write(relPath, `${JSON.stringify(nextSeason, null, 2)}\n`);
	}
}

for (const target of targets) {
	await splitSeasonFile(target);
}
