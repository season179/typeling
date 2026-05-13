import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mimoMetaPath } from "../src/lib/mimoGenerateWav";
import type { MimoTtsResponse } from "../src/lib/mimoTtsResponse";
import {
	generateWinniMimoAudio,
	splitStyledTranscript,
} from "./generate-winni-ch1-mimo-audio";

const ROOT = join(import.meta.dir, "..");
const TEST_DIR = join(ROOT, "data", "audio", "mimo-cli-test");

/** Tiny valid WAV (244 bytes) for fixture responses. */
const TINY_WAV_BASE64 =
	"UklGRuwAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0Ycg" +
	"AAAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQ" +
	"ABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAB" +
	"AAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAA" +
	"EAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEA" +
	"AQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAA==";

const STYLED_TRANSCRIPT = [
	"Make Storyteller sound warm and gentle, like a parent reading a bedtime story.",
	"",
	"Storyteller: [gently] In a cosy workshop filled with soft light, there lived a small blue robot named Pixel.",
	"Pixel: [excitedly] What a lovely day!",
	"Storyteller: [warmly] said Pixel in a soft, buzzy voice.",
].join("\n");

function fixtureResponse(base64 = TINY_WAV_BASE64): MimoTtsResponse {
	return {
		id: "chatcmpl-cli-test",
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

const noSleep = async () => {};

// ── splitStyledTranscript ──────────────────────────────────────────

describe("splitStyledTranscript", () => {
	it("splits at the first blank line", () => {
		const { styleGuidance, spokenText } =
			splitStyledTranscript(STYLED_TRANSCRIPT);
		expect(styleGuidance).toBe(
			"Make Storyteller sound warm and gentle, like a parent reading a bedtime story.",
		);
		expect(spokenText).toContain("Storyteller: [gently]");
		expect(spokenText).toContain("Pixel: [excitedly] What a lovely day!");
	});

	it("handles CRLF line endings", () => {
		const crlf = STYLED_TRANSCRIPT.replace(/\n/g, "\r\n");
		const { styleGuidance, spokenText } = splitStyledTranscript(crlf);
		expect(styleGuidance).toContain("Make Storyteller sound warm");
		expect(spokenText).toContain("Storyteller: [gently]");
	});

	it("falls back to first-line split when no blank line is present", () => {
		const noBlank = [
			"Make Storyteller sound warm.",
			"Storyteller: Hello.",
			"Pixel: Hi!",
		].join("\n");
		const { styleGuidance, spokenText } = splitStyledTranscript(noBlank);
		expect(styleGuidance).toBe("Make Storyteller sound warm.");
		expect(spokenText).toBe("Storyteller: Hello.\nPixel: Hi!");
	});
});

// ── generateWinniMimoAudio ─────────────────────────────────────────

describe("generateWinniMimoAudio", () => {
	const transcriptPath = join(TEST_DIR, "winni-styled.txt");
	const outputPath = join(TEST_DIR, "winni-test.wav");

	beforeAll(async () => {
		await mkdir(TEST_DIR, { recursive: true });
	});

	beforeEach(async () => {
		await writeFile(transcriptPath, STYLED_TRANSCRIPT, "utf-8");
	});

	afterEach(async () => {
		await rm(outputPath, { force: true });
		await rm(mimoMetaPath(outputPath), { force: true });
		await rm(transcriptPath, { force: true });
	});

	afterAll(async () => {
		await rm(TEST_DIR, { recursive: true, force: true });
	});

	it("writes a .wav and a .meta.json given a styled transcript", async () => {
		const fetchFn = okFetch(fixtureResponse());

		const result = await generateWinniMimoAudio({
			transcriptPath,
			outputPath,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
			generatedAt: "2026-05-13T00:00:00.000Z",
		});

		expect(result.outputPath).toBe(outputPath);
		expect(result.metaPath).toBe(mimoMetaPath(outputPath));
		expect(result.voice).toBe("Mia");
		expect(result.transcriptHash).toMatch(/^[0-9a-f]{64}$/);

		const wavStat = await stat(outputPath);
		expect(wavStat.size).toBeGreaterThan(44);

		const wavData = await readFile(outputPath);
		const header = new TextDecoder().decode(wavData.slice(0, 4));
		expect(header).toBe("RIFF");

		const meta = JSON.parse(await readFile(result.metaPath, "utf-8"));
		expect(meta.source_season).toBe("winni-s1");
		expect(meta.episode_idx).toBe(0);
		expect(meta.provider).toBe("mimo");
		expect(meta.model).toBe("mimo-v2.5-tts");
		expect(meta.selected_voice).toBe("Mia");
		expect(meta.audio_format).toBe("wav");
		expect(meta.generated_at).toBe("2026-05-13T00:00:00.000Z");
		expect(meta.transcript_hash).toBe(result.transcriptHash);
	});

	it("sends a chat-completions request with style in user, spoken in assistant", async () => {
		const fetchFn = okFetch(fixtureResponse());

		await generateWinniMimoAudio({
			transcriptPath,
			outputPath,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
		expect(calls.length).toBe(1);
		const [, init] = calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);

		expect(body.model).toBe("mimo-v2.5-tts");
		expect(body.stream).toBe(false);
		expect(body.audio).toEqual({ voice: "Mia", format: "wav" });

		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe("user");
		expect(body.messages[0].content).toContain(
			"Make Storyteller sound warm and gentle",
		);
		expect(body.messages[1].role).toBe("assistant");
		expect(body.messages[1].content).toContain("Storyteller: [gently]");
		expect(body.messages[1].content).toContain("Pixel: [excitedly]");
	});

	it("uses the chat-completions endpoint at the documented base", async () => {
		const fetchFn = okFetch(fixtureResponse());

		await generateWinniMimoAudio({
			transcriptPath,
			outputPath,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
		const [url, init] = calls[0] as [string, RequestInit];
		expect(url).toMatch(/\/chat\/completions$/);
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer test-key");
	});

	it("honours a custom built-in voice", async () => {
		const fetchFn = okFetch(fixtureResponse());

		const result = await generateWinniMimoAudio({
			transcriptPath,
			outputPath,
			voice: "Chloe",
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(result.voice).toBe("Chloe");
		const meta = JSON.parse(await readFile(result.metaPath, "utf-8"));
		expect(meta.selected_voice).toBe("Chloe");
	});

	it("rejects unknown voices", async () => {
		const fetchFn = okFetch(fixtureResponse());

		await expect(
			generateWinniMimoAudio({
				transcriptPath,
				outputPath,
				voice: "NotAVoice",
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
			}),
		).rejects.toThrow(/Unknown MiMo voice/);
	});

	it("fails clearly when MIMO_API_KEY is missing", async () => {
		const fetchFn = okFetch(fixtureResponse());

		await expect(
			generateWinniMimoAudio({
				transcriptPath,
				outputPath,
				apiKey: "",
				fetchFn,
				sleepFn: noSleep,
			}),
		).rejects.toThrow(/MIMO_API_KEY is not set/);
	});

	it("fails clearly when the styled transcript is missing", async () => {
		await rm(transcriptPath, { force: true });
		const fetchFn = okFetch(fixtureResponse());

		await expect(
			generateWinniMimoAudio({
				transcriptPath,
				outputPath,
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
			}),
		).rejects.toThrow(/Cannot read styled transcript/);
	});

	it("fails clearly when the styled transcript is empty", async () => {
		await writeFile(transcriptPath, "", "utf-8");
		const fetchFn = okFetch(fixtureResponse());

		await expect(
			generateWinniMimoAudio({
				transcriptPath,
				outputPath,
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
			}),
		).rejects.toThrow(/Styled transcript is empty/);
	});

	it("fails immediately on HTTP 401 without retrying", async () => {
		const fetchFn = httpErrorFetch(401, "unauthorized");

		await expect(
			generateWinniMimoAudio({
				transcriptPath,
				outputPath,
				apiKey: "test-key",
				fetchFn,
				sleepFn: noSleep,
				maxRetries: 5,
			}),
		).rejects.toThrow(/MiMo TTS HTTP 401/);

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("retries on HTTP 429 then succeeds", async () => {
		let callCount = 0;
		const fetchFn = mock(async () => {
			callCount++;
			if (callCount === 1) {
				return new Response("rate limited", { status: 429 });
			}
			return new Response(JSON.stringify(fixtureResponse()), { status: 200 });
		}) as unknown as typeof fetch;

		const result = await generateWinniMimoAudio({
			transcriptPath,
			outputPath,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(fetchFn).toHaveBeenCalledTimes(2);
		const wavStat = await stat(result.outputPath);
		expect(wavStat.size).toBeGreaterThan(44);
	});

	it("does not require network access in tests (injected fetch)", async () => {
		// Sanity check: this test must complete without touching the network.
		// We assert by using a fetch that throws if called with any URL —
		// then verifying it was called exactly once (proving the path is fetch-injected).
		let networkCalls = 0;
		const fetchFn = mock(async () => {
			networkCalls++;
			return new Response(JSON.stringify(fixtureResponse()), { status: 200 });
		}) as unknown as typeof fetch;

		await generateWinniMimoAudio({
			transcriptPath,
			outputPath,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(networkCalls).toBe(1);
	});
});
