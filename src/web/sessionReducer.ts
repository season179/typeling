export interface SessionReducerState {
	sessionId: string | null;
}

type SessionReducerAction = { type: "INIT"; sessionId: string };

export function sessionReducer(
	state: SessionReducerState,
	action: SessionReducerAction,
): SessionReducerState {
	if (action.type === "INIT") {
		return { ...state, sessionId: action.sessionId };
	}
	return state;
}
