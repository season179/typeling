import { relative as pathRelative } from "node:path";

/**
 * Asset publisher — uploads seasons/ and data/audio/ to R2
 * with content-hash idempotency.
 *
 * Required env vars (see scripts/publish-assets.ts):
 *   CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */

export interface R2HeadResult {
	metadata: Record<string, string>;
}

export interface R2ObjectStore {
	head(key: string): Promise<R2HeadResult | null>;
	put(
		key: string,
		body: Uint8Array,
		metadata: Record<string, string>,
	): Promise<void>;
}

export interface PublishOptions {
	store: R2ObjectStore;
	seasonsDir: string;
	audioDir: string;
	dryRun?: boolean;
	onLog?: (msg: string) => void;
}

export interface PublishResult {
	uploaded: string[];
	skipped: string[];
}

interface FileEntry {
	localPath: string;
	key: string;
}

export async function discoverFiles(
	seasonsDir: string,
	audioDir: string,
): Promise<FileEntry[]> {
	const entries: FileEntry[] = [];

	for await (const file of walkDir(seasonsDir)) {
		if (!file.endsWith(".json")) continue;
		entries.push({
			localPath: file,
			key: `seasons/${pathRelative(seasonsDir, file)}`,
		});
	}

	for await (const file of walkDir(audioDir)) {
		entries.push({
			localPath: file,
			key: `audio/${pathRelative(audioDir, file)}`,
		});
	}

	return entries;
}

export async function publishAssets(
	opts: PublishOptions,
): Promise<PublishResult> {
	const entries = await discoverFiles(opts.seasonsDir, opts.audioDir);
	const uploaded: string[] = [];
	const skipped: string[] = [];

	for (const entry of entries) {
		const body = await Bun.file(entry.localPath).bytes();
		const hash = await sha256Hex(body);
		const existing = await opts.store.head(entry.key);

		if (existing?.metadata.sha256 === hash) {
			skipped.push(entry.key);
			opts.onLog?.(`SKIP ${entry.key} (hash match)`);
			continue;
		}

		if (opts.dryRun) {
			uploaded.push(entry.key);
			opts.onLog?.(`DRY-RUN would upload ${entry.key}`);
			continue;
		}

		await opts.store.put(entry.key, body, { sha256: hash });
		uploaded.push(entry.key);
		opts.onLog?.(`UPLOADED ${entry.key}`);
	}

	return { uploaded, skipped };
}

async function sha256Hex(data: Uint8Array): Promise<string> {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new Uint8Array(data.buffer as ArrayBuffer),
	);
	return Buffer.from(hash).toString("hex");
}

async function* walkDir(dir: string): AsyncGenerator<string> {
	let dirExists: boolean;
	try {
		const stat = await Bun.file(dir).stat();
		dirExists = stat?.isDirectory() ?? false;
	} catch {
		dirExists = false;
	}
	if (!dirExists) return;

	const glob = new Bun.Glob("**/*");
	for await (const filePath of glob.scan({ cwd: dir, absolute: true })) {
		const rel = pathRelative(dir, filePath);
		if (rel.split("/").some((seg) => seg.startsWith("."))) continue;
		const stat = await Bun.file(filePath).stat();
		if (stat?.isFile()) yield filePath;
	}
}
