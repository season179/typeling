export interface PlaybackWord {
	index: number;
	start: number;
	end: number;
}

export function findActiveWordIndex(
	words: PlaybackWord[],
	currentTime: number,
): number | null {
	if (words.length === 0 || !Number.isFinite(currentTime)) {
		return null;
	}

	let low = 0;
	let high = words.length - 1;
	let match = -1;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const word = words[mid];
		if (!word) break;
		if (word.start <= currentTime) {
			match = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	const matchedWord = words[match];
	return matchedWord ? matchedWord.index : null;
}
