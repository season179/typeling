import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  formatTranscript,
  parseTranscript,
  TranscriptError,
  validateTranscript,
} from "../src/lib/transcript";

// Re-exported so existing tests can import these pure helpers from this
// script entrypoint. The implementations live in src/lib/transcript.ts so the
// Worker can share them.
export { formatTranscript, parseTranscript, validateTranscript };

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      source: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
  });

  if (!values.source) {
    throw new TranscriptError("--source is required");
  }
  if (!values.output) {
    throw new TranscriptError("--output is required");
  }

  const sourcePath = values.source;
  const outputPath = values.output;

  // Read source text
  let raw: string;
  try {
    raw = await readFile(sourcePath, "utf-8");
  } catch {
    throw new TranscriptError(
      `Cannot read source file: ${sourcePath}. Run extract-audio-source first?`,
    );
  }

  if (raw.trim().length === 0) {
    throw new TranscriptError(`Source file is empty: ${sourcePath}`);
  }

  // Parse into speaker-labelled lines
  const lines = parseTranscript(raw);

  // Validate
  validateTranscript(lines);

  // Format and write
  const output = formatTranscript(lines);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf-8");

  console.log(
    `Wrote ${outputPath} (${lines.length} turns: ` +
    `${lines.filter((l) => l.speaker === "Storyteller").length} Storyteller, ` +
    `${lines.filter((l) => l.speaker === "Character").length} Character)`,
  );
}

const isMain = import.meta.path === Bun.main;
if (isMain) {
  main().catch((err) => {
    const name = err instanceof Error ? err.name : "Error";
    console.error(`[${name}] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
