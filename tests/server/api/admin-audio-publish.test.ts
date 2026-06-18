import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fetch } from "../../../src/server/index.ts";
import type {
	AssetStore,
	EpisodeAudioAsset,
	ServerBindings,
} from "../../../src/server/stores";
import type { WordTimingSidecar } from "../../../src/lib/wordTimings";

const LOCAL_URL =
	"http://127.0.0.1:3001/api/admin/seasons/winni-s1/episodes/0/audio/publish";

const postPublish = (
	env: Partial<ServerBindings> = {},
	url = LOCAL_URL,
): Promise<Response> =>
	Promise.resolve(
		fetch(new Request(url, { method: "POST" }), env as ServerBindings),
	);

// Minimal config that clears every gate: feature flag on + a loopback publisher
// URL. The gate tests below knock out one field at a time.
const fullConfig: Partial<ServerBindings> = {
	ADMIN_AUDIO_PUBLISH_ENABLED: "1",
	ALIGNER_URL: "http://127.0.0.1:8765",
};

describe("POST /api/admin/.../audio/publish gating", () => {
	it("rejects non-local hosts before any config check", async () => {
		const res = await postPublish(
			fullConfig,
			"https://typeling.example.com/api/admin/seasons/winni-s1/episodes/0/audio/publish",
		);
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "AdminLocalOnly" });
	});

	it("is disabled when the feature flag is unset", async () => {
		const res = await postPublish({});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "AudioPublishDisabled" });
	});

	it("reports not-configured when the publisher URL is missing", async () => {
		const res = await postPublish({ ADMIN_AUDIO_PUBLISH_ENABLED: "1" });
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "AudioPublishNotConfigured" });
	});

	it("refuses a non-loopback publisher URL", async () => {
		const res = await postPublish({
			...fullConfig,
			ALIGNER_URL: "https://publisher.example.com",
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "PublishUrlNotLoopback" });
	});
});

// A loopback fake of the Bun publisher sidecar. The Worker route reads audio
// from the (injected) AssetStore, then POSTs it here; this stand-in skips the
// real R2 upload and returns the success body the orchestrator expects.
function buildSidecar(audioHash: string, textHash: string): WordTimingSidecar {
	return {
		seasonSlug: "winni-s1",
		episodeIdx: 0,
		audioPath: "audio/winni-s1-e0.wav",
		sourceTextPath: "d1://seasons/winni-s1/episodes/0",
		rawAlignmentPath: "aligner://winni-s1-e0.qwen-align",
		audioHash,
		textHash,
		alignerModel: "test-aligner",
		durationSeconds: 1,
		generatedAt: "2026-06-18T00:00:00.000Z",
		words: [{ index: 0, text: "Hi", start: 0, end: 1 }],
	};
}

const AUDIO_HASH = "a".repeat(64);
const TEXT_HASH = "b".repeat(64);

// Injectable AssetStore that returns one ready-to-publish episode. Bypasses the
// real sidecar-hash validation so the route-level happy path stays offline.
const stubAssetStore: AssetStore = {
	async readEpisodeAudio(): Promise<EpisodeAudioAsset> {
		return {
			audioBytes: new Uint8Array([1, 2, 3, 4]),
			sidecar: buildSidecar(AUDIO_HASH, TEXT_HASH),
			contentType: "audio/wav",
		};
	},
	async readEpisodeAudioFile() {
		return null;
	},
	async writeEpisodeAudio() {},
};

describe("POST /api/admin/.../audio/publish happy path", () => {
	let server: ReturnType<typeof Bun.serve>;
	let publisherUrl: string;
	let lastRequest: {
		season: string;
		episodeIdx: string;
		expectedAudioHash: string;
		audioBytes: number;
	} | null = null;

	beforeAll(() => {
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (
					req.method === "POST" &&
					url.pathname === "/publish-episode-audio"
				) {
					const form = await req.formData();
					const audio = form.get("audio") as Blob;
					lastRequest = {
						season: String(form.get("season")),
						episodeIdx: String(form.get("episodeIdx")),
						expectedAudioHash: String(form.get("expectedAudioHash")),
						audioBytes: (await audio.arrayBuffer()).byteLength,
					};
					return Response.json({
						verified: true,
						wavSha256: AUDIO_HASH,
						skipped: false,
					});
				}
				return new Response("not found", { status: 404 });
			},
		});
		publisherUrl = `http://127.0.0.1:${server.port}`;
	});

	afterAll(() => {
		server.stop(true);
	});

	it("publishes via the loopback sidecar and returns the documented shape", async () => {
		const res = await postPublish({
			ADMIN_AUDIO_PUBLISH_ENABLED: "1",
			ALIGNER_URL: publisherUrl,
			ASSET_STORE: stubAssetStore,
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			season_slug: "winni-s1",
			episode: {
				idx: 0,
				publish: {
					textHash: TEXT_HASH,
					wavSha256: AUDIO_HASH,
					verified: true,
					skipped: false,
				},
			},
		});

		expect(lastRequest).toEqual({
			season: "winni-s1",
			episodeIdx: "0",
			expectedAudioHash: AUDIO_HASH,
			audioBytes: 4,
		});
	});

	it("surfaces the orchestrator error shape when audio is missing", async () => {
		const missingAssetStore: AssetStore = {
			...stubAssetStore,
			async readEpisodeAudio() {
				return null;
			},
		};
		const res = await postPublish({
			ADMIN_AUDIO_PUBLISH_ENABLED: "1",
			ALIGNER_URL: publisherUrl,
			ASSET_STORE: missingAssetStore,
		});

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			error: "AudioMissing",
			detail: "No generated audio for this episode.",
		});
	});
});
