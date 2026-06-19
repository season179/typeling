import { describe, expect, it } from "bun:test";

describe("repo hygiene", () => {
	it.each([
		"data/state.json",
		"data/state.json.bak",
		"seasons/rainbow-door-s1.json.bak",
	])("ignores %s", async (path) => {
		const proc = Bun.spawn(["git", "check-ignore", "-q", path]);
		expect(await proc.exited).toBe(0);
	});

	it("tracks data/.gitkeep so the directory exists in fresh checkouts", async () => {
		const proc = Bun.spawn(
			["git", "ls-files", "--error-unmatch", "data/.gitkeep"],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(await proc.exited).toBe(0);
	});

	it("keeps publish-time/sidecar modules out of the shipped bundles (src/server, src/web)", async () => {
		// Neither the Worker bundle (src/server/*) nor the client bundle (src/web/*)
		// may import the publish-time/sidecar modules. asset-publisher.ts and
		// r2-s3-client.ts pull in Bun/node:fs code and carry prod-R2 credentials,
		// and anything under scripts/ (e.g. the loopback sidecar) is sidecar-only;
		// importing any of them from a shipped module would break the Worker bundle
		// or leak credential-bearing code into the browser. Match import specifiers
		// only — prose mentions in comments are allowed.
		const forbidden = ["asset-publisher", "r2-s3-client", "scripts/"];
		const patterns = [
			"src/server/**/*.ts",
			"src/web/**/*.ts",
			"src/web/**/*.tsx",
		];
		const offenders: string[] = [];

		for (const pattern of patterns) {
			const glob = new Bun.Glob(pattern);
			for await (const path of glob.scan(".")) {
				const source = await Bun.file(path).text();
				for (const line of source.split(/\r?\n/)) {
					// Extract the quoted module specifier from an import/require, if any.
					const match = line.match(
						/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/,
					);
					const specifier = match?.[1];
					if (!specifier) continue;
					if (forbidden.some((needle) => specifier.includes(needle))) {
						offenders.push(`${path}: ${line.trim()}`);
					}
				}
			}
		}

		expect(offenders).toEqual([]);
	});

	it("documents the bun scripts in README.md", async () => {
		const readme = await Bun.file("README.md").text();
		for (const command of [
			"bun run dev",
			"bun run lint",
			"bun run format",
			"bun test",
		]) {
			expect(readme).toContain(command);
		}
	});
});
