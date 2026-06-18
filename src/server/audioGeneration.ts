/**
 * audioGeneration.ts — Worker-side orchestrator for the /admin "Generate
 * audio" button. Runs the same pipeline as the CLI, but entirely inside the
 * Cloudflare Worker plus one loopback call to the local forced aligner:
 *
 *   D1 episode text
 *     → transcript (parseTranscript / formatTranscript)
 *     → styled transcript (OpenRouter, plain fetch)
 *     → preservation guard (spoken words must equal the source, or we stop)
 *     → TTS (Gemini, plain fetch) → PCM → WAV
 *     → forced alignment (POST multipart to the loopback aligner service)
 *     → word-timing sidecar (buildWordTimingSidecar, reused verbatim)
 *     → AssetStore.writeEpisodeAudio (validates + stages + reads back)
 *
 * Every external dependency is injectable so the whole thing runs offline in
 * tests. Defaults use `globalThis.fetch` because the server module shadows the
 * global `fetch` name. No secrets are read from `process.env`; the caller
 * passes them in from the Worker `env` bindings.
 *
 * IMPORTANT (bundle purity): this module must only import Worker-safe code.
 * In particular it must NOT import `generateWav.ts` at runtime (it pulls in
 * `node:fs`/`Bun`); the tiny audio-extraction it needs is inlined here.
 */

import { ALIGNER_MODEL } from "../lib/alignerModel";
import {
	type CallGeminiTtsWithRetryInput,
	callGeminiTtsWithRetry,
	GeminiTtsAuthError,
} from "../lib/geminiTtsClient";
import { buildTtsRequest } from "../lib/geminiTtsRequest";
import type { GeminiAudioResponse } from "../lib/generateWav";
import {
	OpenRouterAuthError,
	styleTranscriptViaOpenRouter,
} from "../lib/openRouterStyleClient";
import { assertStyledPreservesEpisodeText } from "../lib/styleTranscript";
import { formatTranscript, parseTranscript } from "../lib/transcript";
import { pcmToWavBuffer } from "../lib/wav";
import { buildWordTimingSidecar, WordTimingError } from "../lib/wordTimings";
import type { AssetStore } from "./stores";

export type AudioGenerationCode =
	| "StyleAuthFailed"
	| "StyleFailed"
	| "StylePreservationFailed"
	| "TtsAuthFailed"
	| "TtsFailed"
	| "TtsNoAudio"
	| "AlignerUnreachable"
	| "AlignFailed"
	| "AlignmentMismatch"
	| "VerificationFailed";

export class AudioGenerationError extends Error {
	constructor(
		readonly code: AudioGenerationCode,
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "AudioGenerationError";
	}
}

/** Inject the forced aligner: WAV + source text → raw Qwen alignment text. */
export type AlignFn = (input: {
	audioBytes: Uint8Array;
	sourceText: string;
}) => Promise<string>;

export interface GenerateEpisodeAudioDeps {
	/** Style a transcript into a TTS performance script. */
	styleFn?: (input: {
		transcript: string;
		apiKey: string;
		fetchFn?: typeof fetch;
	}) => Promise<string>;
	/** Call Gemini TTS. */
	ttsFn?: (input: CallGeminiTtsWithRetryInput) => Promise<GeminiAudioResponse>;
	/** Run forced alignment. Defaults to the loopback HTTP aligner service. */
	alignFn?: AlignFn;
	/** Override fetch (the server module shadows the global `fetch`). */
	fetchFn?: typeof fetch;
}

