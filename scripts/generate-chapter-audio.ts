/**
 * Generate chapter audio for any season + episode using the real Gemini TTS API.
 *
 * Usage:
 *   bun run scripts/generate-chapter-audio.ts --season <slug> --episode-idx <n>
 *   bun run scripts/generate-chapter-audio.ts --season rainbow-door-s1 --episode-idx 0 --transcript data/audio/rainbow-door-s1-e0-styled-transcript.txt
 *   bun run scripts/generate-chapter-audio.ts --season pixel-garden-s1 --episode-idx 0 --output data/audio/pixel-garden-s1-e0.wav
 *
 * Requires GEMINI_API_KEY in the environment.
 * Retries transient missing-audio responses as warned in the Gemini docs.
 *
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { buildTtsRequest, DEFAULT_VOICE_CHOICES } from "../src/lib/geminiTtsRequest";
import { generateWav, metaPath } from "../src/lib/generateWav";
import {
	callGeminiTtsWithRetry,
	GeminiTtsAuthError,
	GeminiTtsError,
	GeminiTtsTransientError,
} from "../src/lib/geminiTtsClient";

const ROOT = join(import.meta.dir, "..");
const DEFAULT_OUTPUT_DIR = join(ROOT, "data", "audio");
const DEFAULT_MAX_RETRIES = 3;

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		transcript: { type: "string" },
		output: { type: "string" },
		season: { type: "string" },
		"episode-idx": { type: "string" },
		"max-retries": { type: "string" },
	},
	strict: true,
});

class CliError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliError";
	}
}

async function main() {
	// ── Parse args ──────────────────────────────────────────────────

	if (!values.season) {
		throw new CliError("--season is required (e.g. --season pixel-garden-s1)");
	}
	if (!values["episode-idx"]) {
		throw new CliError("--episode-idx is required (e.g. --episode-idx 0)");
	}

	const season = values.season;

	const rawIdx = values["episode-idx"];
	const episodeIdx = Number(rawIdx);
	if (!Number.isInteger(episodeIdx) || episodeIdx < 0) {
		throw new CliError(
			`Invalid --episode-idx: "${rawIdx}". Must be a non-negative integer.`,
		);
	}

	const rawRetries = values["max-retries"] ?? String(DEFAULT_MAX_RETRIES);
	const maxRetries = Number(rawRetries);
	if (!Number.isInteger(maxRetries) || maxRetries < 0) {
		throw new CliError(
			`Invalid --max-retries: "${rawRetries}". Must be a non-negative integer.`,
		);
	}

	const base = `${season}-e${episodeIdx}`;
	const transcriptPath =
		values.transcript ??
		join(DEFAULT_OUTPUT_DIR, `${base}-styled-transcript.txt`);
	const outputPath = values.output ?? join(DEFAULT_OUTPUT_DIR, `${base}.wav`);

	// ── Read styled transcript ──────────────────────────────────────

	let styledTranscript: string;
	try {
		styledTranscript = await readFile(transcriptPath, "utf-8");
	} catch {
		throw new CliError(
			`Cannot read styled transcript: ${transcriptPath}\n` +
				"Run the transcript pipeline first:\n" +
				"  bun run scripts/extract-audio-source.ts\n" +
				"  bun run scripts/convert-to-transcript.ts\n" +
				"  bun run scripts/style-transcript.ts",
		);
	}

	if (styledTranscript.trim().length === 0) {
		throw new CliError(`Styled transcript is empty: ${transcriptPath}`);
	}

	// ── Build request ───────────────────────────────────────────────

	const request = buildTtsRequest({ styledTranscript });

	// Compute transcript hash for metadata
	const transcriptHash = createHash("sha256")
		.update(styledTranscript)
		.digest("hex");

	// ── Call Gemini TTS with retry ──────────────────────────────────

	console.log(
		`Calling Gemini TTS (model=${request.model}, maxRetries=${maxRetries})…`,
	);

	let response;
	try {
		response = await callGeminiTtsWithRetry({
			request,
			maxRetries,
		});
	} catch (err) {
		if (err instanceof GeminiTtsAuthError) {
			throw new CliError(
				`${err.message}\n` +
					"Get a key at https://aistudio.google.com/apikey",
			);
		}
		if (err instanceof GeminiTtsTransientError) {
			throw new CliError(
				`Gemini TTS transient failure after retries: ${err.message}`,
			);
		}
		if (err instanceof GeminiTtsError) {
			throw new CliError(`Gemini TTS error: ${err.message}`);
		}
		throw err;
	}

	// ── Write WAV + metadata ────────────────────────────────────────

	await generateWav({
		response,
		outputPath,
		season,
		episodeIdx,
		model: request.model,
		voiceChoices: DEFAULT_VOICE_CHOICES,
		transcriptHash,
	});

	// ── Report ──────────────────────────────────────────────────────

	const wavStat = await stat(outputPath);
	const metaFilePath = metaPath(outputPath);
	const metaStat = await stat(metaFilePath);

	console.log(`✓ Wrote ${outputPath} (${wavStat.size} bytes)`);
	console.log(`✓ Wrote ${metaFilePath} (${metaStat.size} bytes)`);
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
