import { describe, expect, test } from "bun:test";
import {
	buildTtsRequest,
	DEFAULT_VOICE_CHOICES,
	type GeminiTtsRequest,
} from "./geminiTtsRequest";

const STYLED_TRANSCRIPT = [
	"Make Storyteller sound warm and gentle, like a parent reading a bedtime story. Make Character sound curious and bright, like a friendly young robot.",
	"",
	"Storyteller: [gently] In a cosy workshop filled with soft light, there lived a small blue robot named Pixel.",
	"Character: [excitedly] What a lovely day!",
	"Storyteller: [warmly] said Pixel in a soft, buzzy voice.",
].join("\n");

function voiceNameFor(
	request: GeminiTtsRequest,
	speaker: string,
): string | undefined {
	const configs =
		request.generationConfig.speechConfig.multiSpeakerVoiceConfig
			.speakerVoiceConfigs;
	return configs.find((svc) => svc.speaker === speaker)?.voiceConfig
		.prebuiltVoiceConfig.voiceName;
}

function defaultRequest(): GeminiTtsRequest {
	return buildTtsRequest({ styledTranscript: STYLED_TRANSCRIPT });
}

describe("buildTtsRequest", () => {
	test("uses model gemini-3.1-flash-tts-preview", () => {
		expect(defaultRequest().model).toBe("gemini-3.1-flash-tts-preview");
	});

	test("sets responseModalities to AUDIO", () => {
		expect(defaultRequest().generationConfig.responseModalities).toEqual([
			"AUDIO",
		]);
	});

	test("embeds styled transcript in contents[0].parts[0].text", () => {
		const req = defaultRequest();
		expect(req.contents).toHaveLength(1);
		expect(req.contents[0]?.parts).toHaveLength(1);
		expect(req.contents[0]?.parts[0]?.text).toBe(STYLED_TRANSCRIPT);
	});

	test("configures multi-speaker TTS with exactly two speakerVoiceConfigs", () => {
		const configs =
			defaultRequest().generationConfig.speechConfig.multiSpeakerVoiceConfig
				.speakerVoiceConfigs;
		expect(configs).toHaveLength(2);
	});

	test("default speaker names are Storyteller and Character", () => {
		const names =
			defaultRequest().generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs.map(
				(svc) => svc.speaker,
			);
		expect(names.sort()).toEqual(["Character", "Storyteller"]);
	});

	test("default voice choices match DEFAULT_VOICE_CHOICES", () => {
		const req = defaultRequest();
		expect(voiceNameFor(req, "Storyteller")).toBe(
			DEFAULT_VOICE_CHOICES.Storyteller,
		);
		expect(voiceNameFor(req, "Character")).toBe(
			DEFAULT_VOICE_CHOICES.Character,
		);
	});

	test("accepts custom voice choices", () => {
		const req = buildTtsRequest({
			styledTranscript: STYLED_TRANSCRIPT,
			voiceChoices: { Storyteller: "Sulafat", Character: "Leda" },
		});
		expect(voiceNameFor(req, "Storyteller")).toBe("Sulafat");
		expect(voiceNameFor(req, "Character")).toBe("Leda");
	});

	test("each speakerVoiceConfig has the expected shape", () => {
		for (const svc of defaultRequest().generationConfig.speechConfig
			.multiSpeakerVoiceConfig.speakerVoiceConfigs) {
			expect(typeof svc.speaker).toBe("string");
			expect(svc.speaker.length).toBeGreaterThan(0);
			expect(typeof svc.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
				"string",
			);
			expect(
				svc.voiceConfig.prebuiltVoiceConfig.voiceName.length,
			).toBeGreaterThan(0);
		}
	});
});
