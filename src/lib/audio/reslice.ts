import { createHash } from "node:crypto";
import { sentenceBoundaries } from "../sentenceBoundaries";
import { extractAlignmentStoryWords } from "../storyWordTokens";
import { pcmToWavBuffer } from "../wav";
import {
	readWavDurationSeconds,
	type WordTiming,
	type WordTimingSidecar,
	wordTimingSidecarSchema,
} from "../wordTimings";
import { checkSidecarMatchesEpisodeText } from "./sidecarMatch";

/**
 * Pure, local episode-audio re-slicer (no aligner, no subprocess, no fs).
 *
 * Splits one fully-aligned episode (`<season>-e<i>.wav` + `.words.json`) into
 * two shorter episodes at a sentence-final boundary, slicing the mono PCM at the
 * sample for the cut time. Re-using the existing word timings means zero TTS and
 * zero re-alignment. Worker-portable: bytes + JSON only.
 */

const RIFF_HEADER_SIZE = 12;
const WAV_CHUNK_HEADER_SIZE = 8;
const MIN_WAV_FORMAT_CHUNK_SIZE = 16;

export class ResliceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ResliceError";
	}
}

function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.slice(start, end));
}

export interface ParsedWav {
	sampleRate: number;
	numChannels: number;
	bitsPerSample: number;
	blockAlign: number; // bytes per sample frame
	pcm: Uint8Array; // raw data-chunk bytes
}

/**
 * Parse a canonical RIFF/WAVE file (as produced by `pcmToWavBuffer`) into its
 * format fields and raw PCM bytes. Tolerates extra chunks by walking the chunk
 * list rather than assuming a fixed 44-byte header.
 */
export function parseWav(audioBytes: Uint8Array): ParsedWav {
	const view = new DataView(
		audioBytes.buffer,
		audioBytes.byteOffset,
		audioBytes.byteLength,
	);
	if (
		readAscii(audioBytes, 0, 4) !== "RIFF" ||
		readAscii(audioBytes, 8, 12) !== "WAVE"
	) {
		throw new ResliceError("Audio file is not a RIFF/WAVE file.");
	}

	let numChannels: number | undefined;
	let sampleRate: number | undefined;
	let blockAlign: number | undefined;
	let bitsPerSample: number | undefined;
	let pcm: Uint8Array | undefined;
	let offset = RIFF_HEADER_SIZE;

	while (offset + WAV_CHUNK_HEADER_SIZE <= audioBytes.byteLength) {
		const chunkId = readAscii(audioBytes, offset, offset + 4);
		const chunkSize = view.getUint32(offset + 4, true);
		const chunkDataStart = offset + WAV_CHUNK_HEADER_SIZE;

		if (chunkDataStart + chunkSize > audioBytes.byteLength) {
			throw new ResliceError(`Invalid WAV chunk size for ${chunkId}.`);
		}

		if (chunkId === "fmt ") {
			if (chunkSize < MIN_WAV_FORMAT_CHUNK_SIZE) {
				throw new ResliceError("WAV fmt chunk is too short.");
			}
			numChannels = view.getUint16(chunkDataStart + 2, true);
			sampleRate = view.getUint32(chunkDataStart + 4, true);
			blockAlign = view.getUint16(chunkDataStart + 12, true);
			bitsPerSample = view.getUint16(chunkDataStart + 14, true);
		} else if (chunkId === "data") {
			pcm = audioBytes.slice(chunkDataStart, chunkDataStart + chunkSize);
		}

		offset = chunkDataStart + chunkSize + (chunkSize % 2);
	}

	if (
		numChannels === undefined ||
		sampleRate === undefined ||
		blockAlign === undefined ||
		bitsPerSample === undefined ||
		pcm === undefined
	) {
		throw new ResliceError("WAV file is missing fmt or data chunks.");
	}
	if (blockAlign <= 0 || pcm.length % blockAlign !== 0) {
		throw new ResliceError("WAV data is not aligned to whole sample frames.");
	}

	return { sampleRate, numChannels, bitsPerSample, blockAlign, pcm };
}

