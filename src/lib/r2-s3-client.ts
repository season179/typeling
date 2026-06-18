/**
 * r2-s3-client.ts — Minimal S3-compatible client for Cloudflare R2, used by the
 * asset-publish scripts (publish-assets.ts, publish-episode-audio.ts). Implements
 * just the AWS Signature V4 HEAD/PUT needed to upload audio artifacts with
 * content-hash idempotency and `sha256` custom metadata.
 *
 * Publish-time only — never imported by the Worker bundle (src/server/*).
 */
import type { R2HeadResult, R2ObjectStore } from "./asset-publisher";

// ─── AWS Signature V4 (minimal, R2-only) ─────────────────────────────

const SERVICE = "s3";
const REGION = "auto";

function amzDate(): string {
	return new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d+Z/, "Z");
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
	// Pass the view straight to digest so its byteOffset/byteLength are honoured;
	// `new Uint8Array(data.buffer)` would hash the whole backing buffer and so
	// disagree with the bytes actually uploaded for any subarray view.
	const encoded =
		typeof data === "string" ? new TextEncoder().encode(data) : data;
	// Our byte arrays are always ArrayBuffer-backed (never SharedArrayBuffer);
	// the cast satisfies BufferSource while the view's offset/length are honoured.
	const hash = await crypto.subtle.digest(
		"SHA-256",
		encoded as Uint8Array<ArrayBuffer>,
	);
	return Buffer.from(hash).toString("hex");
}

async function signingKey(
	secretKey: string,
	date: string,
): Promise<Uint8Array> {
	const kDate = await hmac(new TextEncoder().encode(`AWS4${secretKey}`), date);
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

	const sortedKeys = Object.keys(signedHeaders).sort();
	const canonicalHeaders = sortedKeys
		.map((k) => `${k}:${(signedHeaders[k] ?? "").trim()}\n`)
		.join("");
	const signedHeaderKeys = sortedKeys.join(";");

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
	const sigBuf = await hmac(key, stringToSign);
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

export class R2S3Client implements R2ObjectStore {
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
			// Blob honours the view's byteOffset/length, matching the bytes signed
			// by sha256Hex(body) above.
			body: new Blob([body as Uint8Array<ArrayBuffer>]),
		});

		if (!res.ok) {
			throw new Error(`R2 PUT ${key} failed: ${res.status} ${res.statusText}`);
		}
	}
}

/**
 * Build an {@link R2S3Client} from the standard publish env vars, defaulting the
 * bucket to `typeling-prod-assets`. Throws with a clear message if a required
 * credential is missing. Bun auto-loads these from `.env`.
 */
export function r2ClientFromEnv(): { client: R2S3Client; bucket: string } {
	const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
	const accessKey = requireEnv("R2_ACCESS_KEY_ID");
	const secretKey = requireEnv("R2_SECRET_ACCESS_KEY");
	const bucket = process.env.R2_BUCKET || "typeling-prod-assets";
	return {
		client: new R2S3Client({ accountId, bucket, accessKey, secretKey }),
		bucket,
	};
}

function requireEnv(name: string): string {
	const val = process.env[name];
	if (!val) {
		throw new Error(
			`Missing required env var: ${name}. Set CLOUDFLARE_ACCOUNT_ID, ` +
				`R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (in .env or your shell).`,
		);
	}
	return val;
}
