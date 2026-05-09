import { useEffect, useReducer, useRef } from "react";
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
	});

	const cursorRef = useRef(cursor.cursorIdx);
	cursorRef.current = cursor.cursorIdx;

	useEffect(() => {
		sessionDispatch({ type: "INIT", sessionId: crypto.randomUUID() });
	}, []);

	useEffect(() => {
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key === " ") {
				e.preventDefault();
				return;
			}
			if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
			cursorDispatch({
				type: "KEY_DOWN",
				key: e.key,
				expected: episodeText[cursorRef.current] ?? "",
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

	const typed = episodeText.slice(0, cursor.cursorIdx);
	const cursorChar = episodeText[cursor.cursorIdx] ?? "";
	const untyped = episodeText.slice(cursor.cursorIdx + 1);

	return (
		<>
			<span data-testid="session-id">{session.sessionId}</span>
			<span data-testid="cursor-idx">{cursor.cursorIdx}</span>
			<p className="font-mono">
				<span data-testid="typed-region" className="text-gray-400">
					{typed}
				</span>
				<span
					data-testid="cursor-char"
					className="border-b-2 border-black animate-pulse text-gray-900"
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
