import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { GlobalWindow, type Window } from "happy-dom";
import { saveDraft, loadDraft, clearDraft, keyFor } from "../../../src/web/episodeRunner/autosave";

const window = new GlobalWindow() as unknown as Window & typeof globalThis;

const draft = {
  sessionId: "abc-123",
  cursorIdx: 5,
  activeMs: 4200,
  lastKeystrokeAt: 1715300000000,
};

describe("saveDraft / loadDraft / clearDraft", () => {
  beforeAll(() => {
    // @ts-expect-error happy-dom globals
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.localStorage = window.localStorage;
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  afterAll(() => {
    window.close();
  });

  it("round-trip: save then load returns the same draft", () => {
    saveDraft("winni", "winni-s1", 0, draft);
    const loaded = loadDraft("winni", "winni-s1", 0);
    expect(loaded).toEqual(draft);
  });

  it("loadDraft returns null when no entry exists", () => {
    const result = loadDraft("winni", "winni-s1", 99);
    expect(result).toBeNull();
  });

  it("loadDraft returns null when JSON fails to parse", () => {
    window.localStorage.setItem(keyFor("winni", "winni-s1", 5), "not-json");
    const result = loadDraft("winni", "winni-s1", 5);
    expect(result).toBeNull();
  });

  it("loadDraft removes the corrupt entry from localStorage", () => {
    window.localStorage.setItem(keyFor("winni", "winni-s1", 5), "not-json");
    loadDraft("winni", "winni-s1", 5);
    expect(window.localStorage.getItem(keyFor("winni", "winni-s1", 5))).toBeNull();
  });

  it("clearDraft removes the entry so loadDraft returns null", () => {
    saveDraft("zack", "zack-s1", 2, draft);
    expect(loadDraft("zack", "zack-s1", 2)).not.toBeNull();
    clearDraft("zack", "zack-s1", 2);
    expect(loadDraft("zack", "zack-s1", 2)).toBeNull();
  });

  it("drafts for different children are isolated", () => {
    saveDraft("winni", "winni-s1", 0, draft);
    saveDraft("zack", "zack-s1", 0, { ...draft, cursorIdx: 10 });
    expect(loadDraft("winni", "winni-s1", 0)?.cursorIdx).toBe(5);
    expect(loadDraft("zack", "zack-s1", 0)?.cursorIdx).toBe(10);
  });

  it("drafts for different episodeIdx are isolated", () => {
    saveDraft("winni", "winni-s1", 0, draft);
    saveDraft("winni", "winni-s1", 1, { ...draft, cursorIdx: 3 });
    expect(loadDraft("winni", "winni-s1", 0)?.cursorIdx).toBe(5);
    expect(loadDraft("winni", "winni-s1", 1)?.cursorIdx).toBe(3);
  });

  it("drafts for different seasonSlug are isolated", () => {
    saveDraft("winni", "winni-s1", 0, draft);
    saveDraft("winni", "winni-s2", 0, { ...draft, cursorIdx: 7 });
    expect(loadDraft("winni", "winni-s1", 0)?.cursorIdx).toBe(5);
    expect(loadDraft("winni", "winni-s2", 0)?.cursorIdx).toBe(7);
  });

  it("round-trips lastKeystrokeAt null", () => {
    const withNull = { ...draft, lastKeystrokeAt: null };
    saveDraft("winni", "winni-s1", 0, withNull);
    const loaded = loadDraft("winni", "winni-s1", 0);
    expect(loaded?.lastKeystrokeAt).toBeNull();
  });

  it("save overwrites existing draft for the same key", () => {
    saveDraft("winni", "winni-s1", 0, draft);
    saveDraft("winni", "winni-s1", 0, { ...draft, cursorIdx: 99 });
    const loaded = loadDraft("winni", "winni-s1", 0);
    expect(loaded?.cursorIdx).toBe(99);
  });
});
