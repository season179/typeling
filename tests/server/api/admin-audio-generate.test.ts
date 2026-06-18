import { describe, expect, it } from "bun:test";
import type { ServerBindings } from "../../../src/server/stores";
import { fetch } from "../../../src/server/index.ts";

const LOCAL_URL =
	"http://127.0.0.1:3001/api/admin/seasons/rainbow-door-s1/episodes/0/audio";

const postGenerate = (
	env: Partial<ServerBindings> = {},
	url = LOCAL_URL,
): Promise<Response> =>
	Promise.resolve(
		fetch(new Request(url, { method: "POST" }), env as ServerBindings),
	);

const fullConfig: Partial<ServerBindings> = {
	ADMIN_AUDIO_GENERATION_ENABLED: "1",
	GEMINI_API_KEY: "gemini-key",
	OPENROUTER_API_KEY: "openrouter-key",
	ALIGNER_URL: "http://127.0.0.1:8765",
};

describe("POST /api/admin/.../audio gating", () => {
	it("rejects non-local hosts before any config check", async () => {
		const res = await postGenerate(
			fullConfig,
			"https://typeling.example.com/api/admin/seasons/rainbow-door-s1/episodes/0/audio",
		);
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "AdminLocalOnly" });
	});

	it("is disabled when the feature flag is unset", async () => {
		const res = await postGenerate({});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "AudioGenerationDisabled" });
	});

	it("reports not-configured when secrets are missing", async () => {
		const res = await postGenerate({ ADMIN_AUDIO_GENERATION_ENABLED: "1" });
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "AudioGenerationNotConfigured" });
	});

	it("refuses a non-loopback aligner URL", async () => {
		const res = await postGenerate({
			...fullConfig,
			ALIGNER_URL: "https://aligner.example.com",
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "AlignerUrlNotLoopback" });
	});
});
