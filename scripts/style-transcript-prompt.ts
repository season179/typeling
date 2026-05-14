/**
 * style-transcript-prompt.ts — Prompt template for styling a two-speaker
 * transcript into a bedtime TTS performance script.
 *
 * Two targets:
 *
 * - **`gemini`** (default) — Zack flow. Preamble is a short
 *   "Make Storyteller sound…" instruction; body uses `Storyteller:` /
 *   `Pixel:` speaker labels and `[bracket]` mood tags. Gemini consumes
 *   this format directly.
 *
 * - **`mimo-director`** — Winni flow with `mimo-v2.5-tts-voicedesign`.
 *   Preamble is a single-voice Character / Scene / Guidance description
 *   (one performer voices both roles). Body still uses the same speaker
 *   labels and `[bracket]` tags — labels help the LLM keep the dialogue
 *   structure straight, and the runner strips them before sending to MiMo
 *   (a single voice would otherwise read them aloud). Bracket tags are
 *   preserved by the Director Mode runner as audio-tag control.
 *
 * ## Review workflow for Season
 *
 * After the text model returns a styled transcript, review these points
 * before sending it to TTS:
 *
 * 1. **Story meaning preserved** — Read the styled transcript side-by-side
 *    with the original. No sentences should be added, removed, or reworded.
 *    The only additions should be [audio tags] in square brackets.
 *
 * 2. **No new plot events** — Check that every story beat matches the
 *    original transcript. If the model invented a new detail or reaction,
 *    remove it.
 *
 * 3. **British English intact** — Spot-check spellings like "colour",
 *    "favourite", "centre", "realise". The model must not Americanise them.
 *
 * 4. **Warm, kid-safe tone** — Read it aloud in your head. Every line should
 *    feel cosy, gentle, and appropriate for a 7–10 year old at bedtime.
 *    No creepy, sarcastic, or tense delivery.
 *
 * 5. **Only Storyteller and Pixel** — Grep for unexpected speaker labels.
 *    The transcript must only have `Storyteller:` and `Pixel:` lines.
 *
 * 6. **Audio tags are sparse and readable** — Tags like [softly], [gently],
 *    [warmly], [excitedly], [curiously] should appear only where they add
 *    real value. If every other word has a tag, it's too much. If a tag
 *    looks confusing or wrong, delete it.
 *
 * 7. **Preamble present and on-target** — There must be a short instruction
 *    block before the transcript. For `gemini`, "Make Storyteller sound…".
 *    For `mimo-director`, a Character / Scene / Guidance description of a
 *    single performer who voices both roles.
 *
 * 8. **No stray instruction text in the transcript** — The transcript lines
 *    after the preamble must contain only the spoken words and audio tags.
 *    If you see instructions, scene descriptions, or director's notes mixed
 *    into the transcript, remove them.
 *
 * This module does not call any network API. It only exports prompt text.
 */

export type StyleTarget = "gemini" | "mimo-director";

export interface StylePromptInputs {
	/** The raw transcript with Storyteller: / Pixel: lines. */
	transcript: string;
	/** Which TTS provider's preamble shape to emit. Defaults to `gemini`. */
	target?: StyleTarget;
}

export interface BuiltStylePrompt {
	system: string;
	user: string;
}

const GEMINI_PREAMBLE_RULE =
	'The first line MUST be a short TTS preamble telling the TTS model how each speaker should sound (e.g. "Make Storyteller sound warm and gentle… Make Pixel sound curious and bright…"). Then a blank line, then the transcript with audio tags.';

const GEMINI_EXAMPLE = [
	"Make Storyteller sound warm and gentle, like a parent reading a bedtime story. Make Pixel sound curious and bright, like a friendly young robot.",
	"",
	"Storyteller: [gently] In a cosy workshop filled with soft light...",
	"Pixel: [excitedly] What a lovely day!",
	"Storyteller: [warmly] said Pixel in a soft, buzzy voice.",
].join("\n");

const MIMO_DIRECTOR_PREAMBLE_RULE = [
	"The first line MUST be a Director Mode preamble describing a SINGLE performer who voices both Storyteller and Pixel. Cover three dimensions in plain prose (no headings, no labels, one paragraph):",
	"  • Character — identity, age, timbre, accent; how the performer differentiates Storyteller (warm, parental) from Pixel (a young, curious robot) without using two separate voices.",
	"  • Scene — bedtime mood; calm, intimate, quietly wondrous; never frightening.",
	"  • Guidance — pace, breath, pauses, dynamic range; how inline [bracket] tags should be interpreted (softly = hushed; excitedly = brighter lift; etc.).",
	"Then a blank line, then the transcript with audio tags.",
].join("\n");

const MIMO_DIRECTOR_EXAMPLE = [
	"A warm, gentle storyteller — an adult performer with a soft parental voice, reading a bedtime tale to a child. When voicing Pixel (a curious young robot character), lift the pitch slightly and add a small smile, but keep the same underlying timbre — this is one performer doing both parts. The mood is calm, intimate, quietly wondrous; never frightening. Speak slowly, with soft breath and unhurried pauses between sentences. Honour the inline [bracket] tags as performance direction.",
	"",
	"Storyteller: [gently] In a cosy workshop filled with soft light...",
	"Pixel: [excitedly] What a lovely day!",
	"Storyteller: [warmly] said Pixel in a soft, buzzy voice.",
].join("\n");

export function buildStylePrompt({
	transcript,
	target = "gemini",
}: StylePromptInputs): BuiltStylePrompt {
	const preambleRule =
		target === "mimo-director"
			? MIMO_DIRECTOR_PREAMBLE_RULE
			: GEMINI_PREAMBLE_RULE;

	const example =
		target === "mimo-director" ? MIMO_DIRECTOR_EXAMPLE : GEMINI_EXAMPLE;

	const system = [
		"You are a gentle, expert director for a children's bedtime audio performance.",
		"Your job is to take a two-speaker transcript and add light TTS performance direction.",
		"",
		"RULES (follow exactly):",
		"1. Preserve the original story meaning. Do not change, reword, add, or remove any words. Only add [audio tags] in square brackets.",
		"2. Keep British English spelling and idiom exactly as written. Do not Americanise any words.",
		"3. Keep a warm, kind, cosy bedtime tone throughout. Nothing scary, tense, or sad.",
		"4. Do not add new plot events, dialogue, or narration. Only add inline audio tags.",
		"5. Keep exactly two speaker labels in the transcript body: Storyteller and Pixel. Do not rename, merge, or add speakers.",
		"6. Use audio tags sparingly — only where they genuinely help the performance. A tag every 2–3 lines is plenty. Favour: [softly], [gently], [warmly], [excitedly], [curiously], [wonderingly], [brightly], [happily].",
		"7. Always put the output in the exact format described below.",
		"",
		"OUTPUT FORMAT:",
		preambleRule,
		"",
		"Example structure (do not copy the example text — use the real transcript):",
		"```",
		example,
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
