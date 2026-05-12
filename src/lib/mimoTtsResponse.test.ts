import { describe, expect, test } from "bun:test";
import {
	extractMimoAudioData,
	type MimoTtsResponse,
	MimoTtsResponseError,
	validateMimoAudioResponse,
} from "./mimoTtsResponse";

// ── Fixtures ───────────────────────────────────────────────────────

function audioResponse(
	base64 = "SGVsbG8gV29ybGQ=",
	format = "wav",
): MimoTtsResponse {
	return {
		id: "chatcmpl-test-123",
		object: "chat.completion",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					audio: { data: base64, format },
				},
				finish_reason: "stop",
			},
		],
	};
}

function textOnlyResponse(): MimoTtsResponse {
	return {
		id: "chatcmpl-test-456",
		object: "chat.completion",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: "Sorry, I couldn't generate audio.",
				},
				finish_reason: "stop",
			},
		],
	};
}

function emptyChoicesResponse(): MimoTtsResponse {
	return { id: "chatcmpl-test-789", choices: [] };
}

function noMessageResponse(): MimoTtsResponse {
	return {
		id: "chatcmpl-test-abc",
		choices: [{ index: 0, finish_reason: "stop" }],
	};
}

function noAudioNoTextResponse(): MimoTtsResponse {
	return {
		id: "chatcmpl-test-def",
		choices: [
			{
				index: 0,
				message: { role: "assistant" },
				finish_reason: "stop",
			},
		],
	};
}

function emptyAudioDataResponse(): MimoTtsResponse {
	return {
		id: "chatcmpl-test-ghi",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					audio: { data: "", format: "wav" },
				},
				finish_reason: "stop",
			},
		],
	};
}

// ── extractMimoAudioData ───────────────────────────────────────────

describe("extractMimoAudioData", () => {
	test("extracts base64 audio data and format from a valid response", () => {
		const result = extractMimoAudioData(audioResponse());
		expect(result.data).toBe("SGVsbG8gV29ybGQ=");
		expect(result.format).toBe("wav");
	});

	test("defaults format to wav when not specified", () => {
		const response = audioResponse();
		if (response.choices[0]?.message?.audio) {
			delete (response.choices[0].message.audio as { format?: string }).format;
		}
		expect(extractMimoAudioData(response).format).toBe("wav");
	});

	test("extracts mp3 format when specified", () => {
		expect(extractMimoAudioData(audioResponse("SGVsbG8=", "mp3")).format).toBe(
			"mp3",
		);
	});

	test("throws on empty choices", () => {
		expect(() => extractMimoAudioData(emptyChoicesResponse())).toThrow(
			MimoTtsResponseError,
		);
		expect(() => extractMimoAudioData(emptyChoicesResponse())).toThrow(
			"no choices",
		);
	});

	test("throws on missing message", () => {
		expect(() => extractMimoAudioData(noMessageResponse())).toThrow(
			MimoTtsResponseError,
		);
		expect(() => extractMimoAudioData(noMessageResponse())).toThrow(
			"no message",
		);
	});

	test("throws on message with no audio and no text", () => {
		expect(() => extractMimoAudioData(noAudioNoTextResponse())).toThrow(
			MimoTtsResponseError,
		);
		expect(() => extractMimoAudioData(noAudioNoTextResponse())).toThrow(
			"no audio field",
		);
	});

	test("throws on text-only response (no audio)", () => {
		expect(() => extractMimoAudioData(textOnlyResponse())).toThrow(
			MimoTtsResponseError,
		);
		expect(() => extractMimoAudioData(textOnlyResponse())).toThrow(
			"text instead of audio",
		);
	});

	test("throws on empty audio data", () => {
		expect(() => extractMimoAudioData(emptyAudioDataResponse())).toThrow(
			MimoTtsResponseError,
		);
		expect(() => extractMimoAudioData(emptyAudioDataResponse())).toThrow(
			"missing or empty",
		);
	});
});

// ── validateMimoAudioResponse ──────────────────────────────────────

describe("validateMimoAudioResponse", () => {
	test("returns null for a valid audio response", () => {
		expect(validateMimoAudioResponse(audioResponse())).toBeNull();
	});

	test("returns error for empty choices", () => {
		expect(validateMimoAudioResponse(emptyChoicesResponse())).toContain(
			"no choices",
		);
	});

	test("returns error for missing message", () => {
		expect(validateMimoAudioResponse(noMessageResponse())).toContain(
			"no message",
		);
	});

	test("returns error for message with no audio and no text", () => {
		expect(validateMimoAudioResponse(noAudioNoTextResponse())).toContain(
			"no audio field",
		);
	});

	test("returns error for text-only response (no audio)", () => {
		expect(validateMimoAudioResponse(textOnlyResponse())).toContain(
			"text instead of audio",
		);
	});

	test("returns error for empty audio data", () => {
		expect(validateMimoAudioResponse(emptyAudioDataResponse())).toContain(
			"missing or empty",
		);
	});

	test("returns null for response with audio data", () => {
		expect(
			validateMimoAudioResponse(audioResponse("aGVsbG8gd29ybGQ=")),
		).toBeNull();
	});
});
