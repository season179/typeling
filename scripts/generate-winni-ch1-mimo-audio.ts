/**
 * Generate Winni chapter 1 (season 1 episode 0) audio using the real
 * MiMo TTS API.
 *
 * Usage:
 *   bun run scripts/generate-winni-ch1-mimo-audio.ts
 *   bun run scripts/generate-winni-ch1-mimo-audio.ts --transcript data/audio/winni-s1-e0-styled-transcript.txt
 *   bun run scripts/generate-winni-ch1-mimo-audio.ts --output data/audio/winni-s1-e0.wav
 *   bun run scripts/generate-winni-ch1-mimo-audio.ts --voice Chloe
 *
 * Requires MIMO_API_KEY in the environment.
 * Calls Xiaomi's OpenAI-compatible chat-completions endpoint for mimo-v2.5-tts.
 *
 * MiMo is single-voice for built-in voices. The styled transcript's first line
 * (TTS preamble) is sent as MiMo's style guidance (user message); the remainder
 * is sent as the spoken text (assistant message). Speaker labels in the
 * transcript body will be read aloud — edit the styled transcript by hand if
 * you want them stripped.
 *
 * @see https://platform.mimoai.com/docs
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { mimoGenerateWav, mimoMetaPath } from "../src/lib/mimoGenerateWav";
import {
	callMimoTtsWithRetry,
	MimoTtsAuthError,
	MimoTtsError,
	MimoTtsTransientError,
} from "../src/lib/mimoTtsClient";
import {
	buildMimoTtsRequest,
	DEFAULT_MIMO_VOICE,
	MIMO_BUILT_IN_VOICES,
} from "../src/lib/mimoTtsRequest";

const ROOT = join(import.meta.dir, "..");
const DEFAULT_TRANSCRIPT = join(
	ROOT,
	"data",
	"audio",
	"winni-s1-e0-styled-transcript.txt",
);
const DEFAULT_OUTPUT_DIR = join(ROOT, "data", "audio");
const DEFAULT_SEASON = "winni-s1";
const DEFAULT_EPISODE_IDX = 0;
const DEFAULT_MAX_RETRIES = 3;

class CliError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliError";
	}
}

export interface WinniMimoCliInput {
	transcriptPath?: string;
	outputPath?: string;
	season?: string;
	episodeIdx?: number;
	voice?: string;
	maxRetries?: number;
	apiKey?: string;
	apiBase?: string;
	fetchFn?: typeof fetch;
	sleepFn?: (ms: number) => Promise<void>;
	generatedAt?: string;
}

export interface WinniMimoCliResult {
	outputPath: string;
	metaPath: string;
	voice: string;
	transcriptHash: string;
}

/**
 * Split a styled transcript into MiMo-friendly (styleGuidance, spokenText).
 *
 * Convention: the first non-empty line is the TTS preamble (style guidance);
 * everything after the blank line that follows it is the spoken text.
 * If the transcript has no blank-line separator, the first line is still
 * treated as style guidance and the remaining lines as spoken text.
 */
export function splitStyledTranscript(transcript: string): {
	styleGuidance: string;
	spokenText: string;
} {
	const trimmed = transcript.replace(/\r\n/g, "\n").trimEnd();

	// Find the first blank line — preamble is everything before it.
	const blankLineIdx = trimmed.search(/\n\s*\n/);

	if (blankLineIdx === -1) {
		// No blank line: take the first line as preamble.
		const firstNewline = trimmed.indexOf("\n");
		if (firstNewline === -1) {
			throw new CliError(
				"Styled transcript has only one line. Expected a TTS preamble followed by speaker-labelled lines.",
			);
		}
		const styleGuidance = trimmed.slice(0, firstNewline).trim();
		const spokenText = trimmed.slice(firstNewline + 1).trim();
		return { styleGuidance, spokenText };
	}

	const styleGuidance = trimmed.slice(0, blankLineIdx).trim();
	// Skip the blank-line separator
	const afterBlank = trimmed.slice(blankLineIdx).replace(/^\s*\n\s*\n/, "");
	const spokenText = afterBlank.trim();

	return { styleGuidance, spokenText };
}

/**
 * Programmatic entry point — exposed for tests.
 * The CLI wrapper at the bottom of this file calls this with parsed argv.
 */
