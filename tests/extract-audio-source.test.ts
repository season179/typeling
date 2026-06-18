import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dir, "..");
const SCRIPT = join(TEST_DIR, "scripts", "extract-audio-source.ts");
const SEASON_PATH = join(TEST_DIR, "seasons", "pixel-garden-s1.json");
const OUTPUT_DIR = join(TEST_DIR, "data", "audio");
const OUTPUT_FILE = join(OUTPUT_DIR, "pixel-garden-s1-e0-source.txt");

async function runScript(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", "run", SCRIPT, ...args], {
    cwd: TEST_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("extract-audio-source", () => {
  beforeAll(async () => {
    await mkdir(OUTPUT_DIR, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(OUTPUT_FILE);
    } catch {
      /* ignore */
    }
  });

  it("extracts episode 0 text into a clearly named artifact", async () => {
    const { exitCode, stdout, stderr } = await runScript([
      "--season", "seasons/pixel-garden-s1.json",
      "--output", "data/audio/pixel-garden-s1-e0-source.txt",
      "--episode-idx", "0",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    // Read the original season to get episode 0 text
    const seasonRaw = await readFile(SEASON_PATH, "utf-8");
    const season = JSON.parse(seasonRaw);
    const episode = season.episodes.find(
      (ep: { idx: number }) => ep.idx === 0,
    );
    expect(episode).toBeDefined();

    const artifactText = await readFile(OUTPUT_FILE, "utf-8");
    expect(artifactText).toBe(episode!.text);
  });

  it("fails with clear message when season file is missing", async () => {
    const { exitCode, stderr } = await runScript([
      "--season", "seasons/nonexistent.json",
      "--output", "data/audio/test-out.txt",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("[ExtractionError]");
    expect(stderr).toContain("Cannot read season file");
    expect(stderr).toContain("seasons/nonexistent.json");
  });

  it("fails with clear message when episode idx is not found", async () => {
    const { exitCode, stderr } = await runScript([
      "--season", "seasons/pixel-garden-s1.json",
      "--output", "data/audio/test-out.txt",
      "--episode-idx", "999",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("[ExtractionError]");
    expect(stderr).toContain("Episode with idx 999 not found");
  });

  it("fails with clear message when season file is not valid JSON", async () => {
    const badPath = join(OUTPUT_DIR, "bad-season.json");
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(badPath, "not json at all");

    try {
      const { exitCode, stderr } = await runScript([
        "--season", "data/audio/bad-season.json",
        "--output", "data/audio/test-out.txt",
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("[ExtractionError]");
      expect(stderr).toContain("not valid JSON");
    } finally {
      await rm(badPath);
    }
  });

  it("does not modify the original season file", async () => {
    // Capture mtime before
    const beforeStat = await Bun.file(SEASON_PATH).stat();
    const beforeMtime = beforeStat.mtimeMs;

    // Read content before
    const beforeContent = await readFile(SEASON_PATH, "utf-8");

    // Run extraction
    const { exitCode } = await runScript([
      "--season", "seasons/pixel-garden-s1.json",
      "--output", "data/audio/pixel-garden-s1-e0-source.txt",
      "--episode-idx", "0",
    ]);
    expect(exitCode).toBe(0);

    // Content and mtime must be unchanged
    const afterContent = await readFile(SEASON_PATH, "utf-8");
    const afterStat = await Bun.file(SEASON_PATH).stat();

    expect(afterContent).toBe(beforeContent);
    expect(afterStat.mtimeMs).toBe(beforeMtime);
  });
});
