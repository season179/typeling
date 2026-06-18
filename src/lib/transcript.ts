/**
 * Pure transcript helpers: split raw episode prose into Storyteller / Character
 * speaker turns. No fs, no Bun, no process — safe to import in the Worker.
 *
 * Quote characters delimit speaker turns: text outside quotes is the
 * Storyteller, text inside quotes is the Character. The quote characters
 * themselves are dropped (they are delimiters, not spoken).
 */

export class TranscriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TranscriptError";
	}
}

export const ALLOWED_SPEAKERS = new Set(["Storyteller", "Character"]);

export interface TranscriptLine {
	speaker: "Storyteller" | "Character";
	text: string;
}

export function parseTranscript(text: string): TranscriptLine[] {
	const segments = text.split('"');
	const lines: TranscriptLine[] = [];

	for (let i = 0; i < segments.length; i++) {
		const trimmed = segments[i]?.trim() ?? "";
		if (trimmed.length === 0) continue;

		// Even-indexed segments (0, 2, 4, ...) are outside quotes → Storyteller
		// Odd-indexed segments (1, 3, 5, ...) are inside quotes → Character
		const speaker = i % 2 === 0 ? "Storyteller" : "Character";
		lines.push({ speaker, text: trimmed });
	}

	return lines;
}

export function validateTranscript(lines: TranscriptLine[]): void {
	for (const [i, line] of lines.entries()) {
		if (!ALLOWED_SPEAKERS.has(line.speaker)) {
			throw new TranscriptError(
				`Unexpected speaker label "${line.speaker}" on line ${i + 1}. ` +
					`Only Storyteller and Character are allowed.`,
			);
		}
	}
}

export function formatTranscript(lines: TranscriptLine[]): string {
	return `${lines.map((line) => `${line.speaker}: ${line.text}`).join("\n")}\n`;
}
