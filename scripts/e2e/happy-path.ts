#!/usr/bin/env bun
/**
 * End-to-end happy path test using agent-browser.
 *
 * Flow:
 *  1. Open the app.
 *  2. Click the story card.
 *  3. Type episode 0 of the active season.
 *  4. Assert the browser lands on /play/rainbow-door-s1/complete/0.
 *  5. Assert episode 0 shows as "completed" in the chapter map.
 *
 * Usage: bun run e2e:happy-path
 * Assumes the dev server is running on http://localhost:5173.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..", "..");
const BASE_URL = "http://localhost:5173";
const STATE_PATH = join(ROOT, "data", "state.json");
const SEASON_PATH = join(ROOT, "seasons", "rainbow-door-s1.json");

// The legacy file-store seed (data/state.seed.json) was removed; inline a
// neutral deterministic seed so this localhost script stays self-contained.
const SEED_STATE = {
  children: {
    "rainbow-door-s1": {
      name: "The Rainbow Door",
      theme: "rainbow",
      target_wpm: 15,
      active_season: "rainbow-door-s1",
      current_episode: 0,
      current_session_id: null,
    },
    "pixel-garden-s1": {
      name: "Pixel's Science Garden",
      theme: "science",
      target_wpm: 18,
      active_season: "pixel-garden-s1",
      current_episode: 0,
      current_session_id: null,
    },
  },
  sessions: [],
};

// Chunk the episode text so WPM stays ≤ MAX_WPM (1000).
// 867 chars / 5 chars-per-word = 173.4 "words".
// At 1000 WPM the minimum active time is ceil(173.4 / 1000 × 60) = 11 s.
// We split into ~80-char chunks with a 1 s gap between them, giving
// at least 10 × 1 s of gap → comfortably under the limit.
const CHUNK_SIZE = 80;
const CHUNK_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AgentResult = { stdout: string; stderr: string; exitCode: number };

async function agent(args: string[]): Promise<AgentResult> {
  const proc = Bun.spawn(["agent-browser", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function run(...args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await agent(args);
  if (exitCode !== 0) {
    const cmd = args.join(" ");
    const detail = stderr.trim() || `exit code ${exitCode}`;
    throw new Error(`agent-browser ${cmd} failed: ${detail}`);
  }
  return stdout;
}

function getEpisodeText(): string {
  const raw = readFileSync(SEASON_PATH, "utf-8");
  const season = JSON.parse(raw);
  const ep = season.episodes.find(
    (e: { idx: number; text: string }) => e.idx === 0,
  );
  if (!ep) throw new Error("Episode 0 not found in season file");
  return ep.text;
}

/** Type `text` in chunks with delays to keep WPM under the ceiling. */
async function typeText(text: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    await run("keyboard", "type", chunk);
    if (i < chunks.length - 1) {
      await run("wait", String(CHUNK_DELAY_MS));
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- Pre-flight: ensure agent-browser is available ----------------------
  const which = Bun.spawnSync(["which", "agent-browser"]);
  if (which.exitCode !== 0) {
    throw new Error(
      "agent-browser not found. Install it:\n  npm i -g agent-browser && agent-browser install",
    );
  }

  // --- Snapshot existing state so we can restore it -----------------------
  const hadState = existsSync(STATE_PATH);
  let backup: Buffer | null = null;
  if (hadState) {
    try {
      backup = readFileSync(STATE_PATH);
    } catch (err) {
      throw new Error(
        `Cannot read existing state file (${STATE_PATH}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // --- Verify the dev server is reachable ---------------------------------
  let healthOk = false;
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    healthOk = res.ok;
  } catch {
    // will fail below with a clear message
  }
  if (!healthOk) {
    throw new Error(
      `Dev server not reachable at ${BASE_URL}. Start it first:\n  bun run dev`,
    );
  }

  // Always start from seed so the test is deterministic.
  writeFileSync(STATE_PATH, `${JSON.stringify(SEED_STATE, null, 2)}\n`);

  try {
    // 1. Open the app ------------------------------------------------------
    console.log("1. Opening app …");
    await run("open", BASE_URL);

    // 2. Click the story card ----------------------------------------------
    console.log("2. Clicking the story card …");
    await run("find", "text", "The Rainbow Door", "click");

    // 3. Wait for the episode runner to appear -----------------------------
    console.log("3. Waiting for episode runner …");
    await run("wait", "--text", "Luma");

    // 4. Type the entire episode text --------------------------------------
    const text = getEpisodeText();
    console.log(
      `4. Typing episode 0 (${text.length} chars) …`,
    );
    await typeText(text);

    // 5. Wait for the completion page --------------------------------------
    console.log("5. Waiting for completion page …");
    await run("wait", "--url", "**/complete/0");

    // 6. Assert the URL ----------------------------------------------------
    const url = (await run("get", "url")).trim();
    if (!url.includes("/play/rainbow-door-s1/complete/0")) {
      throw new Error(
        `Expected URL to contain /play/rainbow-door-s1/complete/0, got: ${url}`,
      );
    }
    console.log(`   URL: ${url} ✓`);

    // 7. Wait for chapter map to finish loading ----------------------------
    await run("wait", "--text", "Episode 1 complete!");

    // 8. Assert episode 0 is "completed" -----------------------------------
    const status = (
      await run(
        "eval",
        `document.querySelector('[data-testid="chapter-cell"][data-episode-idx="0"]').dataset.status`,
      )
    ).trim();
    if (status !== "completed") {
      throw new Error(
        `Expected episode 0 status "completed", got "${status}"`,
      );
    }
    console.log(`   Episode 0 status: ${status} ✓`);

    console.log("\n✅ Happy path E2E test passed!");
  } finally {
    // --- Restore original state -------------------------------------------
    try {
      if (backup) {
        await Bun.write(STATE_PATH, backup);
      } else if (!hadState) {
        // Only clean up if we created it ourselves.
        Bun.file(STATE_PATH).delete();
      }
      // No else: backup is always non-null when hadState is true (the
      // read is guarded above). If readFileSync threw we never reach here.
    } catch {
      // best effort — don't mask the real failure
    }

    // --- Clean up browser -------------------------------------------------
    try {
      await agent(["close", "--all"]);
    } catch {
      // browser may already be closed
    }
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
