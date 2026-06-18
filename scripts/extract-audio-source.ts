import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DEFAULT_SEASON_PATH = join(ROOT, "seasons", "pixel-garden-s1.json");
const DEFAULT_OUTPUT_DIR = join(ROOT, "data", "audio");
const DEFAULT_OUTPUT_FILE = "pixel-garden-s1-e0-source.txt";

interface SeasonFile {
  episodes: Array<{ idx: number; text: string }>;
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    season: { type: "string" },
    output: { type: "string" },
    "episode-idx": { type: "string" },
  },
  strict: true,
});

const seasonPath = values.season ?? DEFAULT_SEASON_PATH;
const outputPath = values.output ?? join(DEFAULT_OUTPUT_DIR, DEFAULT_OUTPUT_FILE);

class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

async function main() {
  const rawIdx = values["episode-idx"] ?? "0";
  const episodeIdx = Number(rawIdx);
  if (!Number.isInteger(episodeIdx) || episodeIdx < 0) {
    throw new ExtractionError(
      `Invalid --episode-idx: "${rawIdx}". Must be a non-negative integer.`,
    );
  }

  // Read season file
  let raw: string;
  try {
    raw = await readFile(seasonPath, "utf-8");
  } catch {
    throw new ExtractionError(
      `Cannot read season file: ${seasonPath}. Does it exist?`,
    );
  }

  // Parse season
  let season: SeasonFile;
  try {
    season = JSON.parse(raw);
  } catch {
    throw new ExtractionError(`Season file is not valid JSON: ${seasonPath}`);
  }

  if (!season.episodes || !Array.isArray(season.episodes)) {
    throw new ExtractionError(
      `Season file missing "episodes" array: ${seasonPath}`,
    );
  }

  // Find episode by idx (not position — the episode may not be at the array index matching its idx)
  const episode = season.episodes.find((ep) => ep.idx === episodeIdx);
  if (!episode) {
    throw new ExtractionError(
      `Episode with idx ${episodeIdx} not found in ${seasonPath}`,
    );
  }

  // Write artifact
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, episode.text, "utf-8");
  console.log(`Wrote ${outputPath} (${episode.text.length} characters)`);
}

main().catch((err) => {
  const name = err instanceof Error ? err.name : "Error";
  console.error(`[${name}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
