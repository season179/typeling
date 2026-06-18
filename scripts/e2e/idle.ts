#!/usr/bin/env bun
/**
 * End-to-end idle handling test using agent-browser.
 *
 * Flow:
 *  1. Open the app, click the story card, start episode 0.
 *  2. Type the first 10 chars.
 *  3. Sleep 8 seconds (>5s idle threshold, which is 5000ms).
 *  4. Type the next 10 chars.
 *  5. Type the rest of the episode in chunks (same approach as happy-path).
 *  6. Wait for the completion page.
 *  7. Query GET /api/children/rainbow-door-s1/sessions for the just-saved session.
 *  8. Assert: session.active_ms falls within a documented tolerance band that
 *     proves the ~8s idle gap was excluded.
 *
 * Usage: bun run e2e:idle
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

// Idle sleep must exceed the IDLE_THRESHOLD (5000ms) defined in the reducer.
const IDLE_SLEEP_MS = 8000;

// active_ms must be at least this much less than wall-clock elapsed to prove
// the idle gap was excluded. Chosen as IDLE_SLEEP_MS - 2000 to allow for
// clock jitter while still requiring the bulk of the idle period to be
// excluded from active_ms.
const IDLE_MARGIN_MS = 6000;

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
    const episodeText = getEpisodeText();

    // Record wall-clock start for the idle-exclusion assertion.
    const wallStart = Date.now();

    // 1. Open the app ------------------------------------------------------
    console.log("1. Opening app …");
    await run("open", BASE_URL);

    // 2. Click the story card ----------------------------------------------
    console.log("2. Clicking the story card …");
    await run("find", "text", "The Rainbow Door", "click");

    // 3. Wait for the episode runner to appear -----------------------------
    console.log("3. Waiting for episode runner …");
    await run("wait", "--text", "Luma");

    // 4. Type first 10 chars -----------------------------------------------
    const firstChunk = episodeText.slice(0, 10);
    console.log(`4. Typing first ${firstChunk.length} chars …`);
    await run("keyboard", "type", firstChunk);

    // 5. Sleep 8 seconds (>5s idle threshold) ------------------------------
    console.log(
      `5. Sleeping ${IDLE_SLEEP_MS}ms (idle threshold is 5000ms) …`,
    );
    await run("wait", String(IDLE_SLEEP_MS));

    // 6. Type next 10 chars ------------------------------------------------
    const secondChunk = episodeText.slice(10, 20);
    console.log(`6. Typing next ${secondChunk.length} chars …`);
    await run("keyboard", "type", secondChunk);

    // 7. Type the rest of the episode --------------------------------------
    const rest = episodeText.slice(20);
    console.log(`7. Typing remaining ${rest.length} chars …`);
    await typeText(rest);

    // 8. Wait for the completion page --------------------------------------
    console.log("8. Waiting for completion page …");
    await run("wait", "--url", "**/complete/0");

    // Record wall-clock end.
    const wallEnd = Date.now();
    const wallElapsed = wallEnd - wallStart;

    // 9. Assert URL ------------------------------------------------------
    const url = (await run("get", "url")).trim();
    if (!url.includes("/play/rainbow-door-s1/complete/0")) {
      throw new Error(
        `Expected URL to contain /play/rainbow-door-s1/complete/0, got: ${url}`,
      );
    }
    console.log(`   URL: ${url} ✓`);

    // 10. Query sessions API (with retry for state-write flush) -----------
    console.log("10. Querying sessions API …");

    let sessions: Array<Record<string, unknown>> = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const sessionsRes = await fetch(
        `${BASE_URL}/api/children/rainbow-door-s1/sessions`,
      );
      if (!sessionsRes.ok) {
        throw new Error(`Sessions API returned ${sessionsRes.status}`);
      }
      sessions = await sessionsRes.json();
      if (Array.isArray(sessions) && sessions.length > 0) break;
      if (attempt < 5) {
        console.log(`   Retry ${attempt}: session not yet persisted, waiting 200ms …`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!Array.isArray(sessions) || sessions.length === 0) {
      throw new Error(
        "No sessions found after 5 retries — session was not persisted",
      );
    }

    // Latest session (sorted newest-first by the server).
    const latest = sessions[0]!;
    const rawActiveMs = latest.active_ms;
    if (typeof rawActiveMs !== "number" || !Number.isFinite(rawActiveMs)) {
      throw new Error(
        `active_ms missing or invalid in session: ${JSON.stringify(latest)}`,
      );
    }
    const activeMs: number = rawActiveMs;
    console.log(`   active_ms: ${activeMs}ms`);
    console.log(`   wall clock elapsed: ${wallElapsed}ms`);
    console.log(`   difference: ${wallElapsed - activeMs}ms`);

    // 11. Assert idle was excluded -----------------------------------------
    //
    // Tolerance band: active_ms ∈ [500, wallElapsed - IDLE_MARGIN_MS]
    //
    // Lower bound (500): ensures typing actually contributed some active time.
    //
    // Upper bound (wallElapsed - IDLE_MARGIN_MS): ensures the ~8s idle gap
    // was excluded.  IDLE_MARGIN_MS = 6000 means at least 6 seconds of wall
    // clock were classified as idle.  The actual idle sleep is 8 s, so this
    // leaves ~2 s of headroom for clock jitter and measurement noise.
    const lowerBound = 500;
    const upperBound = wallElapsed - IDLE_MARGIN_MS;

    if (activeMs < lowerBound) {
      throw new Error(
        `active_ms (${activeMs}) below lower bound (${lowerBound}) — ` +
          "typing was not counted",
      );
    }
    if (activeMs > upperBound) {
      throw new Error(
        `active_ms (${activeMs}) exceeds upper bound (${upperBound}) — ` +
          "idle time may not have been excluded. " +
          `Wall clock: ${wallElapsed}ms, ` +
          `expected active_ms ≤ ${upperBound}ms ` +
          `(wall clock − ${IDLE_MARGIN_MS}ms idle margin)`,
      );
    }
    console.log(
      `   active_ms in [${lowerBound}, ${upperBound}] ✓`,
    );

    console.log("\n✅ Idle handling E2E test passed!");
  } finally {
    // --- Restore original state -------------------------------------------
    try {
      if (backup) {
        await Bun.write(STATE_PATH, backup);
      } else if (!hadState) {
        // Only clean up if we created it ourselves.
        Bun.file(STATE_PATH).delete();
      }
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
