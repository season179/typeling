import { describe, it, expect } from "bun:test";
import { createServer } from "vite";
import serverFetch from "../src/server/index.ts";
import viteConfig from "../vite.config.ts";

describe("vite proxy", () => {
  it("vite config has /api proxy to 127.0.0.1:3001", () => {
    expect(viteConfig.server?.proxy).toBeDefined();
    const proxy = viteConfig.server!.proxy as Record<string, { target: string }>;
    expect(proxy["/api"]).toBeDefined();
    expect(proxy["/api"]!.target).toBe("http://127.0.0.1:3001");
  });

  it("proxies /api/health through Vite dev server to Hono", async () => {
    // Start Hono server
    const honoServer = Bun.serve({
      fetch: serverFetch,
      hostname: "127.0.0.1",
      port: 3001,
    });

    // Start Vite dev server
    const viteServer = await createServer({
      ...viteConfig,
      logLevel: "silent",
      optimizeDeps: {
        ...viteConfig.optimizeDeps,
        include: [],
        noDiscovery: true,
      },
      server: {
        ...viteConfig.server,
        port: 0, // dynamic port
        strictPort: false,
      },
    });
    await viteServer.listen();

    try {
      const address = viteServer.httpServer?.address();
      const vitePort =
        typeof address === "object" && address !== null
          ? address.port
          : viteServer.config.server.port;
      const res = await fetch(`http://127.0.0.1:${vitePort}/api/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await viteServer.close();
      honoServer.stop(true);
    }
  }, 30000);
});
