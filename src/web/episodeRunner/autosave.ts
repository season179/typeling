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
	childId: string,
	seasonSlug: string,
	episodeIdx: number,
): string => `${DRAFT_PREFIX}${childId}:${seasonSlug}:${episodeIdx}`;

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

const parseDraftKey = (
	key: string,
): { childId: string; seasonSlug: string; episodeIdx: number } | null => {
	if (!key.startsWith(DRAFT_PREFIX)) return null;
	const parts = key.slice(DRAFT_PREFIX.length).split(":");
	if (parts.length < 3) return null;
	const episodeIdx = Number(parts.pop());
	if (Number.isNaN(episodeIdx)) return null;
	const seasonSlug = parts.pop();
	if (seasonSlug === undefined) return null;
	const childId = parts.join(":");
	if (!childId || !seasonSlug) return null;
	return { childId, seasonSlug, episodeIdx };
};

export function listDraftsForChild(
	childId: string,
): Array<{ childId: string; seasonSlug: string; episodeIdx: number }> {
	const prefix = `${DRAFT_PREFIX}${childId}:`;
	const results: Array<{
		childId: string;
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
	children: Record<string, { active_season: string }>,
): void {
	for (const [childId, child] of Object.entries(children)) {
		const drafts = listDraftsForChild(childId);
		for (const draft of drafts) {
			if (draft.seasonSlug !== child.active_season) {
				clearDraft(childId, draft.seasonSlug, draft.episodeIdx);
			}
		}
	}
}
