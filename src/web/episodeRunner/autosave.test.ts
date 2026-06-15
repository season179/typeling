import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearStaleDrafts, listDraftsForOwner, saveDraft } from "./autosave";

function makeLocalStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
		key: (index: number) => {
			const keys = [...store.keys()];
			return keys[index] ?? null;
		},
		get length() {
			return store.size;
		},
	};
}

beforeEach(() => {
	(globalThis as Record<string, unknown>).localStorage = makeLocalStorage();
});

afterEach(() => {
	delete (globalThis as Record<string, unknown>).localStorage;
});

const draft = {
	sessionId: "test-session-id",
	cursorIdx: 5,
	activeMs: 3000,
	lastKeystrokeAt: 1000,
};

describe("listDraftsForOwner", () => {
	test("returns correct entries for an owner", () => {
		saveDraft("alice@example.com", "season-1", 0, draft);
		saveDraft("alice@example.com", "season-1", 1, draft);

		const result = listDraftsForOwner("alice@example.com");
		expect(result).toHaveLength(2);
		expect(result).toContainEqual({
			ownerId: "alice@example.com",
			seasonSlug: "season-1",
			episodeIdx: 0,
		});
		expect(result).toContainEqual({
			ownerId: "alice@example.com",
			seasonSlug: "season-1",
			episodeIdx: 1,
		});
	});

	test("returns empty array when no drafts exist", () => {
		expect(listDraftsForOwner("alice@example.com")).toEqual([]);
	});

	test("ignores drafts for other owners", () => {
		saveDraft("alice@example.com", "season-1", 0, draft);
		saveDraft("bob@example.com", "season-2", 0, draft);

		const result = listDraftsForOwner("alice@example.com");
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			ownerId: "alice@example.com",
			seasonSlug: "season-1",
			episodeIdx: 0,
		});
	});
});

describe("clearStaleDrafts", () => {
	test("clears draft whose story is no longer available", () => {
		saveDraft("alice@example.com", "old-season", 0, draft);

		clearStaleDrafts("alice@example.com", ["new-season"]);

		expect(listDraftsForOwner("alice@example.com")).toEqual([]);
	});

	test("keeps draft whose story is still available", () => {
		saveDraft("alice@example.com", "season-1", 0, draft);

		clearStaleDrafts("alice@example.com", ["season-1"]);

		expect(listDraftsForOwner("alice@example.com")).toHaveLength(1);
		expect(listDraftsForOwner("alice@example.com")[0]).toEqual({
			ownerId: "alice@example.com",
			seasonSlug: "season-1",
			episodeIdx: 0,
		});
	});

	test("handles owner with no drafts", () => {
		clearStaleDrafts("alice@example.com", ["season-1"]);
		expect(listDraftsForOwner("alice@example.com")).toEqual([]);
	});

	test("keeps drafts for other owners", () => {
		saveDraft("alice@example.com", "season-1", 0, draft);

		clearStaleDrafts("bob@example.com", []);

		expect(listDraftsForOwner("alice@example.com")).toHaveLength(1);
	});

	test("clears only stale drafts, keeps valid ones", () => {
		saveDraft("alice@example.com", "old-season", 0, draft);
		saveDraft("alice@example.com", "current-season", 1, draft);
		saveDraft("bob@example.com", "bob-season", 0, draft);

		clearStaleDrafts("alice@example.com", ["current-season"]);

		const aliceDrafts = listDraftsForOwner("alice@example.com");
		expect(aliceDrafts).toHaveLength(1);
		expect(aliceDrafts[0]).toEqual({
			ownerId: "alice@example.com",
			seasonSlug: "current-season",
			episodeIdx: 1,
		});

		const bobDrafts = listDraftsForOwner("bob@example.com");
		expect(bobDrafts).toHaveLength(1);
	});
});
