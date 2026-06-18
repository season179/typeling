/**
 * audioPublish.ts — Worker-side orchestrator for the /admin "Publish to
 * production" button. The Worker cannot write remote R2 directly (its
 * `ASSETS_BUCKET` binding is the LOCAL emulation under `bun run dev`), so this
 * module:
 *
 *   AssetStore.readEpisodeAudio (LOCAL R2 — validates + reads back)
 *     → multipart POST to the loopback sidecar (`scripts/aligner-server.ts`)
 *     → the sidecar performs the actual remote-R2 upload using `.env` creds
 *
 * Every external dependency is injectable so the whole thing runs offline in
 * tests. The default fetch is `globalThis.fetch` because the server module
 * shadows the global `fetch` name. No secrets are read here; the caller passes
 * the loopback sidecar URL in from the Worker `env` bindings.
 *
 * IMPORTANT (bundle purity): this module is in the Worker bundle, so it must
 * only import Worker-safe code. In particular it must NOT import
 * `asset-publisher.ts` (it pulls in `Bun`/`node:fs`); the remote upload runs in
 * the sidecar, not here.
 */

import { type AssetStore, EpisodeAudioError } from "./stores";

export type AudioPublishCode =
	| "AudioMissing"
	| "AudioStale"
	| "PublisherUnreachable"
	| "PublishNotConfigured"
	| "PublishUploadFailed"
	| "PublishVerificationFailed"
	| "PublisherBadResponse";

export class AudioPublishError extends Error {
	constructor(
		readonly code: AudioPublishCode,
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "AudioPublishError";
	}
}

export interface PublishEpisodeAudioResult {
	textHash: string;
	wavSha256: string;
	verified: boolean;
	skipped: boolean;
}

export interface PublishEpisodeAudioInput {
	seasonSlug: string;
	episodeIdx: number;
	episodeText: string;
	assetStore: AssetStore;
	/** Base URL of the loopback sidecar, e.g. http://127.0.0.1:8765 */
	publisherUrl: string;
	deps?: { fetchFn?: typeof fetch };
}

/** Response body returned by the sidecar's `/publish-episode-audio` endpoint. */
interface PublisherResponseBody {
	verified?: unknown;
	wavSha256?: unknown;
	skipped?: unknown;
}

/** What the sidecar reports back about the remote-R2 upload. */
export interface PublisherUploadResult {
	wavSha256: string;
	verified: boolean;
	skipped: boolean;
}

/**
 * POST one episode's already-generated audio to the loopback publisher sidecar.
 * `audio` is the WAV bytes, `sidecar` is the word-timing JSON (stringified), and
 * `expectedAudioHash` lets the sidecar reject a WAV/sidecar mismatch.
 */
export type AudioPublishFn = (input: {
	audioBytes: Uint8Array;
	sidecarJson: string;
	seasonSlug: string;
	episodeIdx: number;
	expectedAudioHash: string;
}) => Promise<PublisherUploadResult>;

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Default publisher: multipart POST to `${publisherUrl}/publish-episode-audio`
 * over loopback. Mirrors makeHttpAlignFn in audioGeneration.ts.
 */
