import { describe, it, expect } from "bun:test";
import fetch from "../src/server/index.ts";

describe("server", () => {
  it("GET /api/health returns { ok: true }", async () => {
    const req = new Request("http://127.0.0.1:3001/api/health");
    const res = await fetch(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("does not serve health through 0.0.0.0", async () => {
    const req = new Request("http://0.0.0.0:3001/api/health");
    const res = await fetch(req);
    expect(res.status).toBe(0);
    expect(res.type).toBe("error");
  });
});
