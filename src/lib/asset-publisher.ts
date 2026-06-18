import { relative as pathRelative } from "node:path";

/**
 * Asset publisher — uploads data/audio/ to R2
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
	audioDir: string;
	dryRun?: boolean;
	onLog?: (msg: string) => void;
}

export interface PublishResult {
	uploaded: string[];
	skipped: string[];
}

export interface FileEntry {
	localPath: string;
	key: string;
}

/** A fully-resolved object ready to publish: bytes + the metadata (notably
 * `sha256`) used for content-hash idempotency. No filesystem access. */
export interface PublishObject {
	key: string;
	body: Uint8Array;
	metadata: Record<string, string>;
}

export interface PublishObjectsOptions {
	store: R2ObjectStore;
	objects: PublishObject[];
	dryRun?: boolean;
	onLog?: (msg: string) => void;
}

/** Only audio artifacts belong in the asset bucket — never intermediate
 * `*-source.txt` transcripts or other stray files in data/audio/. */
function isAudioArtifact(name: string): boolean {
	return name.endsWith(".wav") || name.endsWith(".words.json");
}

export async function discoverFiles(audioDir: string): Promise<FileEntry[]> {
	const entries: FileEntry[] = [];

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
	const entries = await discoverFiles(opts.audioDir);
	return publishEntries({ ...opts, entries });
}

/**
 * Upload an explicit set of files (vs. discovering a whole directory) with the
 * same content-hash idempotency and `sha256` metadata. Lets callers publish a
 * single episode without sweeping the entire audio directory.
 */
export async function publishEntries(
	opts: Omit<PublishOptions, "audioDir"> & { entries: FileEntry[] },
): Promise<PublishResult> {
	const objects: PublishObject[] = [];
	for (const entry of opts.entries) {
		const body = await Bun.file(entry.localPath).bytes();
		const hash = await sha256Hex(body);
		objects.push({ key: entry.key, body, metadata: { sha256: hash } });
	}

	return publishObjects({
		store: opts.store,
		objects,
		dryRun: opts.dryRun,
		onLog: opts.onLog,
	});
}

/**
 * Pure byte-level publish loop: no filesystem access. For each object IN ORDER,
 * HEAD the key and skip when the existing `sha256` metadata already matches;
 * otherwise PUT (or, in dry-run, record without writing). Sequential PUTs that
 * preserve the input array order.
 */
export async function publishObjects(
	opts: PublishObjectsOptions,
): Promise<PublishResult> {
	const uploaded: string[] = [];
	const skipped: string[] = [];

	for (const object of opts.objects) {
		const existing = await opts.store.head(object.key);

		if (existing?.metadata.sha256 === object.metadata.sha256) {
			skipped.push(object.key);
			opts.onLog?.(`SKIP ${object.key} (hash match)`);
			continue;
		}

		if (opts.dryRun) {
			uploaded.push(object.key);
			opts.onLog?.(`DRY-RUN would upload ${object.key}`);
			continue;
		}

		await opts.store.put(object.key, object.body, object.metadata);
		uploaded.push(object.key);
		opts.onLog?.(`UPLOADED ${object.key}`);
	}

	return { uploaded, skipped };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
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
		if (!isAudioArtifact(rel)) continue;
		const stat = await Bun.file(filePath).stat();
		if (stat?.isFile()) yield filePath;
	}
}
