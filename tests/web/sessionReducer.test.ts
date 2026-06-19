import { describe, expect, it } from "bun:test";
import {
	type SessionReducerState,
	sessionReducer,
} from "../../src/web/sessionReducer";

describe("sessionReducer", () => {
	it("INIT sets sessionId in state", () => {
		const initial: SessionReducerState = { sessionId: null };
		const next = sessionReducer(initial, {
			type: "INIT",
			sessionId: "abc-123",
		});
		expect(next.sessionId).toBe("abc-123");
	});
});
