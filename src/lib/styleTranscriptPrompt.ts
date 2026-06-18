/**
 * styleTranscriptPrompt.ts — Prompt template for styling a two-speaker
 * transcript into a bedtime TTS performance script for Gemini.
 *
 * The preamble is a short "Make Storyteller sound…" instruction; the body
 * uses `Storyteller:` / `Character:` speaker labels and `[bracket]` mood tags.
 * Gemini consumes this format directly.
 *
 * Pure: no network, no fs, no Bun — safe to import in the Worker.
 */

export interface StylePromptInputs {
	/** The raw transcript with Storyteller: / Character: lines. */
	transcript: string;
}

export interface BuiltStylePrompt {
	system: string;
	user: string;
}

const PREAMBLE_RULE =
	'The first line MUST be a short TTS preamble telling the TTS model how each speaker should sound (e.g. "Make Storyteller sound warm and gentle… Make Character sound curious and bright…"). Then a blank line, then the transcript with audio tags.';

const EXAMPLE = [
	"Make Storyteller sound warm and gentle, like a parent reading a bedtime story. Make Character sound curious and bright, like a friendly young companion.",
	"",
	"Storyteller: [gently] In a cosy workshop filled with soft light...",
	"Character: [excitedly] What a lovely day!",
	"Storyteller: [warmly] they said in a soft, happy voice.",
].join("\n");

export function buildStylePrompt({
	transcript,
}: StylePromptInputs): BuiltStylePrompt {
	const system = [
		"You are a gentle, expert director for a children's bedtime audio performance.",
		"Your job is to take a two-speaker transcript and add light TTS performance direction.",
		"",
		"RULES (follow exactly):",
		"1. Preserve the original story meaning. Do not change, reword, add, or remove any words. Only add [audio tags] in square brackets.",
		"2. Keep British English spelling and idiom exactly as written. Do not Americanise any words.",
		"3. Keep a warm, kind, cosy bedtime tone throughout. Nothing scary, tense, or sad.",
		"4. Do not add new plot events, dialogue, or narration. Only add inline audio tags.",
		"5. Keep exactly two speaker labels in the transcript body: Storyteller and Character. Do not rename, merge, or add speakers. The 'Character' label voices every quoted line, regardless of which named character in the story is speaking.",
		"6. Use audio tags sparingly — only where they genuinely help the performance. A tag every 2–3 lines is plenty. Favour: [softly], [gently], [warmly], [excitedly], [curiously], [wonderingly], [brightly], [happily].",
		"7. Always put the output in the exact format described below.",
		"",
		"OUTPUT FORMAT:",
		PREAMBLE_RULE,
		"",
		"Example structure (do not copy the example text — use the real transcript):",
		"```",
		EXAMPLE,
		"```",
		"",
		"IMPORTANT: The preamble (first line) is the ONLY direction the TTS model will receive. The transcript lines below it will be spoken aloud. Never put instructions, scene directions, or notes in the transcript section — only speaker-labelled lines with optional [audio tags].",
		"",
		"Return ONLY the final styled transcript. No markdown fences, no commentary, no explanation.",
	].join("\n");

	const user = [
		"Style this transcript for a warm bedtime TTS performance.",
		"Follow all the rules. Add sparse [audio tags] where helpful.",
		"Keep every original word. Do not invent anything new.",
		"",
		"--- RAW TRANSCRIPT ---",
		transcript,
		"--- END TRANSCRIPT ---",
	].join("\n");

	return { system, user };
}
