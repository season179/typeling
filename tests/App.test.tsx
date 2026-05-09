import { Window, GlobalWindow } from "happy-dom";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import App from "../src/web/App";

const window = new GlobalWindow() as unknown as Window & typeof globalThis;

describe("App", () => {
  beforeAll(() => {
    // @ts-expect-error happy-dom globals
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.navigator = window.navigator;
  });

  afterAll(() => {
    window.close();
  });

  afterEach(() => {
    cleanup();
  });

  it("fetches /api/health on mount and renders the response", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<RequestInfo | URL> = [];
    globalThis.fetch = (async (input) => {
      requests.push(input);
      return (
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        })
      );
    }) as typeof fetch;

    try {
      const { getByText } = render(<App />);
      await waitFor(() => {
        expect(getByText('{"ok":true}')).toBeDefined();
      });
      expect(requests).toEqual(["/api/health"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
