/**
 * aligner-server.ts — Local, loopback-only HTTP sidecar with two dev-only roles:
 *
 *   1. Forced alignment. A wrapper around the `speech` forced aligner, because
 *      the Cloudflare Workers runtime cannot spawn the `speech` binary; the
 *      admin "Generate audio" route in the Worker calls this over 127.0.0.1.
 *   2. Remote audio publish. The local Workers runtime's R2 binding is the LOCAL
 *      emulation, so the Worker cannot write the production R2 bucket directly.
 *      The admin "Publish to production" route reads + validates an episode's
 *      audio from local R2, then POSTs the bytes here; this sidecar performs the
 *      actual remote-R2 upload using the S3 creds in `.env` (via
 *      `r2ClientFromEnv()`). Production has no sidecar and no `.env`, so the
 *      publish feature is inert in prod by construction.
 *
 * Dev-only. Started alongside `bun run dev` and torn down with it. Never
 * deployed, never bound to a public address.
 *
 *   POST /align                  multipart/form-data { audio: <wav file>, text: <source text> }
 *                                → 200 { alignment: "<raw Qwen alignment stdout>" }
 *   POST /publish-episode-audio  multipart/form-data { audio: <wav file>, sidecar,
 *                                  season, episodeIdx, expectedAudioHash }
 *                                → 200 { verified: true, wavSha256, skipped }
 *   GET  /health                 → 200 { ok: true }
 *
 * The aligner model is heavy, so alignments are serialised: one runs at a time.
 */

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALIGNER_MODEL } from "../src/lib/alignerModel";
import { publishObjects } from "../src/lib/asset-publisher";
import { r2ClientFromEnv } from "../src/lib/r2-s3-client";
import { sha256, wordTimingSidecarSchema } from "../src/lib/wordTimings";

const HOSTNAME = "127.0.0.1";
const PORT = Number(process.env.ALIGNER_PORT ?? "8765");

/** A season slug that is safe to interpolate into an R2 object key: no path
 * separators, no `.`/`..`, so it cannot escape the `audio/` prefix. */
const SAFE_SLUG = /^[a-z0-9-]+$/;

class AlignerError extends Error {
	constructor(
		message: string,
		readonly status: number,
		/** Optional machine-readable code echoed to the Worker so it can map the
		 * failure to a specific AudioPublishError (e.g. a read-back verification
		 * failure must not be reported as a generic upload failure). */
		readonly code?: string,
	) {
		super(message);
		this.name = "AlignerError";
	}
}

// ── Serialise alignments ────────────────────────────────────────────
// The aligner model is large; running two at once would thrash. Chain each
// request behind the previous one so only one `speech align` runs at a time.
let tail: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
	const run = tail.then(fn, fn);
	tail = run.catch(() => undefined);
	return run;
}

// ── Preflight: is the `speech` CLI reachable? ───────────────────────
// Non-fatal: if `speech` is missing we still start the server so `bun run dev`
// (which supervises this with --kill-others-on-fail) is not torn down. The
// /align endpoint returns a clear 503 instead, and only the admin "Generate
// audio" button is affected.
async function detectSpeechAvailable(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["speech", "--help"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		// A non-zero exit means the binary exists but is broken (wrong version,
		// missing model, bad install). Treat that as unavailable so /align
		// returns the friendly 503 instead of failing deeper inside `speech
		// align`. `speech --help` exits 0 on a healthy install.
		return (await proc.exited) === 0;
	} catch {
		return false;
	}
}

