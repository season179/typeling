import { useEffect, useReducer, useRef, useState } from "react";
import { episodeRunnerReducer as cursorReducer } from "./episodeRunner/reducer";
import { episodeRunnerReducer as sessionReducer } from "./episodeRunnerReducer";

interface EpisodeRunnerProps {
	episodeText: string;
}

export default function EpisodeRunner({ episodeText }: EpisodeRunnerProps) {
	const [session, sessionDispatch] = useReducer(sessionReducer, {
		sessionId: null,
	});

	const [cursor, cursorDispatch] = useReducer(cursorReducer, {
		cursorIdx: 0,
		activeMs: 0,
		lastKeystrokeAt: null,
		flashUntil: null,
	});

	const cursorRef = useRef(cursor.cursorIdx);
	cursorRef.current = cursor.cursorIdx;

	const [now, setNow] = useState(Date.now());

	useEffect(() => {
		sessionDispatch({ type: "INIT", sessionId: crypto.randomUUID() });
	}, []);

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

	const typed = episodeText.slice(0, cursor.cursorIdx);
	const cursorChar = episodeText[cursor.cursorIdx] ?? "";
	const untyped = episodeText.slice(cursor.cursorIdx + 1);

	return (
		<>
			<span data-testid="session-id">{session.sessionId}</span>
			<span data-testid="cursor-idx">{cursor.cursorIdx}</span>
			<span data-testid="active-ms">{cursor.activeMs}</span>
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
