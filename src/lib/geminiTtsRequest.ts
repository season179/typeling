/**
 * Pure Gemini TTS request builder for gemini-3.1-flash-tts-preview.
 * Does NOT read GEMINI_API_KEY or call any network API.
 *
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */

/**
 * Default voice choices for chapter audio.
 * For the full voice list see the speech-generation docs linked above.
 */
export const DEFAULT_VOICE_CHOICES: Record<string, string> = {
	Storyteller: "Kore",
	Character: "Puck",
};

export interface PrebuiltVoiceConfig {
	voiceName: string;
}

export interface VoiceConfig {
	prebuiltVoiceConfig: PrebuiltVoiceConfig;
}

export interface SpeakerVoiceConfig {
	speaker: string;
	voiceConfig: VoiceConfig;
}

export interface MultiSpeakerVoiceConfig {
	speakerVoiceConfigs: SpeakerVoiceConfig[];
}

export interface SpeechConfig {
	multiSpeakerVoiceConfig: MultiSpeakerVoiceConfig;
}

export interface GenerationConfig {
	responseModalities: string[];
	speechConfig: SpeechConfig;
}

export interface GeminiTtsRequest {
	model: string;
	contents: Array<{
		parts: Array<{
			text: string;
		}>;
	}>;
	generationConfig: GenerationConfig;
}

export interface BuildTtsRequestInput {
	/** The approved styled transcript (preamble + speaker-labelled lines). */
	styledTranscript: string;
	/**
	 * Speaker → voice-name map. Defaults to {@link DEFAULT_VOICE_CHOICES}.
	 * Must contain exactly the speakers that appear in the transcript.
	 */
	voiceChoices?: Record<string, string>;
}

export function buildTtsRequest(input: BuildTtsRequestInput): GeminiTtsRequest {
	const voices = input.voiceChoices ?? DEFAULT_VOICE_CHOICES;

	const speakerVoiceConfigs: SpeakerVoiceConfig[] = Object.entries(voices).map(
		([speaker, voiceName]) => ({
			speaker,
			voiceConfig: {
				prebuiltVoiceConfig: { voiceName },
			},
		}),
	);

	return {
		model: "gemini-3.1-flash-tts-preview",
		contents: [
			{
				parts: [
					{
						text: input.styledTranscript,
					},
				],
			},
		],
		generationConfig: {
			responseModalities: ["AUDIO"],
			speechConfig: {
				multiSpeakerVoiceConfig: {
					speakerVoiceConfigs,
				},
			},
		},
	};
}
