#!/usr/bin/env bun
/**
 * End-to-end wrong-key isolation test using agent-browser.
 *
 * Flow:
 *  1. Open /, click a child (Winni).
 *  2. Read the next expected character.
 *  3. Dispatch a wrong key via KeyboardEvent.
 *  4. Assert: cursorIdx did NOT advance (snapshot the typed-region length; should remain unchanged).
 *  5. Assert: red flash class appeared in the DOM (polled, tolerant of timing).
 *  6. Dispatch the correct key; assert cursor advances by 1.
 *
 * Usage: bun run e2e:wrong-key
 * Assumes the dev server is running on http://localhost:5173.
 */

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..", "..");
const BASE_URL = "http://localhost:5173";
const STATE_PATH = join(ROOT, "data", "state.json");
const SEED_PATH = join(ROOT, "data", "state.seed.json");

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

/** Sleep for `ms` milliseconds. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dispatch a keydown KeyboardEvent on the document.
 *
 * Uses JSON.stringify for safe interpolation — the episode text may contain
 * apostrophes and other characters that would break a raw JS string literal.
 */
async function dispatchKey(key: string): Promise<void> {
  await run(
    "eval",
    `document.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)}, bubbles:true}))`,
  );
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
  copyFileSync(SEED_PATH, STATE_PATH);

  try {
    // 1. Open the app ------------------------------------------------------
    console.log("1. Opening app …");
    await run("open", BASE_URL);

    // 2. Click Winni's card ------------------------------------------------
    console.log("2. Clicking Winni's card …");
    await run("find", "text", "Winni", "click");

    // 3. Wait for the episode runner to appear -----------------------------
    console.log("3. Waiting for episode runner …");
    await run("wait", "--text", "Luma");

    // Let React finish the initial render so cursor-char is in the DOM.
    await sleep(100);

    // Read the next expected character -----------------------------------
    const expected = (
      await run("get", "text", "[data-testid='cursor-char']")
    ).trim();
    console.log(`   Expected char: "${expected}"`);

    // Pick a wrong key that is definitely not the expected character.
    // Use 'x' unless the expected char happens to be 'x' or 'X'.
    const wrongKey = expected.toLowerCase() === "x" ? "z" : "x";
    console.log(`   Wrong key to press: "${wrongKey}"`);

    // Record initial state before the wrong key --------------------------
    const typedBefore = (
      await run("get", "text", "[data-testid='typed-region']")
    ).trim();
    const cursorIdxBefore = (
      await run("get", "text", "[data-testid='cursor-idx']")
    ).trim();
    console.log(
      `   cursorIdx before wrong key: ${cursorIdxBefore}, typed length: ${typedBefore.length}`,
    );

    // 4. Dispatch wrong key ------------------------------------------------
    console.log("4. Dispatching wrong key …");
    await dispatchKey(wrongKey);

    // 5. Assert red flash class appeared + cursorIdx unchanged -----------
    //    Poll FIRST — the flash only lasts 200ms and earlier assertions
    //    would eat into that window.
    console.log("5. Polling for red flash …");
    let flashSeen = false;
    for (let i = 0; i < 15; i++) {
      const cls = (
        await run(
          "get",
          "attr",
          "[data-testid='cursor-char']",
          "class",
        )
      ).trim();
      if (cls.includes("text-red-500")) {
        flashSeen = true;
        break;
      }
      // Poll every ~15ms — 15 iterations × 15ms = 225ms window,
      // comfortably covering the 200ms flash duration.
      await sleep(15);
    }
    if (!flashSeen) {
      throw new Error(
        "Red flash (text-red-500) did not appear after wrong key",
      );
    }
    console.log("   Red flash detected ✓");

    // Assert cursorIdx did NOT advance -----------------------------------
    const typedAfterWrong = (
      await run("get", "text", "[data-testid='typed-region']")
    ).trim();
    const cursorIdxAfterWrong = (
      await run("get", "text", "[data-testid='cursor-idx']")
    ).trim();

    if (cursorIdxAfterWrong !== cursorIdxBefore) {
      throw new Error(
        `Expected cursorIdx to stay at ${cursorIdxBefore} after wrong key, got ${cursorIdxAfterWrong}`,
      );
    }
    if (typedAfterWrong.length !== typedBefore.length) {
      throw new Error(
        `Expected typed-region length to stay at ${typedBefore.length} after wrong key, got ${typedAfterWrong.length}`,
      );
    }
    console.log(
      `   cursorIdx after wrong key: ${cursorIdxAfterWrong} (unchanged) ✓`,
    );

    // 6. Dispatch the correct key ------------------------------------------
    console.log("6. Dispatching correct key …");
    await dispatchKey(expected);

    // Let React flush the re-render after dispatch (defensive, ~1 frame).
    await sleep(50);

    // Assert cursor advanced by 1 -----------------------------------------
    const cursorIdxAfterCorrect = (
      await run("get", "text", "[data-testid='cursor-idx']")
    ).trim();
    const expectedIdx = String(Number(cursorIdxBefore) + 1);
    if (cursorIdxAfterCorrect !== expectedIdx) {
      throw new Error(
        `Expected cursorIdx to be ${expectedIdx} after correct key, got ${cursorIdxAfterCorrect}`,
      );
    }
    console.log(`   cursorIdx after correct key: ${cursorIdxAfterCorrect} ✓`);

    console.log("\n✅ Wrong-key isolation E2E test passed!");
  } finally {
    // --- Restore original state -------------------------------------------
    try {
      if (backup) {
        await Bun.write(STATE_PATH, backup);
      } else if (!hadState) {
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
