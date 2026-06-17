import { createHash } from "node:crypto";
import { extractAlignmentStoryWords } from "../storyWordTokens";
import type { WordTimingSidecar } from "../wordTimings";

/**
 * Pure, HTTP-free variant of the server's serve-time staleness check.
 *
 * `src/server/stores.ts` delegates to this so the re-slice acceptance test can
 * run the EXACT same check the runtime applies on every audio request — a half
 * that passes here is guaranteed to pass the server's `EpisodeAudioStale` gate.
 * Worker-portable: bytes + JSON only, no fs, no subprocess.
 */
export type SidecarMatch = { ok: true } | { ok: false; reason: string };

function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

export function checkSidecarMatchesEpisodeText(
	sidecar: WordTimingSidecar,
	seasonSlug: string,
	episodeIdx: number,
	episodeText: string,
): SidecarMatch {
	if (sidecar.seasonSlug !== seasonSlug) {
		return {
			ok: false,
			reason: `seasonSlug ${sidecar.seasonSlug} !== ${seasonSlug}`,
		};
	}
	if (sidecar.episodeIdx !== episodeIdx) {
		return {
			ok: false,
			reason: `episodeIdx ${sidecar.episodeIdx} !== ${episodeIdx}`,
		};
	}
	if (sidecar.textHash !== sha256(episodeText)) {
		return { ok: false, reason: "textHash does not match episode text" };
	}

	const expectedWords = extractAlignmentStoryWords(episodeText);
	if (sidecar.words.length !== expectedWords.length) {
		return {
			ok: false,
			reason: `word count ${sidecar.words.length} !== ${expectedWords.length}`,
		};
	}

	let previousEnd = 0;
	for (const [index, word] of sidecar.words.entries()) {
		const expected = expectedWords[index];
		if (!expected || word.index !== expected.wordIndex) {
			return { ok: false, reason: `word ${index} index/order mismatch` };
		}
		if (word.text !== expected.text) {
			return { ok: false, reason: `word ${index} text mismatch` };
		}
		if (word.end < word.start) {
			return { ok: false, reason: `word ${index} end before start` };
		}
		if (word.start < previousEnd) {
			return { ok: false, reason: `word ${index} starts before previous end` };
		}
		if (word.end > sidecar.durationSeconds) {
			return { ok: false, reason: `word ${index} end beyond audio duration` };
		}
		previousEnd = word.end;
	}

	return { ok: true };
}
