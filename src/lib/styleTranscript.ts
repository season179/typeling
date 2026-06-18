/**
 * styleTranscript.ts — Worker-safe validation for styled TTS transcripts.
 *
 * Two responsibilities:
 *   1. `validateStyledTranscript` — shape check: a Gemini-style
 *      "Make Storyteller sound…" preamble followed by speaker-labelled
 *      lines containing both speakers.
 *   2. `assertStyledPreservesEpisodeText` — content check: the words actually
 *      spoken in the styled transcript (after stripping the preamble, speaker
 *      labels, and [audio tags]) must match the episode source word-for-word.
 *      This catches an LLM that reworded, dropped, or invented words BEFORE we
 *      spend a TTS call and then fail forced alignment against the source text.
 *
 * Pure: only depends on the shared tokenizer — safe to import in the Worker.
 */

import { extractStoryWordTexts } from "./storyWordTokens";

export class StyleValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StyleValidationError";
	}
}

export class StylePreservationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StylePreservationError";
	}
}

const SPEAKER_LINE = /^(Storyteller|Character): /i;
const SPEAKER_LABEL = /^(Storyteller|Character):\s*/i;
const AUDIO_TAG = /\[[^\]]*\]/g;

/**
 * Validate that the styled transcript output meets all the requirements
 * for a valid bedtime TTS script: a Gemini-style "Make Storyteller sound…"
 * preamble followed by speaker-labelled transcript lines with optional
 * [audio tags].
 */
export function validateStyledTranscript(output: string): void {
	if (output.trim().length === 0) {
		throw new StyleValidationError("Styled transcript is empty.");
	}

	const lines = output.split("\n");

	// Must have at least a preamble and one transcript line
	if (lines.length < 2) {
		throw new StyleValidationError(
			"Styled transcript too short. Expected a TTS preamble and at least one transcript line.",
		);
	}

	const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";

	if (
		!firstNonEmpty.toLowerCase().includes("make storyteller") &&
		!firstNonEmpty.toLowerCase().includes("storyteller sound")
	) {
		throw new StyleValidationError(
			"Styled transcript missing TTS preamble on the first line. " +
				'The preamble should start with something like "Make Storyteller sound…"',
		);
	}

	// Collect transcript lines (after preamble, lines with speaker prefix)
	const transcriptLines = lines.filter((l) => SPEAKER_LINE.test(l.trim()));

	if (transcriptLines.length === 0) {
		throw new StyleValidationError(
			"No speaker-labelled transcript lines found. Expected lines starting with 'Storyteller: ' or 'Character: '.",
		);
	}

	// Must have both speakers (the regex already guarantees only valid speaker labels)
	const hasStoryteller = transcriptLines.some((l) =>
		/^Storyteller: /i.test(l.trim()),
	);
	const hasCharacter = transcriptLines.some((l) =>
		/^Character: /i.test(l.trim()),
	);

	if (!hasStoryteller || !hasCharacter) {
		throw new StyleValidationError(
			"Styled transcript must contain both Storyteller and Character speaker lines.",
		);
	}
}

/**
 * Extract just the spoken prose from a styled transcript: keep only
 * speaker-labelled lines, drop the speaker label and any [audio tags].
 * The preamble and any stray non-speaker lines are discarded.
 */
export function extractStyledSpokenText(styled: string): string {
	return styled
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => SPEAKER_LINE.test(line))
		.map((line) => line.replace(SPEAKER_LABEL, "").replace(AUDIO_TAG, " "))
		.join("\n");
}

/**
 * Assert the styled transcript still speaks exactly the episode's words, in
 * order. Comparison is on word tokens only (punctuation, quotes, and casing
 * are ignored) because styling drops the quote delimiters and may adjust
 * sentence-initial casing — neither changes the spoken words. Any added,
 * removed, or reworded word is a hard failure.
 */
export function assertStyledPreservesEpisodeText(
	styled: string,
	episodeText: string,
): void {
	const spoken = extractStoryWordTexts(extractStyledSpokenText(styled)).map(
		(w) => w.toLowerCase(),
	);
	const expected = extractStoryWordTexts(episodeText).map((w) =>
		w.toLowerCase(),
	);

	if (spoken.length !== expected.length) {
		throw new StylePreservationError(
			`Styled transcript word count (${spoken.length}) does not match the episode source (${expected.length}). ` +
				"The styling step must not add or remove words.",
		);
	}

	for (let i = 0; i < expected.length; i += 1) {
		if (spoken[i] !== expected[i]) {
			throw new StylePreservationError(
				`Styled transcript diverges from the episode source at word ${i + 1}: ` +
					`expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(spoken[i])}. ` +
					"The styling step must not reword the story.",
			);
		}
	}
}
