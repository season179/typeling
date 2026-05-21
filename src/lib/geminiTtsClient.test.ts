import { describe, expect, it, mock } from "bun:test";
import {
	callGeminiTts,
	callGeminiTtsWithRetry,
	GeminiTtsAuthError,
	GeminiTtsError,
	GeminiTtsTransientError,
	validateAudioResponse,
} from "./geminiTtsClient";
import type { GeminiTtsRequest } from "./geminiTtsRequest";
import type { GeminiAudioResponse } from "./generateWav";

// ── Fixtures ───────────────────────────────────────────────────────

function audioResponse(base64 = "SGVsbG8="): GeminiAudioResponse {
	return {
		candidates: [
			{
				content: {
					parts: [
						{ inlineData: { mimeType: "audio/pcm;rate=24000", data: base64 } },
					],
				},
			},
		],
	};
}

function textResponse() {
	return {
		candidates: [
			{
				content: {
					parts: [{ text: "Sorry, I couldn't generate audio." }],
				},
			},
		],
	} as unknown as GeminiAudioResponse;
}

function emptyCandidatesResponse(): GeminiAudioResponse {
	return { candidates: [] };
}

function emptyPartsResponse(): GeminiAudioResponse {
	return { candidates: [{ content: { parts: [] } }] };
}

function emptyInlineDataResponse(): GeminiAudioResponse {
	return {
		candidates: [
			{
				content: {
					parts: [
						{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "" } },
					],
				},
			},
		],
	};
}

const SAMPLE_REQUEST: GeminiTtsRequest = {
	model: "gemini-3.1-flash-tts-preview",
	contents: [{ parts: [{ text: "Storyteller: Hello!\nCharacter: Hi!" }] }],
	generationConfig: {
		responseModalities: ["AUDIO"],
		speechConfig: {
			multiSpeakerVoiceConfig: {
				speakerVoiceConfigs: [
					{
						speaker: "Storyteller",
						voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
					},
					{
						speaker: "Character",
						voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
					},
				],
			},
		},
	},
};

function okFetch(response: GeminiAudioResponse): typeof fetch {
	return mock(
		async () => new Response(JSON.stringify(response), { status: 200 }),
	) as unknown as typeof fetch;
}

function httpErrorFetch(status: number, body = "error"): typeof fetch {
	return mock(
		async () => new Response(body, { status }),
	) as unknown as typeof fetch;
}

function networkErrorFetch(): typeof fetch {
	return mock(async () => {
		throw new TypeError("fetch failed");
	}) as unknown as typeof fetch;
}

// ── validateAudioResponse ──────────────────────────────────────────

describe("validateAudioResponse", () => {
	it("returns null for a valid audio response", () => {
		expect(validateAudioResponse(audioResponse())).toBeNull();
	});

	it("returns error for empty candidates", () => {
		expect(validateAudioResponse(emptyCandidatesResponse())).toContain(
			"no candidates",
		);
	});

	it("returns error for empty parts", () => {
		expect(validateAudioResponse(emptyPartsResponse())).toContain("no parts");
	});

	it("returns error for empty inlineData.data", () => {
		expect(validateAudioResponse(emptyInlineDataResponse())).toContain(
			"missing or empty",
		);
	});

	it("returns error for text-only (non-audio) response", () => {
		expect(validateAudioResponse(textResponse())).toContain(
			"text instead of audio",
		);
	});
});

// ── callGeminiTts ──────────────────────────────────────────────────

