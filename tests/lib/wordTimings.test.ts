import { describe, expect, it } from "bun:test";
import {
	buildWordTimingSidecar,
	type BuildWordTimingSidecarInput,
	parseQwenAlignment,
	readWavDurationSeconds,
	type WordTimingSidecar,
} from "../../src/lib/wordTimings";
import { pcmToWavBuffer } from "../../src/lib/wav";

const WAV_BYTES = pcmToWavBuffer(new Uint8Array(24000 * 2 * 2));
const BASE_SIDECAR_INPUT: BuildWordTimingSidecarInput = {
	seasonSlug: "zack-s1",
	episodeIdx: 0,
	audioPath: "data/audio/zack-s1-e0.wav",
	sourceTextPath: "data/audio/zack-s1-e0-source.txt",
	rawAlignmentPath: "data/audio/zack-s1-e0.qwen-align.raw.txt",
	sourceText: "In a cosy",
	rawAlignment: `
[0.00s - 0.88s] In
[1.04s - 1.04s] a
[1.12s - 1.20s] cosy
`,
	audioBytes: WAV_BYTES,
	alignerModel: "aufklarer/Qwen3-ForcedAligner-0.6B-4bit",
	generatedAt: "2026-05-20T00:00:00.000Z",
};

describe("word timings", () => {
	it("parses Qwen alignment output while ignoring progress logs", () => {
		const words = parseQwenAlignment(`
Loading audio: data/audio/zack-s1-e0.wav
Aligning...
[0.00s - 0.88s] In
[1.04s - 1.04s] a
[1.12s - 1.20s] cosy
Alignment took 2.44s
`);

		expect(words).toEqual([
			{ index: 0, text: "In", start: 0, end: 0.88 },
			{ index: 1, text: "a", start: 1.04, end: 1.04 },
			{ index: 2, text: "cosy", start: 1.12, end: 1.2 },
		]);
	});

	it("builds a sidecar tied to the exact source and WAV bytes", () => {
		const sidecar = buildTestSidecar();

		expect(sidecar.words).toHaveLength(3);
		expect(sidecar.words[2]).toEqual({
			index: 2,
			text: "cosy",
			start: 1.12,
			end: 1.2,
		});
		expect(sidecar.durationSeconds).toBe(2);
		expect(sidecar.audioHash).toHaveLength(64);
		expect(sidecar.textHash).toHaveLength(64);
	});

	it("fails when aligned text drifts from the source text", () => {
		expect(() =>
			buildTestSidecar({
				rawAlignment: `
[0.00s - 0.88s] In
[1.04s - 1.04s] the
[1.12s - 1.20s] cosy
`,
			}),
		).toThrow('got "the", expected "a"');
	});

	it("fails when timing moves backwards", () => {
		expect(() =>
			parseQwenAlignment(`
[0.00s - 0.88s] In
[0.80s - 1.04s] a
`),
		).toThrow("moved backwards");
	});

	it("fails when a timing exceeds the WAV duration", () => {
		expect(() =>
			buildTestSidecar({
				sourceText: "In",
				rawAlignment: "[1.90s - 2.10s] In",
			}),
		).toThrow("beyond audio duration");
	});

	it("reads WAV duration from the RIFF header", () => {
		expect(readWavDurationSeconds(WAV_BYTES)).toBe(2);
	});
});

function buildTestSidecar(
	overrides: Partial<BuildWordTimingSidecarInput> = {},
): WordTimingSidecar {
	return buildWordTimingSidecar({ ...BASE_SIDECAR_INPUT, ...overrides });
}
