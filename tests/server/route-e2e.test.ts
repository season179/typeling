import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { extractAlignmentStoryWords } from "../../src/lib/storyWordTokens";
import { pcmToWavBuffer } from "../../src/lib/wav";
import { app } from "../../src/server/index";
import {
	InMemoryAssetStore,
	InMemoryStateStore,
	InMemoryStoryStore,
	type ServerBindings,
} from "../../src/server/stores";

const fixtureSeason = {
	slug: "winni-s1-test",
	name: "Test Rainbow Story",
	theme: "pink unicorn",
	episodes: Array.from({ length: 14 }, (_, i) => ({
		idx: i,
		text: `Episode ${i + 1} text for testing.`,
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

const testAudioBytes = pcmToWavBuffer(new Uint8Array(24000 * 2 * 2));

function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

function audioForEpisode(
	episodeIdx: number,
	sidecarOverrides: Record<string, unknown> = {},
) {
	const episodeText = fixtureSeason.episodes[episodeIdx]?.text ?? "";
	const words = extractAlignmentStoryWords(episodeText).map((word, index) => ({
		index: word.wordIndex,
		text: word.text,
		start: index * 0.2,
		end: index * 0.2 + 0.1,
	}));

	return {
		seasonSlug: fixtureSeason.slug,
		episodeIdx,
		audioBytes: testAudioBytes,
		sidecar: {
			seasonSlug: fixtureSeason.slug,
			episodeIdx,
			audioPath: `memory://${fixtureSeason.slug}-e${episodeIdx}.wav`,
			sourceTextPath: `memory://${fixtureSeason.slug}-e${episodeIdx}-source.txt`,
			rawAlignmentPath: `memory://${fixtureSeason.slug}-e${episodeIdx}.raw.txt`,
			audioHash: sha256(testAudioBytes),
			textHash: sha256(episodeText),
			alignerModel: "test-aligner",
			durationSeconds: 2,
			generatedAt: "2026-05-20T00:00:00.000Z",
			words,
			...sidecarOverrides,
		},
	};
}

function bindings(): ServerBindings {
	return {
		APP_STATE_STORE: new InMemoryStateStore(fixtureState),
		ASSET_STORE: new InMemoryAssetStore({}),
		STORY_STORE: new InMemoryStoryStore({ seasons: [fixtureSeason] }),
	};
}

function bindingsWithAudio(
	audio: ReturnType<typeof audioForEpisode>,
): ServerBindings {
	return {
		APP_STATE_STORE: new InMemoryStateStore(fixtureState),
		ASSET_STORE: new InMemoryAssetStore({
			audio: [audio],
		}),
		STORY_STORE: new InMemoryStoryStore({ seasons: [fixtureSeason] }),
	};
}

function requestApp(
	request: Request,
	env: ServerBindings = bindings(),
): Response | Promise<Response> {
	return app.request(request, undefined, env);
}

function episodeRequest(childId: string, episodeIdx: string): Request {
	return new Request(
		`http://127.0.0.1:3001/api/children/${childId}/episodes/${episodeIdx}`,
	);
}

function audioRequest(childId: string, episodeIdx: string): Request {
	return new Request(
		`http://127.0.0.1:3001/api/children/${childId}/episodes/${episodeIdx}/audio`,
	);
}

function audioFileRequest(
	childId: string,
	episodeIdx: string,
	range?: string,
): Request {
	const init = range ? { headers: { range } } : undefined;
	return new Request(
		`http://127.0.0.1:3001/api/children/${childId}/episodes/${episodeIdx}/audio/file`,
		init,
	);
}

async function expectAudioRange(
	res: Response,
	audio: ReturnType<typeof audioForEpisode>,
	expectedRange: string,
	expectedBytes: Uint8Array,
): Promise<void> {
	expect(res.status).toBe(206);
	expect(res.headers.get("content-range")).toBe(
		`${expectedRange}/${audio.audioBytes.byteLength}`,
	);
	expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(
		Array.from(expectedBytes),
	);
}

describe("route E2E with in-memory bindings", () => {
	it("returns ChildNotFound when the child does not exist", async () => {
		const res = await requestApp(episodeRequest("zack", "0"));

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "ChildNotFound" });
	});

	it("returns InvalidEpisode when the episode index is not an integer", async () => {
		const res = await requestApp(episodeRequest("winni", "one"));

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "InvalidEpisode" });
	});

	it("returns EpisodeNotFound when the episode index is outside the season", async () => {
		const res = await requestApp(episodeRequest("winni", "99"));

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "EpisodeNotFound" });
	});

	it("returns EpisodeLocked when the episode is beyond the child's progress", async () => {
		const res = await requestApp(episodeRequest("winni", "1"));

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "EpisodeLocked" });
	});

	it("returns EpisodeAudioMissing when an open episode has no audio artifacts", async () => {
		const res = await requestApp(audioRequest("winni", "0"));

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "EpisodeAudioMissing" });
	});

	it("returns EpisodeAudioMissing when an open episode has no audio file artifacts", async () => {
		const res = await requestApp(audioFileRequest("winni", "0"));

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "EpisodeAudioMissing" });
	});

	it("returns EpisodeAudioStale when audio sidecar integrity fails", async () => {
		const res = await requestApp(
			audioRequest("winni", "0"),
			bindingsWithAudio(audioForEpisode(0, { audioHash: "0".repeat(64) })),
		);

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "EpisodeAudioStale" });
	});

	it("returns EpisodeAudioStale when audio file sidecar integrity fails", async () => {
		const res = await requestApp(
			audioFileRequest("winni", "0"),
			bindingsWithAudio(audioForEpisode(0, { audioHash: "0".repeat(64) })),
		);

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "EpisodeAudioStale" });
	});

	it("returns a closed ranged audio file response from in-memory bindings", async () => {
		const audio = audioForEpisode(0);

		const res = await requestApp(
			audioFileRequest("winni", "0", "bytes=12-31"),
			bindingsWithAudio(audio),
		);

		await expectAudioRange(
			res,
			audio,
			"bytes 12-31",
			audio.audioBytes.slice(12, 32),
		);
	});

	it("returns an open-ended ranged audio file response from in-memory bindings", async () => {
		const audio = audioForEpisode(0);

		const res = await requestApp(
			audioFileRequest("winni", "0", "bytes=12-"),
			bindingsWithAudio(audio),
		);

		await expectAudioRange(
			res,
			audio,
			`bytes 12-${audio.audioBytes.byteLength - 1}`,
			audio.audioBytes.slice(12),
		);
	});

	it("returns a suffix ranged audio file response from in-memory bindings", async () => {
		const audio = audioForEpisode(0);
		const suffixLength = 16;
		const firstByte = audio.audioBytes.byteLength - suffixLength;

		const res = await requestApp(
			audioFileRequest("winni", "0", `bytes=-${suffixLength}`),
			bindingsWithAudio(audio),
		);

		await expectAudioRange(
			res,
			audio,
			`bytes ${firstByte}-${audio.audioBytes.byteLength - 1}`,
			audio.audioBytes.slice(-suffixLength),
		);
	});
});
