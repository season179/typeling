import { describe, it, expect } from "bun:test";

describe("bun run dev", () => {
  it("starts both Hono server and Vite dev server", async () => {
    const proc = Bun.spawn(["bun", "run", "dev"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PORT: "3001" },
    });

    try {
      // Wait up to 10s for both servers to be ready
      const deadline = Date.now() + 10000;
      let honoReady = false;
      let viteReady = false;

      while (Date.now() < deadline && (!honoReady || !viteReady)) {
        if (!honoReady) {
          try {
            const res = await fetch("http://127.0.0.1:3001/api/health", { signal: AbortSignal.timeout(500) });
            if (res.status === 200) honoReady = true;
          } catch { /* ignore */ }
        }
        if (!viteReady) {
          try {
            const res = await fetch("http://127.0.0.1:5173", { signal: AbortSignal.timeout(500) });
            if (res.status === 200) viteReady = true;
          } catch { /* ignore */ }
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
