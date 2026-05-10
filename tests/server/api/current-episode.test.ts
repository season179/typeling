import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fetch from "../../../src/server/index.ts";

const fixtureSeason = {
	slug: "winni-s1-test",
	child_id: "winni",
	theme: "pink unicorn",
	episodes: Array.from({ length: 14 }, (_, i) => ({
		idx: i,
		text: i === 0
			? "The pink unicorn skipped through the meadow."
			: `Episode ${i + 1} text for testing.`,
	})),
};

const fixtureState = {
	children: {
		winni: {
			name: "Winni",
			theme: "rainbow-unicorn",
			target_wpm: 15,
			active_season: "winni-s1-test",
			current_episode: 0,
			current_session_id: null,
		},
	},
	sessions: [],
};

let workDir: string;
let stateFile: string;
let seasonsDir: string;
let originalStatePath: string | undefined;
let originalSeasonsDir: string | undefined;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "typeling-current-episode-"));
	stateFile = join(workDir, "state.json");
	seasonsDir = join(workDir, "seasons");
	await mkdir(seasonsDir, { recursive: true });

	originalStatePath = Bun.env.TYPELING_STATE_PATH;
	originalSeasonsDir = Bun.env.TYPELING_SEASONS_DIR;
	Bun.env.TYPELING_STATE_PATH = stateFile;
	Bun.env.TYPELING_SEASONS_DIR = seasonsDir;
});

afterEach(async () => {
	if (originalStatePath === undefined) {
		delete Bun.env.TYPELING_STATE_PATH;
	} else {
		Bun.env.TYPELING_STATE_PATH = originalStatePath;
	}
	if (originalSeasonsDir === undefined) {
		delete Bun.env.TYPELING_SEASONS_DIR;
	} else {
		Bun.env.TYPELING_SEASONS_DIR = originalSeasonsDir;
	}
	await rm(workDir, { recursive: true, force: true });
});

const getCurrentEpisode = (childId: string) =>
	fetch(
		new Request(
			`http://127.0.0.1:3001/api/children/${childId}/current-episode`,
		),
	);

const writeState = (state: unknown) =>
	writeFile(stateFile, JSON.stringify(state), "utf8");

const writeSeason = (slug: string, season: unknown) =>
	writeFile(join(seasonsDir, `${slug}.json`), JSON.stringify(season), "utf8");

describe("GET /api/children/:id/current-episode", () => {
	it("returns 200 with text, episode_idx, and season_slug for the child's current episode", async () => {
		await writeState(fixtureState);
		await writeSeason(fixtureSeason.slug, fixtureSeason);

		const res = await getCurrentEpisode("winni");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			text: "The pink unicorn skipped through the meadow.",
			episode_idx: 0,
			season_slug: "winni-s1-test",
		});
	});

	it("returns 404 when the child id is not in state", async () => {
		await writeState(fixtureState);
		await writeSeason(fixtureSeason.slug, fixtureSeason);

		const res = await getCurrentEpisode("zack");

		expect(res.status).toBe(404);
	});

	it("returns 500 with a named error when the active_season file is missing", async () => {
		await writeState(fixtureState);
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});

		try {
			const res = await getCurrentEpisode("winni");

			expect(res.status).toBe(500);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe("SeasonFileNotFoundError");
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("returns 200 with complete:true when current_episode is past the end of the season's episodes", async () => {
		const stateBeyondEnd = {
			...fixtureState,
			children: {
				winni: {
					...fixtureState.children.winni,
					current_episode: fixtureSeason.episodes.length,
				},
			},
		};
		await writeState(stateBeyondEnd);
		await writeSeason(fixtureSeason.slug, fixtureSeason);

		const res = await getCurrentEpisode("winni");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ complete: true });
	});
});
