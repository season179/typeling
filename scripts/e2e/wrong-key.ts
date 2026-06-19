#!/usr/bin/env bun
/**
 * End-to-end wrong-key isolation test using agent-browser.
 *
 * Flow:
 *  1. Open /, click the story card.
 *  2. Read the next expected character.
 *  3. Dispatch a wrong key via KeyboardEvent.
 *  4. Assert: cursorIdx did NOT advance.
 *  5. Assert: red flash class appeared in the DOM.
 *  6. Dispatch the correct key; assert cursor advances by 1.
 *
 * Usage: bun run e2e:wrong-key
 * Assumes `dev:direct` is running with TYPELING_IDENTITY — see README.md.
 */

import {
	BASE_URL,
	E2E_STORY_NAME,
	closeBrowser,
	requireAgentBrowser,
	requireDevServer,
	run,
	sleep,
} from "./shared";

async function dispatchKey(key: string): Promise<void> {
	await run(
		"eval",
		`document.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)}, bubbles:true}))`,
	);
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
		await sleep(100);

		const expected = (
			await run("get", "text", "[data-testid='cursor-char']")
		).trim();
		console.log(`   Expected char: "${expected}"`);

		const wrongKey = expected.toLowerCase() === "x" ? "z" : "x";
		console.log(`   Wrong key to press: "${wrongKey}"`);

		const typedBefore = (
			await run("get", "text", "[data-testid='typed-region']")
		).trim();
		const cursorIdxBefore = (
			await run("get", "text", "[data-testid='cursor-idx']")
		).trim();
		console.log(
			`   cursorIdx before wrong key: ${cursorIdxBefore}, typed length: ${typedBefore.length}`,
		);

		console.log("4. Dispatching wrong key …");
		await dispatchKey(wrongKey);

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
			if (cls.includes("text-red-400")) {
				flashSeen = true;
				break;
			}
			await sleep(15);
		}
		if (!flashSeen) {
			throw new Error(
				"Red flash (text-red-400) did not appear after wrong key",
			);
		}
		console.log("   Red flash detected ✓");

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

		console.log("6. Dispatching correct key …");
		await dispatchKey(expected);
		await sleep(50);

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
		await closeBrowser();
	}
}

main().catch((e) => {
	console.error(`\n❌ ${e.message}`);
	process.exit(1);
});
