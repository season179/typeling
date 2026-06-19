import type { GraduationStatus } from "../lib/graduation";
import type { SessionTotals } from "../lib/readerStats";
import type { Session, UserProfile } from "../lib/schemas/state";

/**
 * The single seam between the Typeling frontend and its HTTP API. Every URL,
 * method, header and request body lives here, so the whole client/server
 * contract is legible in one file.
 *
 * Endpoints whose callers all want parsed JSON (and treat a non-2xx as a hard
 * failure) return typed data and throw `HTTP <status>` on failure. Endpoints
 * with caller-specific success/error handling (navigation, fallback UI,
 * error-body parsing) return the raw `Response`.
 */

export interface ProgressStory {
	slug: string;
	name: string;
	theme: string;
	total_episodes: number;
	current_episode: number;
	target_wpm: number;
	rolling3: number | null;
	status: GraduationStatus;
	recent_sessions: Session[];
}

export interface ProgressResponse {
	user: UserProfile;
	stories: ProgressStory[];
}

/** One story's progress for a single reader on the parent dashboard. */
export interface ReaderStoryProgress extends ProgressStory {
	totals: SessionTotals;
	/** Recent session WPMs, oldest -> newest, for the sparkline. */
	trend: number[];
	last_active_at: string | null;
}

/** A single kid (Google account) and their progress across every story. */
export interface ReaderProgress {
	email: string;
	display_name: string;
	target_wpm: number;
	stories: ReaderStoryProgress[];
}

export interface FamilyResponse {
	readers: ReaderProgress[];
}

export interface EpisodeData {
	text: string;
	episode_idx: number;
	current_episode: number;
	season_slug: string;
	story_name: string;
	total_episodes: number;
}

export interface EpisodeComplete {
	complete: true;
	current_episode: number;
	season_slug: string;
	story_name: string;
	total_episodes: number;
}

export type EpisodeResponse = EpisodeData | EpisodeComplete;

export type CurrentUserResponse =
	| { authenticated: false }
	| { authenticated: true; user: UserProfile };

export interface SessionSubmissionBody {
	id: string | null;
	season_slug: string;
	episode_idx: number;
	wpm: number;
	char_count: number;
	active_ms: number;
	started_at: string;
	finished_at: string;
}

function withSignal(signal?: AbortSignal): RequestInit | undefined {
	return signal ? { signal } : undefined;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
	const res = await fetch(path, withSignal(signal));
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}`);
	}
	return (await res.json()) as T;
}

export function getProgress(signal?: AbortSignal): Promise<ProgressResponse> {
	return getJson<ProgressResponse>("/api/progress", signal);
}

/**
 * The parent dashboard's all-kids feed. Throws `HTTP 401` when not signed in
 * and `HTTP 403` when the signed-in account is not an allowlisted viewer.
 */
export function getFamily(signal?: AbortSignal): Promise<FamilyResponse> {
	return getJson<FamilyResponse>("/api/parent/family", signal);
}

export function getCurrentEpisode(
	storySlug: string,
	signal?: AbortSignal,
): Promise<EpisodeResponse> {
	return getJson<EpisodeResponse>(
		`/api/stories/${storySlug}/current-episode`,
		signal,
	);
}

export function getEpisode(
	storySlug: string,
	episodeIdx: number | string,
	signal?: AbortSignal,
): Promise<EpisodeResponse> {
	return getJson<EpisodeResponse>(
		`/api/stories/${storySlug}/episodes/${episodeIdx}`,
		signal,
	);
}

/** Returns the signed-in user, falling back to unauthenticated on any non-ok. */
export async function getMe(
	signal?: AbortSignal,
): Promise<CurrentUserResponse> {
	const res = await fetch("/api/me", withSignal(signal));
	if (!res.ok) {
		return { authenticated: false };
	}
	return (await res.json()) as CurrentUserResponse;
}

export function resetEpisode(
	storySlug: string,
	episodeIdx: number,
): Promise<Response> {
	return fetch(`/api/stories/${storySlug}/episodes/${episodeIdx}/reset`, {
		method: "POST",
	});
}

export function postSession(body: SessionSubmissionBody): Promise<Response> {
	return fetch("/api/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

export function getEpisodeAudio(
	storySlug: string,
	episodeIdx: number,
	signal?: AbortSignal,
): Promise<Response> {
	return fetch(
		`/api/stories/${storySlug}/episodes/${episodeIdx}/audio`,
		withSignal(signal),
	);
}

export function getAdminStories(signal?: AbortSignal): Promise<Response> {
	return fetch("/api/admin/stories", withSignal(signal));
}

export function putAdminEpisode(
	storySlug: string,
	episodeIdx: number,
	text: string,
): Promise<Response> {
	return fetch(
		`/api/admin/seasons/${encodeURIComponent(storySlug)}/episodes/${episodeIdx}`,
		{
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text }),
		},
	);
}

export function postAdminEpisodeAudio(
	storySlug: string,
	episodeIdx: number,
): Promise<Response> {
	return fetch(
		`/api/admin/seasons/${encodeURIComponent(storySlug)}/episodes/${episodeIdx}/audio`,
		{ method: "POST" },
	);
}

export function postAdminEpisodeAudioPublish(
	storySlug: string,
	episodeIdx: number,
): Promise<Response> {
	return fetch(
		`/api/admin/seasons/${encodeURIComponent(storySlug)}/episodes/${episodeIdx}/audio/publish`,
		{ method: "POST" },
	);
}
