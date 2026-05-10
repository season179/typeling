import type { EpisodeRunnerState } from "./reducer";

export interface Draft
	extends Pick<
		EpisodeRunnerState,
		"cursorIdx" | "activeMs" | "lastKeystrokeAt"
	> {
	sessionId: string;
}

export const keyFor = (
	childId: string,
	seasonSlug: string,
	episodeIdx: number,
): string => `typeling:draft:${childId}:${seasonSlug}:${episodeIdx}`;

export function saveDraft(
	childId: string,
	seasonSlug: string,
	episodeIdx: number,
	draft: Draft,
): void {
	localStorage.setItem(
		keyFor(childId, seasonSlug, episodeIdx),
		JSON.stringify(draft),
	);
}

export function loadDraft(
	childId: string,
	seasonSlug: string,
	episodeIdx: number,
): Draft | null {
	const key = keyFor(childId, seasonSlug, episodeIdx);
	const raw = localStorage.getItem(key);
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as Draft;
	} catch {
		localStorage.removeItem(key);
		return null;
	}
}

export function clearDraft(
	childId: string,
	seasonSlug: string,
	episodeIdx: number,
): void {
	localStorage.removeItem(keyFor(childId, seasonSlug, episodeIdx));
}
