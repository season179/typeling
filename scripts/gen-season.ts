import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import type { z } from "zod";
import { seasonSchema } from "../src/lib/schemas/season";
import { asciiNormalize } from "../src/lib/asciiNormalize";
import { usToBritish } from "../src/lib/usToBritish";
import { CharsetError } from "../src/lib/assertCharset";
import { checkStoryText } from "../src/lib/storyTextPolicy";
import { wordCountBudget } from "../src/lib/wordCountBudget";
import { buildPrompt } from "./gen-season-prompt";

type Season = z.infer<typeof seasonSchema>;

interface SeasonProfile {
	theme: string;
	target_wpm: number;
	forbidden_name: string;
}

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
	readonly forbiddenName: string;

	constructor(episodeIdx: number, forbiddenName: string) {
		super(`Forbidden name appears in episode ${episodeIdx}: ${forbiddenName}`);
		this.name = "PersonalNameError";
		this.episodeIdx = episodeIdx;
		this.forbiddenName = forbiddenName;
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
		slug: { type: "string" },
		theme: { type: "string" },
		"target-wpm": { type: "string" },
		"forbidden-name": { type: "string" },
		fixture: { type: "string" },
	},
	strict: true,
});

const slug = values.slug;
const theme = values.theme;
const targetWpmRaw = values["target-wpm"];
const forbiddenName = values["forbidden-name"];
const fixturePath = values.fixture;

if (!slug || !theme || !targetWpmRaw || !forbiddenName) {
	console.error(
		"Usage: gen-season --slug <slug> --theme <theme> --target-wpm <n> --forbidden-name <name> [--fixture <path>]",
	);
	process.exit(1);
}

const targetWpm = Number(targetWpmRaw);
if (!Number.isInteger(targetWpm) || targetWpm < 1) {
	console.error("--target-wpm must be a positive integer");
	process.exit(1);
}

const profile: SeasonProfile = {
	theme,
	target_wpm: targetWpm,
	forbidden_name: forbiddenName,
};

function storyNameFromTheme(storyTheme: string): string {
	return storyTheme
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

async function loadFromLLM(seasonProfile: SeasonProfile): Promise<unknown> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new LLMTransportError(
			"OPENROUTER_API_KEY is not set. Use --fixture for offline development.",
		);
	}

	const prompt = buildPrompt({
		theme: seasonProfile.theme,
		targetWpm: seasonProfile.target_wpm,
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
		slug,
		name: storyNameFromTheme(seasonProfile.theme),
		theme: seasonProfile.theme,
		episodes,
	};
}

function validateSeason(raw: unknown, seasonProfile: SeasonProfile): Season {
	const seasonResult = seasonSchema.safeParse(raw);
	if (!seasonResult.success) {
		throw new SeasonSchemaError(seasonResult.error.message);
	}
	const season = seasonResult.data;

	const budget = wordCountBudget(seasonProfile.target_wpm);

	for (const episode of season.episodes) {
		let text = episode.text;

		text = asciiNormalize(text);
		text = usToBritish(text);

		const violation = checkStoryText(text, {
			forbiddenNames: [seasonProfile.forbidden_name],
			nameMatch: "substring",
		});
		if (violation) {
			switch (violation.kind) {
				case "charset":
					throw new CharsetError(violation.position, violation.char);
				case "blacklist":
					throw new ContentBlacklistError(episode.idx, violation.terms);
				case "forbidden-name":
					throw new PersonalNameError(episode.idx, seasonProfile.forbidden_name);
				default: {
					const _exhaustive: never = violation;
					throw _exhaustive;
				}
			}
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

async function generateFromLLMWithRetries(
	seasonProfile: SeasonProfile,
): Promise<Season> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt += 1) {
		try {
			const raw = await loadFromLLM(seasonProfile);
			return validateSeason(raw, seasonProfile);
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
	const season = fixturePath
		? validateSeason(await loadFromFixture(fixturePath), profile)
		: await generateFromLLMWithRetries(profile);

	const output = JSON.stringify(season, null, 2);
	await writeFile(join(ROOT, "seasons", `${slug}.json`), output);
	console.log(`Wrote seasons/${slug}.json (${season.episodes.length} episodes)`);
}

main().catch((err) => {
	const name = err instanceof Error ? err.name : "Error";
	console.error(
		`[${name}] ${err instanceof Error ? err.message : String(err)}`,
	);
	process.exit(1);
});
