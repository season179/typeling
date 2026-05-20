/**
 * Generate a word-timing sidecar from a Qwen3-ForcedAligner raw alignment.
 *
 * Usage:
 *   bun run scripts/generate-word-timings.ts
 *   bun run scripts/generate-word-timings.ts --season zack-s1 --episode-idx 0
 */

import { join } from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildWordTimingSidecar } from "../src/lib/wordTimings";

const ROOT = join(import.meta.dir, "..");
const DEFAULT_OUTPUT_DIR = join(ROOT, "data", "audio");
const DEFAULT_ALIGNER_MODEL = "aufklarer/Qwen3-ForcedAligner-0.6B-4bit";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		season: { type: "string" },
		"episode-idx": { type: "string" },
		audio: { type: "string" },
		source: { type: "string" },
		alignment: { type: "string" },
		output: { type: "string" },
		"aligner-model": { type: "string" },
	},
	strict: true,
});

class CliError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliError";
	}
}

interface ArtifactPaths {
	audioPath: string;
	sourceTextPath: string;
	rawAlignmentPath: string;
	outputPath: string;
}

async function main(): Promise<void> {
	const season = values.season ?? "zack-s1";
	const episodeIdx = parseEpisodeIdx(values["episode-idx"] ?? "0");
	const baseName = `${season}-e${episodeIdx}`;
	const paths = resolveArtifactPaths(baseName);
	const alignerModel = values["aligner-model"] ?? DEFAULT_ALIGNER_MODEL;

	const [sourceText, rawAlignment, audioBytes] = await Promise.all([
		readText(paths.sourceTextPath, "source text"),
		readText(paths.rawAlignmentPath, "raw alignment"),
		readBinary(paths.audioPath, "audio"),
	]);

	const sidecar = buildWordTimingSidecar({
		seasonSlug: season,
		episodeIdx,
		audioPath: relativePath(paths.audioPath),
		sourceTextPath: relativePath(paths.sourceTextPath),
		rawAlignmentPath: relativePath(paths.rawAlignmentPath),
		sourceText,
		rawAlignment,
		audioBytes,
		alignerModel,
	});

	await writeFile(
		paths.outputPath,
		`${JSON.stringify(sidecar, null, 2)}\n`,
		"utf-8",
	);

	const outputStat = await stat(paths.outputPath);
	console.log(
		`Wrote ${relativePath(paths.outputPath)} (${sidecar.words.length} words, ${sidecar.durationSeconds.toFixed(
			2,
		)}s, ${outputStat.size} bytes)`,
	);
}

function parseEpisodeIdx(rawIdx: string): number {
	const episodeIdx = Number(rawIdx);
	if (!Number.isInteger(episodeIdx) || episodeIdx < 0) {
		throw new CliError(
			`Invalid --episode-idx: "${rawIdx}". Must be a non-negative integer.`,
		);
	}
	return episodeIdx;
}

function resolveArtifactPaths(baseName: string): ArtifactPaths {
	return {
		audioPath: values.audio ?? join(DEFAULT_OUTPUT_DIR, `${baseName}.wav`),
		sourceTextPath:
			values.source ?? join(DEFAULT_OUTPUT_DIR, `${baseName}-source.txt`),
		rawAlignmentPath:
			values.alignment ??
			join(DEFAULT_OUTPUT_DIR, `${baseName}.qwen-align.raw.txt`),
		outputPath:
			values.output ?? join(DEFAULT_OUTPUT_DIR, `${baseName}.words.json`),
	};
}

async function readText(path: string, label: string): Promise<string> {
	try {
		return await readFile(path, "utf-8");
	} catch (err) {
		throw new CliError(
			`Cannot read ${label}: ${path}. ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

async function readBinary(path: string, label: string): Promise<Uint8Array> {
	try {
		return new Uint8Array(await readFile(path));
	} catch (err) {
		throw new CliError(
			`Cannot read ${label}: ${path}. ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

function relativePath(path: string): string {
	return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

const isMain = import.meta.path === Bun.main;
if (isMain) {
	main().catch((err) => {
		const name = err instanceof Error ? err.name : "Error";
		console.error(
			`[${name}] ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	});
}
