/**
 * openRouterStyleClient.ts — Worker-safe OpenRouter client for styling a
 * transcript into a bedtime TTS performance script.
 *
 * Mirrors the CLI's `styleViaLLM` but uses plain `fetch` instead of the
 * `openai` SDK (which is not Worker-bundle safe) and takes the API key as an
 * explicit argument instead of reading `process.env`. The fetch function is
 * injectable for tests; it defaults to `globalThis.fetch` because the server
 * module shadows the global `fetch` name.
 */

import {
	StyleValidationError,
	validateStyledTranscript,
} from "./styleTranscript";
import { buildStylePrompt } from "./styleTranscriptPrompt";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "xiaomi/mimo-v2.5-pro";
const DEFAULT_MAX_ATTEMPTS = 3;

export class OpenRouterStyleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OpenRouterStyleError";
	}
}

export class OpenRouterAuthError extends OpenRouterStyleError {
	constructor(message: string) {
		super(message);
		this.name = "OpenRouterAuthError";
	}
}

export interface StyleViaOpenRouterInput {
	transcript: string;
	apiKey: string;
	fetchFn?: typeof fetch;
	model?: string;
	maxAttempts?: number;
}

interface OpenRouterChatResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Style a transcript via OpenRouter and return the validated styled output.
 * Retries shape-validation failures up to `maxAttempts`; transport and auth
 * failures throw immediately.
 */
export async function styleTranscriptViaOpenRouter(
	input: StyleViaOpenRouterInput,
): Promise<string> {
	if (!input.apiKey) {
		throw new OpenRouterAuthError("OPENROUTER_API_KEY is not set.");
	}

	const fetchFn = input.fetchFn ?? globalThis.fetch;
	const model = input.model ?? DEFAULT_MODEL;
	const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const prompt = buildStylePrompt({ transcript: input.transcript });

	const body = JSON.stringify({
		model,
		temperature: 0.3,
		messages: [
			{ role: "system", content: prompt.system },
			{ role: "user", content: prompt.user },
		],
	});

	let lastValidationError: Error | undefined;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		let response: Response;
		try {
			response = await fetchFn(OPENROUTER_URL, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${input.apiKey}`,
				},
				body,
			});
		} catch (err) {
			throw new OpenRouterStyleError(
				`OpenRouter request failed: ${describeError(err)}`,
			);
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			if (response.status === 401 || response.status === 403) {
				throw new OpenRouterAuthError(
					`OpenRouter auth failed (HTTP ${response.status}).`,
				);
			}
			throw new OpenRouterStyleError(
				`OpenRouter HTTP ${response.status}: ${detail.slice(0, 300)}`,
			);
		}

		let data: OpenRouterChatResponse;
		try {
			data = (await response.json()) as OpenRouterChatResponse;
		} catch (err) {
			throw new OpenRouterStyleError(
				`OpenRouter returned invalid JSON: ${describeError(err)}`,
			);
		}

		const content = data.choices?.[0]?.message?.content ?? null;
		if (!content) {
			lastValidationError = new OpenRouterStyleError(
				"OpenRouter returned empty content.",
			);
			continue;
		}

		try {
			validateStyledTranscript(content);
			return content;
		} catch (err) {
			if (!(err instanceof StyleValidationError)) throw err;
			lastValidationError = err;
			if (attempt === maxAttempts) throw err;
		}
	}

	throw (
		lastValidationError ??
		new OpenRouterStyleError("OpenRouter styling failed after all attempts.")
	);
}
