import { z } from "zod";

const MAX_EPISODE_IDX = 13;

export const episodeSchema = z.object({
	idx: z.number().int().min(0).max(MAX_EPISODE_IDX),
	text: z.string().min(1),
});

export const seasonSchema = z.object({
	slug: z.string().min(1),
	child_id: z.string().min(1),
	theme: z.string().min(1),
	episodes: z.array(episodeSchema).min(1),
});
