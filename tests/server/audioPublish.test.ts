import { describe, expect, it } from "bun:test";
import { extractAlignmentStoryWords } from "../../src/lib/storyWordTokens";
import { pcmToWavBuffer } from "../../src/lib/wav";
import {
	buildWordTimingSidecar,
	type WordTimingSidecar,
} from "../../src/lib/wordTimings";
import {
	AudioPublishError,
	type PublishEpisodeAudioResult,
	publishEpisodeAudio,
} from "../../src/server/audioPublish";
import { InMemoryAssetStore } from "../../src/server/stores";

const SEASON = "rainbow-door-s1-pub";
const EPISODE_IDX = 0;
const EPISODE_TEXT = "Luma saw a rainbow path in the sunny garden.";
const PUBLISHER_URL = "http://127.0.0.1:8765";

/** A 1-second silent 24kHz mono 16-bit PCM buffer wrapped in a RIFF/WAVE container. */
function silentWavBytes(): Uint8Array {
	return pcmToWavBuffer(new Uint8Array(48000)); // 24000 samples * 2 bytes
}

/**
 * Build a sidecar that is internally consistent with `audioBytes` and the
 * episode text, using the same builder the production generator uses. This
 * guarantees the seeded asset passes the store's staleness gate.
 */
function buildSidecar(audioBytes: Uint8Array): WordTimingSidecar {
	// Derive an alignment whose word texts exactly match the source tokens.
	// buildWordTimingSidecar validates word-by-word, so reuse the same tokeniser
	// the production generator uses (extractAlignmentStoryWords) to mirror those
	// tokens in the raw alignment lines.
	const rawAlignment = extractAlignmentStoryWords(EPISODE_TEXT)
		.map((word, i) => {
			const start = (i * 0.01).toFixed(2);
			const end = (i * 0.01 + 0.005).toFixed(3);
			return `[${start}s - ${end}s] ${word.text}`;
		})
		.join("\n");

	return buildWordTimingSidecar({
		seasonSlug: SEASON,
		episodeIdx: EPISODE_IDX,
		audioPath: `audio/${SEASON}-e${EPISODE_IDX}.wav`,
		sourceTextPath: `text/${SEASON}-e${EPISODE_IDX}.txt`,
		rawAlignmentPath: `align/${SEASON}-e${EPISODE_IDX}.txt`,
		sourceText: EPISODE_TEXT,
		rawAlignment,
		audioBytes,
		alignerModel: "test-aligner",
		generatedAt: "2026-06-18T00:00:00.000Z",
	});
}

/** Seed a store with one ready, internally-consistent episode audio asset. */
function readyStore(): InMemoryAssetStore {
	const audioBytes = silentWavBytes();
	const sidecar = buildSidecar(audioBytes);
	return new InMemoryAssetStore({
		audio: [{ seasonSlug: SEASON, episodeIdx: EPISODE_IDX, audioBytes, sidecar }],
	});
}

/** A fetch mock that returns a fixed response and records what it was called with. */
function fetchReturning(
	response: Response,
	seen: { url: string; body?: FormData }[] = [],
): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		seen.push({ url, body: init?.body as FormData | undefined });
		return response;
	}) as typeof fetch;
}

function run(
	assetStore: InMemoryAssetStore,
	fetchFn: typeof fetch,
): Promise<PublishEpisodeAudioResult> {
	return publishEpisodeAudio({
		seasonSlug: SEASON,
		episodeIdx: EPISODE_IDX,
		episodeText: EPISODE_TEXT,
		assetStore,
		publisherUrl: PUBLISHER_URL,
		deps: { fetchFn },
	});
}

