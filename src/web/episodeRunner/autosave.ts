import type { EpisodeRunnerState } from "./reducer";

export interface Draft
	extends Pick<
		EpisodeRunnerState,
		"cursorIdx" | "activeMs" | "lastKeystrokeAt"
	> {
	sessionId: string;
}

const DRAFT_PREFIX = "typeling:draft:";

export const keyFor = (
	ownerId: string,
	seasonSlug: string,
	episodeIdx: number,
): string => `${DRAFT_PREFIX}${ownerId}:${seasonSlug}:${episodeIdx}`;

export function saveDraft(
	ownerId: string,
	seasonSlug: string,
	episodeIdx: number,
	draft: Draft,
): void {
	localStorage.setItem(
		keyFor(ownerId, seasonSlug, episodeIdx),
		JSON.stringify(draft),
	);
}

export function loadDraft(
	ownerId: string,
	seasonSlug: string,
	episodeIdx: number,
): Draft | null {
	const key = keyFor(ownerId, seasonSlug, episodeIdx);
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
	ownerId: string,
	seasonSlug: string,
	episodeIdx: number,
): void {
	localStorage.removeItem(keyFor(ownerId, seasonSlug, episodeIdx));
}

const parseDraftKey = (
	key: string,
): { ownerId: string; seasonSlug: string; episodeIdx: number } | null => {
	if (!key.startsWith(DRAFT_PREFIX)) return null;
	const parts = key.slice(DRAFT_PREFIX.length).split(":");
	if (parts.length < 3) return null;
	const episodeIdx = Number(parts.pop());
	if (Number.isNaN(episodeIdx)) return null;
	const seasonSlug = parts.pop();
	if (seasonSlug === undefined) return null;
	const ownerId = parts.join(":");
	if (!ownerId || !seasonSlug) return null;
	return { ownerId, seasonSlug, episodeIdx };
};

export function listDraftsForOwner(
	ownerId: string,
): Array<{ ownerId: string; seasonSlug: string; episodeIdx: number }> {
	const prefix = `${DRAFT_PREFIX}${ownerId}:`;
	const results: Array<{
		ownerId: string;
		seasonSlug: string;
		episodeIdx: number;
	}> = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key === null) continue;
		if (!key.startsWith(prefix)) continue;
		const parsed = parseDraftKey(key);
		if (parsed) results.push(parsed);
	}
	return results;
}

export function clearStaleDrafts(
	ownerId: string,
	activeStorySlugs: string[],
): void {
	const activeStories = new Set(activeStorySlugs);
	const drafts = listDraftsForOwner(ownerId);
	for (const draft of drafts) {
		if (!activeStories.has(draft.seasonSlug)) {
			clearDraft(ownerId, draft.seasonSlug, draft.episodeIdx);
		}
	}
}
