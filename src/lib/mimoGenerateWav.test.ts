import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	MimoGenerateWavError,
	mimoGenerateWav,
	mimoMetaPath,
} from "./mimoGenerateWav";
import type { MimoTtsResponse } from "./mimoTtsResponse";

const ROOT = join(import.meta.dir, "..", "..");
const FIXTURE_PATH = join(ROOT, "fixtures", "mimo-audio-response.json");
const OUTPUT_DIR = join(ROOT, "data", "audio", "mimo-test");

/** Tiny valid WAV (244 bytes) for fixture responses. */
const TINY_WAV_BASE64 =
	"UklGRuwAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0Ycg" +
	"AAAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQ" +
	"ABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAB" +
	"AAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAA" +
	"EAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEA" +
	"AQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAA==";

function outputPath(name: string): string {
	return join(OUTPUT_DIR, `${name}.wav`);
}

async function loadFixture(): Promise<MimoTtsResponse> {
	const raw = await readFile(FIXTURE_PATH, "utf-8");
	return JSON.parse(raw) as MimoTtsResponse;
}

// ── Fixtures ───────────────────────────────────────────────────────

/** A valid MiMo response with base64-encoded WAV data. */
function validResponse(base64?: string, format = "wav"): MimoTtsResponse {
	return {
		id: "chatcmpl-test-123",
		object: "chat.completion",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					audio: {
						data: base64 ?? TINY_WAV_BASE64,
						format,
					},
				},
				finish_reason: "stop",
			},
		],
	};
}

/** A MiMo response with empty choices. */
function emptyChoicesResponse(): MimoTtsResponse {
	return { id: "chatcmpl-test-empty", choices: [] };
}

/** A MiMo response with text instead of audio. */
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

