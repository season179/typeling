/**
 * Pure MiMo TTS request builder for mimo-v2.5-tts.
 * Does NOT read MIMO_API_KEY or call any network API.
 *
 * MiMo uses an OpenAI-compatible chat-completions endpoint where:
 * - Style guidance belongs in a `user` message
 * - Spoken text belongs in an `assistant` message
 * - Voice selection is via the `audio` request object
 *
 * @see https://platform.mimoai.com/docs (Xiaomi MiMo TTS documentation)
 */

// ── Constants ──────────────────────────────────────────────────────

/**
 * Built-in English voices for MiMo TTS.
 * `mimo_default` varies by deployed cluster; these are explicit choices.
 */
export const MIMO_BUILT_IN_VOICES = ["Mia", "Chloe", "Milo", "Dean"] as const;

export type MimoBuiltInVoice = (typeof MIMO_BUILT_IN_VOICES)[number];

/** Default voice for the first experiment. */
export const DEFAULT_MIMO_VOICE: MimoBuiltInVoice = "Mia";

// ── Types ──────────────────────────────────────────────────────────

export interface MimoAudioConfig {
	voice: string;
	/** Audio format for the response. "wav" is suitable for local playback. */
	format: "wav" | "mp3" | "pcm";
}

export interface MimoMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface MimoTtsRequest {
	model: string;
	messages: MimoMessage[];
	audio: MimoAudioConfig;
	/** Non-streaming for the first experiment (streaming is not yet available). */
	stream: false;
}

export interface BuildMimoTtsRequestInput {
	/**
	 * Style guidance for how the text should be spoken.
	 * Placed in the `user` message so MiMo receives performance direction
	 * without speaking the instructions aloud.
	 *
	 * Example: "Speak warmly and gently, like a parent reading a bedtime story."
	 */
	styleGuidance: string;
	/**
	 * The text to synthesize as speech.
	 * Placed in the `assistant` message.
	 */
	spokenText: string;
	/**
	 * Built-in English voice name. Defaults to {@link DEFAULT_MIMO_VOICE}.
	 * Valid values: Mia, Chloe, Milo, Dean.
	 */
	voice?: string;
	/**
	 * Audio format for the response. Defaults to "wav" for local playback.
	 */
	format?: "wav" | "mp3" | "pcm";
}

// ── Errors ─────────────────────────────────────────────────────────

export class MimoTtsRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MimoTtsRequestError";
	}
}

// ── Builder ────────────────────────────────────────────────────────

/**
 * Build a MiMo chat-completions TTS request for mimo-v2.5-tts.
 *
 * The request:
 * - Places style guidance in a `user` message
 * - Places spoken text in an `assistant` message
 * - Selects a built-in English voice through the `audio` object
 * - Requests WAV format suitable for local playback
 *
 * @throws {MimoTtsRequestError} when inputs are invalid.
 */
export function buildMimoTtsRequest(
	input: BuildMimoTtsRequestInput,
): MimoTtsRequest {
	// Validate required fields
	if (input.styleGuidance.trim().length === 0) {
		throw new MimoTtsRequestError(
			"styleGuidance is required and must not be empty.",
		);
	}
	if (input.spokenText.trim().length === 0) {
		throw new MimoTtsRequestError(
			"spokenText is required and must not be empty.",
		);
	}

	const voice = input.voice ?? DEFAULT_MIMO_VOICE;
	const format = input.format ?? "wav";

	return {
		model: "mimo-v2.5-tts",
		messages: [
			{
				role: "user",
				content: input.styleGuidance,
			},
			{
				role: "assistant",
				content: input.spokenText,
			},
		],
		audio: {
			voice,
			format,
		},
		stream: false,
	};
}