export async function generateWinniMimoAudio(
	input: WinniMimoCliInput,
): Promise<WinniMimoCliResult> {
	const transcriptPath = input.transcriptPath ?? DEFAULT_TRANSCRIPT;
	const season = input.season ?? DEFAULT_SEASON;
	const episodeIdx = input.episodeIdx ?? DEFAULT_EPISODE_IDX;
	const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
	const voice = input.voice ?? DEFAULT_MIMO_VOICE;
	const outputPath =
		input.outputPath ??
		join(DEFAULT_OUTPUT_DIR, `${season}-e${episodeIdx}.wav`);

	if (!(MIMO_BUILT_IN_VOICES as readonly string[]).includes(voice)) {
		throw new CliError(
			`Unknown MiMo voice "${voice}". ` +
				`Choose one of: ${MIMO_BUILT_IN_VOICES.join(", ")}.`,
		);
	}

	// ── Read styled transcript ──────────────────────────────────────

	let styledTranscript: string;
	try {
		styledTranscript = await readFile(transcriptPath, "utf-8");
	} catch {
		throw new CliError(
			`Cannot read styled transcript: ${transcriptPath}\n` +
				"Run the transcript pipeline first:\n" +
				`  bun run scripts/extract-audio-source.ts --season seasons/${season}.json --output data/audio/${season}-e${episodeIdx}-source.txt --episode-idx ${episodeIdx}\n` +
				`  bun run scripts/convert-to-transcript.ts --source data/audio/${season}-e${episodeIdx}-source.txt --output data/audio/${season}-e${episodeIdx}-transcript.txt\n` +
				`  bun run scripts/style-transcript.ts --source data/audio/${season}-e${episodeIdx}-transcript.txt --output data/audio/${season}-e${episodeIdx}-styled-transcript.txt`,
		);
	}

	if (styledTranscript.trim().length === 0) {
		throw new CliError(`Styled transcript is empty: ${transcriptPath}`);
	}

	// ── Split into MiMo-friendly style + spoken parts ───────────────

	const { styleGuidance, spokenText } = splitStyledTranscript(styledTranscript);

	if (styleGuidance.length === 0) {
		throw new CliError(
			`Styled transcript has no TTS preamble: ${transcriptPath}\n` +
				"The first line must be performance direction (e.g. 'Make Storyteller sound warm…').",
		);
	}
	if (spokenText.length === 0) {
		throw new CliError(
			`Styled transcript has no spoken body after the preamble: ${transcriptPath}`,
		);
	}

	// ── Build request ───────────────────────────────────────────────

	const request = buildMimoTtsRequest({
		styleGuidance,
		spokenText,
		voice,
	});

	// Compute transcript hash from the full styled transcript for traceability.
	const transcriptHash = createHash("sha256")
		.update(styledTranscript)
		.digest("hex");

	// ── Call MiMo TTS with retry ────────────────────────────────────

	const response = await callMimoTtsWithRetry({
		request,
		apiKey: input.apiKey,
		apiBase: input.apiBase,
		fetchFn: input.fetchFn,
		sleepFn: input.sleepFn,
		maxRetries,
	});

	// ── Write WAV + metadata ────────────────────────────────────────

	await mimoGenerateWav({
		response,
		outputPath,
		season,
		episodeIdx,
		voice,
		transcriptHash,
		generatedAt: input.generatedAt,
	});

	return {
		outputPath,
		metaPath: mimoMetaPath(outputPath),
		voice,
		transcriptHash,
	};
}

// ── CLI entry point ────────────────────────────────────────────────

async function main() {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			transcript: { type: "string" },
			output: { type: "string" },
			season: { type: "string" },
			"episode-idx": { type: "string" },
			voice: { type: "string" },
			"max-retries": { type: "string" },
		},
		strict: true,
	});

	const rawIdx = values["episode-idx"] ?? String(DEFAULT_EPISODE_IDX);
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

	const voice = values.voice ?? DEFAULT_MIMO_VOICE;

	console.log(
		`Calling MiMo TTS (model=mimo-v2.5-tts, voice=${voice}, maxRetries=${maxRetries})…`,
	);

	let result: WinniMimoCliResult;
	try {
		result = await generateWinniMimoAudio({
			transcriptPath: values.transcript,
			outputPath: values.output,
			season: values.season,
			episodeIdx,
			voice,
			maxRetries,
		});
	} catch (err) {
		if (err instanceof MimoTtsAuthError) {
			throw new CliError(
				`${err.message}\nExport MIMO_API_KEY before running this command.`,
			);
		}
		if (err instanceof MimoTtsTransientError) {
			throw new CliError(
				`MiMo TTS transient failure after retries: ${err.message}`,
			);
		}
		if (err instanceof MimoTtsError) {
			throw new CliError(`MiMo TTS error: ${err.message}`);
		}
		throw err;
	}

	const [wavStat, metaStat] = await Promise.all([
		stat(result.outputPath),
		stat(result.metaPath),
	]);

	console.log(`✓ Wrote ${result.outputPath} (${wavStat.size} bytes)`);
	console.log(`✓ Wrote ${result.metaPath} (${metaStat.size} bytes)`);
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
