import { describe, expect, it, mock } from "bun:test";
import {
	callMimoTts,
	callMimoTtsWithRetry,
	DEFAULT_MIMO_API_BASE,
	MimoTtsAuthError,
	MimoTtsError,
	MimoTtsTransientError,
} from "./mimoTtsClient";
import type { MimoTtsRequest } from "./mimoTtsRequest";
import type { MimoTtsResponse } from "./mimoTtsResponse";

// ── Fixtures ───────────────────────────────────────────────────────

function audioResponse(base64 = "SGVsbG8="): MimoTtsResponse {
	return {
		id: "chatcmpl-test",
		object: "chat.completion",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					audio: { data: base64, format: "wav" },
				},
				finish_reason: "stop",
			},
		],
	};
}

function textOnlyResponse(): MimoTtsResponse {
	return {
		id: "chatcmpl-test-text",
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
	return { id: "chatcmpl-empty", choices: [] };
}

const SAMPLE_REQUEST: MimoTtsRequest = {
	model: "mimo-v2.5-tts",
	messages: [
		{ role: "user", content: "Speak warmly." },
		{ role: "assistant", content: "Hello world." },
	],
	audio: { voice: "Mia", format: "wav" },
	stream: false,
};

function okFetch(response: MimoTtsResponse): typeof fetch {
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

function badJsonFetch(): typeof fetch {
	return mock(
		async () => new Response("not json {", { status: 200 }),
	) as unknown as typeof fetch;
}

// ── callMimoTts ────────────────────────────────────────────────────

describe("callMimoTts", () => {
	it("throws MimoTtsAuthError when MIMO_API_KEY is missing", async () => {
		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "",
				fetchFn: okFetch(audioResponse()),
			}),
		).rejects.toThrow(MimoTtsAuthError);
	});

	it("calls the chat-completions endpoint at the default base URL", async () => {
		const fetchFn = okFetch(audioResponse());
		await callMimoTts({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
		});

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const [url] = calls[0] as [string, RequestInit];
		expect(url).toBe(`${DEFAULT_MIMO_API_BASE}/chat/completions`);
	});

	it("honours apiBase override and trims trailing slash", async () => {
		const fetchFn = okFetch(audioResponse());
		await callMimoTts({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			apiBase: "https://example.test/v1/",
			fetchFn,
		});

		const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
		const [url] = calls[0] as [string, RequestInit];
		expect(url).toBe("https://example.test/v1/chat/completions");
	});

	it("sends Bearer auth and JSON body", async () => {
		const fetchFn = okFetch(audioResponse());
		await callMimoTts({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
		});

		const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
		const [, init] = calls[0] as [string, RequestInit];
		expect(init.method).toBe("POST");
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer test-key");
		expect(headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(init.body as string)).toEqual(SAMPLE_REQUEST);
	});

	it("returns parsed audio response on success", async () => {
		const expected = audioResponse();
		const result = await callMimoTts({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn: okFetch(expected),
		});
		expect(result).toEqual(expected);
	});

	it("throws MimoTtsTransientError on HTTP 429", async () => {
		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(429, "rate limited"),
			}),
		).rejects.toThrow(MimoTtsTransientError);
	});

	it("throws MimoTtsTransientError on HTTP 500", async () => {
		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(500, "server error"),
			}),
		).rejects.toThrow(MimoTtsTransientError);
	});

	it("throws MimoTtsError (non-transient) on HTTP 400", async () => {
		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(400, "bad request"),
			}),
		).rejects.toThrow(MimoTtsError);

		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(400, "bad request"),
			}),
		).rejects.not.toThrow(MimoTtsTransientError);
	});

	it("throws MimoTtsError (non-transient) on HTTP 401", async () => {
		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(401, "unauthorized"),
			}),
		).rejects.toThrow(MimoTtsError);

		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(401, "unauthorized"),
			}),
		).rejects.not.toThrow(MimoTtsTransientError);
	});

	it("throws MimoTtsError (non-transient) on HTTP 403", async () => {
		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(403, "forbidden"),
			}),
		).rejects.toThrow(MimoTtsError);

		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: httpErrorFetch(403, "forbidden"),
			}),
		).rejects.not.toThrow(MimoTtsTransientError);
	});

	it("throws MimoTtsTransientError on network error", async () => {
		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: networkErrorFetch(),
			}),
		).rejects.toThrow(MimoTtsTransientError);
	});

	it("throws MimoTtsTransientError on malformed JSON", async () => {
		await expect(
			callMimoTts({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn: badJsonFetch(),
			}),
		).rejects.toThrow(MimoTtsTransientError);
	});
});

