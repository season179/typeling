import { describe, expect, it } from "bun:test";

describe("dev scripts", () => {
	it("runs Hono and Vite as separate Portless apps", async () => {
		const packageJson = await Bun.file("package.json").json();
		expect(packageJson.scripts.dev).toContain("bun run dev:proxy &&");
		expect(packageJson.scripts["dev:proxy"]).toBe(
			"portless proxy start --https",
		);
		expect(packageJson.scripts.dev).toContain("portless typeling-api");
		expect(packageJson.scripts.dev).toContain("portless typeling vite");
		expect(packageJson.scripts.dev).toContain(
			"SERVER_URL=https://typeling-api.localhost",
		);
		expect(packageJson.scripts.dev).not.toContain("SERVER_PORT");
	});

	it("dev:direct starts both Hono server and Vite dev server", async () => {
		const apiPort = 3101;
		const proc = Bun.spawn(["bun", "run", "dev:direct"], {
			cwd: process.cwd(),
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				SERVER_PORT: String(apiPort),
			},
		});

		try {
			// Wait up to 10s for both servers to be ready
			const deadline = Date.now() + 10000;
			let honoReady = false;
			let viteReady = false;

			while (Date.now() < deadline && (!honoReady || !viteReady)) {
				const [honoResult, viteResult] = await Promise.allSettled([
					honoReady
						? Promise.resolve(null)
						: fetch(`http://127.0.0.1:${apiPort}/api/health`, {
								signal: AbortSignal.timeout(500),
							}),
					viteReady
						? Promise.resolve(null)
						: fetch("http://127.0.0.1:5173/api/health", {
								signal: AbortSignal.timeout(500),
							}),
				]);

				if (
					!honoReady &&
					honoResult.status === "fulfilled" &&
					honoResult.value?.status === 200
				) {
					honoReady = true;
				}
				if (
					!viteReady &&
					viteResult.status === "fulfilled" &&
					viteResult.value?.status === 200
				) {
					viteReady = true;
				}
				if (!honoReady || !viteReady) {
					await new Promise((r) => setTimeout(r, 200));
				}
			}

			expect(honoReady).toBe(true);
			expect(viteReady).toBe(true);
		} finally {
			proc.kill("SIGTERM");
			await proc.exited;
		}
	}, 15000);
});
