export interface SentenceBoundary {
	start: number; // inclusive character index
	end: number; // exclusive character index
}

const ABBREVIATIONS = new Set(["Dr", "Mr", "Mrs", "Ms", "Prof", "St"]);

const CLOSING_QUOTES = new Set(['"', "'", "\u201C", "\u201D"]);

/**
 * Split text into sentence boundaries.
 * A sentence ends at . ! ? followed by optional closing quotes and then
 * space + capital letter (or end of text).  Known abbreviations like "Dr"
 * are not treated as sentence boundaries.
 */
export function sentenceBoundaries(text: string): SentenceBoundary[] {
	const boundaries: SentenceBoundary[] = [];
	let start = 0;

	for (let i = 0; i < text.length; i++) {
		const ch = text.charAt(i);
		if (ch === "." || ch === "!" || ch === "?") {
			// Skip abbreviations
			if (ch === ".") {
				let abbrStart = i - 1;
				while (abbrStart >= 0 && /[A-Za-z]/.test(text.charAt(abbrStart)))
					abbrStart--;
				const word = text.slice(abbrStart + 1, i);
				if (ABBREVIATIONS.has(word)) continue;
			}

			// Skip past closing quotes
			let end = i + 1;
			while (end < text.length && CLOSING_QUOTES.has(text.charAt(end))) end++;

			// Skip whitespace
			let next = end;
			while (next < text.length && text.charAt(next) === " ") next++;

			const isEnd = next >= text.length;
			const nextChar = isEnd ? "" : text.charAt(next);
			const isCapitalStart = /[A-Z"]/.test(nextChar);

			if (isEnd || isCapitalStart) {
				// Include trailing whitespace so the space between sentences
				// belongs to the completed sentence (not invisible).
				boundaries.push({ start, end: next });
				start = next;
				i = next - 1; // will be incremented by loop
			}
		}
	}

	// Trailing text without punctuation
	if (start < text.length) {
		boundaries.push({ start, end: text.length });
	}

	// Ensure non-empty result for non-empty input
	if (boundaries.length === 0 && text.length > 0) {
		boundaries.push({ start: 0, end: text.length });
	}

	return boundaries;
}
