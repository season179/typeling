import { useEffect, useReducer } from "react";
import { episodeRunnerReducer } from "./episodeRunnerReducer";

interface EpisodeRunnerProps {
	episodeText: string;
}

export default function EpisodeRunner({ episodeText }: EpisodeRunnerProps) {
	const [state, dispatch] = useReducer(episodeRunnerReducer, {
		sessionId: null,
	});

	useEffect(() => {
		dispatch({ type: "INIT", sessionId: crypto.randomUUID() });
	}, []);

	return (
		<>
			<span data-testid="session-id">{state.sessionId}</span>
			<p className="font-mono">{episodeText}</p>
		</>
	);
}
