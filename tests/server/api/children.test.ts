import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetch } from "../../../src/server/index.ts";

const fixtureChildren = {
	winni: {
		name: "Winni",
		theme: "rainbow-unicorn",
		target_wpm: 15,
		active_season: "winni-s1-test",
		current_episode: 0,
		current_session_id: null,
	},
};

const fixtureState = {
	children: fixtureChildren,
	sessions: [],
};

let workDir: string;
let stateFile: string;
let originalStatePath: string | undefined;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "typeling-children-"));
	stateFile = join(workDir, "state.json");
	originalStatePath = Bun.env.TYPELING_STATE_PATH;
	Bun.env.TYPELING_STATE_PATH = stateFile;
});

afterEach(async () => {
	if (originalStatePath === undefined) {
		delete Bun.env.TYPELING_STATE_PATH;
	} else {
		Bun.env.TYPELING_STATE_PATH = originalStatePath;
	}
	await rm(workDir, { recursive: true, force: true });
});

const getChildren = () =>
	fetch(new Request("http://127.0.0.1:3001/api/children"));

describe("GET /api/children", () => {
	it("returns 200 with the children record from state", async () => {
		await writeFile(stateFile, JSON.stringify(fixtureState), "utf8");

		const res = await getChildren();

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(fixtureChildren);
	});

	it("returns 500 with a named error when readState throws", async () => {
		await writeFile(stateFile, "{ not valid json", "utf8");
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});

		try {
			const res = await getChildren();

			expect(res.status).toBe(500);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe("StateParseError");
			expect(errorSpy).toHaveBeenCalledTimes(1);
		} finally {
			errorSpy.mockRestore();
		}
	});
});
