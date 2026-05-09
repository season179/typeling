export interface EpisodeRunnerState {
	sessionId: string | null;
}

type EpisodeRunnerAction = { type: "INIT"; sessionId: string };

export function episodeRunnerReducer(
	state: EpisodeRunnerState,
	action: EpisodeRunnerAction,
): EpisodeRunnerState {
	if (action.type === "INIT") {
		return { ...state, sessionId: action.sessionId };
	}
	return state;
}
