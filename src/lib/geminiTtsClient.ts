/**
 * Real Gemini TTS API client for gemini-3.1-flash-tts-preview.
 *
 * Calls the Gemini generateContent endpoint, validates that the response
 * contains audio data, and retries transient failures (missing audio,
 * non-audio responses, HTTP 429/5xx).
 *
 * Uses GEMINI_API_KEY from the environment. Fails clearly when it is missing.
 *
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */

import type { GeminiTtsRequest } from "./geminiTtsRequest";
import type { GeminiAudioResponse } from "./generateWav";

// ── Constants ──────────────────────────────────────────────────────

const GEMINI_API_BASE =
	"https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1_000; // doubles each retry

// ── Errors ─────────────────────────────────────────────────────────

export class GeminiTtsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GeminiTtsError";
	}
}

export class GeminiTtsAuthError extends GeminiTtsError {
	constructor(message: string) {
		super(message);
		this.name = "GeminiTtsAuthError";
	}
}

export class GeminiTtsTransientError extends GeminiTtsError {
	constructor(message: string) {
		super(message);
		this.name = "GeminiTtsTransientError";
	}
}

// ── Input ──────────────────────────────────────────────────────────

export interface CallGeminiTtsInput {
	/** A fully-built request from buildTtsRequest(). */
	request: GeminiTtsRequest;
	/**
	 * Override the API key. Defaults to process.env.GEMINI_API_KEY.
	 * Pass explicitly to make the dependency visible and testable.
	 */
	apiKey?: string;
	/**
	 * Override the fetch function for testing.
	 * Defaults to globalThis.fetch.
	 */
	fetchFn?: typeof fetch;
}

export interface CallGeminiTtsWithRetryInput extends CallGeminiTtsInput {
	/** Maximum number of retry attempts (default: 3). */
	maxRetries?: number;
	/** Initial backoff in milliseconds (default: 1000, doubles each retry). */
	backoffMs?: number;
	/** Override setTimeout for testing. */
	sleepFn?: (ms: number) => Promise<void>;
}

// ── Audio validation ───────────────────────────────────────────────

/**
 * Check whether a Gemini-style response contains valid audio data.
 * Returns null if valid, or an error message describing what is missing.
 */
export function validateAudioResponse(
	response: GeminiAudioResponse,
): string | null {
	const candidates = response.candidates;
	if (!candidates || candidates.length === 0) {
		return "Response has no candidates.";
	}

	const content = candidates[0]?.content;
	if (!content) {
		return "Response candidate has no content.";
	}

	const parts = content.parts;
	if (!parts || parts.length === 0) {
		return "Response content has no parts.";
	}

	const part = parts[0];
	if (!part) {
		return "Response content first part is undefined.";
	}

	// Check for inlineData (audio) vs text (non-audio transient)
	if (!("inlineData" in part) || !part.inlineData) {
		const hasText =
			"text" in part && typeof (part as { text?: string }).text === "string";
		if (hasText) {
			return "Response contains text instead of audio (transient non-audio response).";
		}
		return "Response part has no inlineData.";
	}

	if (!part.inlineData.data) {
		return "Response inlineData.data is missing or empty.";
	}

	return null; // valid
}

// ── Core call (single attempt) ─────────────────────────────────────

/**
 * Make a single attempt to call the Gemini TTS API.
 * Does NOT retry — use {@link callGeminiTtsWithRetry} for retry logic.
 */
export async function callGeminiTts(
	input: CallGeminiTtsInput,
): Promise<GeminiAudioResponse> {
	const apiKey = input.apiKey ?? process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new GeminiTtsAuthError(
			"GEMINI_API_KEY is not set. Export it or pass --api-key.",
		);
	}

	const model = input.request.model;
	const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

	const fetchFn = input.fetchFn ?? globalThis.fetch;

	let response: Response;
	try {
		response = await fetchFn(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input.request),
		});
	} catch (err) {
		throw new GeminiTtsTransientError(
			`Network error calling Gemini TTS: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!response.ok) {
		const body = await response.text().catch(() => "(unreadable)");
		const isRetryable = response.status === 429 || response.status >= 500;
		const ErrClass = isRetryable ? GeminiTtsTransientError : GeminiTtsError;
		throw new ErrClass(
			`Gemini TTS HTTP ${response.status}: ${body.slice(0, 500)}`,
		);
	}

	let data: GeminiAudioResponse;
	try {
		data = (await response.json()) as GeminiAudioResponse;
	} catch (err) {
		throw new GeminiTtsTransientError(
			`Failed to parse Gemini TTS response as JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	return data;
}

// ── Retry wrapper ──────────────────────────────────────────────────

/**
 * Call Gemini TTS with retry logic for transient failures.
 *
 * Retries when:
 * - Response has no audio data (text instead of audio, empty candidates, etc.)
 * - HTTP 429 (rate limit) or 5xx (server error)
 * - Network errors
 *
 * Does NOT retry on HTTP 400/401/403 (these are permanent failures).
 */
export async function callGeminiTtsWithRetry(
	input: CallGeminiTtsWithRetryInput,
): Promise<GeminiAudioResponse> {
	const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
	const initialBackoff = input.backoffMs ?? DEFAULT_BACKOFF_MS;
	const sleepFn =
		input.sleepFn ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		if (attempt > 0) {
			const backoff = initialBackoff * 2 ** (attempt - 1);
			console.error(
				`Retry ${attempt}/${maxRetries} after ${backoff}ms backoff…`,
			);
			await sleepFn(backoff);
		}

		try {
			const response = await callGeminiTts(input);

			// Validate audio content
			const validationError = validateAudioResponse(response);
			if (validationError) {
				// Transient: response came back but without audio
				lastError = new GeminiTtsTransientError(validationError);
				console.error(
					`Attempt ${attempt + 1}/${maxRetries + 1}: ${validationError}`,
				);
				continue;
			}

			return response; // success
		} catch (err) {
			if (err instanceof GeminiTtsTransientError) {
				lastError = err;
				console.error(
					`Attempt ${attempt + 1}/${maxRetries + 1}: ${err.message}`,
				);
				continue;
			}
			// Non-transient errors (auth, bad request) — fail immediately
			throw err;
		}
	}

	// All retries exhausted
	throw new GeminiTtsTransientError(
		`Gemini TTS failed after ${maxRetries + 1} attempts. Last error: ${lastError?.message ?? "unknown"}`,
	);
}