describe("callGeminiTts", () => {
	it("throws GeminiTtsAuthError when GEMINI_API_KEY is missing", async () => {
		await expect(
			callGeminiTts({
				request: SAMPLE_REQUEST,
				apiKey: "",
				fetchFn: okFetch(audioResponse()),
			}),
		).rejects.toThrow(GeminiTtsAuthError);
	});

	it("calls the correct Gemini API URL", async () => {
		const fetchFn = okFetch(audioResponse());
		await callGeminiTts({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
		});

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const [url] = calls[0] as [string, RequestInit];
		expect(url).toContain(
			"generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
		);
		expect(url).toContain("key=test-key");
	});

	it("sends the request body as JSON", async () => {
		const fetchFn = okFetch(audioResponse());
		await callGeminiTts({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
		});

		const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const [, init] = calls[0] as [string, RequestInit];
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual(SAMPLE_REQUEST);
	});

	it("returns parsed audio response on success", async () => {
		const expected = audioResponse();
		const result = await callGeminiTts({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn: okFetch(expected),
		});
		expect(result).toEqual(expected);
	});

	it("throws GeminiTtsTransientError on HTTP 429", async () => {
		await expect(
			callGeminiTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(429, "rate limited"),
			}),
		).rejects.toThrow(GeminiTtsTransientError);
	});

	it("throws GeminiTtsTransientError on HTTP 500", async () => {
		await expect(
			callGeminiTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(500, "server error"),
			}),
		).rejects.toThrow(GeminiTtsTransientError);
	});

	it("throws GeminiTtsError (non-transient) on HTTP 400", async () => {
		await expect(
			callGeminiTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(400, "bad request"),
			}),
		).rejects.toThrow(GeminiTtsError);

		await expect(
			callGeminiTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(400, "bad request"),
			}),
		).rejects.not.toThrow(GeminiTtsTransientError);
	});

	it("throws GeminiTtsTransientError on network error", async () => {
		await expect(
			callGeminiTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: networkErrorFetch(),
			}),
		).rejects.toThrow(GeminiTtsTransientError);
	});
});

// ── callGeminiTtsWithRetry ─────────────────────────────────────────

describe("callGeminiTtsWithRetry", () => {
	const noSleep = async () => {};

	it("succeeds on first attempt without retrying", async () => {
		const fetchFn = okFetch(audioResponse());
		const result = await callGeminiTtsWithRetry({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(result.candidates).toHaveLength(1);
	});

	it("retries when response contains text instead of audio", async () => {
		let callCount = 0;
		const fetchFn = mock(async () => {
			callCount++;
			if (callCount === 1) {
				return new Response(JSON.stringify(textResponse()), { status: 200 });
			}
			return new Response(JSON.stringify(audioResponse()), { status: 200 });
		}) as unknown as typeof fetch;

		const result = await callGeminiTtsWithRetry({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(result.candidates).toHaveLength(1);
	});

	it("retries on HTTP 429 then succeeds", async () => {
		let callCount = 0;
		const fetchFn = mock(async () => {
			callCount++;
			if (callCount === 1) {
				return new Response("rate limited", { status: 429 });
			}
			return new Response(JSON.stringify(audioResponse()), { status: 200 });
		}) as unknown as typeof fetch;

		const result = await callGeminiTtsWithRetry({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(result.candidates).toHaveLength(1);
	});

	it("does NOT retry on HTTP 401 (auth error)", async () => {
		const fetchFn = httpErrorFetch(401, "unauthorized");

		await expect(
			callGeminiTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "bad-key",
				fetchFn,
				sleepFn: noSleep,
			}),
		).rejects.toThrow(GeminiTtsError);

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("exhausts retries and throws GeminiTtsTransientError", async () => {
		const fetchFn = okFetch(emptyCandidatesResponse());

		await expect(
			callGeminiTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
				maxRetries: 2,
			}),
		).rejects.toThrow(GeminiTtsTransientError);

		// 1 initial + 2 retries = 3 total calls
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	it("respects maxRetries parameter", async () => {
		const fetchFn = okFetch(textResponse());

		await expect(
			callGeminiTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
				maxRetries: 0,
			}),
		).rejects.toThrow(GeminiTtsTransientError);

		// maxRetries=0 means 1 attempt, 0 retries
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("uses exponential backoff between retries", async () => {
		const sleepCalls: number[] = [];
		const sleepFn = async (ms: number) => {
			sleepCalls.push(ms);
		};

		const fetchFn = okFetch(textResponse());

		await expect(
			callGeminiTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn,
				sleepFn,
				maxRetries: 3,
				backoffMs: 500,
			}),
		).rejects.toThrow(GeminiTtsTransientError);

		// Backoff: 500, 1000, 2000
		expect(sleepCalls).toEqual([500, 1000, 2000]);
	});

	it("retries on network error then succeeds", async () => {
		let callCount = 0;
		const fetchFn = mock(async () => {
			callCount++;
			if (callCount === 1) {
				throw new TypeError("fetch failed");
			}
			return new Response(JSON.stringify(audioResponse()), { status: 200 });
		}) as unknown as typeof fetch;

		const result = await callGeminiTtsWithRetry({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(result.candidates).toHaveLength(1);
	});
});
