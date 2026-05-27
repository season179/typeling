#!/usr/bin/env bun
/**
 * publish-assets.ts — Upload seasons/ and data/audio/ to Cloudflare R2
 * with content-hash idempotency.
 *
 * Required env vars:
 *   CLOUDFLARE_ACCOUNT_ID  — R2 account ID
 *   R2_ACCESS_KEY_ID       — R2 API token access key
 *   R2_SECRET_ACCESS_KEY   — R2 API token secret key
 *   R2_BUCKET              — Bucket name (default: typeling-assets)
 *
 * Usage:
 *   bun run scripts/publish-assets.ts            # upload changed files
 *   bun run scripts/publish-assets.ts --dry-run  # preview only, no writes
 *
 * No secrets are stored in the repo. Set env vars in your shell or .env.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	publishAssets,
	type R2HeadResult,
	type R2ObjectStore,
} from "../src/lib/asset-publisher";

// ─── AWS Signature V4 (minimal, R2-only) ─────────────────────────────

const SERVICE = "s3";
const REGION = "auto";

function amzDate(): string {
	return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key.buffer as ArrayBuffer,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		cryptoKey,
		new TextEncoder().encode(data),
	);
	return new Uint8Array(sig);
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
	const encoded =
		typeof data === "string"
			? new TextEncoder().encode(data)
			: new Uint8Array(data.buffer as ArrayBuffer);
	const hash = await crypto.subtle.digest("SHA-256", encoded);
	return Buffer.from(hash).toString("hex");
}

async function signingKey(
	secretKey: string,
	date: string,
): Promise<Uint8Array> {
	const kDate = await hmac(
		new TextEncoder().encode(`AWS4${secretKey}`),
		date,
	);
	const kRegion = await hmac(kDate, REGION);
	const kService = await hmac(kRegion, SERVICE);
	return hmac(kService, "aws4_request");
}

async function signRequest(opts: {
	method: string;
	url: URL;
	headers: Record<string, string>;
	body: Uint8Array | null;
	accessKey: string;
	secretKey: string;
}): Promise<Record<string, string>> {
	const date = amzDate();
	const stamp = date.slice(0, 8);
	const payloadHash = opts.body
		? await sha256Hex(opts.body)
		: "UNSIGNED-PAYLOAD";

	const signedHeaders: Record<string, string> = {
		...opts.headers,
		host: opts.url.host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date": date,
	};

	const canonicalHeaders = Object.keys(signedHeaders)
		.sort()
		.map((k) => `${k}:${signedHeaders[k]!.trim()}\n`)
		.join("");
	const signedHeaderKeys = Object.keys(signedHeaders).sort().join(";");

	const canonicalRequest = [
		opts.method,
		opts.url.pathname,
		opts.url.search.slice(1),
		canonicalHeaders,
		signedHeaderKeys,
		payloadHash,
	].join("\n");

	const credScope = `${stamp}/${REGION}/${SERVICE}/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		date,
		credScope,
		await sha256Hex(canonicalRequest),
	].join("\n");

	const key = await signingKey(opts.secretKey, stamp);
	const sigBuf = await hmac(
		key,
		stringToSign,
	);
	const signature = Buffer.from(sigBuf).toString("hex");

	const authHeader =
		`AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${credScope}, ` +
		`SignedHeaders=${signedHeaderKeys}, Signature=${signature}`;

	return {
		...signedHeaders,
		authorization: authHeader,
	};
}

// ─── S3-compatible R2 client ─────────────────────────────────────────

class R2S3Client implements R2ObjectStore {
	private readonly endpoint: string;
	private readonly bucket: string;
	private readonly accessKey: string;
	private readonly secretKey: string;

	constructor(opts: {
		accountId: string;
		bucket: string;
		accessKey: string;
		secretKey: string;
	}) {
		this.endpoint = `https://${opts.accountId}.r2.cloudflarestorage.com`;
		this.bucket = opts.bucket;
		this.accessKey = opts.accessKey;
		this.secretKey = opts.secretKey;
	}

	async head(key: string): Promise<R2HeadResult | null> {
		const url = new URL(`/${this.bucket}/${key}`, this.endpoint);
		const headers = await signRequest({
			method: "HEAD",
			url,
			headers: {},
			body: null,
			accessKey: this.accessKey,
			secretKey: this.secretKey,
		});

		const res = await fetch(url.toString(), {
			method: "HEAD",
			headers,
		});

		if (res.status === 404) return null;
		if (!res.ok) {
			throw new Error(`R2 HEAD ${key} failed: ${res.status} ${res.statusText}`);
		}

		// Extract x-amz-meta-* headers into metadata
		const metadata: Record<string, string> = {};
		for (const [k, v] of res.headers.entries()) {
			if (k.startsWith("x-amz-meta-")) {
				metadata[k.slice("x-amz-meta-".length)] = v;
			}
		}
		return { metadata };
	}

	async put(
		key: string,
		body: Uint8Array,
		metadata: Record<string, string>,
	): Promise<void> {
		const url = new URL(`/${this.bucket}/${key}`, this.endpoint);
		const metaHeaders: Record<string, string> = {};
		for (const [k, v] of Object.entries(metadata)) {
			metaHeaders[`x-amz-meta-${k}`] = v;
		}

		const headers = await signRequest({
			method: "PUT",
			url,
			headers: { ...metaHeaders, "content-length": String(body.length) },
			body,
			accessKey: this.accessKey,
			secretKey: this.secretKey,
		});

		const res = await fetch(url.toString(), {
			method: "PUT",
			headers,
			body: new Blob([body.buffer as ArrayBuffer]),
		});

		if (!res.ok) {
			throw new Error(`R2 PUT ${key} failed: ${res.status} ${res.statusText}`);
		}
	}
}

// ─── CLI ──────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
	const val = process.env[name];
	if (!val) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return val;
}

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			"dry-run": { type: "boolean", default: false },
		},
		strict: true,
	});

	const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
	const accessKey = requireEnv("R2_ACCESS_KEY_ID");
	const secretKey = requireEnv("R2_SECRET_ACCESS_KEY");
	const bucket = process.env.R2_BUCKET || "typeling-assets";

	const projectRoot = resolve(import.meta.dir, "..");
	const store = new R2S3Client({ accountId, bucket, accessKey, secretKey });

	const result = await publishAssets({
		store,
		seasonsDir: resolve(projectRoot, "seasons"),
		audioDir: resolve(projectRoot, "data", "audio"),
		dryRun: values["dry-run"],
		onLog: (msg) => console.log(msg),
	});

	console.log(
		`\nDone: ${result.uploaded.length} uploaded, ${result.skipped.length} skipped.`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
