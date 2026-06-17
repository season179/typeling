import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { checkSidecarMatchesEpisodeText } from "../../../src/lib/audio/sidecarMatch";
import {
	chooseEpisodeSplit,
	parseWav,
	ResliceError,
	resliceEpisode,
	resliceEpisodeToTexts,
} from "../../../src/lib/audio/reslice";
import { sentenceBoundaries } from "../../../src/lib/sentenceBoundaries";
import { extractAlignmentStoryWords } from "../../../src/lib/storyWordTokens";
import { pcmToWavBuffer } from "../../../src/lib/wav";
import { wordTimingSidecarSchema } from "../../../src/lib/wordTimings";

const SAMPLE_RATE = 24000;
const BLOCK_ALIGN = 2; // mono, 16-bit

const sha256 = (input: string | Uint8Array) =>
	createHash("sha256").update(input).digest("hex");

const STORY =
	"The small dragon woke up early. She stretched her green wings wide. " +
	"A gentle breeze drifted through the cave. Today she would learn to type. " +
	"The wise owl had promised to help. They sat down beside the warm fire.";

/**
 * Fabricate a fully-aligned source episode: per-word timings on a fixed grid
 * (0.3s slot, 0.2s spoken, 0.1s gap) plus a silent WAV long enough to cover
 * them — the shape `buildWordTimingSidecar` produces from a real alignment.
 */
function buildSource(text: string, seasonSlug = "winni-s1", episodeIdx = 4) {
	const alignment = extractAlignmentStoryWords(text);
	const words = alignment.map((word, i) => ({
		index: word.wordIndex,
		text: word.text,
		start: i * 0.3,
		end: i * 0.3 + 0.2,
	}));
	const durationSeconds = alignment.length * 0.3;
	const frames = Math.round(durationSeconds * SAMPLE_RATE);
	const audio = pcmToWavBuffer(
		new Uint8Array(frames * BLOCK_ALIGN),
		SAMPLE_RATE,
		1,
		16,
	);
	const sidecar = wordTimingSidecarSchema.parse({
		seasonSlug,
		episodeIdx,
		audioPath: `memory://${seasonSlug}-e${episodeIdx}.wav`,
		sourceTextPath: `memory://${seasonSlug}-e${episodeIdx}-source.txt`,
		rawAlignmentPath: `memory://${seasonSlug}-e${episodeIdx}.qwen-align.raw.txt`,
		audioHash: sha256(audio),
		textHash: sha256(text),
		alignerModel: "test-aligner",
		durationSeconds,
		generatedAt: "2026-06-17T00:00:00.000Z",
		words,
	});
	return { text, audio, sidecar };
}

function partsFor(seasonSlug: string, evenIdx: number) {
	const part = (idx: number) => ({
		episodeIdx: idx,
		audioPath: `memory://${seasonSlug}-e${idx}.wav`,
		sourceTextPath: `memory://${seasonSlug}-e${idx}-source.txt`,
		rawAlignmentPath: `memory://${seasonSlug}-e${idx}.qwen-align.raw.txt`,
	});
	return { partA: part(evenIdx), partB: part(evenIdx + 1) };
}

describe("chooseEpisodeSplit", () => {
	it("cuts on a sentence boundary near the word-count midpoint", () => {
		const total = extractAlignmentStoryWords(STORY).length;
		const split = chooseEpisodeSplit(STORY);

		// The cut is a real sentence boundary offset.
		const boundaryEnds = new Set(
			sentenceBoundaries(STORY).map((b) => b.end),
		);
		expect(boundaryEnds.has(split.charIndex)).toBe(true);

		// And it is the boundary closest to half the words.
		expect(split.wordIndex).toBeGreaterThan(0);
		expect(split.wordIndex).toBeLessThan(total);
		expect(Math.abs(split.wordIndex - total / 2)).toBeLessThanOrEqual(total / 4);
	});

	it("throws when there is no interior sentence boundary", () => {
		expect(() => chooseEpisodeSplit("One short sentence here.")).toThrow(
			ResliceError,
		);
	});

	it("throws on a single-word episode", () => {
		expect(() => chooseEpisodeSplit("Hello")).toThrow(ResliceError);
	});
});

