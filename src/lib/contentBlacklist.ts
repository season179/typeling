export const TERMS = [
	"death",
	"died",
	"dying",
	"kill",
	"killed",
	"killing",
	"hate",
	"scary",
	"scared",
	"blood",
	"bloody",
	"gore",
	"weapon",
	"gun",
	"knife",
	"war",
	"fight",
	"fighting",
	"evil",
	"demon",
	"devil",
	"hell",
];

// Leading \b only (no trailing \b): "killer" matches "kill" but "skill" doesn't.
const PATTERN = new RegExp(
	`\\b(${[...TERMS].sort((a, b) => b.length - a.length).join("|")})`,
	"gi",
);

export function contentBlacklist(text: string): string[] {
	const matches = text.matchAll(PATTERN);
	const found: string[] = [];
	for (const m of matches) {
		const term = m[1];
		if (term !== undefined) {
			found.push(term.toLowerCase());
		}
	}
	return found;
}
