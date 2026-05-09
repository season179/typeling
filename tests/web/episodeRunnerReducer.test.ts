import { describe, expect, it } from "bun:test";
import {
	type EpisodeRunnerState,
	episodeRunnerReducer,
} from "../../src/web/episodeRunnerReducer";

describe("episodeRunnerReducer", () => {
	it("INIT sets sessionId in state", () => {
		const initial: EpisodeRunnerState = { sessionId: null };
		const next = episodeRunnerReducer(initial, {
			type: "INIT",
			sessionId: "abc-123",
		});
		expect(next.sessionId).toBe("abc-123");
	});
});
