import { describe, expect, it } from "bun:test";

describe("repo hygiene", () => {
	it.each(["data/state.json", "data/state.json.bak"])("ignores %s", async (path) => {
		const proc = Bun.spawn(["git", "check-ignore", "-q", path]);
		expect(await proc.exited).toBe(0);
	});

	it("tracks data/.gitkeep so the directory exists in fresh checkouts", async () => {
		const proc = Bun.spawn(["git", "ls-files", "--error-unmatch", "data/.gitkeep"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await proc.exited).toBe(0);
	});

	it("documents the bun scripts in README.md", async () => {
		const readme = await Bun.file("README.md").text();
		for (const command of [
			"bun run dev",
			"bun run server",
			"bun run web",
			"bun run lint",
			"bun run format",
			"bun test",
		]) {
			expect(readme).toContain(command);
		}
	});
});
