/**
 * Pure MiMo TTS response extractor for mimo-v2.5-tts.
 * Does NOT call any network API.
 *
 * MiMo returns an OpenAI-compatible chat-completion response where
 * audio data is base64-encoded in `choices[0].message.audio.data`.
 *
 * @see https://platform.mimoai.com/docs (Xiaomi MiMo TTS documentation)
 */

// ── Types ──────────────────────────────────────────────────────────

/** The audio object inside a MiMo chat-completion message. */
export interface MimoAudioData {
	/** Base64-encoded audio bytes. */
	data: string;
	/** Audio format declared by the provider (e.g. "wav", "mp3", "pcm"). */
	format?: string;
}

/** The message inside a MiMo chat-completion choice. */
export interface MimoResponseMessage {
	role?: string;
	content?: string;
	audio?: MimoAudioData;
}

/** A single choice in a MiMo chat-completion response. */
export interface MimoResponseChoice {
	index?: number;
	message?: MimoResponseMessage;
	finish_reason?: string;
}

/** The shape of a MiMo chat-completion TTS response. */
export interface MimoTtsResponse {
	id?: string;
	object?: string;
	choices: MimoResponseChoice[];
}

// ── Errors ─────────────────────────────────────────────────────────

export class MimoTtsResponseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MimoTtsResponseError";
	}
}

// ── Extraction ─────────────────────────────────────────────────────

export interface ExtractedMimoAudio {
	/** Base64-encoded audio data. */
	data: string;
	/** Audio format declared by the provider. */
	format: string;
}

/**
 * Extract base64 audio from a MiMo chat-completion TTS response.
 *
 * Reads `choices[0].message.audio.data` and `choices[0].message.audio.format`.
 *
 * @throws {MimoTtsResponseError} when audio data is missing, empty, or malformed.
 */
export function extractMimoAudioData(
	response: MimoTtsResponse,
): ExtractedMimoAudio {
	const error = validateMimoAudioResponse(response);
	if (error) {
		throw new MimoTtsResponseError(`MiMo TTS ${error}`);
	}

	const audio = response.choices[0]?.message?.audio;
	if (!audio) {
		throw new MimoTtsResponseError("MiMo TTS has no audio data.");
	}

	return {
		data: audio.data,
		format: audio.format ?? "wav",
	};
}

// ── Validation helper (mirrors Gemini's validateAudioResponse) ─────

/**
 * Check whether a MiMo-style response contains valid audio data.
 * Returns null if valid, or an error message describing what is missing.
 *
 * This is a non-throwing alternative to {@link extractMimoAudioData}
 * for use in retry logic.
 */
export function validateMimoAudioResponse(
	response: MimoTtsResponse,
): string | null {
	if (!response.choices || response.choices.length === 0) {
		return "Response has no choices.";
	}

	const choice = response.choices[0];
	if (!choice) {
		return "Response choices[0] is undefined.";
	}

	const message = choice.message;
	if (!message) {
		return "Response choice has no message.";
	}

	const audio = message.audio;
	if (!audio) {
		// Check if there's text content instead of audio (transient non-audio response)
		if (message.content && typeof message.content === "string") {
			return "Response contains text instead of audio (transient non-audio response).";
		}
		return "Response message has no audio field.";
	}

	if (!audio.data) {
		return "Response audio.data is missing or empty.";
	}

	if (audio.data.trim().length === 0) {
		return "Response audio.data is empty.";
	}

	return null; // valid
}
