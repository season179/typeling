import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLocation } from "wouter";
import { sentenceBoundaries } from "../lib/sentenceBoundaries";
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
	const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const storyRef = useRef<HTMLDivElement | null>(null);
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

	// Cleanup nav timer on unmount
	useEffect(() => {
		return () => {
			if (navTimerRef.current !== null) {
				clearTimeout(navTimerRef.current);
			}
		};
	}, []);

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

		void fetch("/api/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})
			.then((res) => {
				if (res.ok) {
					clearDraft(childId, seasonSlug, episodeIdx);
					// Brief pause so the child can see the full story before navigating
					navTimerRef.current = setTimeout(() => {
						navigate(`/play/${childId}/complete/${episodeIdx}`);
					}, 600);
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

	// ── Sentence-level derived state ──

	const sentences = useMemo(
		() => sentenceBoundaries(episodeText),
		[episodeText],
	);

	const currentSentenceIdx = useMemo(() => {
		const idx = sentences.findIndex((s) => cursor.cursorIdx < s.end);
		return idx;
	}, [sentences, cursor.cursorIdx]);

	const completedSentences = useMemo(
		() => sentences.slice(0, Math.max(0, currentSentenceIdx)),
		[sentences, currentSentenceIdx],
	);

	const currentSentence =
		currentSentenceIdx >= 0 ? sentences[currentSentenceIdx] : null;

	const allDone =
		episodeText.length > 0 && cursor.cursorIdx >= episodeText.length;

	// Sentence-relative cursor position for the current sentence
	const sentenceStart = currentSentence?.start ?? 0;
	const relativeCursor = Math.max(0, cursor.cursorIdx - sentenceStart);
	const sentenceText = currentSentence
		? episodeText.slice(currentSentence.start, currentSentence.end)
		: "";
	const typedInSentence = sentenceText.slice(0, relativeCursor);
	const cursorCharInSentence = sentenceText[relativeCursor] ?? "";
	const untypedInSentence = sentenceText.slice(relativeCursor + 1);

	// Completed sentence text content for the story-so-far area
	const completedTexts = useMemo(
		() => completedSentences.map((s) => episodeText.slice(s.start, s.end)),
		[completedSentences, episodeText],
	);

	// Auto-scroll story area when completed sentences change
	const prevCompletedLen = useRef(completedSentences.length);
	useEffect(() => {
		if (completedSentences.length > prevCompletedLen.current) {
			storyRef.current?.scrollTo({
				top: storyRef.current.scrollHeight,
				behavior: "smooth",
			});
		}
		prevCompletedLen.current = completedSentences.length;
	}, [completedSentences.length]);

	return (
		<>
			{/* Hidden test elements — keep these for test compatibility */}
			<span data-testid="session-id" className="sr-only">
				{session.sessionId}
			</span>
			<span data-testid="cursor-idx" className="sr-only">
				{cursor.cursorIdx}
			</span>
			<span data-testid="active-ms" className="sr-only">
				{cursor.activeMs}
			</span>
			{error && (
				<span data-testid="session-error" className="sr-only">
					{error}
				</span>
			)}

			<main className="fixed inset-0 flex flex-col bg-[#fefaf2] overflow-hidden">
				{/* ── Story so far area ── */}
				<div
					ref={storyRef}
					className="flex-shrink-0 overflow-y-auto px-6 pt-6 sm:px-12 sm:pt-10"
				>
					<div className="mx-auto max-w-2xl space-y-3">
						{completedTexts.map((text, i) => (
							<p
								key={completedSentences[i]?.start ?? i}
								className="animate-fade-slide-up font-serif text-base leading-relaxed text-stone-400 sm:text-lg"
							>
								{text}
							</p>
						))}
						{/* Show all remaining sentences when fully done */}
						{allDone &&
							sentences.slice(completedSentences.length).map((s, i) => (
								<p
									key={s.start}
									className="animate-fade-slide-up font-serif text-base leading-relaxed text-stone-400 sm:text-lg"
									style={{ animationDelay: `${i * 0.08}s` }}
								>
									{episodeText.slice(s.start, s.end)}
								</p>
							))}
					</div>
				</div>

				{/* ── Spacer ── */}
				<div className="flex-1 min-h-0" />

				{/* ── Current sentence area ── */}
				{!allDone && currentSentence && (
					<div className="flex-shrink-0 px-6 pb-16 sm:px-12 sm:pb-24">
						<div className="mx-auto max-w-2xl text-center">
							<p className="font-serif text-2xl sm:text-3xl leading-relaxed text-stone-800 tracking-normal">
								<span data-testid="typed-region" className="text-stone-300">
									{typedInSentence}
								</span>
								<span
									data-testid="cursor-char"
									className={`inline-block border-b-[3px] ${
										flash
											? "border-red-400 text-red-400"
											: "border-amber-400 text-stone-800 cursor-glow"
									}`}
								>
									{cursorCharInSentence || "\u00A0"}
								</span>
								<span data-testid="untyped-region" className="text-stone-800">
									{untypedInSentence}
								</span>
							</p>
						</div>
					</div>
				)}

				{/* ── Completion celebration ── */}
				{allDone && (
					<div className="flex-shrink-0 px-6 pb-16 sm:px-12 sm:pb-24 text-center">
						<p className="animate-celebrate-pop font-serif text-2xl sm:text-3xl text-amber-600 font-semibold">
							Well done! ✨
						</p>
					</div>
				)}
			</main>
		</>
	);
}
