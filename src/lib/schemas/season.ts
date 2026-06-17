import { z } from "zod";

// Episode counts are per-season; these are the absolute bounds shared by every
// episode-related schema so the cap lives in exactly one place. Keep the DB CHECK
// constraints in migrations/ aligned with these numbers.
export const MAX_EPISODES_PER_SEASON = 40;
export const MAX_EPISODE_IDX = MAX_EPISODES_PER_SEASON - 1;
// One past the last valid episode — lets progress track season completion.
export const MAX_CURRENT_EPISODE = MAX_EPISODES_PER_SEASON;

// Episodes to author when generating a brand-new season. Distinct from the
// absolute cap above: this is the shape we want for new content, not the limit
// the schema enforces. Existing seasons can be any length up to the cap.
export const TARGET_EPISODES_PER_SEASON = 28;

export const episodeSchema = z.object({
	idx: z.number().int().min(0).max(MAX_EPISODE_IDX),
	text: z.string().min(1),
});

export const seasonSchema = z.object({
	slug: z.string().min(1),
	name: z.string().min(1),
	theme: z.string().min(1),
	episodes: z.array(episodeSchema).min(1).max(MAX_EPISODES_PER_SEASON),
});