function sliceWav(
	parsed: ParsedWav,
	startFrame: number,
	endFrame: number,
): Uint8Array {
	const { blockAlign, sampleRate, numChannels, bitsPerSample, pcm } = parsed;
	const slice = pcm.subarray(startFrame * blockAlign, endFrame * blockAlign);
	return pcmToWavBuffer(slice, sampleRate, numChannels, bitsPerSample);
}

export interface EpisodeSplit {
	/** Character offset in the source text where the second half begins. */
	charIndex: number;
	/** Number of alignment words before the cut (= the split word index `k`). */
	wordIndex: number;
}

/**
 * Pick the sentence-final boundary nearest the word-count midpoint (§1.3).
 * Sentence boundaries carry a real pause, so the audio cut lands in silence.
 */
export function chooseEpisodeSplit(text: string): EpisodeSplit {
	const totalWords = extractAlignmentStoryWords(text).length;
	if (totalWords < 2) {
		throw new ResliceError(
			`Cannot split an episode with ${totalWords} word(s).`,
		);
	}

	const target = totalWords / 2;
	let best: EpisodeSplit | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const boundary of sentenceBoundaries(text)) {
		const charIndex = boundary.end;
		// Skip the final boundary (whole text) and any zero-length lead.
		if (charIndex <= 0 || charIndex >= text.length) continue;
		const wordIndex = extractAlignmentStoryWords(
			text.slice(0, charIndex),
		).length;
		if (wordIndex <= 0 || wordIndex >= totalWords) continue;

		const distance = Math.abs(wordIndex - target);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = { charIndex, wordIndex };
		}
	}

	if (!best) {
		throw new ResliceError(
			"No interior sentence boundary to split this episode on.",
		);
	}
	return best;
}

export interface ReslicePart {
	episodeIdx: number;
	audioPath: string;
	sourceTextPath: string;
	rawAlignmentPath: string;
}

export interface ResliceInput {
	sourceSidecar: WordTimingSidecar;
	sourceAudio: Uint8Array;
	/** Original episode text; must match `sourceSidecar` (asserted defensively). */
	sourceText: string;
	/** Where to cut. Defaults to `chooseEpisodeSplit(sourceText)`. */
	split?: EpisodeSplit;
	partA: ReslicePart;
	partB: ReslicePart;
	/** Deterministic timestamp for the new sidecars (`new Date()` is banned here). */
	generatedAt: string;
}

export interface ReslicedHalf {
	text: string;
	audio: Uint8Array;
	sidecar: WordTimingSidecar;
}

