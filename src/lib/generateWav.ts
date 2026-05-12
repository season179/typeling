/**
 * Generate a WAV file from a Gemini TTS fixture response.
 *
 * Isolates local audio artifact writing from the real Gemini API call.
 * All inputs come from fixtures — no network, no secrets.
 *
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_VOICE_CHOICES } from "./geminiTtsRequest";
import { writeWav } from "./wav";

// ── Types ────────────────────────────────────────────────────────

/** The shape Gemini returns for an audio generation response. */
export interface GeminiAudioPart {
	inlineData: {
		mimeType: string;
		data: string; // base64-encoded PCM
	};
}

export interface GeminiAudioContent {
	parts: GeminiAudioPart[];
}

export interface GeminiAudioCandidate {
	content: GeminiAudioContent;
}

export interface GeminiAudioResponse {
	candidates: GeminiAudioCandidate[];
}

/** Metadata written alongside the WAV file. */
export interface WavMetadata {
	source_season: string;
	episode_idx: number;
	model: string;
	selected_voices: Record<string, string>;
	transcript_hash: string;
	generated_at: string; // ISO-8601
}

// ── Input ─────────────────────────────────────────────────────────

export interface GenerateWavInput {
	/** A Gemini-style audio response (or fixture mimicking it). */
	response: GeminiAudioResponse;
	/** Where to write the .wav file. */
	outputPath: string;
	/** Metadata fields. */
	season: string;
	episodeIdx: number;
	model: string;
	voiceChoices?: Record<string, string>;
	/** SHA-256 hex digest of the styled transcript text. */
	transcriptHash: string;
	/** ISO-8601 timestamp for the metadata. */
	generatedAt?: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class GenerateWavError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GenerateWavError";
	}
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Extract the base64 PCM data from a Gemini-style response.
 * Throws {@link GenerateWavError} when the data is missing or malformed.
 */
export function extractAudioData(response: GeminiAudioResponse): string {
	const part = response.candidates?.[0]?.content?.parts?.[0];
	if (!part) {
		throw new GenerateWavError(
			"Audio response has no candidates[0].content.parts[0].",
		);
	}
	const inline = part.inlineData;
	if (!inline) {
		throw new GenerateWavError("Audio part has no inlineData field.");
	}
	if (!inline.data) {
		throw new GenerateWavError("Audio inlineData.data is missing or empty.");
	}
	return inline.data;
}

/**
 * Derive the metadata output path from the WAV output path.
 * e.g. "data/audio/zack-s1-e0.wav" → "data/audio/zack-s1-e0.meta.json"
 */
export function metaPath(wavPath: string): string {
	return wavPath.replace(/\.wav$/, ".meta.json");
}

/**
 * Write WAV + metadata files from a Gemini-style fixture response.
 *
 * Does NOT call any network API.
 */
export async function generateWav(input: GenerateWavInput): Promise<void> {
	const base64Data = extractAudioData(input.response);

	// Decode base64 → raw PCM bytes
	let pcmData: Uint8Array;
	try {
		const raw = Buffer.from(base64Data, "base64");
		if (raw.length === 0) {
			throw new GenerateWavError("Decoded PCM data is empty.");
		}
		pcmData = new Uint8Array(raw);
	} catch (err) {
		if (err instanceof GenerateWavError) throw err;
		throw new GenerateWavError(
			`Failed to decode base64 audio data: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Write WAV
	await mkdir(dirname(input.outputPath), { recursive: true });
	await writeWav(input.outputPath, pcmData);

	// Write metadata
	const metadata: WavMetadata = {
		source_season: input.season,
		episode_idx: input.episodeIdx,
		model: input.model,
		selected_voices: input.voiceChoices ?? DEFAULT_VOICE_CHOICES,
		transcript_hash: input.transcriptHash,
		generated_at: input.generatedAt ?? new Date().toISOString(),
	};

	const metaFilePath = metaPath(input.outputPath);
	await writeFile(metaFilePath, JSON.stringify(metadata, null, 2), "utf-8");
}
