#!/usr/bin/env bun
/**
 * End-to-end idle handling test using agent-browser.
 *
 * Flow:
 *  1. Open the app, click the story card, start episode 0.
 *  2. Type the first 10 chars.
 *  3. Sleep 8 seconds (>5s idle threshold).
 *  4. Type the next 10 chars.
 *  5. Type the rest of the episode in chunks.
 *  6. Wait for the completion page.
 *  7. Query GET /api/progress for the just-saved session.
 *  8. Assert active_ms excludes the idle gap.
 *
 * Usage: bun run e2e:idle
 * Assumes `dev:direct` is running with TYPELING_IDENTITY — see README.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BASE_URL,
	E2E_STORY_NAME,
	E2E_STORY_SLUG,
	closeBrowser,
	requireAgentBrowser,
	requireDevServer,
	run,
	sleep,
} from "./shared";

const ROOT = join(import.meta.dir, "..", "..");
const SEASON_PATH = join(ROOT, "seasons", `${E2E_STORY_SLUG}.json`);

const CHUNK_SIZE = 80;
const CHUNK_DELAY_MS = 1000;
const IDLE_SLEEP_MS = 8000;
const IDLE_MARGIN_MS = 6000;

function getEpisodeText(): string {
	const raw = readFileSync(SEASON_PATH, "utf-8");
	const season = JSON.parse(raw);
	const ep = season.episodes.find(
		(e: { idx: number; text: string }) => e.idx === 0,
	);
	if (!ep) throw new Error("Episode 0 not found in season file");
	return ep.text;
}

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

async function fetchLatestSession(): Promise<Record<string, unknown>> {
	for (let attempt = 1; attempt <= 5; attempt++) {
		const progressRes = await fetch(`${BASE_URL}/api/progress`);
		if (!progressRes.ok) {
			throw new Error(`/api/progress returned ${progressRes.status}`);
		}
		const progress = (await progressRes.json()) as {
			stories?: Array<{
				slug: string;
				recent_sessions?: Array<Record<string, unknown>>;
			}>;
		};
		const story = progress.stories?.find((row) => row.slug === E2E_STORY_SLUG);
		const sessions = story?.recent_sessions ?? [];
		if (sessions.length > 0) {
			return sessions[0]!;
		}
		if (attempt < 5) {
			console.log(
				`   Retry ${attempt}: session not yet persisted, waiting 200ms …`,
			);
			await sleep(200);
		}
	}
	throw new Error(
		"No sessions found after 5 retries — session was not persisted",
	);
}

async function main() {
	await requireAgentBrowser();
	await requireDevServer();

	const episodeText = getEpisodeText();
	const wallStart = Date.now();

	try {
		console.log("1. Opening app …");
		await run("open", BASE_URL);

		console.log("2. Clicking the story card …");
		await run("find", "text", E2E_STORY_NAME, "click");

		console.log("3. Waiting for episode runner …");
		await run("wait", "--text", "Luma");

		const firstChunk = episodeText.slice(0, 10);
		console.log(`4. Typing first ${firstChunk.length} chars …`);
		await run("keyboard", "type", firstChunk);

		console.log(`5. Sleeping ${IDLE_SLEEP_MS}ms (idle gap) …`);
		await sleep(IDLE_SLEEP_MS);

		const secondChunk = episodeText.slice(10, 20);
		console.log(`6. Typing next ${secondChunk.length} chars …`);
		await run("keyboard", "type", secondChunk);

		const rest = episodeText.slice(20);
		console.log(`7. Typing remaining ${rest.length} chars …`);
		await typeText(rest);

		console.log("8. Waiting for completion page …");
		await run("wait", "--url", "**/complete/0");

		const wallElapsed = Date.now() - wallStart;

		const url = (await run("get", "url")).trim();
		if (!url.includes(`/play/${E2E_STORY_SLUG}/complete/0`)) {
			throw new Error(
				`Expected URL to contain /play/${E2E_STORY_SLUG}/complete/0, got: ${url}`,
			);
		}
		console.log(`   URL: ${url} ✓`);

		console.log("9. Querying /api/progress …");
		const latest = await fetchLatestSession();
		const rawActiveMs = latest.active_ms;
		if (typeof rawActiveMs !== "number" || !Number.isFinite(rawActiveMs)) {
			throw new Error(
				`active_ms missing or invalid in session: ${JSON.stringify(latest)}`,
			);
		}
		const activeMs = rawActiveMs;
		console.log(`   active_ms: ${activeMs}ms`);
		console.log(`   wall clock elapsed: ${wallElapsed}ms`);
		console.log(`   difference: ${wallElapsed - activeMs}ms`);

		const lowerBound = 500;
		const upperBound = wallElapsed - IDLE_MARGIN_MS;

		if (activeMs < lowerBound) {
			throw new Error(
				`active_ms (${activeMs}) below lower bound (${lowerBound}) — typing was not counted`,
			);
		}
		if (activeMs > upperBound) {
			throw new Error(
				`active_ms (${activeMs}) exceeds upper bound (${upperBound}) — idle time may not have been excluded. ` +
					`Wall clock: ${wallElapsed}ms, expected active_ms ≤ ${upperBound}ms`,
			);
		}
		console.log(`   active_ms in [${lowerBound}, ${upperBound}] ✓`);

		console.log("\n✅ Idle handling E2E test passed!");
	} finally {
		await closeBrowser();
	}
}

main().catch((e) => {
	console.error(`\n❌ ${e.message}`);
	process.exit(1);
});
