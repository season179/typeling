#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { seasonSchema } from "../src/lib/schemas/season";

const DATABASE_NAME = "typeling-content";
const SEASON_FILES = ["seasons/winni-s1.json", "seasons/zack-s1.json"];

function usage(): never {
	console.error(
		"Usage: bun run scripts/seed-story-d1.ts (--local | --remote) [--dry-run]",
	);
	process.exit(1);
}

function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

async function loadSeason(filePath: string) {
	const raw = await Bun.file(filePath).json();
	return seasonSchema.parse(raw);
}

async function buildSeedSql(): Promise<string> {
	const projectRoot = resolve(import.meta.dir, "..");
	const statements = ["PRAGMA foreign_keys = ON;"];

	for (const relativePath of SEASON_FILES) {
		const season = await loadSeason(resolve(projectRoot, relativePath));
		statements.push(
			[
				"INSERT INTO seasons (slug, child_id, theme)",
				`VALUES (${sqlString(season.slug)}, ${sqlString(season.child_id)}, ${sqlString(season.theme)})`,
				"ON CONFLICT(slug) DO UPDATE SET",
				"child_id = excluded.child_id,",
				"theme = excluded.theme,",
				"updated_at = CURRENT_TIMESTAMP;",
			].join("\n"),
		);

		for (const episode of season.episodes) {
			statements.push(
				[
					"INSERT INTO episodes (season_slug, idx, text, text_hash)",
					`VALUES (${sqlString(season.slug)}, ${episode.idx}, ${sqlString(episode.text)}, ${sqlString(sha256(episode.text))})`,
					"ON CONFLICT(season_slug, idx) DO UPDATE SET",
					"text = excluded.text,",
					"text_hash = excluded.text_hash,",
					"updated_at = CURRENT_TIMESTAMP;",
				].join("\n"),
			);
		}
	}

	return `${statements.join("\n\n")}\n`;
}

async function main() {
	const args = new Set(process.argv.slice(2));
	const local = args.has("--local");
	const remote = args.has("--remote");
	const dryRun = args.has("--dry-run");
	if (local === remote) usage();

	const sql = await buildSeedSql();
	if (dryRun) {
		console.log(sql);
		return;
	}

	const tempDir = await mkdtemp(join(tmpdir(), "typeling-story-d1-"));
	const sqlPath = join(tempDir, "seed-story.sql");
	try {
		await writeFile(sqlPath, sql, "utf8");
		const proc = Bun.spawn(
			[
				"bunx",
				"wrangler",
				"d1",
				"execute",
				DATABASE_NAME,
				local ? "--local" : "--remote",
				"--file",
				sqlPath,
				"--yes",
			],
			{
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			process.exit(exitCode);
		}
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
