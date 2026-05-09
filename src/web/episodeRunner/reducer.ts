export interface EpisodeRunnerState {
	cursorIdx: number;
}

export type EpisodeRunnerAction = {
	type: "KEY_DOWN";
	key: string;
	expected: string;
	repeat?: boolean;
};

export function episodeRunnerReducer(
	state: EpisodeRunnerState,
	action: EpisodeRunnerAction,
): EpisodeRunnerState {
	if (action.type !== "KEY_DOWN") {
		return state;
	}
	if (action.repeat) {
		return state;
	}
	// Browser event.key for non-printable keys is always >1 char.
	if (action.key.length !== 1) {
		return state;
	}
	if (action.key === action.expected) {
		return { ...state, cursorIdx: state.cursorIdx + 1 };
	}
	return state;
}
