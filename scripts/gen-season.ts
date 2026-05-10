import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { seasonSchema } from "../src/lib/schemas/season";
import { readState } from "../src/server/state";
import { asciiNormalize } from "../src/lib/asciiNormalize";
import { usToBritish } from "../src/lib/usToBritish";
import { assertCharset } from "../src/lib/assertCharset";
import { contentBlacklist } from "../src/lib/contentBlacklist";
import { wordCountBudget } from "../src/lib/wordCountBudget";

export class SeasonFixtureError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SeasonFixtureError";
	}
}

export class SeasonSchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SeasonSchemaError";
	}
}

export class ContentBlacklistError extends Error {
	readonly terms: string[];
	readonly episodeIdx: number;

	constructor(episodeIdx: number, terms: string[]) {
		super(
			`Content blacklist hit in episode ${episodeIdx}: ${terms.join(", ")}`,
		);
		this.name = "ContentBlacklistError";
		this.terms = terms;
		this.episodeIdx = episodeIdx;
	}
}

export class WordCountError extends Error {
	readonly episodeIdx: number;
	readonly wordCount: number;
	readonly min: number;
	readonly max: number;

	constructor(episodeIdx: number, wordCount: number, min: number, max: number) {
		super(
			`Word count ${wordCount} for episode ${episodeIdx} is outside budget [${min}, ${max}]`,
		);
		this.name = "WordCountError";
		this.episodeIdx = episodeIdx;
		this.wordCount = wordCount;
		this.min = min;
		this.max = max;
	}
}

const ROOT = join(import.meta.dir, "..");

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		child: { type: "string" },
		slug: { type: "string" },
		fixture: { type: "string" },
	},
	strict: true,
});

const childId = values.child;
const slug = values.slug;
const fixturePath = values.fixture;

if (!childId || !slug || !fixturePath) {
	console.error("Usage: gen-season --child <id> --slug <slug> --fixture <path>");
	process.exit(1);
}

// TS doesn't narrow across async function boundaries — work around it.
const cid = childId!;
const slg = slug!;
const fix = fixturePath!;

const statePath =
	process.env.TYPELING_STATE_PATH ?? join(ROOT, "data", "state.json");

async function main() {
	let rawFixture: string;
	try {
		rawFixture = await readFile(join(ROOT, fix), "utf-8");
	} catch (err) {
		throw new SeasonFixtureError(
			`Cannot read fixture: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawFixture);
	} catch (err) {
		throw new SeasonFixtureError(
			`Fixture JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const seasonResult = seasonSchema.safeParse(parsed);
	if (!seasonResult.success) {
		throw new SeasonSchemaError(seasonResult.error.message);
	}
	const season = seasonResult.data;

	const state = await readState(statePath);
	const child = state.children[cid];
	if (!child) {
		throw new SeasonFixtureError(
			`Child "${cid}" not found in state.json`,
		);
	}

	const budget = wordCountBudget(child.target_wpm);

	// Normalise, spell-check, validate charset, and enforce budget.
	for (const episode of season.episodes) {
		let text = episode.text;

		text = asciiNormalize(text);
		text = usToBritish(text);
		assertCharset(text);

		const hits = contentBlacklist(text);
		if (hits.length > 0) {
			throw new ContentBlacklistError(episode.idx, hits);
		}

		const wordCount = text.split(/\s+/).filter(Boolean).length;
		if (wordCount < budget.min || wordCount > budget.max) {
			throw new WordCountError(
				episode.idx,
				wordCount,
				budget.min,
				budget.max,
			);
		}

		episode.text = text;
	}

	const output = JSON.stringify(season, null, 2);
	await writeFile(join(ROOT, "seasons", `${slg}.json`), output);
	console.log(`Wrote seasons/${slg}.json (${season.episodes.length} episodes)`);
}

main().catch((err) => {
	const name = err instanceof Error ? err.name : "Error";
	console.error(`[${name}] ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
