import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearStaleDrafts, listDraftsForChild, saveDraft } from "./autosave";

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

describe("listDraftsForChild", () => {
	test("returns correct entries for a child", () => {
		saveDraft("alice", "season-1", 0, draft);
		saveDraft("alice", "season-1", 1, draft);

		const result = listDraftsForChild("alice");
		expect(result).toHaveLength(2);
		expect(result).toContainEqual({
			childId: "alice",
			seasonSlug: "season-1",
			episodeIdx: 0,
		});
		expect(result).toContainEqual({
			childId: "alice",
			seasonSlug: "season-1",
			episodeIdx: 1,
		});
	});

	test("returns empty array when no drafts exist", () => {
		expect(listDraftsForChild("alice")).toEqual([]);
	});

	test("ignores drafts for other children", () => {
		saveDraft("alice", "season-1", 0, draft);
		saveDraft("bob", "season-2", 0, draft);

		const result = listDraftsForChild("alice");
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			childId: "alice",
			seasonSlug: "season-1",
			episodeIdx: 0,
		});
	});
});

describe("clearStaleDrafts", () => {
	test("clears draft whose season differs from active_season", () => {
		saveDraft("alice", "old-season", 0, draft);

		clearStaleDrafts({ alice: { active_season: "new-season" } });

		expect(listDraftsForChild("alice")).toEqual([]);
	});

	test("keeps draft whose season matches active_season", () => {
		saveDraft("alice", "season-1", 0, draft);

		clearStaleDrafts({ alice: { active_season: "season-1" } });

		expect(listDraftsForChild("alice")).toHaveLength(1);
		expect(listDraftsForChild("alice")[0]).toEqual({
			childId: "alice",
			seasonSlug: "season-1",
			episodeIdx: 0,
		});
	});

	test("handles child with no drafts", () => {
		clearStaleDrafts({ alice: { active_season: "season-1" } });
		expect(listDraftsForChild("alice")).toEqual([]);
	});

	test("handles empty children record", () => {
		saveDraft("alice", "season-1", 0, draft);

		clearStaleDrafts({});

		expect(listDraftsForChild("alice")).toHaveLength(1);
	});

	test("clears only stale drafts, keeps valid ones", () => {
		saveDraft("alice", "old-season", 0, draft);
		saveDraft("alice", "current-season", 1, draft);
		saveDraft("bob", "bob-season", 0, draft);

		clearStaleDrafts({
			alice: { active_season: "current-season" },
			bob: { active_season: "bob-season" },
		});

		const aliceDrafts = listDraftsForChild("alice");
		expect(aliceDrafts).toHaveLength(1);
		expect(aliceDrafts[0]).toEqual({
			childId: "alice",
			seasonSlug: "current-season",
			episodeIdx: 1,
		});

		const bobDrafts = listDraftsForChild("bob");
		expect(bobDrafts).toHaveLength(1);
	});
});
