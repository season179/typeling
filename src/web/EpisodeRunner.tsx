import { useEffect, useReducer, useRef, useState } from "react";
import { useLocation } from "wouter";
import { wpmFromCharsAndMs } from "../lib/wpm";
import { clearDraft, loadDraft, saveDraft } from "./episodeRunner/autosave";
import { episodeRunnerReducer as cursorReducer } from "./episodeRunner/reducer";
import { episodeRunnerReducer as sessionReducer } from "./episodeRunnerReducer";

interface EpisodeRunnerProps {
	episodeText: string;
	childId: string;
	seasonSlug: string;
	episodeIdx: number;
}

export default function EpisodeRunner({
	episodeText,
	childId,
	seasonSlug,
	episodeIdx,
}: EpisodeRunnerProps) {
	const [_, navigate] = useLocation();

	const [session, sessionDispatch] = useReducer(sessionReducer, {
		sessionId: null,
	});

	const [cursor, cursorDispatch] = useReducer(cursorReducer, {
		cursorIdx: 0,
		activeMs: 0,
		lastKeystrokeAt: null,
		flashUntil: null,
		startedAt: null,
	});

	const cursorRef = useRef(cursor.cursorIdx);
	cursorRef.current = cursor.cursorIdx;

	const sentRef = useRef(false);
	const [error, setError] = useState<string | null>(null);

	const [now, setNow] = useState(Date.now());

	useEffect(() => {
		const draft = loadDraft(childId, seasonSlug, episodeIdx);
		if (draft) {
			sessionDispatch({ type: "INIT", sessionId: draft.sessionId });
			cursorDispatch({
				type: "RESTORE",
				draft: {
					cursorIdx: draft.cursorIdx,
					activeMs: draft.activeMs,
					lastKeystrokeAt: draft.lastKeystrokeAt,
				},
			});
		} else {
			sessionDispatch({ type: "INIT", sessionId: crypto.randomUUID() });
		}
	}, [childId, seasonSlug, episodeIdx]);

	// Tick now for flash expiry
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 50);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") {
				cursorDispatch({ type: "BLUR" });
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	useEffect(() => {
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
			if (e.key === " ") {
				e.preventDefault();
			}
			cursorDispatch({
				type: "KEY_DOWN",
				key: e.key,
				expected: episodeText[cursorRef.current] ?? "",
				now: Date.now(),
				repeat: e.repeat,
			});
		};
		const onPaste = (e: ClipboardEvent) => {
			e.preventDefault();
		};
		document.addEventListener("keydown", onKeydown);
		document.addEventListener("paste", onPaste);
		return () => {
			document.removeEventListener("keydown", onKeydown);
			document.removeEventListener("paste", onPaste);
		};
	}, [episodeText]);

	const flash = cursor.flashUntil != null && cursor.flashUntil > now;

	useEffect(() => {
		if (session.sessionId === null) return;
		try {
			saveDraft(childId, seasonSlug, episodeIdx, {
				sessionId: session.sessionId,
				cursorIdx: cursor.cursorIdx,
				activeMs: cursor.activeMs,
				lastKeystrokeAt: cursor.lastKeystrokeAt,
			});
		} catch {
			// localStorage unavailable or full — non-critical, session still proceeds
		}
	}, [
		session.sessionId,
		cursor.cursorIdx,
		cursor.activeMs,
		cursor.lastKeystrokeAt,
		childId,
		seasonSlug,
		episodeIdx,
	]);

	// Completion effect
	useEffect(() => {
		if (cursor.cursorIdx !== episodeText.length) return;
		if (sentRef.current) return;
		sentRef.current = true;

		const body = {
			id: session.sessionId,
			child_id: childId,
			season_slug: seasonSlug,
			episode_idx: episodeIdx,
			wpm: wpmFromCharsAndMs(cursor.cursorIdx, cursor.activeMs),
			char_count: cursor.cursorIdx,
			active_ms: cursor.activeMs,
			started_at: cursor.startedAt
				? new Date(cursor.startedAt).toISOString()
				: new Date().toISOString(),
			finished_at: new Date().toISOString(),
		};

		fetch("/api/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})
			.then((res) => {
				if (res.ok) {
					clearDraft(childId, seasonSlug, episodeIdx);
					navigate(`/play/${childId}/complete/${episodeIdx}`);
				} else {
					setError(`Failed to save session (${res.status})`);
				}
			})
			.catch(() => {
				setError("Failed to save session");
			});
	}, [
		cursor.cursorIdx,
		episodeText.length,
		session.sessionId,
		childId,
		seasonSlug,
		episodeIdx,
		cursor.activeMs,
		cursor.startedAt,
		navigate,
	]);

	const typed = episodeText.slice(0, cursor.cursorIdx);
	const cursorChar = episodeText[cursor.cursorIdx] ?? "";
	const untyped = episodeText.slice(cursor.cursorIdx + 1);

	return (
		<>
			<span data-testid="session-id">{session.sessionId}</span>
			<span data-testid="cursor-idx">{cursor.cursorIdx}</span>
			<span data-testid="active-ms">{cursor.activeMs}</span>
			{error && <span data-testid="session-error">{error}</span>}
			<p className="font-mono">
				<span data-testid="typed-region" className="text-gray-400">
					{typed}
				</span>
				<span
					data-testid="cursor-char"
					className={`border-b-2 border-black animate-pulse ${
						flash ? "text-red-500" : "text-gray-900"
					}`}
				>
					{cursorChar}
				</span>
				<span data-testid="untyped-region" className="text-gray-900">
					{untyped}
				</span>
			</p>
		</>
	);
}
