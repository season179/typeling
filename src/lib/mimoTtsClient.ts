/**
 * Real MiMo TTS API client for mimo-v2.5-tts.
 *
 * Calls Xiaomi's OpenAI-compatible chat-completions endpoint, validates that
 * the response contains audio data, and retries transient failures
 * (missing audio, HTTP 429/5xx, network errors).
 *
 * Uses MIMO_API_KEY from the environment. Fails clearly when it is missing.
 *
 * @see https://platform.mimoai.com/docs
 */

import type { MimoTtsRequest } from "./mimoTtsRequest";
import {
	type MimoTtsResponse,
	validateMimoAudioResponse,
} from "./mimoTtsResponse";

// ── Constants ──────────────────────────────────────────────────────

/**
 * Default base URL for Xiaomi's OpenAI-compatible chat-completions endpoint.
 * Override with MIMO_API_BASE env var if Xiaomi documents a different host
 * for the deployed cluster.
 */
export const DEFAULT_MIMO_API_BASE = "https://api.mimoai.com/v1";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1_000; // doubles each retry

// ── Errors ─────────────────────────────────────────────────────────

export class MimoTtsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MimoTtsError";
	}
}

export class MimoTtsAuthError extends MimoTtsError {
	constructor(message: string) {
		super(message);
		this.name = "MimoTtsAuthError";
	}
}

export class MimoTtsTransientError extends MimoTtsError {
	constructor(message: string) {
		super(message);
		this.name = "MimoTtsTransientError";
	}
}

// ── Input ──────────────────────────────────────────────────────────

export interface CallMimoTtsInput {
	/** A fully-built request from buildMimoTtsRequest(). */
	request: MimoTtsRequest;
	/**
	 * Override the API key. Defaults to process.env.MIMO_API_KEY.
	 * Pass explicitly to make the dependency visible and testable.
	 */
	apiKey?: string;
	/**
	 * Override the API base URL. Defaults to MIMO_API_BASE env var,
	 * then DEFAULT_MIMO_API_BASE.
	 */
	apiBase?: string;
	/**
	 * Override the fetch function for testing.
	 * Defaults to globalThis.fetch.
	 */
	fetchFn?: typeof fetch;
}

export interface CallMimoTtsWithRetryInput extends CallMimoTtsInput {
	/** Maximum number of retry attempts (default: 3). */
	maxRetries?: number;
	/** Initial backoff in milliseconds (default: 1000, doubles each retry). */
	backoffMs?: number;
	/** Override setTimeout for testing. */
	sleepFn?: (ms: number) => Promise<void>;
}

// ── Core call (single attempt) ─────────────────────────────────────

/**
 * Make a single attempt to call the MiMo TTS API.
 * Does NOT retry — use {@link callMimoTtsWithRetry} for retry logic.
 *
 * Throws:
 * - {@link MimoTtsAuthError} when MIMO_API_KEY is missing.
 * - {@link MimoTtsTransientError} for HTTP 429, 5xx, network errors, or malformed JSON.
 * - {@link MimoTtsError} for HTTP 400, 401, 403 (non-retryable).
 */
export async function callMimoTts(
	input: CallMimoTtsInput,
): Promise<MimoTtsResponse> {
	const apiKey = input.apiKey ?? process.env.MIMO_API_KEY;
	if (!apiKey) {
		throw new MimoTtsAuthError(
			"MIMO_API_KEY is not set. Export it or pass --api-key.",
		);
	}

	const apiBase =
		input.apiBase ?? process.env.MIMO_API_BASE ?? DEFAULT_MIMO_API_BASE;
	const url = `${apiBase.replace(/\/$/, "")}/chat/completions`;

	const fetchFn = input.fetchFn ?? globalThis.fetch;

	let response: Response;
	try {
		response = await fetchFn(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(input.request),
		});
	} catch (err) {
		throw new MimoTtsTransientError(
			`Network error calling MiMo TTS: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!response.ok) {
		const body = await response.text().catch(() => "(unreadable)");
		const isRetryable = response.status === 429 || response.status >= 500;
		const ErrClass = isRetryable ? MimoTtsTransientError : MimoTtsError;
		throw new ErrClass(
			`MiMo TTS HTTP ${response.status}: ${body.slice(0, 500)}`,
		);
	}

	let data: MimoTtsResponse;
	try {
		data = (await response.json()) as MimoTtsResponse;
	} catch (err) {
		throw new MimoTtsTransientError(
			`Failed to parse MiMo TTS response as JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	return data;
}

// ── Retry wrapper ──────────────────────────────────────────────────

/**
 * Call MiMo TTS with retry logic for transient failures.
 *
 * Retries when:
 * - Response has no audio data (text instead of audio, empty choices, etc.)
 * - HTTP 429 (rate limit) or 5xx (server error)
 * - Network errors
 *
 * Does NOT retry on HTTP 400/401/403 (these are permanent failures).
 */
export async function callMimoTtsWithRetry(
	input: CallMimoTtsWithRetryInput,
): Promise<MimoTtsResponse> {
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
			const response = await callMimoTts(input);

			// Validate audio content
			const validationError = validateMimoAudioResponse(response);
			if (validationError) {
				lastError = new MimoTtsTransientError(validationError);
				console.error(
					`Attempt ${attempt + 1}/${maxRetries + 1}: ${validationError}`,
				);
				continue;
			}

			return response; // success
		} catch (err) {
			if (err instanceof MimoTtsTransientError) {
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

	throw new MimoTtsTransientError(
		`MiMo TTS failed after ${maxRetries + 1} attempts. Last error: ${lastError?.message ?? "unknown"}`,
	);
}
