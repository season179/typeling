export const TERMS = [
	"death",
	"died",
	"dying",
	"kill",
	"killed",
	"killer",
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

const PATTERN = new RegExp(
	`\\b(${[...TERMS].sort((a, b) => b.length - a.length).join("|")})\\b`,
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