describe("publishEpisodeAudio", () => {
	it("returns textHash/wavSha256 on the verified happy path", async () => {
		const assetStore = readyStore();
		const expected = await assetStore.readEpisodeAudio(
			SEASON,
			EPISODE_IDX,
			EPISODE_TEXT,
		);
		expect(expected).not.toBeNull();
		const audioHash = expected?.sidecar.audioHash as string;
		const textHash = expected?.sidecar.textHash as string;

		const seen: { url: string; body?: FormData }[] = [];
		const fetchFn = fetchReturning(
			new Response(
				JSON.stringify({ verified: true, wavSha256: audioHash, skipped: false }),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
			seen,
		);

		const result = await run(assetStore, fetchFn);

		expect(result.verified).toBe(true);
		expect(result.skipped).toBe(false);
		expect(result.textHash).toBe(textHash);
		expect(result.wavSha256).toBe(audioHash);

		// It POSTed to the loopback sidecar's publish endpoint with multipart form data.
		expect(seen).toHaveLength(1);
		expect(seen[0]?.url).toBe(`${PUBLISHER_URL}/publish-episode-audio`);
		const form = seen[0]?.body;
		expect(form).toBeInstanceOf(FormData);
		expect(form?.get("season")).toBe(SEASON);
		expect(form?.get("episodeIdx")).toBe(String(EPISODE_IDX));
		expect(form?.get("expectedAudioHash")).toBe(audioHash);
		expect(form?.get("audio")).toBeInstanceOf(Blob);
		expect(typeof form?.get("sidecar")).toBe("string");
	});

	it("reports skipped:true when the sidecar already had the audio", async () => {
		const assetStore = readyStore();
		const expected = await assetStore.readEpisodeAudio(
			SEASON,
			EPISODE_IDX,
			EPISODE_TEXT,
		);
		const audioHash = expected?.sidecar.audioHash as string;

		const fetchFn = fetchReturning(
			new Response(
				JSON.stringify({ verified: true, wavSha256: audioHash, skipped: true }),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		const result = await run(assetStore, fetchFn);
		expect(result.verified).toBe(true);
		expect(result.skipped).toBe(true);
	});

	it("maps a missing asset to AudioMissing 404", async () => {
		const assetStore = new InMemoryAssetStore({}); // nothing seeded
		let fetched = false;
		const fetchFn = (async () => {
			fetched = true;
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		const promise = run(assetStore, fetchFn);
		await expect(promise).rejects.toMatchObject({
			name: "AudioPublishError",
			code: "AudioMissing",
			status: 404,
		});
		// The sidecar is never contacted when there is nothing to publish.
		expect(fetched).toBe(false);
	});

	it("maps a stale sidecar (EpisodeAudioError) to AudioStale 409", async () => {
		// Seed an asset whose sidecar does not match the audio bytes: readEpisodeAudio
		// will throw EpisodeAudioError, which the orchestrator must remap.
		const audioBytes = silentWavBytes();
		const sidecar = buildSidecar(audioBytes);
		// Corrupt the audioHash so the store's audioHash !== sha256(audioBytes) check fails.
		const staleSidecar: WordTimingSidecar = {
			...sidecar,
			audioHash: "0".repeat(64),
		};
		const assetStore = new InMemoryAssetStore({
			audio: [
				{
					seasonSlug: SEASON,
					episodeIdx: EPISODE_IDX,
					audioBytes,
					sidecar: staleSidecar,
				},
			],
		});

		let fetched = false;
		const fetchFn = (async () => {
			fetched = true;
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		const promise = run(assetStore, fetchFn);
		await expect(promise).rejects.toMatchObject({
			name: "AudioPublishError",
			code: "AudioStale",
			status: 409,
		});
		expect(fetched).toBe(false);
	});

	it("maps a fetch failure to PublisherUnreachable 503", async () => {
		const assetStore = readyStore();
		const fetchFn = (async () => {
			throw new Error("connection refused");
		}) as unknown as typeof fetch;

		const promise = run(assetStore, fetchFn);
		await expect(promise).rejects.toMatchObject({
			name: "AudioPublishError",
			code: "PublisherUnreachable",
			status: 503,
		});
	});

	it("maps a 200 with an unparseable body to PublisherBadResponse 502", async () => {
		const assetStore = readyStore();
		const fetchFn = fetchReturning(
			new Response("not json", {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		const promise = run(assetStore, fetchFn);
		await expect(promise).rejects.toMatchObject({
			name: "AudioPublishError",
			code: "PublisherBadResponse",
			status: 502,
		});
	});

	it("maps a 200 with verified:false to PublishVerificationFailed 502", async () => {
		const assetStore = readyStore();
		const expected = await assetStore.readEpisodeAudio(
			SEASON,
			EPISODE_IDX,
			EPISODE_TEXT,
		);
		const audioHash = expected?.sidecar.audioHash as string;
		const fetchFn = fetchReturning(
			new Response(
				JSON.stringify({ verified: false, wavSha256: audioHash, skipped: false }),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		const promise = run(assetStore, fetchFn);
		await expect(promise).rejects.toMatchObject({
			name: "AudioPublishError",
			code: "PublishVerificationFailed",
			status: 502,
		});
	});

	it("maps a 503 with code PublishNotConfigured through to PublishNotConfigured 503", async () => {
		const assetStore = readyStore();
		const fetchFn = fetchReturning(
			new Response(
				JSON.stringify({
					error: "no R2 creds",
					code: "PublishNotConfigured",
				}),
				{ status: 503, headers: { "content-type": "application/json" } },
			),
		);

		const promise = run(assetStore, fetchFn);
		await expect(promise).rejects.toMatchObject({
			name: "AudioPublishError",
			code: "PublishNotConfigured",
			status: 503,
		});
	});

	it("maps a non-ok response without a known code to PublishUploadFailed 502", async () => {
		const assetStore = readyStore();
		const fetchFn = fetchReturning(
			new Response(JSON.stringify({ error: "boom" }), {
				status: 500,
				headers: { "content-type": "application/json" },
			}),
		);

		const promise = run(assetStore, fetchFn);
		await expect(promise).rejects.toMatchObject({
			name: "AudioPublishError",
			code: "PublishUploadFailed",
			status: 502,
		});
	});

	it("exports a typed error class", () => {
		const err = new AudioPublishError("AudioMissing", "boom", 404);
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe("AudioMissing");
		expect(err.status).toBe(404);
	});
});
