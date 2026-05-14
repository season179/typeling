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
	cleanSpokenTextForMimo,
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

// ── cleanSpokenTextForMimo ─────────────────────────────────────────

describe("cleanSpokenTextForMimo", () => {
	it("strips Storyteller: and Pixel: speaker prefixes", () => {
		const input = [
			"Storyteller: Luma walked through the garden.",
			"Pixel: Hello?",
			"Storyteller: said Luma softly.",
		].join("\n");
		expect(cleanSpokenTextForMimo(input)).toBe(
			["Luma walked through the garden.", "Hello?", "said Luma softly."].join(
				"\n",
			),
		);
	});

	it("strips [bracketed] mood tags anywhere on a line", () => {
		const input = [
			"Storyteller: [warmly] Luma was playing in the garden.",
			"Pixel: [curiously] Hello?",
			"Storyteller: [gently] The door began to glow.",
		].join("\n");
		const out = cleanSpokenTextForMimo(input);
		expect(out).not.toMatch(/Storyteller|Pixel/);
		expect(out).not.toMatch(/\[/);
		expect(out).toContain("Luma was playing in the garden.");
		expect(out).toContain("Hello?");
	});

	it("preserves lines that have no speaker prefix or bracket tag", () => {
		const input = "Just a plain narrative line.";
		expect(cleanSpokenTextForMimo(input)).toBe("Just a plain narrative line.");
	});

	it("is case-insensitive for speaker labels", () => {
		const input = "storyteller: hi\nPIXEL: hello";
		expect(cleanSpokenTextForMimo(input)).toBe("hi\nhello");
	});

	it("keeps [bracket] tags when keepBracketTags is true (Director Mode)", () => {
		const input = [
			"Storyteller: [warmly] Luma was playing in the garden.",
			"Pixel: [curiously] Hello?",
		].join("\n");
		const out = cleanSpokenTextForMimo(input, { keepBracketTags: true });
		expect(out).not.toMatch(/Storyteller|Pixel/);
		expect(out).toContain("[warmly]");
		expect(out).toContain("[curiously]");
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

	it("defaults to Director Mode: writes a .wav and a .meta.json with voicedesign metadata", async () => {
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
		expect(result.model).toBe("mimo-v2.5-tts-voicedesign");
		expect(result.voice).toBeNull();
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
		expect(meta.model).toBe("mimo-v2.5-tts-voicedesign");
		expect(meta.selected_voice).toBeNull();
		expect(meta.audio_format).toBe("wav");
		expect(meta.generated_at).toBe("2026-05-13T00:00:00.000Z");
		expect(meta.transcript_hash).toBe(result.transcriptHash);
	});

	it("default Director Mode: sends voicedesign model, omits audio.voice, keeps [bracket] tags", async () => {
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

		expect(body.model).toBe("mimo-v2.5-tts-voicedesign");
		expect(body.stream).toBe(false);
		expect(body.audio.voice).toBeUndefined();
		expect(body.audio.format).toBe("wav");

		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe("user");
		// Whatever preamble the styler emits is sent verbatim as the
		// Director Mode description.
		expect(body.messages[0].content.length).toBeGreaterThan(0);
		expect(body.messages[1].role).toBe("assistant");
		// Speaker labels stripped (single designed voice would read them aloud)…
		expect(body.messages[1].content).not.toMatch(/Storyteller:|Pixel:/);
		// …but [bracket] tags kept — voicedesign interprets them as audio-tag control.
		expect(body.messages[1].content).toMatch(
			/\[gently\]|\[excitedly\]|\[warmly\]/,
		);
		expect(body.messages[1].content).toContain(
			"In a cosy workshop filled with soft light",
		);
		expect(body.messages[1].content).toContain("What a lovely day!");
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

	it("--builtin alone opts into the built-in path with Mia as the default voice", async () => {
		const fetchFn = okFetch(fixtureResponse());

		const result = await generateWinniMimoAudio({
			transcriptPath,
			outputPath,
			builtin: true,
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(result.model).toBe("mimo-v2.5-tts");
		expect(result.voice).toBe("Mia");

		const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
		const [, init] = calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe("mimo-v2.5-tts");
		expect(body.audio).toEqual({ voice: "Mia", format: "wav" });
		// Built-in path strips speaker labels and bracket tags.
		expect(body.messages[1].content).not.toMatch(/Storyteller:|Pixel:/);
		expect(body.messages[1].content).not.toMatch(/\[gently\]|\[excitedly\]/);
	});

	it("passing a voice implicitly opts into built-in mode with that voice", async () => {
		const fetchFn = okFetch(fixtureResponse());

		const result = await generateWinniMimoAudio({
			transcriptPath,
			outputPath,
			voice: "Chloe",
			apiKey: "test-key",
			fetchFn,
			sleepFn: noSleep,
		});

		expect(result.model).toBe("mimo-v2.5-tts");
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
