export type StoryToken =
	| { kind: "word"; text: string; wordIndex: number }
	| { kind: "space" | "newline" | "punctuation"; text: string };

export interface AlignmentStoryWord {
	wordIndex: number;
	text: string;
}

const WORD_PATTERN = /^[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/;

export function tokenizeStoryText(text: string): StoryToken[] {
	const tokens: StoryToken[] = [];
	let index = 0;
	let wordIndex = 0;

	while (index < text.length) {
		const char = text[index];

		if (char === "\r" || char === "\n") {
			const start = index;
			while (text[index] === "\r" || text[index] === "\n") {
				if (text[index] === "\r" && text[index + 1] === "\n") {
					index += 2;
				} else {
					index += 1;
				}
			}
			tokens.push({ kind: "newline", text: text.slice(start, index) });
			continue;
		}

		if (char === " " || char === "\t") {
			const start = index;
			while (text[index] === " " || text[index] === "\t") {
				index += 1;
			}
			tokens.push({ kind: "space", text: text.slice(start, index) });
			continue;
		}

		const wordMatch = text.slice(index).match(WORD_PATTERN);
		if (wordMatch?.[0]) {
			const word = wordMatch[0];
			tokens.push({ kind: "word", text: word, wordIndex });
			wordIndex += 1;
			index += word.length;
			continue;
		}

		tokens.push({ kind: "punctuation", text: char ?? "" });
		index += 1;
	}

	return tokens;
}

export function storyTokensToText(tokens: StoryToken[]): string {
	return tokens.map((token) => token.text).join("");
}

export function extractStoryWordTexts(text: string): string[] {
	return tokenizeStoryText(text)
		.filter((token): token is Extract<StoryToken, { kind: "word" }> => {
			return token.kind === "word";
		})
		.map((token) => token.text);
}

export function extractAlignmentStoryWords(text: string): AlignmentStoryWord[] {
	const words: AlignmentStoryWord[] = [];
	let chunk: StoryToken[] = [];

	const flushChunk = () => {
		const wordTokens = chunk.filter(
			(token): token is Extract<StoryToken, { kind: "word" }> =>
				token.kind === "word",
		);
		if (wordTokens.length === 1) {
			const [wordToken] = wordTokens;
			if (!wordToken) return;
			words.push({
				wordIndex: wordToken.wordIndex,
				text: chunk.map((token) => token.text).join(""),
			});
		} else if (wordTokens.length > 1) {
			for (const token of wordTokens) {
				words.push({ wordIndex: token.wordIndex, text: token.text });
			}
		}
		chunk = [];
	};

	for (const token of tokenizeStoryText(text)) {
		if (token.kind === "space" || token.kind === "newline") {
			flushChunk();
		} else {
			chunk.push(token);
		}
	}
	flushChunk();

	return words;
}