// ── callMimoTtsWithRetry ───────────────────────────────────────────

describe("callMimoTtsWithRetry", () => {
	const noSleep = async () => {};

	it("succeeds on first attempt without retrying", async () => {
		const fetchFn = okFetch(audioResponse());
		const result = await callMimoTtsWithRetry({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(result.choices).toHaveLength(1);
	});

	it("retries when response contains text instead of audio", async () => {
		let callCount = 0;
		const fetchFn = mock(async () => {
			callCount++;
			if (callCount === 1) {
				return new Response(JSON.stringify(textOnlyResponse()), {
					status: 200,
				});
			}
			return new Response(JSON.stringify(audioResponse()), { status: 200 });
		}) as unknown as typeof fetch;

		const result = await callMimoTtsWithRetry({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(result.choices).toHaveLength(1);
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

		const result = await callMimoTtsWithRetry({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(result.choices).toHaveLength(1);
	});

	it("retries on HTTP 503 then succeeds", async () => {
		let callCount = 0;
		const fetchFn = mock(async () => {
			callCount++;
			if (callCount === 1) {
				return new Response("unavailable", { status: 503 });
			}
			return new Response(JSON.stringify(audioResponse()), { status: 200 });
		}) as unknown as typeof fetch;

		const result = await callMimoTtsWithRetry({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(result.choices).toHaveLength(1);
	});

	it("does NOT retry on HTTP 401 (auth error)", async () => {
		const fetchFn = httpErrorFetch(401, "unauthorized");

		await expect(
			callMimoTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "bad-key",
				fetchFn,
				sleepFn: noSleep,
			}),
		).rejects.toThrow(MimoTtsError);

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("does NOT retry on HTTP 403", async () => {
		const fetchFn = httpErrorFetch(403, "forbidden");

		await expect(
			callMimoTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
			}),
		).rejects.toThrow(MimoTtsError);

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("does NOT retry on HTTP 400 (bad request)", async () => {
		const fetchFn = httpErrorFetch(400, "bad request");

		await expect(
			callMimoTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
			}),
		).rejects.toThrow(MimoTtsError);

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("exhausts retries and throws MimoTtsTransientError", async () => {
		const fetchFn = okFetch(emptyChoicesResponse());

		await expect(
			callMimoTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
				maxRetries: 2,
			}),
		).rejects.toThrow(MimoTtsTransientError);

		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	it("respects maxRetries=0 (one attempt only)", async () => {
		const fetchFn = okFetch(textOnlyResponse());

		await expect(
			callMimoTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
				maxRetries: 0,
			}),
		).rejects.toThrow(MimoTtsTransientError);

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("uses exponential backoff between retries", async () => {
		const sleepCalls: number[] = [];
		const sleepFn = async (ms: number) => {
			sleepCalls.push(ms);
		};

		const fetchFn = okFetch(textOnlyResponse());

		await expect(
			callMimoTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "test-key",
				fetchFn,
				sleepFn,
				maxRetries: 3,
				backoffMs: 500,
			}),
		).rejects.toThrow(MimoTtsTransientError);

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

		const result = await callMimoTtsWithRetry({
			request: SAMPLE_REQUEST,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(result.choices).toHaveLength(1);
	});

	it("throws MimoTtsAuthError immediately on missing key (no retries)", async () => {
		const fetchFn = okFetch(audioResponse());

		await expect(
			callMimoTtsWithRetry({
				request: SAMPLE_REQUEST,
				apiKey: "",
				fetchFn,
				sleepFn: noSleep,
				maxRetries: 5,
			}),
		).rejects.toThrow(MimoTtsAuthError);

		expect(fetchFn).toHaveBeenCalledTimes(0);
	});
});
