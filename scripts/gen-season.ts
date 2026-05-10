import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { MAX_EPISODES, seasonSchema } from "../src/lib/schemas/season";
import { readState } from "../src/server/state";
import type { Child } from "../src/lib/schemas/state";
import { asciiNormalize } from "../src/lib/asciiNormalize";
import { usToBritish } from "../src/lib/usToBritish";
import { assertCharset } from "../src/lib/assertCharset";
import { contentBlacklist } from "../src/lib/contentBlacklist";
import { wordCountBudget } from "../src/lib/wordCountBudget";
import { buildPrompt } from "./gen-season-prompt";

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

export class LLMTransportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LLMTransportError";
	}
}

export class LLMResponseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LLMResponseError";
	}
}

const ROOT = join(import.meta.dir, "..");
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MODEL = "xiaomi/mimo-v2.5-pro";

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

if (!childId || !slug) {
	console.error(
		"Usage: gen-season --child <id> --slug <slug> [--fixture <path>]",
	);
	process.exit(1);
}

const cid = childId;
const slg = slug;

const statePath =
	process.env.TYPELING_STATE_PATH ?? join(ROOT, "data", "state.json");

async function loadFromFixture(path: string): Promise<unknown> {
	let raw: string;
	try {
		raw = await readFile(join(ROOT, path), "utf-8");
	} catch (err) {
		throw new SeasonFixtureError(
			`Cannot read fixture: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw new SeasonFixtureError(
			`Fixture JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

async function loadFromLLM(child: Child): Promise<unknown> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new LLMTransportError(
			"OPENROUTER_API_KEY is not set. Use --fixture for offline development.",
		);
	}

	const prompt = buildPrompt({
		childName: child.name,
		theme: child.theme,
		targetWpm: child.target_wpm,
	});

	const client = new OpenAI({
		apiKey,
		baseURL: OPENROUTER_BASE_URL,
	});

	let content: string | null;
	try {
		const completion = await client.chat.completions.create({
			model: MODEL,
			messages: [
				{ role: "system", content: prompt.system },
				{ role: "user", content: prompt.user },
			],
		});
		content = completion.choices[0]?.message?.content ?? null;
	} catch (err) {
		throw new LLMTransportError(
			`OpenRouter call failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!content) {
		throw new LLMResponseError("OpenRouter returned empty content");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (err) {
		throw new LLMResponseError(
			`LLM response JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!Array.isArray(parsed)) {
		throw new LLMResponseError(
			`LLM response must be a JSON array, got ${typeof parsed}`,
		);
	}
	if (!parsed.every((s): s is string => typeof s === "string")) {
		throw new LLMResponseError(
			"LLM response array must contain only strings",
		);
	}

	return {
		slug: slg,
		child_id: cid,
		theme: child.theme,
		episodes: parsed.map((text, idx) => ({ idx, text })),
	};
}

async function main() {
	const state = await readState(statePath);
	const child = state.children[cid];
	if (!child) {
		throw new SeasonFixtureError(`Child "${cid}" not found in state.json`);
	}

	const raw = fixturePath
		? await loadFromFixture(fixturePath)
		: await loadFromLLM(child);

	const seasonResult = seasonSchema.safeParse(raw);
	if (!seasonResult.success) {
		throw new SeasonSchemaError(seasonResult.error.message);
	}
	const season = seasonResult.data;

	if (season.episodes.length !== MAX_EPISODES) {
		throw new SeasonSchemaError(
			`Expected ${MAX_EPISODES} episodes, got ${season.episodes.length}`,
		);
	}

	const budget = wordCountBudget(child.target_wpm);

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
	console.log(
		`Wrote seasons/${slg}.json (${season.episodes.length} episodes)`,
	);
}

main().catch((err) => {
	const name = err instanceof Error ? err.name : "Error";
	console.error(`[${name}] ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
