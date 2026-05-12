/**
 * Generate a WAV file from a MiMo TTS fixture response.
 *
 * MiMo returns base64-encoded WAV audio (already a WAV container),
 * unlike Gemini which returns raw PCM that needs wrapping.
 *
 * This module writes the decoded WAV bytes directly to disk
 * without double-wrapping them as PCM.
 *
 * Does NOT call any network API.
 *
 * @see https://platform.mimoai.com/docs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	extractMimoAudioData,
	type MimoTtsResponse,
	MimoTtsResponseError,
} from "./mimoTtsResponse";

// ── Types ──────────────────────────────────────────────────────────

/** Metadata written alongside the WAV file for MiMo-generated audio. */
export interface MimoWavMetadata {
	source_season: string;
	episode_idx: number;
	provider: string;
	model: string;
	selected_voice: string;
	audio_format: string;
	transcript_hash: string;
	generated_at: string; // ISO-8601
}

// ── Input ──────────────────────────────────────────────────────────

export interface MimoGenerateWavInput {
	/** A MiMo-style chat-completion response (or fixture mimicking it). */
	response: MimoTtsResponse;
	/** Where to write the .wav file. */
	outputPath: string;
	/** Metadata fields. */
	season: string;
	episodeIdx: number;
	voice: string;
	/** SHA-256 hex digest of the styled transcript text. */
	transcriptHash: string;
	/** ISO-8601 timestamp for the metadata. */
	generatedAt?: string;
}

// ── Errors ─────────────────────────────────────────────────────────

export class MimoGenerateWavError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MimoGenerateWavError";
	}
}

// ── Constants ──────────────────────────────────────────────────────

const MODEL = "mimo-v2.5-tts";
const PROVIDER = "mimo";

// ── Validation ─────────────────────────────────────────────────────

/**
 * Check whether decoded bytes look like a valid WAV file.
 * Returns null if valid, or an error message.
 */
function validateWavBytes(bytes: Uint8Array): string | null {
	if (bytes.length === 0) {
		return "Decoded audio data is empty.";
	}
	if (bytes.length < 44) {
		return `Decoded audio data is too small to be a valid WAV (${bytes.length} bytes, need at least 44).`;
	}
	const header = new TextDecoder().decode(bytes.slice(0, 4));
	if (header !== "RIFF") {
		return "Decoded audio data does not start with RIFF header — not a valid WAV file.";
	}
	return null;
}

// ── Path helpers ───────────────────────────────────────────────────

/**
 * Derive the metadata output path from the WAV output path.
 * e.g. "data/audio/winni-s1-e0.wav" → "data/audio/winni-s1-e0.meta.json"
 */
export function mimoMetaPath(wavPath: string): string {
	return wavPath.replace(/\.wav$/, ".meta.json");
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Write WAV + metadata files from a MiMo-style fixture response.
 *
 * MiMo returns base64-encoded WAV audio — this function decodes and
 * writes the bytes directly without wrapping them as raw PCM.
 *
 * Does NOT call any network API.
 */
export async function mimoGenerateWav(
	input: MimoGenerateWavInput,
): Promise<void> {
	// Extract audio data from the MiMo response
	let extracted: { data: string; format: string };
	try {
		extracted = extractMimoAudioData(input.response);
	} catch (err) {
		if (err instanceof MimoTtsResponseError) {
			throw new MimoGenerateWavError(
				`Failed to extract MiMo audio: ${err.message}`,
			);
		}
		throw err;
	}

	// Decode base64 → raw bytes (already WAV format for MiMo)
	const wavBytes = new Uint8Array(Buffer.from(extracted.data, "base64"));

	// Validate the decoded bytes are a valid WAV
	const validationError = validateWavBytes(wavBytes);
	if (validationError) {
		throw new MimoGenerateWavError(validationError);
	}

	// Write WAV directly — no PCM wrapping
	await mkdir(dirname(input.outputPath), { recursive: true });
	await Bun.write(input.outputPath, wavBytes);

	// Write metadata
	const metadata: MimoWavMetadata = {
		source_season: input.season,
		episode_idx: input.episodeIdx,
		provider: PROVIDER,
		model: MODEL,
		selected_voice: input.voice,
		audio_format: extracted.format,
		transcript_hash: input.transcriptHash,
		generated_at: input.generatedAt ?? new Date().toISOString(),
	};

	const metaFilePath = mimoMetaPath(input.outputPath);
	await writeFile(metaFilePath, JSON.stringify(metadata, null, 2), "utf-8");
}