export function makeHttpAudioPublisher(
	publisherUrl: string,
	fetchFn: typeof fetch,
): AudioPublishFn {
	const base = publisherUrl.replace(/\/+$/, "");
	return async ({
		audioBytes,
		sidecarJson,
		seasonSlug,
		episodeIdx,
		expectedAudioHash,
	}) => {
		const form = new FormData();
		// Blob copies its parts into immutable storage, honouring the view's
		// byteOffset/length, so the WAV bytes need no separate pre-copy. The cast
		// asserts the (always-true) ArrayBuffer backing that BlobPart requires.
		form.append(
			"audio",
			new Blob([audioBytes as Uint8Array<ArrayBuffer>], { type: "audio/wav" }),
			"episode.wav",
		);
		form.append("sidecar", sidecarJson);
		form.append("season", seasonSlug);
		form.append("episodeIdx", String(episodeIdx));
		form.append("expectedAudioHash", expectedAudioHash);

		let response: Response;
		try {
			response = await fetchFn(`${base}/publish-episode-audio`, {
				method: "POST",
				body: form,
			});
		} catch (err) {
			throw new AudioPublishError(
				"PublisherUnreachable",
				`Could not reach the local publisher at ${base}: ${describe(err)}. Is \`bun run dev\` running?`,
				503,
			);
		}

		if (!response.ok) {
			let code: string | undefined;
			let detail = "";
			try {
				const body = (await response.json()) as {
					error?: unknown;
					code?: unknown;
				};
				if (typeof body.code === "string") code = body.code;
				if (typeof body.error === "string") detail = body.error;
			} catch {
				detail = await response.text().catch(() => "");
			}
			if (code === "PublishNotConfigured") {
				throw new AudioPublishError(
					"PublishNotConfigured",
					detail ||
						"The local publisher has no R2 credentials configured (.env).",
					503,
				);
			}
			if (code === "PublishVerificationFailed") {
				throw new AudioPublishError(
					"PublishVerificationFailed",
					detail ||
						"The publisher could not verify the uploaded audio in production R2.",
					502,
				);
			}
			throw new AudioPublishError(
				"PublishUploadFailed",
				`Publisher returned HTTP ${response.status}: ${detail.slice(0, 300)}`,
				502,
			);
		}

		let body: PublisherResponseBody;
		try {
			body = (await response.json()) as PublisherResponseBody;
		} catch (err) {
			throw new AudioPublishError(
				"PublisherBadResponse",
				`Publisher returned invalid JSON: ${describe(err)}`,
				502,
			);
		}

		if (typeof body.wavSha256 !== "string" || body.wavSha256.trim() === "") {
			throw new AudioPublishError(
				"PublisherBadResponse",
				"Publisher response was missing wavSha256.",
				502,
			);
		}

		if (body.verified !== true) {
			throw new AudioPublishError(
				"PublishVerificationFailed",
				"Publisher could not verify the uploaded audio in production R2.",
				502,
			);
		}

		return {
			wavSha256: body.wavSha256,
			verified: true,
			skipped: body.skipped === true,
		};
	};
}

/**
 * Read one episode's already-generated audio from the (local) AssetStore and
 * hand it to the loopback publisher sidecar, which performs the remote-R2
 * upload. Throws {@link AudioPublishError} with a stage-specific code on any
 * failure.
 */
export async function publishEpisodeAudio(
	input: PublishEpisodeAudioInput,
): Promise<PublishEpisodeAudioResult> {
	const {
		seasonSlug,
		episodeIdx,
		episodeText,
		assetStore,
		publisherUrl,
		deps = {},
	} = input;

	const fetchFn = deps.fetchFn ?? globalThis.fetch;
	const publishFn = makeHttpAudioPublisher(publisherUrl, fetchFn);

	// 1. read the already-generated audio from the local AssetStore. A stale
	// hash surfaces as EpisodeAudioError; a missing asset returns null.
	let audio: Awaited<ReturnType<AssetStore["readEpisodeAudio"]>>;
	try {
		audio = await assetStore.readEpisodeAudio(
			seasonSlug,
			episodeIdx,
			episodeText,
		);
	} catch (err) {
		if (err instanceof EpisodeAudioError) {
			throw new AudioPublishError("AudioStale", err.message, 409);
		}
		throw err;
	}
	if (!audio) {
		throw new AudioPublishError(
			"AudioMissing",
			"No generated audio for this episode.",
			404,
		);
	}

	// 2. POST to the loopback sidecar, which uploads to remote R2.
	const result = await publishFn({
		audioBytes: audio.audioBytes,
		sidecarJson: JSON.stringify(audio.sidecar),
		seasonSlug,
		episodeIdx,
		expectedAudioHash: audio.sidecar.audioHash,
	});

	return {
		textHash: audio.sidecar.textHash,
		wavSha256: result.wavSha256,
		verified: result.verified,
		skipped: result.skipped,
	};
}