export interface ResliceResult {
	split: EpisodeSplit;
	a: ReslicedHalf;
	b: ReslicedHalf;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function resliceEpisode(input: ResliceInput): ResliceResult {
	const { sourceSidecar, sourceText } = input;

	// Defensive: the source must itself be internally consistent, or every half
	// derived from it would be garbage.
	const sourceCheck = checkSidecarMatchesEpisodeText(
		sourceSidecar,
		sourceSidecar.seasonSlug,
		sourceSidecar.episodeIdx,
		sourceText,
	);
	if (!sourceCheck.ok) {
		throw new ResliceError(
			`Source sidecar does not match source text: ${sourceCheck.reason}`,
		);
	}

	const split = input.split ?? chooseEpisodeSplit(sourceText);
	const { charIndex, wordIndex: k } = split;
	const words = sourceSidecar.words;
	if (k < 1 || k >= words.length) {
		throw new ResliceError(
			`Split word index ${k} is out of range for ${words.length} words.`,
		);
	}

	const textA = sourceText.slice(0, charIndex).trim();
	const textB = sourceText.slice(charIndex).trim();
	if (extractAlignmentStoryWords(textA).length !== k) {
		throw new ResliceError(
			"Split char index does not align with the requested word index (first half).",
		);
	}
	if (extractAlignmentStoryWords(textB).length !== words.length - k) {
		throw new ResliceError(
			"Split char index does not align with the requested word index (second half).",
		);
	}

	const { a, b } = resliceCore(input, textA, textB, k);
	return { split, a, b };
}

export interface ResliceToTextsInput {
	sourceSidecar: WordTimingSidecar;
	sourceAudio: Uint8Array;
	/** First-half text exactly as it appears in the (already split) season JSON. */
	textA: string;
	/** Second-half text exactly as it appears in the (already split) season JSON. */
	textB: string;
	partA: ReslicePart;
	partB: ReslicePart;
	generatedAt: string;
}

/**
 * Re-slice using the authoritative split texts rather than re-deriving them.
 *
 * The split point `k` is recovered from `textA`'s word count, so the new
 * sidecars hash the exact text the server will read from the season JSON — no
 * chance of a whitespace drift between the JSON split and the audio split. The
 * per-half acceptance check still confirms the source word timings line up.
 */
export function resliceEpisodeToTexts(
	input: ResliceToTextsInput,
): ResliceResult {
	const k = extractAlignmentStoryWords(input.textA).length;
	const bWords = extractAlignmentStoryWords(input.textB).length;
	const total = input.sourceSidecar.words.length;
	if (k < 1 || k >= total) {
		throw new ResliceError(
			`First-half word count ${k} is out of range for ${total} source words.`,
		);
	}
	if (k + bWords !== total) {
		throw new ResliceError(
			`Target texts have ${k} + ${bWords} words but the source sidecar has ${total}.`,
		);
	}
	return resliceCore(input, input.textA, input.textB, k);
}

interface CoreSource {
	sourceSidecar: WordTimingSidecar;
	sourceAudio: Uint8Array;
	partA: ReslicePart;
	partB: ReslicePart;
	generatedAt: string;
}

function resliceCore(
	input: CoreSource,
	textA: string,
	textB: string,
	k: number,
): ResliceResult {
	const words = input.sourceSidecar.words;
	const prevEnd = words[k - 1]?.end ?? 0;
	const nextStart = words[k]?.start ?? prevEnd;
	const cutTime = (prevEnd + nextStart) / 2;

	const parsed = parseWav(input.sourceAudio);
	const totalFrames = parsed.pcm.length / parsed.blockAlign;
	const cutFrame = clamp(
		Math.round(cutTime * parsed.sampleRate),
		1,
		totalFrames - 1,
	);
	const cutSeconds = cutFrame / parsed.sampleRate;

	const audioA = sliceWav(parsed, 0, cutFrame);
	const audioB = sliceWav(parsed, cutFrame, totalFrames);
	const durationA = readWavDurationSeconds(audioA);
	const durationB = readWavDurationSeconds(audioB);

	// First half keeps its timings verbatim; second half is rebased by the
	// sample-aligned cut time so its word ends stay within the shorter clip.
	const wordsA: WordTiming[] = words.slice(0, k).map((word) => ({
		index: word.index,
		text: word.text,
		start: clamp(word.start, 0, durationA),
		end: clamp(word.end, 0, durationA),
	}));
	const wordsB: WordTiming[] = words.slice(k).map((word, index) => ({
		index,
		text: word.text,
		start: clamp(word.start - cutSeconds, 0, durationB),
		end: clamp(word.end - cutSeconds, 0, durationB),
	}));

	const a = buildHalf(input, input.partA, textA, audioA, durationA, wordsA);
	const b = buildHalf(input, input.partB, textB, audioB, durationB, wordsB);

	return { split: { charIndex: -1, wordIndex: k }, a, b };
}

function buildHalf(
	input: CoreSource,
	part: ReslicePart,
	text: string,
	audio: Uint8Array,
	durationSeconds: number,
	words: WordTiming[],
): ReslicedHalf {
	const sidecar = wordTimingSidecarSchema.parse({
		seasonSlug: input.sourceSidecar.seasonSlug,
		episodeIdx: part.episodeIdx,
		audioPath: part.audioPath,
		sourceTextPath: part.sourceTextPath,
		rawAlignmentPath: part.rawAlignmentPath,
		audioHash: sha256(audio),
		textHash: sha256(text),
		alignerModel: input.sourceSidecar.alignerModel,
		durationSeconds,
		generatedAt: input.generatedAt,
		words,
	});

	const check = checkSidecarMatchesEpisodeText(
		sidecar,
		sidecar.seasonSlug,
		part.episodeIdx,
		text,
	);
	if (!check.ok) {
		throw new ResliceError(
			`Re-sliced episode ${part.episodeIdx} failed the acceptance check: ${check.reason}`,
		);
	}

	return { text, audio, sidecar };
}
