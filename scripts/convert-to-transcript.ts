import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DEFAULT_SOURCE_PATH = join(ROOT, "data", "audio", "zack-s1-e0-source.txt");
const DEFAULT_OUTPUT_DIR = join(ROOT, "data", "audio");
const DEFAULT_OUTPUT_FILE = "zack-s1-e0-transcript.txt";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    source: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

const sourcePath = values.source ?? DEFAULT_SOURCE_PATH;
const outputPath = values.output ?? join(DEFAULT_OUTPUT_DIR, DEFAULT_OUTPUT_FILE);

class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptError";
  }
}

const ALLOWED_SPEAKERS = new Set(["Storyteller", "Pixel"]);

interface TranscriptLine {
  speaker: "Storyteller" | "Pixel";
  text: string;
}

export function parseTranscript(text: string): TranscriptLine[] {
  const segments = text.split('"');
  const lines: TranscriptLine[] = [];

  for (let i = 0; i < segments.length; i++) {
    const trimmed = segments[i]!.trim();
    if (trimmed.length === 0) continue;

    // Even-indexed segments (0, 2, 4, ...) are outside quotes → Storyteller
    // Odd-indexed segments (1, 3, 5, ...) are inside quotes → Pixel
    const speaker = i % 2 === 0 ? "Storyteller" : "Pixel";
    lines.push({ speaker, text: trimmed });
  }

  return lines;
}

export function validateTranscript(lines: TranscriptLine[]): void {
  for (const [i, line] of lines.entries()) {
    if (!ALLOWED_SPEAKERS.has(line.speaker)) {
      throw new TranscriptError(
        `Unexpected speaker label "${line.speaker}" on line ${i + 1}. ` +
        `Only Storyteller and Pixel are allowed.`,
      );
    }
  }
}

export function formatTranscript(lines: TranscriptLine[]): string {
  return lines.map((line) => `${line.speaker}: ${line.text}`).join("\n") + "\n";
}

async function main() {
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
    `${lines.filter((l) => l.speaker === "Pixel").length} Pixel)`,
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
