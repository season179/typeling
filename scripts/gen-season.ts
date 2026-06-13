import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import type { z } from "zod";
import { seasonSchema } from "../src/lib/schemas/season";
import { readState } from "../src/server/state";
import type { Child } from "../src/lib/schemas/state";
import { asciiNormalize } from "../src/lib/asciiNormalize";
import { usToBritish } from "../src/lib/usToBritish";
import { assertCharset, CharsetError } from "../src/lib/assertCharset";
import { contentBlacklist } from "../src/lib/contentBlacklist";
import { wordCountBudget } from "../src/lib/wordCountBudget";
import { buildPrompt } from "./gen-season-prompt";

type Season = z.infer<typeof seasonSchema>;

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

export class PersonalNameError extends Error {
	readonly episodeIdx: number;
	readonly childName: string;

	constructor(episodeIdx: number, childName: string) {
		super(`Child name appears in episode ${episodeIdx}: ${childName}`);
		this.name = "PersonalNameError";
		this.episodeIdx = episodeIdx;
		this.childName = childName;
	}
}

export class GenericProtagonistError extends Error {
	readonly episodeIdx: number;

	constructor(episodeIdx: number) {
		super(`Generic protagonist label appears in episode ${episodeIdx}`);
		this.name = "GenericProtagonistError";
		this.episodeIdx = episodeIdx;
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
const MAX_LLM_ATTEMPTS = 5;

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

const cid: string = childId;
const slg: string = slug;

const statePath =
	process.env.TYPELING_STATE_PATH ?? join(ROOT, "data", "state.json");

function storyNameFromTheme(theme: string): string {
	return theme
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

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
			temperature: 0.4,
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

	const episodes = parsed.map((text, idx) => {
		if (typeof text !== "string") {
			throw new LLMResponseError(
				`LLM response episode ${idx} is not a string (got ${typeof text})`,
			);
		}
		return { idx, text };
	});

	return {
		slug: slg,
		name: storyNameFromTheme(child.theme),
		theme: child.theme,
		episodes,
	};
}

function validateSeason(raw: unknown, child: Child): Season {
	const seasonResult = seasonSchema.safeParse(raw);
	if (!seasonResult.success) {
		throw new SeasonSchemaError(seasonResult.error.message);
	}
	const season = seasonResult.data;

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

		if (text.toLowerCase().includes(child.name.toLowerCase())) {
			throw new PersonalNameError(episode.idx, child.name);
		}

		if (/\bthe child\b/i.test(text)) {
			throw new GenericProtagonistError(episode.idx);
		}

		const wordCount = text.split(/\s+/).filter(Boolean).length;
		if (wordCount < budget.min || wordCount > budget.max) {
			throw new WordCountError(episode.idx, wordCount, budget.min, budget.max);
		}

		episode.text = text;
	}

	return season;
}

function isRetryableGenerationError(err: unknown): boolean {
	return (
		err instanceof SeasonSchemaError ||
		err instanceof LLMResponseError ||
		err instanceof CharsetError ||
		err instanceof ContentBlacklistError ||
		err instanceof PersonalNameError ||
		err instanceof GenericProtagonistError ||
		err instanceof WordCountError
	);
}

async function generateFromLLMWithRetries(child: Child): Promise<Season> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt += 1) {
		try {
			const raw = await loadFromLLM(child);
			return validateSeason(raw, child);
		} catch (err) {
			if (!isRetryableGenerationError(err)) {
				throw err;
			}

			lastError = err;
			const name = err instanceof Error ? err.name : "Error";
			const message = err instanceof Error ? err.message : String(err);
			if (attempt < MAX_LLM_ATTEMPTS) {
				console.error(
					`Attempt ${attempt}/${MAX_LLM_ATTEMPTS} failed validation: [${name}] ${message}. Retrying...`,
				);
			}
		}
	}

	throw lastError;
}

async function main() {
	const state = await readState(statePath);
	const child = state.children[cid];
	if (!child) {
		throw new SeasonFixtureError(`Child "${cid}" not found in state.json`);
	}

	const season = fixturePath
		? validateSeason(await loadFromFixture(fixturePath), child)
		: await generateFromLLMWithRetries(child);

	const output = JSON.stringify(season, null, 2);
	await writeFile(join(ROOT, "seasons", `${slg}.json`), output);
	console.log(`Wrote seasons/${slg}.json (${season.episodes.length} episodes)`);
}

main().catch((err) => {
	const name = err instanceof Error ? err.name : "Error";
	console.error(
		`[${name}] ${err instanceof Error ? err.message : String(err)}`,
	);
	process.exit(1);
});