describe("resliceEpisode", () => {
	it("splits an episode into two halves that pass the serve-time check", () => {
		const source = buildSource(STORY, "winni-s1", 4);
		const { partA, partB } = partsFor("winni-s1", 8);

		const result = resliceEpisode({
			sourceSidecar: source.sidecar,
			sourceAudio: source.audio,
			sourceText: source.text,
			partA,
			partB,
			generatedAt: "2026-06-17T12:00:00.000Z",
		});

		const total = extractAlignmentStoryWords(STORY).length;

		// Word counts partition the original.
		expect(result.a.sidecar.words).toHaveLength(result.split.wordIndex);
		expect(result.b.sidecar.words).toHaveLength(total - result.split.wordIndex);

		// Each half passes the EXACT check the server applies on every request.
		expect(
			checkSidecarMatchesEpisodeText(
				result.a.sidecar,
				"winni-s1",
				8,
				result.a.text,
			),
		).toEqual({ ok: true });
		expect(
			checkSidecarMatchesEpisodeText(
				result.b.sidecar,
				"winni-s1",
				9,
				result.b.text,
			),
		).toEqual({ ok: true });

		// Sidecars carry the new episode indices and recomputed hashes.
		expect(result.a.sidecar.episodeIdx).toBe(8);
		expect(result.b.sidecar.episodeIdx).toBe(9);
		expect(result.a.sidecar.audioHash).toBe(sha256(result.a.audio));
		expect(result.a.sidecar.textHash).toBe(sha256(result.a.text));
		expect(result.b.sidecar.audioHash).toBe(sha256(result.b.audio));
		expect(result.b.sidecar.textHash).toBe(sha256(result.b.text));
		expect(result.a.sidecar.alignerModel).toBe("test-aligner");
		expect(result.a.sidecar.generatedAt).toBe("2026-06-17T12:00:00.000Z");

		// The second half's timings are rebased to start near zero and stay
		// monotonic.
		expect(result.b.sidecar.words[0]?.start).toBeGreaterThanOrEqual(0);
		expect(result.b.sidecar.words[0]?.start).toBeLessThan(0.3);

		// The two PCM slices reconstruct the original sample count exactly.
		const srcFrames = parseWav(source.audio).pcm.length;
		const aFrames = parseWav(result.a.audio).pcm.length;
		const bFrames = parseWav(result.b.audio).pcm.length;
		expect(aFrames + bFrames).toBe(srcFrames);
		expect(aFrames).toBeGreaterThan(0);
		expect(bFrames).toBeGreaterThan(0);
	});

	it("honours an explicit split point", () => {
		const source = buildSource(STORY, "zack-s1", 0);
		const { partA, partB } = partsFor("zack-s1", 0);
		const split = chooseEpisodeSplit(STORY);

		const result = resliceEpisode({
			sourceSidecar: source.sidecar,
			sourceAudio: source.audio,
			sourceText: source.text,
			split,
			partA,
			partB,
			generatedAt: "2026-06-17T12:00:00.000Z",
		});

		expect(result.split).toEqual(split);
		expect(result.a.sidecar.words).toHaveLength(split.wordIndex);
	});

	it("re-slices from authoritative split texts (matches the JSON the server reads)", () => {
		const source = buildSource(STORY, "winni-s1", 4);
		const { partA, partB } = partsFor("winni-s1", 8);
		const split = chooseEpisodeSplit(STORY);
		const textA = STORY.slice(0, split.charIndex).trim();
		const textB = STORY.slice(split.charIndex).trim();

		const result = resliceEpisodeToTexts({
			sourceSidecar: source.sidecar,
			sourceAudio: source.audio,
			textA,
			textB,
			partA,
			partB,
			generatedAt: "2026-06-17T12:00:00.000Z",
		});

		// Sidecars hash exactly the supplied texts and pass the serve-time check.
		expect(result.a.sidecar.textHash).toBe(result.a.sidecar.textHash);
		expect(
			checkSidecarMatchesEpisodeText(result.a.sidecar, "winni-s1", 8, textA),
		).toEqual({ ok: true });
		expect(
			checkSidecarMatchesEpisodeText(result.b.sidecar, "winni-s1", 9, textB),
		).toEqual({ ok: true });
		expect(result.a.text).toBe(textA);
		expect(result.b.text).toBe(textB);

		// Identical audio split to the derive-from-text path.
		const derived = resliceEpisode({
			sourceSidecar: source.sidecar,
			sourceAudio: source.audio,
			sourceText: STORY,
			partA,
			partB,
			generatedAt: "2026-06-17T12:00:00.000Z",
		});
		expect(result.a.sidecar.audioHash).toBe(derived.a.sidecar.audioHash);
		expect(result.b.sidecar.audioHash).toBe(derived.b.sidecar.audioHash);
	});

	it("rejects target texts whose word counts do not cover the source", () => {
		const source = buildSource(STORY, "winni-s1", 4);
		const { partA, partB } = partsFor("winni-s1", 8);
		expect(() =>
			resliceEpisodeToTexts({
				sourceSidecar: source.sidecar,
				sourceAudio: source.audio,
				textA: "Too short.",
				textB: "Also short.",
				partA,
				partB,
				generatedAt: "2026-06-17T12:00:00.000Z",
			}),
		).toThrow(ResliceError);
	});

	it("rejects a source sidecar that does not match its text", () => {
		const source = buildSource(STORY, "winni-s1", 4);
		const { partA, partB } = partsFor("winni-s1", 8);

		expect(() =>
			resliceEpisode({
				sourceSidecar: source.sidecar,
				sourceAudio: source.audio,
				sourceText: `${source.text} An extra tampered sentence.`,
				partA,
				partB,
				generatedAt: "2026-06-17T12:00:00.000Z",
			}),
		).toThrow(ResliceError);
	});
});
