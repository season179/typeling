export interface EpisodeRunnerState {
	cursorIdx: number;
	activeMs: number;
	lastKeystrokeAt: number | null;
}

export type EpisodeRunnerAction =
	| {
			type: "KEY_DOWN";
			key: string;
			expected: string;
			timestamp: number;
			repeat?: boolean;
	  }
	| { type: "BLUR" };

export function episodeRunnerReducer(
	state: EpisodeRunnerState,
	action: EpisodeRunnerAction,
): EpisodeRunnerState {
	if (action.type === "BLUR") {
		if (state.lastKeystrokeAt === null) return state;
		return { ...state, lastKeystrokeAt: null };
	}
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
	const correct = action.key === action.expected;
	const delta =
		state.lastKeystrokeAt != null
			? Math.max(0, action.timestamp - state.lastKeystrokeAt)
			: 0;
	return {
		...state,
		activeMs: correct ? state.activeMs + delta : state.activeMs,
		lastKeystrokeAt: action.timestamp,
		cursorIdx: correct ? state.cursorIdx + 1 : state.cursorIdx,
	};
}
