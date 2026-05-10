import type { Session } from "./schemas/state";

export interface Rolling3Opts {
	seasonSlug?: string;
}

export function rolling3Wpm(
	sessions: Session[],
	opts?: Rolling3Opts,
): number | null {
	const WINDOW = 3;

	const filtered = opts?.seasonSlug
		? sessions.filter((s) => s.season_slug === opts.seasonSlug)
		: sessions;

	if (filtered.length < WINDOW) return null;

	const sorted = filtered
		.map((s) => ({ s, ts: new Date(s.finished_at).getTime() }))
		.sort((a, b) => b.ts - a.ts)
		.map(({ s }) => s);

	const last = sorted.slice(0, WINDOW);
	return last.reduce((sum, s) => sum + s.wpm, 0) / WINDOW;
}
