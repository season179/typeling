const CHAR_MAP: Record<string, string> = {
	"\u201C": '"',
	"\u201D": '"',
	"\u2018": "'",
	"\u2019": "'",
	"\u2014": "-",
	"\u2013": "-",
	"\u2026": "...",
};

/**
 * Normalise text to the allowed episode charset (ASCII printable + newline).
 *
 * Strategy: map smart quotes / dashes / ellipsis via a lookup table, decompose
 * accented letters with Unicode NFD and strip combining marks, then discard any
 * remaining non-ASCII characters.
 */
export function asciiNormalize(text: string): string {
	// Fast path: pure ASCII text passes through unchanged so callers'
	// change-detection guards (reference equality) work correctly.
	if (isAscii(text)) return text;
	return buildNormalized(text);
}

function isAscii(text: string): boolean {
	for (const ch of text) {
		if ((ch.codePointAt(0) ?? 0) > 127) return false;
	}
	return true;
}

function buildNormalized(text: string): string {
	const decomposed = text.normalize("NFD");
	const result: string[] = [];
	for (const ch of decomposed) {
		const mapped = CHAR_MAP[ch];
		if (mapped !== undefined) {
			result.push(mapped);
			continue;
		}
		// NFD separates combining marks from their base letters.
		// Non-ASCII characters (including those orphaned combining marks)
		// are silently dropped.
		if ((ch.codePointAt(0) ?? 0) <= 127) {
			result.push(ch);
		}
	}
	return result.join("");
}
