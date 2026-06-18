import { assertCharset, CharsetError } from "./assertCharset";
import { contentBlacklist } from "./contentBlacklist";

/**
 * A single reason a piece of story text is not acceptable for kids.
 *
 * `charset` carries the offending position/char, `blacklist` the matched
 * terms, and `forbidden-name` the forbidden name that leaked into the text.
 */
export type StoryTextViolation =
	| { kind: "charset"; position: number; char: string }
	| { kind: "blacklist"; terms: string[] }
	| { kind: "forbidden-name"; name: string };

/**
 * How a forbidden name is matched against the text.
 *
 * `word` (the default) matches only whole words, so "Beach" is not flagged
 * because a protagonist is named "Bea" — the right call for human-edited admin
 * text. `substring` flags any occurrence, including a name embedded in a longer
 * word ("Samantha" contains "Sam"); the generation pipeline uses it so an LLM
 * cannot smuggle a name in by extending it.
 */
export type NameMatchMode = "word" | "substring";

export interface StoryTextPolicyOptions {
	/**
	 * Names that must not appear in kid-facing text. The generation pipeline
	 * passes the single protagonist's own name so the model cannot echo it back
	 * into the prose. Defaults to none.
	 */
	forbiddenNames?: readonly string[];
	/**
	 * Whether a forbidden name is matched as a whole word or as a substring.
	 * Defaults to `word`. See {@link NameMatchMode}.
	 */
	nameMatch?: NameMatchMode;
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the first forbidden name that appears in `text` (case-insensitive),
 * or null. With `word` matching only whole words count, which avoids false
 * positives such as flagging "Beach" because a child is named "Bea"; with
 * `substring` matching any occurrence counts.
 */
export function findForbiddenName(
	text: string,
	names: readonly string[],
	mode: NameMatchMode = "word",
): string | null {
	const haystack = mode === "substring" ? text.toLowerCase() : text;
	for (const name of names) {
		const trimmed = name.trim();
		if (!trimmed) continue;
		if (mode === "substring") {
			if (haystack.includes(trimmed.toLowerCase())) return trimmed;
		} else {
			const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "i");
			if (pattern.test(text)) return trimmed;
		}
	}
	return null;
}

/**
 * The canonical definition of acceptable kid-facing story text: it must use
 * only the allowed charset, contain no blacklisted terms, and mention none of
 * the forbidden real names.
 *
 * Returns the single highest-priority violation (charset, then blacklist, then
 * forbidden name) or null when the text is clean. The fixed priority keeps the
 * error a caller surfaces stable regardless of how many rules the text breaks.
 */
export function checkStoryText(
	text: string,
	options: StoryTextPolicyOptions = {},
): StoryTextViolation | null {
	try {
		assertCharset(text);
	} catch (error) {
		if (!(error instanceof CharsetError)) {
			throw error;
		}
		return { kind: "charset", position: error.position, char: error.char };
	}

	const terms = contentBlacklist(text);
	if (terms.length > 0) {
		return { kind: "blacklist", terms };
	}

	const forbiddenName = findForbiddenName(
		text,
		options.forbiddenNames ?? [],
		options.nameMatch,
	);
	if (forbiddenName) {
		return { kind: "forbidden-name", name: forbiddenName };
	}

	return null;
}
