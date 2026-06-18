/**
 * Smoke command: generate a WAV file from a fixture Gemini audio response.
 *
 * Usage:
 *   bun run scripts/generate-wav.ts
 *   bun run scripts/generate-wav.ts --season rainbow-door-s1 --episode-idx 0
 *   bun run scripts/generate-wav.ts --fixture fixtures/gemini-audio-response.json --output data/audio/test.wav
 *
 * Does NOT call Gemini or any network API.
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
	generateWav,
	metaPath,
	type GeminiAudioResponse,
} from "../src/lib/generateWav";

const ROOT = join(import.meta.dir, "..");
const DEFAULT_FIXTURE = join(ROOT, "fixtures", "gemini-audio-response.json");
const DEFAULT_OUTPUT_DIR = join(ROOT, "data", "audio");
const DEFAULT_MODEL = "gemini-3.1-flash-tts-preview";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		fixture: { type: "string" },
		season: { type: "string" },
		"episode-idx": { type: "string" },
		output: { type: "string" },
		model: { type: "string" },
	},
	strict: true,
});

class CliError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliError";
	}
}

async function main() {
	const season = values.season ?? "pixel-garden-s1";
	const rawIdx = values["episode-idx"] ?? "0";
	const episodeIdx = Number(rawIdx);
	if (!Number.isInteger(episodeIdx) || episodeIdx < 0) {
		throw new CliError(
			`Invalid --episode-idx: "${rawIdx}". Must be a non-negative integer.`,
		);
	}

	const fixturePath = values.fixture ?? DEFAULT_FIXTURE;
	const model = values.model ?? DEFAULT_MODEL;

	const defaultOutput = join(
		DEFAULT_OUTPUT_DIR,
		`${season}-e${episodeIdx}.wav`,
	);
	const outputPath = values.output ?? defaultOutput;

	// Load fixture
	let fixture: GeminiAudioResponse;
	try {
		const raw = await readFile(fixturePath, "utf-8");
		fixture = JSON.parse(raw) as GeminiAudioResponse;
	} catch (err) {
		throw new CliError(
			`Cannot read fixture: ${fixturePath}. ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Compute transcript hash from the fixture data itself (the base64 content
	// acts as a content fingerprint for the fixture).
	const base64Data =
		fixture.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? "";
	const transcriptHash = createHash("sha256")
		.update(base64Data, "base64")
		.digest("hex");

	await generateWav({
		response: fixture,
		outputPath,
		season,
		episodeIdx,
		model,
		transcriptHash,
	});

	// Verify the output
	const wavStat = await stat(outputPath);
	console.log(`Wrote ${outputPath} (${wavStat.size} bytes)`);

	const metaFilePath = metaPath(outputPath);
	const metaStat = await stat(metaFilePath);
	console.log(`Wrote ${metaFilePath} (${metaStat.size} bytes)`);
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
