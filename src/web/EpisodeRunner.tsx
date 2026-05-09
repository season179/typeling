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
		const handler = (e: KeyboardEvent) => {
			if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
			cursorDispatch({
				type: "KEY_DOWN",
				key: e.key,
				expected: episodeText[cursorRef.current] ?? "",
			});
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [episodeText]);

	return (
		<>
			<span data-testid="session-id">{session.sessionId}</span>
			<span data-testid="cursor-idx">{cursor.cursorIdx}</span>
			<p className="font-mono">{episodeText}</p>
		</>
	);
}