export interface GenerateEpisodeAudioInput {
	seasonSlug: string;
	episodeIdx: number;
	episodeText: string;
	geminiApiKey: string;
	openRouterApiKey: string;
	/** Base URL of the loopback aligner service, e.g. http://127.0.0.1:8765 */
	alignerUrl: string;
	assetStore: AssetStore;
	deps?: GenerateEpisodeAudioDeps;
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Extract the base64 PCM payload from a Gemini TTS response. Inlined (rather
 * than imported from generateWav.ts) to keep the Worker bundle free of fs/Bun.
 */
function extractInlineAudio(response: GeminiAudioResponse): string {
	const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
	if (!data) {
		throw new AudioGenerationError(
			"TtsNoAudio",
			"Gemini response contained no inline audio data.",
			502,
		);
	}
	return data;
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/** Default aligner: multipart POST to `${alignerUrl}/align` over loopback. */
function makeHttpAlignFn(alignerUrl: string, fetchFn: typeof fetch): AlignFn {
	const base = alignerUrl.replace(/\/+$/, "");
	return async ({ audioBytes, sourceText }) => {
		// Copy into a plain ArrayBuffer so the Blob part is typed as
		// ArrayBuffer (a Uint8Array may be backed by a SharedArrayBuffer).
		const audioBuffer = new ArrayBuffer(audioBytes.byteLength);
		new Uint8Array(audioBuffer).set(audioBytes);

		const form = new FormData();
		form.append("text", sourceText);
		form.append(
			"audio",
			new Blob([audioBuffer], { type: "audio/wav" }),
			"episode.wav",
		);

		let response: Response;
		try {
			response = await fetchFn(`${base}/align`, {
				method: "POST",
				body: form,
			});
		} catch (err) {
			throw new AudioGenerationError(
				"AlignerUnreachable",
				`Could not reach the local aligner at ${base}: ${describe(err)}. Is \`bun run dev\` running?`,
				503,
			);
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new AudioGenerationError(
				"AlignFailed",
				`Aligner returned HTTP ${response.status}: ${detail.slice(0, 300)}`,
				502,
			);
		}

		let data: { alignment?: string };
		try {
			data = (await response.json()) as { alignment?: string };
		} catch (err) {
			throw new AudioGenerationError(
				"AlignFailed",
				`Aligner returned invalid JSON: ${describe(err)}`,
				502,
			);
		}

		if (typeof data.alignment !== "string" || data.alignment.trim() === "") {
			throw new AudioGenerationError(
				"AlignFailed",
				"Aligner returned an empty alignment.",
				502,
			);
		}
		return data.alignment;
	};
}

/**
 * Run the full generation pipeline for one episode and persist the result via
 * the AssetStore (which re-validates and reads back). Throws
 * {@link AudioGenerationError} with a stage-specific code on any failure.
 */
export async function generateEpisodeAudio(
	input: GenerateEpisodeAudioInput,
): Promise<void> {
	const {
		seasonSlug,
		episodeIdx,
		episodeText,
		geminiApiKey,
		openRouterApiKey,
		alignerUrl,
		assetStore,
		deps = {},
	} = input;

	const fetchFn = deps.fetchFn ?? globalThis.fetch;
	const styleFn = deps.styleFn ?? styleTranscriptViaOpenRouter;
	const ttsFn = deps.ttsFn ?? callGeminiTtsWithRetry;
	const alignFn = deps.alignFn ?? makeHttpAlignFn(alignerUrl, fetchFn);

	// 1. transcript (pure)
	const transcript = formatTranscript(parseTranscript(episodeText));

	// 2. style via OpenRouter
	let styled: string;
	try {
		styled = await styleFn({
			transcript,
			apiKey: openRouterApiKey,
			fetchFn,
		});
	} catch (err) {
		if (err instanceof OpenRouterAuthError) {
			throw new AudioGenerationError("StyleAuthFailed", describe(err), 502);
		}
		throw new AudioGenerationError(
			"StyleFailed",
			`Styling failed: ${describe(err)}`,
			502,
		);
	}

	// 3. preservation guard — fail BEFORE spending a TTS call if words changed
	try {
		assertStyledPreservesEpisodeText(styled, episodeText);
	} catch (err) {
		throw new AudioGenerationError(
			"StylePreservationFailed",
			describe(err),
			422,
		);
	}

	// 4. TTS → PCM → WAV
	let response: GeminiAudioResponse;
	try {
		response = await ttsFn({
			request: buildTtsRequest({ styledTranscript: styled }),
			apiKey: geminiApiKey,
			fetchFn,
		});
	} catch (err) {
		if (err instanceof GeminiTtsAuthError) {
			throw new AudioGenerationError("TtsAuthFailed", describe(err), 502);
		}
		throw new AudioGenerationError(
			"TtsFailed",
			`TTS failed: ${describe(err)}`,
			502,
		);
	}

	const pcm = base64ToBytes(extractInlineAudio(response));
	if (pcm.length === 0) {
		throw new AudioGenerationError(
			"TtsNoAudio",
			"Decoded PCM audio was empty.",
			502,
		);
	}
	const wav = pcmToWavBuffer(pcm);

	// 5. forced alignment (loopback)
	let rawAlignment: string;
	try {
		rawAlignment = await alignFn({ audioBytes: wav, sourceText: episodeText });
	} catch (err) {
		if (err instanceof AudioGenerationError) throw err;
		throw new AudioGenerationError(
			"AlignFailed",
			`Alignment failed: ${describe(err)}`,
			502,
		);
	}

	// 6. word-timing sidecar (reused verbatim from the CLI path)
	let sidecar: ReturnType<typeof buildWordTimingSidecar>;
	try {
		const base = `${seasonSlug}-e${episodeIdx}`;
		sidecar = buildWordTimingSidecar({
			seasonSlug,
			episodeIdx,
			audioPath: `audio/${base}.wav`,
			sourceTextPath: `d1://seasons/${seasonSlug}/episodes/${episodeIdx}`,
			rawAlignmentPath: `aligner://${base}.qwen-align`,
			sourceText: episodeText,
			rawAlignment,
			audioBytes: wav,
			alignerModel: ALIGNER_MODEL,
		});
	} catch (err) {
		if (err instanceof WordTimingError) {
			throw new AudioGenerationError("AlignmentMismatch", describe(err), 502);
		}
		throw new AudioGenerationError(
			"AlignmentMismatch",
			`Could not build word timings: ${describe(err)}`,
			502,
		);
	}

	// 7. persist (writeEpisodeAudio validates, stages, and reads back)
	try {
		await assetStore.writeEpisodeAudio(
			seasonSlug,
			episodeIdx,
			episodeText,
			wav,
			sidecar,
		);
	} catch (err) {
		throw new AudioGenerationError(
			"VerificationFailed",
			`Audio was generated but failed verification on write: ${describe(err)}`,
			500,
		);
	}
}
