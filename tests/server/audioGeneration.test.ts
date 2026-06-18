import { describe, expect, it } from "bun:test";
import type { GeminiAudioResponse } from "../../src/lib/generateWav";
import { GeminiTtsAuthError } from "../../src/lib/geminiTtsClient";
import { OpenRouterAuthError } from "../../src/lib/openRouterStyleClient";
import { extractAlignmentStoryWords } from "../../src/lib/storyWordTokens";
import {
	AudioGenerationError,
	generateEpisodeAudio,
	type GenerateEpisodeAudioDeps,
} from "../../src/server/audioGeneration";
import { InMemoryAssetStore } from "../../src/server/stores";

const SEASON = "winni-s1-gen";
const EPISODE_IDX = 0;
const EPISODE_TEXT = "Luma saw a rainbow path in the sunny garden.";

const STYLED = [
	"Make Storyteller sound warm and gentle.",
	"",
	`Storyteller: ${EPISODE_TEXT}`,
].join("\n");

/** A 1-second silent 24kHz mono 16-bit PCM buffer, base64-encoded. */
function silentPcmBase64(): string {
	const pcm = new Uint8Array(48000); // 24000 samples * 2 bytes
	return Buffer.from(pcm).toString("base64");
}

function fakeTtsResponse(): GeminiAudioResponse {
	return {
		candidates: [
			{
				content: {
					parts: [
						{
							inlineData: {
								mimeType: "audio/L16;rate=24000",
								data: silentPcmBase64(),
							},
						},
					],
				},
			},
		],
	};
}

/** Build a raw Qwen-style alignment that matches the episode words exactly. */
function fakeAlignment(text: string): string {
	return extractAlignmentStoryWords(text)
		.map((word, i) => {
			const start = (i * 0.01).toFixed(2);
			const end = (i * 0.01 + 0.005).toFixed(3);
			return `[${start}s - ${end}s] ${word.text}`;
		})
		.join("\n");
}

function happyDeps(
	overrides: Partial<GenerateEpisodeAudioDeps> = {},
): GenerateEpisodeAudioDeps {
	return {
		styleFn: async () => STYLED,
		ttsFn: async () => fakeTtsResponse(),
		alignFn: async ({ sourceText }) => fakeAlignment(sourceText),
		...overrides,
	};
}

function run(
	assetStore: InMemoryAssetStore,
	deps: GenerateEpisodeAudioDeps,
): Promise<void> {
	return generateEpisodeAudio({
		seasonSlug: SEASON,
		episodeIdx: EPISODE_IDX,
		episodeText: EPISODE_TEXT,
		geminiApiKey: "test-gemini",
		openRouterApiKey: "test-openrouter",
		alignerUrl: "http://127.0.0.1:8765",
		assetStore,
		deps,
	});
}

describe("generateEpisodeAudio", () => {
	it("writes a verifiable audio asset on the happy path", async () => {
		const assetStore = new InMemoryAssetStore({});
		await run(assetStore, happyDeps());

		const asset = await assetStore.readEpisodeAudio(
			SEASON,
			EPISODE_IDX,
			EPISODE_TEXT,
		);
		expect(asset).not.toBeNull();
		const expectedWords = extractAlignmentStoryWords(EPISODE_TEXT).length;
		expect(asset?.sidecar.words.length).toBe(expectedWords);
		expect(asset?.sidecar.durationSeconds).toBeCloseTo(1, 5);
		expect(asset?.sidecar.textHash).toHaveLength(64);
	});

	it("maps OpenRouter auth failure to StyleAuthFailed", async () => {
		const assetStore = new InMemoryAssetStore({});
		const promise = run(
			assetStore,
			happyDeps({
				styleFn: async () => {
					throw new OpenRouterAuthError("bad key");
				},
			}),
		);
		await expect(promise).rejects.toMatchObject({
			name: "AudioGenerationError",
			code: "StyleAuthFailed",
			status: 502,
		});
	});

	it("stops before TTS when styling changes the words", async () => {
		const assetStore = new InMemoryAssetStore({});
		let ttsCalls = 0;
		const promise = run(
			assetStore,
			happyDeps({
				styleFn: async () =>
					STYLED.replace("rainbow", "sunset"),
				ttsFn: async () => {
					ttsCalls += 1;
					return fakeTtsResponse();
				},
			}),
		);
		await expect(promise).rejects.toMatchObject({
			code: "StylePreservationFailed",
			status: 422,
		});
		expect(ttsCalls).toBe(0);
	});

	it("maps Gemini auth failure to TtsAuthFailed", async () => {
		const assetStore = new InMemoryAssetStore({});
		const promise = run(
			assetStore,
			happyDeps({
				ttsFn: async () => {
					throw new GeminiTtsAuthError("bad key");
				},
			}),
		);
		await expect(promise).rejects.toMatchObject({
			code: "TtsAuthFailed",
			status: 502,
		});
	});

	it("maps an alignment that does not match the source to AlignmentMismatch", async () => {
		const assetStore = new InMemoryAssetStore({});
		const promise = run(
			assetStore,
			happyDeps({
				alignFn: async () => "[0.00s - 0.01s] wrongword",
			}),
		);
		await expect(promise).rejects.toMatchObject({
			code: "AlignmentMismatch",
			status: 502,
		});
	});

	it("uses the loopback aligner via the injected fetch and surfaces unreachability", async () => {
		const assetStore = new InMemoryAssetStore({});
		const promise = generateEpisodeAudio({
			seasonSlug: SEASON,
			episodeIdx: EPISODE_IDX,
			episodeText: EPISODE_TEXT,
			geminiApiKey: "test-gemini",
			openRouterApiKey: "test-openrouter",
			alignerUrl: "http://127.0.0.1:8765",
			assetStore,
			deps: {
				styleFn: async () => STYLED,
				ttsFn: async () => fakeTtsResponse(),
				// No alignFn → exercises the default loopback HTTP client.
				fetchFn: (async () => {
					throw new Error("connection refused");
				}) as unknown as typeof fetch,
			},
		});
		await expect(promise).rejects.toMatchObject({
			code: "AlignerUnreachable",
			status: 503,
		});
	});

	it("calls the aligner /align endpoint when using the default client", async () => {
		const assetStore = new InMemoryAssetStore({});
		const seen: string[] = [];
		const fetchFn = (async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			seen.push(url);
			return new Response(JSON.stringify({ alignment: fakeAlignment(EPISODE_TEXT) }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;

		await generateEpisodeAudio({
			seasonSlug: SEASON,
			episodeIdx: EPISODE_IDX,
			episodeText: EPISODE_TEXT,
			geminiApiKey: "test-gemini",
			openRouterApiKey: "test-openrouter",
			alignerUrl: "http://127.0.0.1:8765/",
			assetStore,
			deps: {
				styleFn: async () => STYLED,
				ttsFn: async () => fakeTtsResponse(),
				fetchFn,
			},
		});

		expect(seen).toContain("http://127.0.0.1:8765/align");
		const asset = await assetStore.readEpisodeAudio(
			SEASON,
			EPISODE_IDX,
			EPISODE_TEXT,
		);
		expect(asset).not.toBeNull();
	});

	it("exports a typed error class", () => {
		const err = new AudioGenerationError("TtsFailed", "boom", 502);
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe("TtsFailed");
	});
});
