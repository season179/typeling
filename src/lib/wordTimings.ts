import { createHash } from "node:crypto";
import { z } from "zod";
import { extractAlignmentStoryWords } from "./storyWordTokens";

export const wordTimingSchema = z.object({
	index: z.number().int().min(0),
	text: z.string().min(1),
	start: z.number().nonnegative(),
	end: z.number().nonnegative(),
});

export const wordTimingSidecarSchema = z.object({
	seasonSlug: z.string().min(1),
	episodeIdx: z.number().int().min(0),
	audioPath: z.string().min(1),
	sourceTextPath: z.string().min(1),
	rawAlignmentPath: z.string().min(1),
	audioHash: z.string().length(64),
	textHash: z.string().length(64),
	alignerModel: z.string().min(1),
	durationSeconds: z.number().positive(),
	generatedAt: z.string().min(1),
	words: z.array(wordTimingSchema),
});

export type WordTiming = z.infer<typeof wordTimingSchema>;
export type WordTimingSidecar = z.infer<typeof wordTimingSidecarSchema>;

export interface BuildWordTimingSidecarInput {
	seasonSlug: string;
	episodeIdx: number;
	audioPath: string;
	sourceTextPath: string;
	rawAlignmentPath: string;
	sourceText: string;
	rawAlignment: string;
	audioBytes: Uint8Array;
	alignerModel: string;
	generatedAt?: string;
}

export class WordTimingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WordTimingError";
	}
}

const ALIGNMENT_LINE = /^\[(\d+(?:\.\d+)?)s? - (\d+(?:\.\d+)?)s?\]\s+(.+)$/;
const RIFF_HEADER_SIZE = 12;
const WAV_CHUNK_HEADER_SIZE = 8;
const MIN_WAV_FORMAT_CHUNK_SIZE = 16;

export function splitSourceWords(sourceText: string): string[] {
	return extractAlignmentStoryWords(sourceText).map((word) => word.text);
}

export function parseQwenAlignment(rawAlignment: string): WordTiming[] {
	const words: WordTiming[] = [];

	for (const line of rawAlignment.split(/\r?\n/)) {
		const match = line.match(ALIGNMENT_LINE);
		if (!match) continue;

		const [, rawStart, rawEnd, text] = match;
		if (!rawStart || !rawEnd || text === undefined) {
			throw new WordTimingError(`Invalid alignment line: ${line}`);
		}

		const start = Number(rawStart);
		const end = Number(rawEnd);

		if (!Number.isFinite(start) || !Number.isFinite(end)) {
			throw new WordTimingError(`Invalid timestamp in alignment line: ${line}`);
		}
		if (start < 0 || end < 0) {
			throw new WordTimingError(
				`Negative timestamp in alignment line: ${line}`,
			);
		}
		if (end < start) {
			throw new WordTimingError(`End before start in alignment line: ${line}`);
		}

		const previous = words.at(-1);
		if (previous && start < previous.end) {
			throw new WordTimingError(
				`Alignment moved backwards at word ${words.length}: ${line}`,
			);
		}

		words.push({ index: words.length, text, start, end });
	}

	if (words.length === 0) {
		throw new WordTimingError("No Qwen alignment word lines found.");
	}

	return words;
}

export function readWavDurationSeconds(audioBytes: Uint8Array): number {
	const view = new DataView(
		audioBytes.buffer,
		audioBytes.byteOffset,
		audioBytes.byteLength,
	);
	if (
		readAscii(audioBytes, 0, 4) !== "RIFF" ||
		readAscii(audioBytes, 8, 12) !== "WAVE"
	) {
		throw new WordTimingError("Audio file is not a RIFF/WAVE file.");
	}

	let hasFormatChunk = false;
	let byteRate: number | undefined;
	let dataSize: number | undefined;
	let offset = RIFF_HEADER_SIZE;

	while (offset + WAV_CHUNK_HEADER_SIZE <= audioBytes.byteLength) {
		const chunkId = readAscii(audioBytes, offset, offset + 4);
		const chunkSize = view.getUint32(offset + 4, true);
		const chunkDataStart = offset + WAV_CHUNK_HEADER_SIZE;

		if (chunkDataStart + chunkSize > audioBytes.byteLength) {
			throw new WordTimingError(`Invalid WAV chunk size for ${chunkId}.`);
		}

		if (chunkId === "fmt ") {
			if (chunkSize < MIN_WAV_FORMAT_CHUNK_SIZE) {
				throw new WordTimingError("WAV fmt chunk is too short.");
			}
			hasFormatChunk = true;
			byteRate = view.getUint32(chunkDataStart + 8, true);
		} else if (chunkId === "data") {
			dataSize = chunkSize;
		}

		offset = chunkDataStart + chunkSize + (chunkSize % 2);
	}

	if (!hasFormatChunk || !byteRate || !dataSize) {
		throw new WordTimingError("WAV file is missing fmt or data chunks.");
	}

	return dataSize / byteRate;
}

export function buildWordTimingSidecar(
	input: BuildWordTimingSidecarInput,
): WordTimingSidecar {
	const sourceWords = splitSourceWords(input.sourceText);
	if (sourceWords.length === 0) {
		throw new WordTimingError("Source text is empty.");
	}

	const words = parseQwenAlignment(input.rawAlignment);
	if (words.length !== sourceWords.length) {
		throw new WordTimingError(
			`Aligned word count ${words.length} does not match source word count ${sourceWords.length}.`,
		);
	}

	for (const word of words) {
		const expected = sourceWords[word.index];
		if (expected === undefined || word.text !== expected) {
			throw new WordTimingError(
				`Aligned word ${word.index} does not match source text: got ${JSON.stringify(
					word.text,
				)}, expected ${JSON.stringify(expected)}.`,
			);
		}
	}

	const durationSeconds = readWavDurationSeconds(input.audioBytes);
	const lastWord = words.at(-1);
	if (lastWord && lastWord.end > durationSeconds) {
		throw new WordTimingError(
			`Last word ends at ${lastWord.end}s, beyond audio duration ${durationSeconds.toFixed(
				2,
			)}s.`,
		);
	}

	return {
		seasonSlug: input.seasonSlug,
		episodeIdx: input.episodeIdx,
		audioPath: input.audioPath,
		sourceTextPath: input.sourceTextPath,
		rawAlignmentPath: input.rawAlignmentPath,
		audioHash: sha256(input.audioBytes),
		textHash: sha256(input.sourceText),
		alignerModel: input.alignerModel,
		durationSeconds,
		generatedAt: input.generatedAt ?? new Date().toISOString(),
		words,
	};
}

function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.slice(start, end));
}
