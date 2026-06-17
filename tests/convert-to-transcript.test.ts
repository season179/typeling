import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dir, "..");
const SCRIPT = join(TEST_DIR, "scripts", "convert-to-transcript.ts");
const OUTPUT_DIR = join(TEST_DIR, "data", "audio");
const TRANSCRIPT_FILE = join(OUTPUT_DIR, "zack-s1-e0-transcript.txt");

const SCRIPT_ARGS = [
  "--source", "data/audio/zack-s1-e0-source.txt",
  "--output", "data/audio/zack-s1-e0-transcript.txt",
];

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

async function ensureSourceArtifact() {
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      join(TEST_DIR, "scripts", "extract-audio-source.ts"),
      "--season", "seasons/zack-s1.json",
      "--output", "data/audio/zack-s1-e0-source.txt",
      "--episode-idx", "0",
    ],
    { cwd: TEST_DIR },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Failed to create source artifact (exit ${exitCode}): ${stderr}`,
    );
  }
}

describe("convert-to-transcript", () => {
  beforeAll(async () => {
    await mkdir(OUTPUT_DIR, { recursive: true });
    await ensureSourceArtifact();
  });

  afterAll(async () => {
    try { await rm(TRANSCRIPT_FILE); } catch { /* ignore */ }
  });

  it("writes a speaker-labelled transcript artifact", async () => {
    const { exitCode, stderr } = await runScript(SCRIPT_ARGS);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");
    expect(transcript.length).toBeGreaterThan(0);

    // Every non-empty line should have a speaker prefix
    for (const line of transcript.split("\n")) {
      if (line.trim().length === 0) continue;
      expect(line).toMatch(/^(Storyteller|Character): /);
    }
  });

  it("output contains both speakers Storyteller and Character", async () => {
    const { exitCode } = await runScript(SCRIPT_ARGS);
    expect(exitCode).toBe(0);

    const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");

    expect(transcript).toMatch(/^Storyteller: /m);
    expect(transcript).toMatch(/^Character: /m);
  });

  it("includes narration before dialogue (Storyteller before Character)", async () => {
    const { exitCode } = await runScript(SCRIPT_ARGS);
    expect(exitCode).toBe(0);

    const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");
    const lines = transcript.split("\n").filter((l) => l.trim().length > 0);

    // First line must be Storyteller (the narrative opening)
    expect(lines[0]).toMatch(/^Storyteller: /);

    // At least one Character line must exist (dialogue)
    const characterLines = lines.filter((l) => l.startsWith("Character:"));
    expect(characterLines.length).toBeGreaterThan(0);
    expect(characterLines[0]).toContain("What a lovely day");
  });

  it("includes dialogue (Character lines from quoted text)", async () => {
    const { exitCode } = await runScript(SCRIPT_ARGS);
    expect(exitCode).toBe(0);

    const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");
    const lines = transcript.split("\n").filter((l) => l.trim().length > 0);

    const characterTexts = lines
      .filter((l) => l.startsWith("Character:"))
      .map((l) => l.slice("Character: ".length));

    expect(characterTexts).toContain("What a lovely day,");
  });

  it("includes narration after dialogue", async () => {
    const { exitCode } = await runScript(SCRIPT_ARGS);
    expect(exitCode).toBe(0);

    const transcript = await readFile(TRANSCRIPT_FILE, "utf-8");
    const lines = transcript.split("\n").filter((l) => l.trim().length > 0);

    // Last line should be Storyteller (narration closes the episode)
    const lastLine = lines[lines.length - 1]!;
    expect(lastLine).toMatch(/^Storyteller: /);
    expect(lastLine).toContain("buzzy voice");
  });

  it("fails validation if an unexpected speaker label appears", async () => {
    const mod = await import(
      join(TEST_DIR, "scripts", "convert-to-transcript.ts")
    );

    const lines = mod.parseTranscript('Some text with "a quote" inside');
    expect(lines.length).toBe(3);
    expect(lines[0].speaker).toBe("Storyteller");
    expect(lines[1].speaker).toBe("Character");

    expect(() => mod.validateTranscript(lines)).not.toThrow();

    expect(() =>
      mod.validateTranscript([{ speaker: "Alien" as never, text: "hi" }]),
    ).toThrow("Unexpected speaker label");
  });

  it("handles text with no quotes (all Storyteller)", async () => {
    const noQuoteSrc = join(OUTPUT_DIR, "no-quote-source.txt");
    const noQuoteOut = join(OUTPUT_DIR, "no-quote-transcript.txt");
    await writeFile(noQuoteSrc, "This is narration only. No dialogue here.");

    try {
      const { exitCode } = await runScript([
        "--source", "data/audio/no-quote-source.txt",
        "--output", "data/audio/no-quote-transcript.txt",
      ]);
      expect(exitCode).toBe(0);

      const transcript = await readFile(noQuoteOut, "utf-8");
      const lines = transcript.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatch(/^Storyteller: /);
      // No Character lines
      expect(lines.filter((l) => l.startsWith("Character:")).length).toBe(0);
    } finally {
      for (const p of [noQuoteSrc, noQuoteOut]) {
        try { await rm(p); } catch { /* ignore */ }
      }
    }
  });

  it("does not call any network API (fast local-only execution)", async () => {
    const start = performance.now();
    const { exitCode } = await runScript(SCRIPT_ARGS);
    const elapsed = performance.now() - start;

    expect(exitCode).toBe(0);
    // Should complete in well under 500ms (local file I/O only)
    expect(elapsed).toBeLessThan(500);
  });

  it("fails with clear message when source file is missing", async () => {
    const { exitCode, stderr } = await runScript([
      "--source", "data/audio/nonexistent.txt",
      "--output", "data/audio/test-out.txt",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("[TranscriptError]");
    expect(stderr).toContain("Cannot read source file");
  });

  it("fails with clear message when source file is empty", async () => {
    const emptyPath = join(OUTPUT_DIR, "empty-source.txt");
    await writeFile(emptyPath, "");

    try {
      const { exitCode, stderr } = await runScript([
        "--source", "data/audio/empty-source.txt",
        "--output", "data/audio/test-out.txt",
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("[TranscriptError]");
      expect(stderr).toContain("empty");
    } finally {
      await rm(emptyPath);
    }
  });

  it("handles text that starts with a quote", async () => {
    const src = join(OUTPUT_DIR, "start-quote-source.txt");
    const out = join(OUTPUT_DIR, "start-quote-transcript.txt");
    await writeFile(src, '"Hello" she said.');

    try {
      const { exitCode } = await runScript([
        "--source", "data/audio/start-quote-source.txt",
        "--output", "data/audio/start-quote-transcript.txt",
      ]);
      expect(exitCode).toBe(0);

      const transcript = await readFile(out, "utf-8");
      const lines = transcript.trim().split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("Character: Hello");
      expect(lines[1]).toBe("Storyteller: she said.");
    } finally {
      for (const p of [src, out]) {
        try { await rm(p); } catch { /* ignore */ }
      }
    }
  });

  it("handles text with unbalanced quotes", async () => {
    const src = join(OUTPUT_DIR, "unbalanced-source.txt");
    const out = join(OUTPUT_DIR, "unbalanced-transcript.txt");
    await writeFile(src, 'He said "hello and kept talking.');

    try {
      const { exitCode } = await runScript([
        "--source", "data/audio/unbalanced-source.txt",
        "--output", "data/audio/unbalanced-transcript.txt",
      ]);
      expect(exitCode).toBe(0);

      const transcript = await readFile(out, "utf-8");
      const lines = transcript.trim().split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("Storyteller: He said");
      expect(lines[1]).toBe("Character: hello and kept talking.");
    } finally {
      for (const p of [src, out]) {
        try { await rm(p); } catch { /* ignore */ }
      }
    }
  });

  it("fails on whitespace-only source file", async () => {
    const wsPath = join(OUTPUT_DIR, "whitespace-source.txt");
    await writeFile(wsPath, "   \n  \t  ");

    try {
      const { exitCode, stderr } = await runScript([
        "--source", "data/audio/whitespace-source.txt",
        "--output", "data/audio/test-out.txt",
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("[TranscriptError]");
      expect(stderr).toContain("empty");
    } finally {
      await rm(wsPath);
    }
  });
});
