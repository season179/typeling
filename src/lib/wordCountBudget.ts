const MIN_WORDS = 50;
const MAX_WORDS = 400;
const MIN_FACTOR = 5;
const MAX_FACTOR = 15;

function clampedBudget(targetWpm: number, factor: number): number {
	return Math.min(MAX_WORDS, Math.max(MIN_WORDS, targetWpm * factor));
}

export interface WordBudget {
	min: number;
	max: number;
}

export function wordCountBudget(targetWpm: number): WordBudget {
	return {
		min: clampedBudget(targetWpm, MIN_FACTOR),
		max: clampedBudget(targetWpm, MAX_FACTOR),
	};
}
