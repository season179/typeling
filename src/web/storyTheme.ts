/**
 * Single source of truth for a story's visual theme.
 *
 * The theme used to be inferred from the slug containing a child's name; slugs
 * now describe the story instead, so detection keys off an explicit slug map
 * (covering the canonical seasons and their `-test`/variant suffixes) with a
 * content-token fallback for anything unknown — including the season `theme`
 * field when a caller has it. Centralised so every screen themes a story the
 * same way.
 */
export type StoryTheme = "rainbow" | "science";

const SLUG_THEME: Record<string, StoryTheme> = {
	"rainbow-door-s1": "rainbow",
	"pixel-garden-s1": "science",
};

export function themeForStory(storySlug?: string, storyTheme = ""): StoryTheme {
	const slug = (storySlug ?? "").toLowerCase();
	for (const [knownSlug, theme] of Object.entries(SLUG_THEME)) {
		// Exact match, plus `-test`/`-admin`/… variants used by fixtures/tests.
		if (slug === knownSlug || slug.startsWith(`${knownSlug}-`)) return theme;
	}
	const haystack = `${slug} ${storyTheme}`.toLowerCase();
	if (/pixel|garden|science|robot/.test(haystack)) return "science";
	return "rainbow";
}
