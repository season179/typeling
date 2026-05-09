export interface EpisodeRunnerState {
	cursorIdx: number;
}

export type EpisodeRunnerAction = {
	type: "KEY_DOWN";
	key: string;
	expected: string;
};

export function episodeRunnerReducer(
	state: EpisodeRunnerState,
	action: EpisodeRunnerAction,
): EpisodeRunnerState {
	if (action.type === "KEY_DOWN") {
		if (action.key === action.expected) {
			return { ...state, cursorIdx: state.cursorIdx + 1 };
		}
	}
	return state;
}
