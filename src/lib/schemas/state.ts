import { z } from "zod";

const MAX_EPISODE_IDX = 13;
const MAX_CURRENT_EPISODE = MAX_EPISODE_IDX + 1; // one past last valid episode — allows tracking season completion
const MAX_WPM = 1000;
const MAX_CHAR_COUNT = 10_000;
const MAX_ACTIVE_MS = 24 * 60 * 60 * 1000;

export const childSchema = z.object({
	name: z.string().min(1),
	theme: z.string().min(1),
	target_wpm: z.number().int().min(1).max(MAX_WPM),
	active_season: z.string().min(1),
	current_episode: z.number().int().min(0).max(MAX_CURRENT_EPISODE),
	current_session_id: z.string().min(1).nullable(),
});

export const signedInUserSchema = z.object({
	email: z.string().email(),
	name: z.string().min(1).optional(),
	display_name: z.string().min(1),
	access_subject: z.string().min(1).optional(),
});

export const userProfileSchema = signedInUserSchema.extend({
	target_wpm: z.number().int().min(1).max(MAX_WPM),
});

export const sessionSubmissionSchema = z
	.object({
		id: z.string().min(1),
		season_slug: z.string().min(1),
		episode_idx: z.number().int().min(0).max(MAX_EPISODE_IDX),
		wpm: z.number().min(0).max(MAX_WPM),
		char_count: z.number().int().min(0).max(MAX_CHAR_COUNT),
		active_ms: z.number().int().min(0).max(MAX_ACTIVE_MS),
		started_at: z.iso.datetime(),
		finished_at: z.iso.datetime(),
	})
	.refine((s) => Date.parse(s.finished_at) >= Date.parse(s.started_at), {
		message: "finished_at must be at or after started_at",
	});

export const sessionSchema = sessionSubmissionSchema.extend({
	email: z.string().email().optional(),
});

export const storyProgressSchema = z.object({
	email: z.string().email(),
	season_slug: z.string().min(1),
	current_episode: z.number().int().min(0).max(MAX_CURRENT_EPISODE),
});

export const stateSchema = z.object({
	children: z.record(z.string().min(1), childSchema),
	sessions: z.array(sessionSchema),
});

export type Session = z.infer<typeof sessionSchema>;
export type SessionSubmission = z.infer<typeof sessionSubmissionSchema>;
export type SignedInUser = z.infer<typeof signedInUserSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type StoryProgress = z.infer<typeof storyProgressSchema>;
export type Child = z.infer<typeof childSchema>;
export type State = z.infer<typeof stateSchema>;
