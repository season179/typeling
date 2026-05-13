/**
 * Pure MiMo TTS request builder.
 * Does NOT read MIMO_API_KEY or call any network API.
 *
 * MiMo uses an OpenAI-compatible chat-completions endpoint where:
 * - Style guidance / voice description belongs in a `user` message
 * - Spoken text belongs in an `assistant` message
 *
 * Two models are supported:
 * - `mimo-v2.5-tts` — built-in voices; voice is selected via `audio.voice`.
 * - `mimo-v2.5-tts-voicedesign` — Director Mode; voice is described in the
 *   user message (Character / Scene / Guidance) and `audio.voice` is omitted.
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

/** Model id for the built-in-voice endpoint. */
export const MIMO_MODEL_BUILT_IN = "mimo-v2.5-tts" as const;

/** Model id for Director Mode / Voice Design (voice described in user msg). */
export const MIMO_MODEL_VOICE_DESIGN = "mimo-v2.5-tts-voicedesign" as const;

export type MimoModel =
	| typeof MIMO_MODEL_BUILT_IN
	| typeof MIMO_MODEL_VOICE_DESIGN;

// ── Types ──────────────────────────────────────────────────────────

export interface MimoAudioConfig {
	/**
	 * Built-in voice name. Required for `mimo-v2.5-tts`; omitted for
	 * `mimo-v2.5-tts-voicedesign` (Director Mode), where the voice is
	 * described in the user message instead.
	 */
	voice?: string;
	/** Audio format for the response. "wav" is suitable for local playback. */
	format: "wav" | "mp3" | "pcm";
}

export interface MimoMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface MimoTtsRequest {
	model: MimoModel;
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
	 * Built-in voice example: "Speak warmly and gently, like a parent reading
	 * a bedtime story."
	 *
	 * Director Mode example: free-form character/scene/guidance prose that
	 * describes the voice timbre, the situation, and the acting direction.
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
	 *
	 * Ignored when `model` is `mimo-v2.5-tts-voicedesign`; in Director Mode
	 * the voice is described in the user message.
	 */
	voice?: string;
	/**
	 * Audio format for the response. Defaults to "wav" for local playback.
	 */
	format?: "wav" | "mp3" | "pcm";
	/**
	 * Which MiMo model to target. Defaults to `mimo-v2.5-tts` (built-in voices).
	 * Use `mimo-v2.5-tts-voicedesign` for Director Mode.
	 */
	model?: MimoModel;
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
 * Build a MiMo chat-completions TTS request.
 *
 * The request:
 * - Places style guidance (or character/scene/guidance prose) in a `user` message
 * - Places spoken text in an `assistant` message
 * - For `mimo-v2.5-tts`: selects a built-in English voice through `audio.voice`
 * - For `mimo-v2.5-tts-voicedesign`: omits `audio.voice` (voice is described in user msg)
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

	const model = input.model ?? MIMO_MODEL_BUILT_IN;
	const format = input.format ?? "wav";

	const audio: MimoAudioConfig =
		model === MIMO_MODEL_VOICE_DESIGN
			? { format }
			: { voice: input.voice ?? DEFAULT_MIMO_VOICE, format };

	return {
		model,
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
		audio,
		stream: false,
	};
}
