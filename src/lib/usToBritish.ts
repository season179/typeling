export const ENTRIES: [string, string][] = [
	["color", "colour"],
	["organize", "organise"],
	["organized", "organised"],
	["organizing", "organising"],
	["organization", "organisation"],
	["defense", "defence"],
	["defenses", "defences"],
	["behavior", "behaviour"],
	["behaviors", "behaviours"],
	["favorite", "favourite"],
	["favorites", "favourites"],
	["traveled", "travelled"],
	["traveling", "travelling"],
	["traveler", "traveller"],
	["realize", "realise"],
	["realized", "realised"],
	["recognize", "recognise"],
	["recognized", "recognised"],
	["analyze", "analyse"],
	["analyzed", "analysed"],
	["center", "centre"],
	["centered", "centred"],
	["theater", "theatre"],
	["meter", "metre"],
	["liter", "litre"],
];

/** American → British spelling dictionary. */
export const US_TO_BRITISH: ReadonlyMap<string, string> = new Map(ENTRIES);

const PATTERN = new RegExp(
	`\\b(${ENTRIES.map(([us]) => us)
		.sort((a, b) => b.length - a.length)
		.join("|")})\\b`,
	"gi",
);

export function usToBritish(text: string): string {
	return text.replace(PATTERN, (match) => {
		const lower = match.toLowerCase();
		const replacement = US_TO_BRITISH.get(lower);
		if (replacement === undefined) return match;

		if (match === match.toUpperCase()) {
			return replacement.toUpperCase();
		}
		const firstChar = match.charAt(0);
		const rest = match.slice(1);
		if (firstChar === firstChar.toUpperCase() && rest === rest.toLowerCase()) {
			return replacement.charAt(0).toUpperCase() + replacement.slice(1);
		}
		return replacement;
	});
}
