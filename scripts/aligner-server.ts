/**
 * aligner-server.ts — Local, loopback-only HTTP wrapper around the `speech`
 * forced aligner. This exists because the Cloudflare Workers runtime cannot
 * spawn the `speech` binary; the admin "Generate audio" route in the Worker
 * calls this service over 127.0.0.1 instead.
 *
 * Dev-only. Started alongside `bun run dev` and torn down with it. Never
 * deployed, never bound to a public address.
 *
 *   POST /align   multipart/form-data { audio: <wav file>, text: <source text> }
 *                 → 200 { alignment: "<raw Qwen alignment stdout>" }
 *   GET  /health  → 200 { ok: true }
 *
 * The aligner model is heavy, so alignments are serialised: one runs at a time.
 */

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALIGNER_MODEL } from "../src/lib/alignerModel";

const HOSTNAME = "127.0.0.1";
const PORT = Number(process.env.ALIGNER_PORT ?? "8765");

class AlignerError extends Error {
	constructor(
		message: string,
		readonly status: number,
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
					return Response.json({ error: err.message }, { status: err.status });
				}
				const message = err instanceof Error ? err.message : String(err);
				return Response.json({ error: message }, { status: 500 });
			}
		}

		return Response.json({ error: "Not found" }, { status: 404 });
	},
});

console.log(`[aligner] listening on http://${server.hostname}:${server.port}`);
