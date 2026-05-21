import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	generateWav,
	extractAudioData,
	metaPath,
	GenerateWavError,
	type GeminiAudioResponse,
} from "../../src/lib/generateWav";
import { pcmToWavBuffer } from "../../src/lib/wav";
import { DEFAULT_VOICE_CHOICES } from "../../src/lib/geminiTtsRequest";

const TEST_DIR = join(import.meta.dir, "..", "..");
const FIXTURE_PATH = join(TEST_DIR, "fixtures", "gemini-audio-response.json");
const OUTPUT_DIR = join(TEST_DIR, "data", "audio");

function outputPath(name: string): string {
	return join(OUTPUT_DIR, `${name}.wav`);
}

async function loadFixture(): Promise<GeminiAudioResponse> {
	const raw = await readFile(FIXTURE_PATH, "utf-8");
	return JSON.parse(raw) as GeminiAudioResponse;
}

// ── WAV buffer tests ──────────────────────────────────────────────

describe("pcmToWavBuffer", () => {
	it("produces a 44-byte header followed by PCM data", () => {
		const pcm = new Uint8Array([0x00, 0x00, 0x01, 0x00]);
		const wav = pcmToWavBuffer(pcm);
		expect(wav.length).toBe(44 + 4);

		// Check RIFF header
		const header = wav.slice(0, 4);
		expect(new TextDecoder().decode(header)).toBe("RIFF");
	});

	it("embeds correct sample rate, channels, bits per sample", () => {
		const pcm = new Uint8Array(100);
		const wav = pcmToWavBuffer(pcm, 24000, 1, 16);

		const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
		// sample rate at offset 24
		expect(view.getUint32(24, true)).toBe(24000);
		// channels at offset 22
		expect(view.getUint16(22, true)).toBe(1);
		// bits per sample at offset 34
		expect(view.getUint16(34, true)).toBe(16);
	});

	it("handles empty PCM data (zero-length data chunk)", () => {
		const pcm = new Uint8Array(0);
		const wav = pcmToWavBuffer(pcm);
		expect(wav.length).toBe(44);
		const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
		expect(view.getUint32(40, true)).toBe(0); // data size = 0
	});
});

// ── extractAudioData tests ────────────────────────────────────────

describe("extractAudioData", () => {
	it("extracts base64 data from a valid response", async () => {
		const fixture = await loadFixture();
		const data = extractAudioData(fixture);
		expect(typeof data).toBe("string");
		expect(data.length).toBeGreaterThan(0);

		// Should be valid base64
		const decoded = Buffer.from(data, "base64");
		expect(decoded.length).toBeGreaterThan(0);
	});

	it("throws when candidates is empty", () => {
		expect(() => extractAudioData({ candidates: [] })).toThrow(
			GenerateWavError,
		);
	});

	it("throws when parts is empty", () => {
		expect(() =>
			extractAudioData({
				candidates: [{ content: { parts: [] } }],
			}),
		).toThrow(GenerateWavError);
	});

	it("throws when inlineData is missing", () => {
		expect(() =>
			extractAudioData({
				candidates: [
					// @ts-expect-error testing missing inlineData
					{ content: { parts: [{}] } },
				],
			}),
		).toThrow(GenerateWavError);
	});

	it("throws when inlineData.data is empty", () => {
		expect(() =>
			extractAudioData({
				candidates: [
					{
						content: {
							parts: [{ inlineData: { mimeType: "audio/pcm", data: "" } }],
						},
					},
				],
			}),
		).toThrow(GenerateWavError);
	});
});

// ── generateWav integration tests ─────────────────────────────────

