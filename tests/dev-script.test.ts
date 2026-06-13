import { describe, expect, it } from "bun:test";
import viteConfig from "../vite.config";

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

	it("keeps Cloudflare dev separate from the legacy Portless flow", async () => {
		const packageJson = await Bun.file("package.json").json();
		expect(packageJson.scripts["dev:cloud"]).toBe(
			"TYPELING_CLOUDFLARE=1 vite --host 127.0.0.1",
		);
		expect(packageJson.scripts.dev).not.toContain("TYPELING_CLOUDFLARE");
	});

	it("points direct wrangler dev at the built client assets", async () => {
		const wranglerConfig = await Bun.file("wrangler.jsonc").json();
		expect(wranglerConfig.assets.directory).toBe("./dist/client");
		expect(wranglerConfig.assets.run_worker_first).toEqual(["/api/*"]);
		expect(viteConfig.build?.outDir).toBe("../../dist/client");
	});

	it("configures StateStore as a SQLite-backed Durable Object", async () => {
		const wranglerConfig = await Bun.file("wrangler.jsonc").json();

		expect(wranglerConfig.durable_objects.bindings).toContainEqual({
			name: "STATE_STORE",
			class_name: "StateStore",
		});
		expect(wranglerConfig.migrations).toContainEqual({
			tag: "v1",
			new_sqlite_classes: ["StateStore"],
		});
		expect(JSON.stringify(wranglerConfig.migrations)).not.toContain(
			"new_classes",
		);
	});

	it("binds the Worker to the R2 assets bucket with Node compatibility", async () => {
		const wranglerConfig = await Bun.file("wrangler.jsonc").json();
		expect(wranglerConfig.compatibility_flags).toContain("nodejs_compat");
		expect(wranglerConfig.r2_buckets).toEqual([
			{
				binding: "ASSETS_BUCKET",
				bucket_name: "typeling-prod-assets",
			},
		]);
	});

	it("binds the Worker to the D1 story content database", async () => {
		const wranglerConfig = await Bun.file("wrangler.jsonc").json();
		expect(wranglerConfig.d1_databases).toEqual([
			{
				binding: "STORY_DB",
				database_name: "typeling-content",
				database_id: "a3df3c02-1dec-414a-8a90-507b55549a4c",
			},
		]);
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