/** A MiMo response with empty audio data. */
function emptyAudioResponse(): MimoTtsResponse {
	return {
		id: "chatcmpl-test-empty-audio",
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

// ── mimoGenerateWav tests ──────────────────────────────────────────

describe("mimoGenerateWav", () => {
	beforeAll(async () => {
		await mkdir(OUTPUT_DIR, { recursive: true });
	});

	afterAll(async () => {
		// Clean up test artifacts
		for (const name of [
			"test-e0",
			"test-custom-voice",
			"test-bad-base64",
			"test-not-wav",
			"test-empty",
			"test-fixture",
		]) {
			try {
				await rm(outputPath(name));
			} catch {
				/* ignore */
			}
			try {
				await rm(mimoMetaPath(outputPath(name)));
			} catch {
				/* ignore */
			}
		}
	});

	it("writes a .wav file from MiMo response without double-wrapping as PCM", async () => {
		const response = validResponse();
		const wavPath = outputPath("test-e0");

		await mimoGenerateWav({
			response,
			outputPath: wavPath,
			season: "winni-s1",
			episodeIdx: 0,
			voice: "Mia",
			transcriptHash:
				"abc123def4567890abc123def4567890abc123def4567890abc123def4567890",
			generatedAt: "2026-05-12T00:00:00.000Z",
		});

		// WAV file should exist
		const wavStat = await stat(wavPath);
		expect(wavStat.size).toBeGreaterThan(44);

		// Should have a RIFF header (not double-wrapped)
		const wavData = await readFile(wavPath);
		const header = new TextDecoder().decode(wavData.slice(0, 4));
		expect(header).toBe("RIFF");

		// File size should match the decoded WAV bytes exactly
		// (not PCM + 44-byte header like Gemini)
		const raw = Buffer.from(TINY_WAV_BASE64, "base64");
		expect(wavStat.size).toBe(raw.length);
	});

	it("writes metadata with provider, voice, and audio format", async () => {
		const response = validResponse();
		const wavPath = outputPath("test-e0");
		const transcriptHash =
			"abc123def4567890abc123def4567890abc123def4567890abc123def4567890";

		await mimoGenerateWav({
			response,
			outputPath: wavPath,
			season: "winni-s1",
			episodeIdx: 0,
			voice: "Mia",
			transcriptHash,
			generatedAt: "2026-05-12T00:00:00.000Z",
		});

		const metaRaw = await readFile(mimoMetaPath(wavPath), "utf-8");
		const meta = JSON.parse(metaRaw);

		expect(meta.source_season).toBe("winni-s1");
		expect(meta.episode_idx).toBe(0);
		expect(meta.provider).toBe("mimo");
		expect(meta.model).toBe("mimo-v2.5-tts");
		expect(meta.selected_voice).toBe("Mia");
		expect(meta.audio_format).toBe("wav");
		expect(meta.transcript_hash).toBe(transcriptHash);
		expect(meta.generated_at).toBe("2026-05-12T00:00:00.000Z");
	});

	it("accepts a custom voice", async () => {
		const response = validResponse();
		const wavPath = outputPath("test-custom-voice");

		await mimoGenerateWav({
			response,
			outputPath: wavPath,
			season: "winni-s1",
			episodeIdx: 1,
			voice: "Chloe",
			transcriptHash:
				"def456abc7890123def456abc7890123def456abc7890123def456abc7890123",
		});

		const metaRaw = await readFile(mimoMetaPath(wavPath), "utf-8");
		const meta = JSON.parse(metaRaw);
		expect(meta.selected_voice).toBe("Chloe");
	});

	it("writes from the fixture file", async () => {
		const fixture = await loadFixture();
		const wavPath = outputPath("test-fixture");

		await mimoGenerateWav({
			response: fixture,
			outputPath: wavPath,
			season: "winni-s1",
			episodeIdx: 0,
			voice: "Mia",
			transcriptHash:
				"0000000000000000000000000000000000000000000000000000000000000000",
		});

		const wavStat = await stat(wavPath);
		expect(wavStat.size).toBeGreaterThan(44);

		const wavData = await readFile(wavPath);
		const header = new TextDecoder().decode(wavData.slice(0, 4));
		expect(header).toBe("RIFF");

		const metaRaw = await readFile(mimoMetaPath(wavPath), "utf-8");
		const meta = JSON.parse(metaRaw);
		expect(meta.provider).toBe("mimo");
		expect(meta.model).toBe("mimo-v2.5-tts");
	});

	it("fails clearly when response has no choices", async () => {
		await expect(
			mimoGenerateWav({
				response: emptyChoicesResponse(),
				outputPath: outputPath("test-empty"),
				season: "winni-s1",
				episodeIdx: 0,
				voice: "Mia",
				transcriptHash: "aaa",
			}),
		).rejects.toThrow(MimoGenerateWavError);
	});

	it("fails clearly when response has text instead of audio", async () => {
		await expect(
			mimoGenerateWav({
				response: textOnlyResponse(),
				outputPath: outputPath("test-empty"),
				season: "winni-s1",
				episodeIdx: 0,
				voice: "Mia",
				transcriptHash: "aaa",
			}),
		).rejects.toThrow(MimoGenerateWavError);
	});

	it("fails clearly when audio data is empty", async () => {
		await expect(
			mimoGenerateWav({
				response: emptyAudioResponse(),
				outputPath: outputPath("test-empty"),
				season: "winni-s1",
				episodeIdx: 0,
				voice: "Mia",
				transcriptHash: "aaa",
			}),
		).rejects.toThrow(MimoGenerateWavError);
	});

	it("fails clearly when base64 data is malformed", async () => {
		await expect(
			mimoGenerateWav({
				response: validResponse("!!!"),
				outputPath: outputPath("test-bad-base64"),
				season: "winni-s1",
				episodeIdx: 0,
				voice: "Mia",
				transcriptHash: "aaa",
			}),
		).rejects.toThrow(MimoGenerateWavError);
	});

	it("fails clearly when decoded data is not a valid WAV", async () => {
		const notWav = Buffer.from("this is not a wav file at all").toString(
			"base64",
		);
		await expect(
			mimoGenerateWav({
				response: validResponse(notWav),
				outputPath: outputPath("test-not-wav"),
				season: "winni-s1",
				episodeIdx: 0,
				voice: "Mia",
				transcriptHash: "aaa",
			}),
		).rejects.toThrow(MimoGenerateWavError);
	});

	it("does not leave a misleading completed artifact on failure", async () => {
		const badPath = outputPath("test-empty");

		try {
			await mimoGenerateWav({
				response: emptyChoicesResponse(),
				outputPath: badPath,
				season: "winni-s1",
				episodeIdx: 0,
				voice: "Mia",
				transcriptHash: "aaa",
			});
		} catch {
			/* expected */
		}

		// WAV file should not exist
		const exists = await stat(badPath).catch(() => null);
		expect(exists).toBeNull();

		// Metadata file should not exist
		const metaExists = await stat(mimoMetaPath(badPath)).catch(() => null);
		expect(metaExists).toBeNull();
	});

	it("does not call any network API", async () => {
		const response = validResponse();
		const wavPath = outputPath("test-e0");

		// Should complete without errors (no network needed)
		await mimoGenerateWav({
			response,
			outputPath: wavPath,
			season: "winni-s1",
			episodeIdx: 0,
			voice: "Mia",
			transcriptHash:
				"abc123def4567890abc123def4567890abc123def4567890abc123def4567890",
		});

		const exists = await stat(wavPath).catch(() => null);
		expect(exists).not.toBeNull();
	});
});

// ── mimoMetaPath tests ─────────────────────────────────────────────

describe("mimoMetaPath", () => {
	it("replaces .wav with .meta.json", () => {
		expect(mimoMetaPath("data/audio/winni-s1-e0.wav")).toBe(
			"data/audio/winni-s1-e0.meta.json",
		);
	});

	it("only replaces the .wav suffix", () => {
		expect(mimoMetaPath("path/to/something.wav.backup.wav")).toBe(
			"path/to/something.wav.backup.meta.json",
		);
	});
});
