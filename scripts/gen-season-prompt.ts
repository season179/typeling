import { MAX_EPISODES } from "../src/lib/schemas/season";
import { TERMS as BLACKLIST_TERMS } from "../src/lib/contentBlacklist";
import { wordCountBudget } from "../src/lib/wordCountBudget";

const ALLOWED_CHARS = "A-Z a-z 0-9 space . , ! ? ' \" ; : - ( ) and newline";

export interface PromptInputs {
	theme: string;
	targetWpm: number;
}

export interface BuiltPrompt {
	system: string;
	user: string;
}

export function buildPrompt({
	theme,
	targetWpm,
}: PromptInputs): BuiltPrompt {
	const { min, max } = wordCountBudget(targetWpm);
	const blacklist = BLACKLIST_TERMS.join(", ");

	const system = [
		"You write gentle, age-appropriate bedtime story episodes for a young child learning to type.",
		"Tone: warm, kind, encouraging, never punitive, never frightening.",
		"Audience: a child who is just starting to type. Keep vocabulary simple, sentences short.",
		"Privacy: do not use the child's real name, initials, family names, or any identifying personal details.",
		"Invent a short, memorable fictional name for the main character that fits the theme. Use that same fictional name throughout the whole season.",
		"Do not call the main character \"the child\", \"the learner\", \"the visitor\", or another generic label.",
		"Language: British English spelling and idiom (colour, favourite, realise, centre, organise, etc.).",
		`Allowed characters only: ${ALLOWED_CHARS}. Do not use em dashes, ellipses, smart quotes, emoji, or any non-ASCII character.`,
		`Forbidden words (do not use any form of these, anywhere): ${blacklist}.`,
		"No conflict beyond mild, easily-resolved problems. No injuries. No villains. No scary creatures. No sad endings.",
		"Output format: a single JSON array of exactly 14 strings. Each string is the full text of one episode. Episode 0 first, episode 13 last.",
		"Do not wrap the array in an object. Do not add commentary, code fences, or explanation. Output only the JSON array.",
	].join("\n");

	const user = [
		`Theme: ${theme}`,
		`Target episodes: exactly ${MAX_EPISODES}.`,
		`Word count per episode: between ${min} and ${max} words inclusive.`,
		"",
		`Write a gentle ${MAX_EPISODES}-episode story arc on the theme above, suitable for an early typing learner.`,
		"Give the protagonist a good fictional name that is not the real child's name.",
		"Each episode should stand on its own as a satisfying scene while moving the arc forward.",
		"Return only the JSON array of 14 episode texts.",
	].join("\n");

	return { system, user };
}
