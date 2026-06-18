/**
 * build-chapter-audio.ts — Walk every step of the chapter audio pipeline
 * for a given season + episode, end-to-end.
 *
 * Usage:
 *   bun run scripts/build-chapter-audio.ts --season <slug> --episode-idx <n>
 *   bun run scripts/build-chapter-audio.ts --season pixel-garden-s1 --episode-idx 0 --from audio --force
 *
 * The six steps are:
 *   1. source     — extract episode text from seasons/<slug>.json
 *   2. transcript — split into Storyteller/Character speaker labels
 *   3. style      — add TTS preamble + audio tags via OpenRouter (paid)
 *   4. audio      — generate WAV via Gemini multi-speaker TTS (paid)
 *   5. align      — run `speech align` (Qwen3-ForcedAligner) on the WAV
 *   6. timings    — normalise raw alignment into the words.json sidecar
 *
 * By default each step is skipped if its output already exists. Pass
 * `--force` to ignore existing files. Pass `--from <step>` to skip every
 * step before that point (useful for "regenerate audio onward without
 * re-running style").
 *
 * Preflight: hard-fails up front if GEMINI_API_KEY, OPENROUTER_API_KEY, or
 * the `speech` CLI is missing — even when the relevant step would have
 * been skipped. This avoids surprises mid-pipeline.
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { access, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";

const ROOT = join(import.meta.dir, "..");
const AUDIO_DIR = join(ROOT, "data", "audio");
const ALIGNER_MODEL = "aufklarer/Qwen3-ForcedAligner-0.6B-4bit";

const STEPS = [
	"source",
	"transcript",
	"style",
	"audio",
	"align",
	"timings",
] as const;
type Step = (typeof STEPS)[number];

class BuildError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BuildError";
	}
}

interface Paths {
	seasonJson: string;
	source: string;
	transcript: string;
	styled: string;
	wav: string;
	meta: string;
	rawAlign: string;
	words: string;
}

function resolvePaths(season: string, episodeIdx: number): Paths {
	const base = `${season}-e${episodeIdx}`;
	return {
		seasonJson: join(ROOT, "seasons", `${season}.json`),
		source: join(AUDIO_DIR, `${base}-source.txt`),
		transcript: join(AUDIO_DIR, `${base}-transcript.txt`),
		styled: join(AUDIO_DIR, `${base}-styled-transcript.txt`),
		wav: join(AUDIO_DIR, `${base}.wav`),
		meta: join(AUDIO_DIR, `${base}.meta.json`),
		rawAlign: join(AUDIO_DIR, `${base}.qwen-align.raw.txt`),
		words: join(AUDIO_DIR, `${base}.words.json`),
	};
}

function rel(path: string): string {
	return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function preflight(paths: Paths): Promise<void> {
	const missing: string[] = [];

	if (!process.env.GEMINI_API_KEY) missing.push("GEMINI_API_KEY (env var)");
	if (!process.env.OPENROUTER_API_KEY)
		missing.push("OPENROUTER_API_KEY (env var)");
	if (!Bun.which("speech"))
		missing.push("`speech` CLI (install Qwen3-ForcedAligner runner)");
	if (!(await exists(paths.seasonJson)))
		missing.push(`season file ${rel(paths.seasonJson)}`);

	if (missing.length > 0) {
		throw new BuildError(
			`Preflight failed. Missing:\n  - ${missing.join("\n  - ")}`,
		);
	}
}

async function runSubprocess(
	cmd: string[],
	label: string,
): Promise<void> {
	const proc = Bun.spawn(cmd, {
		cwd: ROOT,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new BuildError(
			`Step "${label}" failed (exit ${exitCode}): ${cmd.join(" ")}`,
		);
	}
}

async function runAlign(paths: Paths): Promise<void> {
	const sourceText = await readFile(paths.source, "utf-8");
	const proc = Bun.spawn(
		[
			"speech",
			"align",
			paths.wav,
			"--text",
			sourceText,
			"--language",
			"en",
			"--aligner-model",
			ALIGNER_MODEL,
		],
		{
			cwd: ROOT,
			stdout: "pipe",
			stderr: "inherit",
		},
	);
	const stdout = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new BuildError(`Step "align" failed (exit ${exitCode}).`);
	}
	if (stdout.trim().length === 0) {
		throw new BuildError(
			"Step \"align\" produced no output on stdout. Is `speech align` configured correctly?",
		);
	}
	await writeFile(paths.rawAlign, stdout, "utf-8");
}

function buildStepRunners(
	season: string,
	episodeIdx: number,
	paths: Paths,
): Record<Step, () => Promise<void>> {
	const idx = String(episodeIdx);
	return {
		source: () =>
			runSubprocess(
				[
					"bun",
					"run",
					join(ROOT, "scripts", "extract-audio-source.ts"),
					"--season",
					paths.seasonJson,
					"--episode-idx",
					idx,
					"--output",
					paths.source,
				],
				"source",
			),
		transcript: () =>
			runSubprocess(
				[
					"bun",
					"run",
					join(ROOT, "scripts", "convert-to-transcript.ts"),
					"--source",
					paths.source,
					"--output",
					paths.transcript,
				],
				"transcript",
			),
		style: () =>
			runSubprocess(
				[
					"bun",
					"run",
					join(ROOT, "scripts", "style-transcript.ts"),
					"--source",
					paths.transcript,
					"--output",
					paths.styled,
				],
				"style",
			),
		audio: () =>
			runSubprocess(
				[
					"bun",
					"run",
					join(ROOT, "scripts", "generate-chapter-audio.ts"),
					"--season",
					season,
					"--episode-idx",
					idx,
					"--transcript",
					paths.styled,
					"--output",
					paths.wav,
				],
				"audio",
			),
		align: () => runAlign(paths),
		timings: () =>
			runSubprocess(
				[
					"bun",
					"run",
					join(ROOT, "scripts", "generate-word-timings.ts"),
					"--season",
					season,
					"--episode-idx",
					idx,
				],
				"timings",
			),
	};
}

function outputPathFor(step: Step, paths: Paths): string {
	switch (step) {
		case "source":
			return paths.source;
		case "transcript":
			return paths.transcript;
		case "style":
			return paths.styled;
		case "audio":
			return paths.wav;
		case "align":
			return paths.rawAlign;
		case "timings":
			return paths.words;
	}
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			season: { type: "string" },
			"episode-idx": { type: "string" },
			from: { type: "string" },
			force: { type: "boolean" },
		},
		strict: true,
	});

	if (!values.season) {
		throw new BuildError("--season is required (e.g. --season pixel-garden-s1)");
	}
	if (!values["episode-idx"]) {
		throw new BuildError("--episode-idx is required (e.g. --episode-idx 0)");
	}

	const season = values.season;
	const episodeIdx = Number(values["episode-idx"]);
	if (!Number.isInteger(episodeIdx) || episodeIdx < 0) {
		throw new BuildError(
			`Invalid --episode-idx: "${values["episode-idx"]}". Must be a non-negative integer.`,
		);
	}

	let fromIdx = 0;
	if (values.from) {
		const idx = (STEPS as readonly string[]).indexOf(values.from);
		if (idx === -1) {
			throw new BuildError(
				`Invalid --from "${values.from}". Must be one of: ${STEPS.join(", ")}.`,
			);
		}
		fromIdx = idx;
	}

	const force = values.force ?? false;

	const paths = resolvePaths(season, episodeIdx);

	console.log(
		`Building chapter audio for ${season} episode ${episodeIdx}` +
			(force ? " (force)" : "") +
			(values.from ? ` (from ${values.from})` : ""),
	);
	console.log("");

	await preflight(paths);

	const runners = buildStepRunners(season, episodeIdx, paths);

	for (const [i, step] of STEPS.entries()) {
		const outPath = outputPathFor(step, paths);
		const outRel = rel(outPath);

		if (i < fromIdx) {
			console.log(`↷ ${step.padEnd(10)} skipped (before --from ${values.from})`);
			continue;
		}

		if (!force && (await exists(outPath))) {
			console.log(`↷ ${step.padEnd(10)} cached: ${outRel}`);
			continue;
		}

		console.log(`▶ ${step.padEnd(10)} → ${outRel}`);
		await runners[step]();
		console.log(`✓ ${step.padEnd(10)} done`);
	}

	console.log("");
	console.log("Artifacts to inspect:");
	console.log(`  - ${rel(paths.styled)}`);
	console.log(`  - ${rel(paths.wav)}`);
	console.log(`  - ${rel(paths.words)}`);
}

const isMain = import.meta.path === Bun.main;
if (isMain) {
	main().catch((err) => {
		const name = err instanceof Error ? err.name : "Error";
		console.error(
			`\n[${name}] ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	});
}
