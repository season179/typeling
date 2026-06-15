import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAlignmentStoryWords } from "../../../src/lib/storyWordTokens";
import { pcmToWavBuffer } from "../../../src/lib/wav";
import { fetch } from "../../../src/server/index.ts";
import { fakeD1StoryDatabase } from "../../lib/fakeD1Story";

const fixtureSeason = {
	slug: "winni-s1-admin",
	name: "Test Rainbow Story",
	theme: "rainbow-unicorn",
	episodes: Array.from({ length: 14 }, (_, i) => ({
		idx: i,
		text:
			i === 0
				? "Luma saw a rainbow path in the sunny garden."
				: `Episode ${i + 1} text for testing.`,
	})),
};

let workDir: string;
let stateFile: string;
let seasonsDir: string;
let audioDir: string;
let originalStatePath: string | undefined;
let originalSeasonsDir: string | undefined;
let originalAudioDir: string | undefined;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "typeling-admin-"));
	stateFile = join(workDir, "state.json");
	seasonsDir = join(workDir, "seasons");
	audioDir = join(workDir, "audio");
	await mkdir(seasonsDir, { recursive: true });
	await mkdir(audioDir, { recursive: true });

	originalStatePath = Bun.env.TYPELING_STATE_PATH;
	originalSeasonsDir = Bun.env.TYPELING_SEASONS_DIR;
	originalAudioDir = Bun.env.TYPELING_AUDIO_DIR;
	Bun.env.TYPELING_STATE_PATH = stateFile;
	Bun.env.TYPELING_SEASONS_DIR = seasonsDir;
	Bun.env.TYPELING_AUDIO_DIR = audioDir;
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
	if (originalAudioDir === undefined) {
		delete Bun.env.TYPELING_AUDIO_DIR;
	} else {
		Bun.env.TYPELING_AUDIO_DIR = originalAudioDir;
	}
	await rm(workDir, { recursive: true, force: true });
});

const writeSeason = (season: unknown = fixtureSeason) =>
	writeFile(
		join(seasonsDir, `${fixtureSeason.slug}.json`),
		JSON.stringify(season),
		"utf8",
	);

const getAdminStories = (url = "http://127.0.0.1:3001/api/admin/stories") =>
	fetch(new Request(url));

const updateEpisode = (text: string) =>
	fetch(
		new Request(
			"http://127.0.0.1:3001/api/admin/seasons/winni-s1-admin/episodes/0",
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text }),
			},
		),
	);

const getAdminAudioFile = () =>
	fetch(
		new Request(
			"http://127.0.0.1:3001/api/admin/seasons/winni-s1-admin/episodes/0/audio/file",
		),
	);

const getAdminCaptions = () =>
	fetch(
		new Request(
			"http://127.0.0.1:3001/api/admin/seasons/winni-s1-admin/episodes/0/audio/captions.vtt",
		),
	);

const sha256 = (input: string | Uint8Array) =>
	createHash("sha256").update(input).digest("hex");

const writeAudioArtifacts = async (
	episodeText = fixtureSeason.episodes[0]!.text,
) => {
	const seasonSlug = fixtureSeason.slug;
	const episodeIdx = 0;
	const baseName = `${seasonSlug}-e${episodeIdx}`;
	const audioPath = join(audioDir, `${baseName}.wav`);
	const timingsPath = join(audioDir, `${baseName}.words.json`);
	const audioBytes = pcmToWavBuffer(new Uint8Array(24000 * 2 * 2));
	const words = extractAlignmentStoryWords(episodeText).map((word, index) => ({
		index: word.wordIndex,
		text: word.text,
		start: index * 0.2,
		end: index * 0.2 + 0.1,
	}));

	await writeFile(audioPath, audioBytes);
	await writeFile(
		timingsPath,
		JSON.stringify({
			seasonSlug,
			episodeIdx,
			audioPath,
			sourceTextPath: join(audioDir, `${baseName}-source.txt`),
			rawAlignmentPath: join(audioDir, `${baseName}.qwen-align.raw.txt`),
			audioHash: sha256(audioBytes),
			textHash: sha256(episodeText),
			alignerModel: "test-aligner",
			durationSeconds: 2,
			generatedAt: "2026-05-20T00:00:00.000Z",
			words,
		}),
		"utf8",
	);
};

describe("admin API", () => {
	it("returns stories and audio status for local requests", async () => {
		await writeSeason();
		await writeAudioArtifacts();

		const res = await getAdminStories();

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.admin.access).toBe("local-only");
		expect(body.stories[0].slug).toBe("winni-s1-admin");
		expect(body.stories[0].episodes[0]).toMatchObject({
			idx: 0,
			word_count: 9,
			audio: { status: "ready", duration_seconds: 2, words: 9 },
		});
		expect(body.stories[0].episodes[1].audio.status).toBe("missing");
	});

	it("rejects admin requests from non-local hostnames", async () => {
		const res = await getAdminStories(
			"https://typeling.example.com/api/admin/stories",
		);

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "AdminLocalOnly" });
	});

	it("updates a season episode on disk", async () => {
		await writeSeason();
		const nextText = "Luma found a small brass key beside the rainbow gate.";

		const res = await updateEpisode(nextText);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.episode.text).toBe(nextText);
		const saved = await Bun.file(
			join(seasonsDir, `${fixtureSeason.slug}.json`),
		).json();
		expect(saved.episodes[0].text).toBe(nextText);
		expect(
			await Bun.file(
				join(seasonsDir, `${fixtureSeason.slug}.json.bak`),
			).exists(),
		).toBe(true);
	});

	it("updates a D1-bound season episode and refreshes its text hash", async () => {
		const storyDb = fakeD1StoryDatabase([fixtureSeason]);
		const nextText = "Luma found a small brass key beside the rainbow gate.";

		const res = await fetch(
			new Request(
				"http://127.0.0.1:3001/api/admin/seasons/winni-s1-admin/episodes/0",
				{
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ text: nextText }),
				},
			),
			{
				STORY_DB: storyDb,
			},
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.episode.text).toBe(nextText);
		expect(storyDb.episodeTextHash(fixtureSeason.slug, 0)).toBe(
			sha256(nextText),
		);
	});

	it("rejects story text with real child names before writing", async () => {
		await writeSeason();

		const res = await updateEpisode("Winni found a rainbow gate.");

		expect(res.status).toBe(422);
		expect(await res.json()).toEqual({ error: "RealChildNameInStory" });
		const saved = await Bun.file(
			join(seasonsDir, `${fixtureSeason.slug}.json`),
		).json();
		expect(saved.episodes[0].text).toBe(fixtureSeason.episodes[0]!.text);
	});

	it("serves admin audio without using child chapter locks", async () => {
		await writeSeason();
		await writeAudioArtifacts();

		const res = await getAdminAudioFile();

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("audio/wav");
		expect(new Uint8Array(await res.arrayBuffer()).slice(0, 4)).toEqual(
			new Uint8Array([82, 73, 70, 70]),
		);
	});

	it("serves admin captions from the story text and audio duration", async () => {
		await writeSeason();
		await writeAudioArtifacts();

		const res = await getAdminCaptions();

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
		const text = await res.text();
		expect(text).toContain("WEBVTT");
		expect(text).toContain("00:00:00.000 --> 00:00:02.000");
		expect(text).toContain(fixtureSeason.episodes[0]!.text);
	});
});