// ── Run one forced alignment ────────────────────────────────────────
async function runAlignment(
	audioBytes: ArrayBuffer,
	sourceText: string,
): Promise<string> {
	const wavPath = join(tmpdir(), `typeling-align-${crypto.randomUUID()}.wav`);
	try {
		await Bun.write(wavPath, audioBytes);

		const proc = Bun.spawn(
			[
				"speech",
				"align",
				wavPath,
				"--text",
				sourceText,
				"--language",
				"en",
				"--aligner-model",
				ALIGNER_MODEL,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		if (exitCode !== 0) {
			throw new AlignerError(
				`speech align failed (exit ${exitCode}): ${stderr.trim().slice(0, 500)}`,
				502,
			);
		}
		if (stdout.trim().length === 0) {
			throw new AlignerError(
				"speech align produced no output on stdout.",
				502,
			);
		}
		return stdout;
	} finally {
		await rm(wavPath, { force: true }).catch(() => undefined);
	}
}

async function handleAlign(req: Request): Promise<Response> {
	let form: FormData;
	try {
		form = await req.formData();
	} catch {
		throw new AlignerError("Expected multipart/form-data body.", 400);
	}

	const audio = form.get("audio");
	const text = form.get("text");

	if (!(audio instanceof File)) {
		throw new AlignerError("Missing `audio` file field.", 400);
	}
	if (typeof text !== "string" || text.trim().length === 0) {
		throw new AlignerError("Missing `text` field.", 400);
	}

	const audioBytes = await audio.arrayBuffer();
	if (audioBytes.byteLength === 0) {
		throw new AlignerError("`audio` file is empty.", 400);
	}

	if (!speechAvailable) {
		throw new AlignerError(
			"The `speech` CLI is not available on PATH. Install it to generate audio.",
			503,
		);
	}

	const alignment = await serialize(() => runAlignment(audioBytes, text));
	return Response.json({ alignment });
}

// ── Publish one episode's audio to the production R2 bucket ─────────
// The Worker (under `bun run dev`) reads + validates the episode audio from
// LOCAL R2, then POSTs the bytes here. This handler re-verifies the bytes
// against their sidecar hash and uploads to remote R2 with `r2ClientFromEnv()`
// (creds from `.env`, read here only). Unlike /align, this does NOT require the
// `speech` CLI — publishing needs only R2 credentials.
async function handlePublishEpisodeAudio(req: Request): Promise<Response> {
	// The legitimate caller is the dev Worker — a server-side fetch that carries
	// no Origin header. A browser cross-origin POST (CSRF / DNS-rebinding against
	// this loopback port) always sends an Origin, so reject any request that has
	// one: a web page the user happens to visit during `bun run dev` must not be
	// able to drive a production-R2 write.
	if (req.headers.get("origin") !== null) {
		throw new AlignerError("Cross-origin requests are not allowed.", 403);
	}

	let form: FormData;
	try {
		form = await req.formData();
	} catch {
		throw new AlignerError("Expected multipart/form-data body.", 400);
	}

	const audioFile = form.get("audio");
	const sidecarString = form.get("sidecar");
	const season = form.get("season");
	const episodeIdxField = form.get("episodeIdx");
	const expectedAudioHash = form.get("expectedAudioHash");

	if (!(audioFile instanceof File)) {
		throw new AlignerError("Missing `audio` file field.", 400);
	}
	if (typeof sidecarString !== "string" || sidecarString.trim().length === 0) {
		throw new AlignerError("Missing `sidecar` field.", 400);
	}
	if (typeof season !== "string" || season.trim().length === 0) {
		throw new AlignerError("Missing `season` field.", 400);
	}
	if (typeof episodeIdxField !== "string" || episodeIdxField.trim() === "") {
		throw new AlignerError("Missing `episodeIdx` field.", 400);
	}
	// Canonical non-negative integer only: reject "1e2", "0x10", " 2 ", "01",
	// which Number() would silently coerce into a surprising index.
	const episodeIdx = Number(episodeIdxField);
	if (
		!Number.isInteger(episodeIdx) ||
		episodeIdx < 0 ||
		String(episodeIdx) !== episodeIdxField
	) {
		throw new AlignerError("`episodeIdx` must be a non-negative integer.", 400);
	}
	if (typeof expectedAudioHash !== "string" || expectedAudioHash.length === 0) {
		throw new AlignerError("Missing `expectedAudioHash` field.", 400);
	}

	const wavBytes = new Uint8Array(await audioFile.arrayBuffer());
	if (wavBytes.byteLength === 0) {
		throw new AlignerError("`audio` file is empty.", 400);
	}

	let sidecarObj: ReturnType<typeof wordTimingSidecarSchema.parse>;
	try {
		sidecarObj = wordTimingSidecarSchema.parse(JSON.parse(sidecarString));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new AlignerError(`Invalid sidecar JSON: ${message}`, 400);
	}

	// The bytes we received must hash to exactly the sidecar's audioHash, and the
	// caller's expectedAudioHash must agree. This rejects any mismatch between the
	// uploaded WAV, its sidecar, and what the Worker thought it was publishing.
	const actualHash = sha256(wavBytes);
	if (actualHash !== sidecarObj.audioHash) {
		throw new AlignerError(
			`WAV hash ${actualHash} does not match sidecar audioHash ${sidecarObj.audioHash}.`,
			400,
		);
	}
	if (sidecarObj.audioHash !== expectedAudioHash) {
		throw new AlignerError(
			`Sidecar audioHash ${sidecarObj.audioHash} does not match expectedAudioHash ${expectedAudioHash}.`,
			400,
		);
	}

	// The R2 destination key is built from the sidecar's own identity (bound to
	// the verified audio bytes above), and the form fields must agree with it — so
	// a caller cannot publish one episode's audio under another's key, and the
	// slug cannot smuggle path separators that would escape the `audio/` prefix.
	if (season !== sidecarObj.seasonSlug || episodeIdx !== sidecarObj.episodeIdx) {
		throw new AlignerError(
			`Form season/episodeIdx (${season}, ${episodeIdx}) do not match the sidecar (${sidecarObj.seasonSlug}, ${sidecarObj.episodeIdx}).`,
			400,
		);
	}
	if (!SAFE_SLUG.test(sidecarObj.seasonSlug)) {
		throw new AlignerError(
			`Unsafe season slug: ${JSON.stringify(sidecarObj.seasonSlug)}.`,
			400,
		);
	}

	let client: ReturnType<typeof r2ClientFromEnv>["client"];
	try {
		({ client } = r2ClientFromEnv());
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return Response.json(
			{ error: message, code: "PublishNotConfigured" },
			{ status: 503 },
		);
	}

	const base = `${sidecarObj.seasonSlug}-e${sidecarObj.episodeIdx}`;
	const wavKey = `audio/${base}.wav`;
	const sidecarKey = `audio/${base}.words.json`;
	const sidecarBytes = new TextEncoder().encode(sidecarString);
	const sidecarHash = sha256(sidecarBytes);

	// WAV first, sidecar last: the sidecar is the "ready" marker, so it must never
	// land before the audio it points at. publishObjects PUTs sequentially in order.
	const result = await publishObjects({
		store: client,
		objects: [
			{
				key: wavKey,
				body: wavBytes,
				metadata: { sha256: sidecarObj.audioHash },
			},
			{
				key: sidecarKey,
				body: sidecarBytes,
				metadata: { sha256: sidecarHash },
			},
		],
	});
	const skipped = result.uploaded.length === 0;

	// Read-back verify: both objects must actually be in remote R2 with the right
	// hash before we report success — a present-but-stale object is as bad as a
	// missing one. Reported with a code so the Worker can surface a verification
	// failure rather than a generic upload failure.
	const wavHead = await client.head(wavKey);
	if (!wavHead || wavHead.metadata.sha256 !== sidecarObj.audioHash) {
		throw new AlignerError(
			`Read-back verification failed: ${wavKey} missing or hash mismatch in R2.`,
			502,
			"PublishVerificationFailed",
		);
	}
	const sidecarHead = await client.head(sidecarKey);
	if (!sidecarHead || sidecarHead.metadata.sha256 !== sidecarHash) {
		throw new AlignerError(
			`Read-back verification failed: ${sidecarKey} missing or hash mismatch in R2.`,
			502,
			"PublishVerificationFailed",
		);
	}

	return Response.json({
		verified: true,
		wavSha256: sidecarObj.audioHash,
		skipped,
	});
}

const speechAvailable = await detectSpeechAvailable();
if (!speechAvailable) {
	console.warn(
		"[aligner] WARNING: `speech` CLI not found on PATH. The aligner will run, " +
			"but /align returns 503 until it is installed (the admin 'Generate audio' " +
			"button will fail with a clear message).",
	);
}

const server = Bun.serve({
	hostname: HOSTNAME,
	port: PORT,
	// Forced alignment can take a while. 255s is Bun's hard maximum for
	// idleTimeout; an alignment that streams no bytes for longer than this is
	// cut off. Episodes here are short (a couple of minutes of audio), so this
	// ceiling is comfortable in practice — but it IS a ceiling.
	idleTimeout: 255,
	async fetch(req) {
		const url = new URL(req.url);

		if (req.method === "GET" && url.pathname === "/health") {
			return Response.json({ ok: true, speechAvailable });
		}

		if (req.method === "POST" && url.pathname === "/align") {
			try {
				return await handleAlign(req);
			} catch (err) {
				if (err instanceof AlignerError) {
					return Response.json(
						err.code
							? { error: err.message, code: err.code }
							: { error: err.message },
						{ status: err.status },
					);
				}
				const message = err instanceof Error ? err.message : String(err);
				return Response.json({ error: message }, { status: 500 });
			}
		}

		if (req.method === "POST" && url.pathname === "/publish-episode-audio") {
			try {
				return await handlePublishEpisodeAudio(req);
			} catch (err) {
				if (err instanceof AlignerError) {
					return Response.json(
						err.code
							? { error: err.message, code: err.code }
							: { error: err.message },
						{ status: err.status },
					);
				}
				const message = err instanceof Error ? err.message : String(err);
				return Response.json({ error: message }, { status: 500 });
			}
		}

		return Response.json({ error: "Not found" }, { status: 404 });
	},
});

console.log(`[aligner] listening on http://${server.hostname}:${server.port}`);
