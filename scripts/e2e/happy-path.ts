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
} from "./shared";

const ROOT = join(import.meta.dir, "..", "..");
const SEASON_PATH = join(ROOT, "seasons", `${E2E_STORY_SLUG}.json`);

const CHUNK_SIZE = 80;
const CHUNK_DELAY_MS = 1000;

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

async function main() {
	await requireAgentBrowser();
	await requireDevServer();

	try {
		console.log("1. Opening app …");
		await run("open", BASE_URL);

		console.log("2. Clicking the story card …");
		await run("find", "text", E2E_STORY_NAME, "click");

		console.log("3. Waiting for episode runner …");
		await run("wait", "--text", "Luma");

		const text = getEpisodeText();
		console.log(`4. Typing episode 0 (${text.length} chars) …`);
		await typeText(text);

		console.log("5. Waiting for completion page …");
		await run("wait", "--url", "**/complete/0");

		const url = (await run("get", "url")).trim();
		if (!url.includes(`/play/${E2E_STORY_SLUG}/complete/0`)) {
			throw new Error(
				`Expected URL to contain /play/${E2E_STORY_SLUG}/complete/0, got: ${url}`,
			);
		}
		console.log(`   URL: ${url} ✓`);

		await run("wait", "--text", "Episode 1 complete!");

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
		await closeBrowser();
	}
}

main().catch((e) => {
	console.error(`\n❌ ${e.message}`);
	process.exit(1);
});
