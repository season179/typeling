/**
 * style-transcript.ts — Apply the bedtime TTS style prompt to a raw
 * two-speaker transcript and write a styled transcript artifact.
 *
 * Usage:
 *   bun run scripts/style-transcript.ts --source data/audio/zack-s1-e0-transcript.txt --output data/audio/zack-s1-e0-styled-transcript.txt
 *   bun run scripts/style-transcript.ts --source … --output … --fixture path/to/styled-fixture.txt
 *
 * Emits a Gemini-style preamble ("Make Storyteller sound…") followed by the
 * speaker-labelled transcript with sparse [audio tags].
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import OpenAI from "openai";
import { buildStylePrompt } from "./style-transcript-prompt";

const ROOT = join(import.meta.dir, "..");
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MODEL = "xiaomi/mimo-v2.5-pro";
const MAX_LLM_ATTEMPTS = 3;

const DEFAULT_SOURCE = join(ROOT, "data", "audio", "zack-s1-e0-transcript.txt");
const DEFAULT_OUTPUT = join(
	ROOT,
	"data",
	"audio",
	"zack-s1-e0-styled-transcript.txt",
);

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		source: { type: "string" },
		output: { type: "string" },
		fixture: { type: "string" },
	},
	strict: true,
});

const sourcePath = values.source ?? DEFAULT_SOURCE;
const outputPath = values.output ?? DEFAULT_OUTPUT;
const fixturePath = values.fixture;

class StyleTranscriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StyleTranscriptError";
	}
}

class LLMTransportError extends StyleTranscriptError {
	constructor(message: string) {
		super(message);
		this.name = "LLMTransportError";
	}
}

class LLMResponseError extends StyleTranscriptError {
	constructor(message: string) {
		super(message);
		this.name = "LLMResponseError";
	}
}

class StyleValidationError extends StyleTranscriptError {
	constructor(message: string) {
		super(message);
		this.name = "StyleValidationError";
	}
}

/**
 * Validate that the styled transcript output meets all the requirements
 * for a valid bedtime TTS script: a Gemini-style "Make Storyteller sound…"
 * preamble followed by speaker-labelled transcript lines with optional
 * [audio tags].
 */
function validateStyledTranscript(output: string): void {
	if (output.trim().length === 0) {
		throw new StyleValidationError("Styled transcript is empty.");
	}

	const lines = output.split("\n");

	// Must have at least a preamble and one transcript line
	if (lines.length < 2) {
		throw new StyleValidationError(
			"Styled transcript too short. Expected a TTS preamble and at least one transcript line.",
		);
	}

	const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";

	if (
		!firstNonEmpty.toLowerCase().includes("make storyteller") &&
		!firstNonEmpty.toLowerCase().includes("storyteller sound")
	) {
		throw new StyleValidationError(
			"Styled transcript missing TTS preamble on the first line. " +
				'The preamble should start with something like "Make Storyteller sound…"',
		);
	}

	// Collect transcript lines (after preamble, lines with speaker prefix)
	const transcriptLines = lines.filter((l) =>
		/^(Storyteller|Pixel): /i.test(l.trim()),
	);

	if (transcriptLines.length === 0) {
		throw new StyleValidationError(
			"No speaker-labelled transcript lines found. Expected lines starting with 'Storyteller: ' or 'Pixel: '.",
		);
	}

	// Must have both speakers (the regex already guarantees only valid speaker labels)
	const hasStoryteller = transcriptLines.some((l) =>
		/^Storyteller: /i.test(l.trim()),
	);
	const hasPixel = transcriptLines.some((l) => /^Pixel: /i.test(l.trim()));

	if (!hasStoryteller || !hasPixel) {
		throw new StyleValidationError(
			"Styled transcript must contain both Storyteller and Pixel speaker lines.",
		);
	}
}

async function styleViaLLM(transcript: string): Promise<string> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new LLMTransportError(
			"OPENROUTER_API_KEY is not set. Use --fixture for offline development.",
		);
	}

	const client = new OpenAI({
		apiKey,
		baseURL: OPENROUTER_BASE_URL,
	});

	const prompt = buildStylePrompt({ transcript });

	for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt += 1) {
		let content: string | null;
		try {
			const completion = await client.chat.completions.create({
				model: MODEL,
				temperature: 0.3,
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
			throw new LLMResponseError("OpenRouter returned empty content.");
		}

		try {
			validateStyledTranscript(content);
			return content;
		} catch (err) {
			if (attempt === MAX_LLM_ATTEMPTS) throw err;

			const name = err instanceof Error ? err.name : "Error";
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				`Attempt ${attempt}/${MAX_LLM_ATTEMPTS} failed validation: [${name}] ${message}. Retrying…`,
			);
		}
	}

	// Unreachable — the final iteration either returns or throws.
	// Satisfy TypeScript's exhaustiveness check.
	throw new LLMResponseError("All retry attempts exhausted.");
}

async function loadFixture(path: string): Promise<string> {
	let raw: string;
	try {
		raw = await readFile(join(ROOT, path), "utf-8");
	} catch (err) {
		throw new StyleTranscriptError(
			`Cannot read fixture: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (raw.trim().length === 0) {
		throw new StyleTranscriptError(`Fixture is empty: ${path}`);
	}
	return raw;
}

async function main() {
	// Read source transcript
	let transcript: string;
	try {
		transcript = await readFile(sourcePath, "utf-8");
	} catch {
		throw new StyleTranscriptError(
			`Cannot read source transcript: ${sourcePath}. Run convert-to-transcript first?`,
		);
	}

	if (transcript.trim().length === 0) {
		throw new StyleTranscriptError(`Source transcript is empty: ${sourcePath}`);
	}

	// Get styled transcript via LLM or fixture
	const styled = fixturePath
		? await loadFixture(fixturePath)
		: await styleViaLLM(transcript);

	// Validate the result
	validateStyledTranscript(styled);

	// Write artifact
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, styled, "utf-8");

	const lines = styled.split("\n").filter((l) => l.trim().length > 0);
	const transcriptLines = lines.filter((l) =>
		/^(Storyteller|Pixel): /i.test(l.trim()),
	);
	console.log(
		`Wrote ${outputPath} (${transcriptLines.length} transcript lines: ` +
			`${transcriptLines.filter((l) => l.trim().startsWith("Storyteller: ")).length} Storyteller, ` +
			`${transcriptLines.filter((l) => l.trim().startsWith("Pixel: ")).length} Pixel)`,
	);
}

const isMain = import.meta.path === Bun.main;
if (isMain) {
	main().catch((err) => {
		const name = err instanceof Error ? err.name : "Error";
		console.error(
			`[${name}] ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	});
}