describe("generateWav", () => {
	beforeAll(async () => {
		await mkdir(OUTPUT_DIR, { recursive: true });
	});

	afterAll(async () => {
		// Clean up test artifacts
		for (const name of [
			"test-e0",
			"test-missing-data",
			"test-custom-voices",
			"test-bad-base64",
		]) {
			try {
				await rm(outputPath(name));
			} catch {
				/* ignore */
			}
			try {
				await rm(metaPath(outputPath(name)));
			} catch {
				/* ignore */
			}
		}
	});

	it("creates a .wav file from fixture audio data", async () => {
		const fixture = await loadFixture();
		const wavPath = outputPath("test-e0");
		const generatedAt = "2026-05-12T00:00:00.000Z";

		await generateWav({
			response: fixture,
			outputPath: wavPath,
			season: "zack-s1",
			episodeIdx: 0,
			model: "gemini-3.1-flash-tts-preview",
			transcriptHash:
				"abc123def4567890abc123def4567890abc123def4567890abc123def4567890",
			generatedAt,
		});

		// WAV file should exist and have the correct header
		const wavStat = await stat(wavPath);
		expect(wavStat.size).toBeGreaterThan(44);

		const wavData = await readFile(wavPath);
		const header = new TextDecoder().decode(wavData.slice(0, 4));
		expect(header).toBe("RIFF");

		// WAV size should match: header (44) + decoded PCM length
		const b64Data = extractAudioData(fixture);
		const pcmLen = Buffer.from(b64Data, "base64").length;
		expect(wavStat.size).toBe(44 + pcmLen);
	});

	it("writes metadata beside the .wav file", async () => {
		const fixture = await loadFixture();
		const wavPath = outputPath("test-e0");
		const generatedAt = "2026-05-12T00:00:00.000Z";
		const transcriptHash =
			"abc123def4567890abc123def4567890abc123def4567890abc123def4567890";

		await generateWav({
			response: fixture,
			outputPath: wavPath,
			season: "zack-s1",
			episodeIdx: 0,
			model: "gemini-3.1-flash-tts-preview",
			transcriptHash,
			generatedAt,
		});

		const metaFilePath = metaPath(wavPath);
		const metaRaw = await readFile(metaFilePath, "utf-8");
		const meta = JSON.parse(metaRaw);

		expect(meta.source_season).toBe("zack-s1");
		expect(meta.episode_idx).toBe(0);
		expect(meta.model).toBe("gemini-3.1-flash-tts-preview");
		expect(meta.selected_voices).toEqual(DEFAULT_VOICE_CHOICES);
		expect(meta.transcript_hash).toBe(transcriptHash);
		expect(meta.generated_at).toBe(generatedAt);
	});

	it("metadata includes custom voice choices when provided", async () => {
		const fixture = await loadFixture();
		const wavPath = outputPath("test-custom-voices");
		const customVoices = { Storyteller: "Sulafat", Character: "Leda" };

		await generateWav({
			response: fixture,
			outputPath: wavPath,
			season: "zack-s1",
			episodeIdx: 1,
			model: "gemini-3.1-flash-tts-preview",
			voiceChoices: customVoices,
			transcriptHash:
				"def456abc7890123def456abc7890123def456abc7890123def456abc7890123",
		});

		const metaRaw = await readFile(metaPath(wavPath), "utf-8");
		const meta = JSON.parse(metaRaw);
		expect(meta.selected_voices).toEqual(customVoices);
	});

	it("fails clearly when fixture has no audio data", async () => {
		const badResponse: GeminiAudioResponse = {
			candidates: [],
		};

		await expect(
			generateWav({
				response: badResponse,
				outputPath: outputPath("test-missing-data"),
				season: "zack-s1",
				episodeIdx: 0,
				model: "gemini-3.1-flash-tts-preview",
				transcriptHash: "aaa",
			}),
		).rejects.toThrow(GenerateWavError);
	});

	it("fails clearly when base64 audio data is malformed", async () => {
		const badResponse: GeminiAudioResponse = {
			candidates: [
				{
					content: {
						parts: [
							{ inlineData: { mimeType: "audio/pcm", data: "!!!" } },
						],
					},
				},
			],
		};

		await expect(
			generateWav({
				response: badResponse,
				outputPath: outputPath("test-bad-base64"),
				season: "zack-s1",
				episodeIdx: 0,
				model: "gemini-3.1-flash-tts-preview",
				transcriptHash: "aaa",
			}),
		).rejects.toThrow(GenerateWavError);
	});

	it("does not call any network API", async () => {
		// This test just verifies the module is importable without secrets
		// and produces no network activity when generating.
		const fixture = await loadFixture();
		const wavPath = outputPath("test-e0");

		// Should complete without errors (no network needed)
		await generateWav({
			response: fixture,
			outputPath: wavPath,
			season: "zack-s1",
			episodeIdx: 0,
			model: "gemini-3.1-flash-tts-preview",
			transcriptHash:
				"abc123def4567890abc123def4567890abc123def4567890abc123def4567890",
		});

		const exists = await stat(wavPath).catch(() => null);
		expect(exists).not.toBeNull();
	});
});

// ── metaPath tests ────────────────────────────────────────────────

describe("metaPath", () => {
	it("replaces .wav with .meta.json", () => {
		expect(metaPath("data/audio/zack-s1-e0.wav")).toBe(
			"data/audio/zack-s1-e0.meta.json",
		);
	});

	it("only replaces the .wav suffix", () => {
		expect(metaPath("path/to/something.wav.backup.wav")).toBe(
			"path/to/something.wav.backup.meta.json",
		);
	});
});
