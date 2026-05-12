import { describe, expect, test } from "bun:test";
import {
	buildMimoTtsRequest,
	DEFAULT_MIMO_VOICE,
	MIMO_BUILT_IN_VOICES,
	type MimoTtsRequest,
	MimoTtsRequestError,
} from "./mimoTtsRequest";

const STYLE_GUIDANCE =
	"Speak warmly and gently, like a parent reading a bedtime story to a young child.";

const SPOKEN_TEXT = [
	"Once upon a time, in a cosy workshop filled with soft light, there lived a small blue robot named Pixel.",
	"Pixel loved to explore and discover new things every day.",
].join("\n");

function defaultRequest(): MimoTtsRequest {
	return buildMimoTtsRequest({
		styleGuidance: STYLE_GUIDANCE,
		spokenText: SPOKEN_TEXT,
	});
}

describe("buildMimoTtsRequest", () => {
	test("uses model mimo-v2.5-tts", () => {
		expect(defaultRequest().model).toBe("mimo-v2.5-tts");
	});

	test("places style guidance in a user message", () => {
		const req = defaultRequest();
		expect(req.messages).toHaveLength(2);
		expect(req.messages[0]?.role).toBe("user");
		expect(req.messages[0]?.content).toBe(STYLE_GUIDANCE);
	});

	test("places spoken text in an assistant message", () => {
		const req = defaultRequest();
		expect(req.messages[1]?.role).toBe("assistant");
		expect(req.messages[1]?.content).toBe(SPOKEN_TEXT);
	});

	test("selects default built-in English voice", () => {
		expect(defaultRequest().audio.voice).toBe(DEFAULT_MIMO_VOICE);
	});

	test("defaults to wav format for local playback", () => {
		const req = defaultRequest();
		expect(req.audio.format).toBe("wav");
	});

	test("sets stream to false (non-streaming)", () => {
		const req = defaultRequest();
		expect(req.stream).toBe(false);
	});

	test("accepts custom voice", () => {
		const req = buildMimoTtsRequest({
			styleGuidance: STYLE_GUIDANCE,
			spokenText: SPOKEN_TEXT,
			voice: "Chloe",
		});
		expect(req.audio.voice).toBe("Chloe");
	});

	test("accepts custom format", () => {
		const req = buildMimoTtsRequest({
			styleGuidance: STYLE_GUIDANCE,
			spokenText: SPOKEN_TEXT,
			format: "mp3",
		});
		expect(req.audio.format).toBe("mp3");
	});

	test("each built-in voice is accepted without error", () => {
		for (const voice of MIMO_BUILT_IN_VOICES) {
			const req = buildMimoTtsRequest({
				styleGuidance: STYLE_GUIDANCE,
				spokenText: SPOKEN_TEXT,
				voice,
			});
			expect(req.audio.voice).toBe(voice);
		}
	});

	test("request has the expected shape", () => {
		const req = defaultRequest();
		// Top-level keys
		expect(typeof req.model).toBe("string");
		expect(Array.isArray(req.messages)).toBe(true);
		expect(typeof req.audio).toBe("object");
		expect(req.stream).toBe(false);

		// Messages shape
		for (const msg of req.messages) {
			expect(["user", "assistant"]).toContain(msg.role);
			expect(typeof msg.content).toBe("string");
			expect(msg.content.length).toBeGreaterThan(0);
		}

		// Audio shape
		expect(typeof req.audio.voice).toBe("string");
		expect(req.audio.voice.length).toBeGreaterThan(0);
		expect(["wav", "mp3", "pcm"]).toContain(req.audio.format);
	});
});

describe("buildMimoTtsRequest — error cases", () => {
	test("throws MimoTtsRequestError when styleGuidance is empty", () => {
		expect(() =>
			buildMimoTtsRequest({
				styleGuidance: "",
				spokenText: SPOKEN_TEXT,
			}),
		).toThrow(MimoTtsRequestError);
	});

	test("throws MimoTtsRequestError when spokenText is empty", () => {
		expect(() =>
			buildMimoTtsRequest({
				styleGuidance: STYLE_GUIDANCE,
				spokenText: "",
			}),
		).toThrow(MimoTtsRequestError);
	});

	test("throws MimoTtsRequestError when styleGuidance is whitespace-only", () => {
		expect(() =>
			buildMimoTtsRequest({
				styleGuidance: "   ",
				spokenText: SPOKEN_TEXT,
			}),
		).toThrow(MimoTtsRequestError);
	});

	test("throws MimoTtsRequestError when spokenText is whitespace-only", () => {
		expect(() =>
			buildMimoTtsRequest({
				styleGuidance: STYLE_GUIDANCE,
				spokenText: "   ",
			}),
		).toThrow(MimoTtsRequestError);
	});
});
