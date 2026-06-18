import { describe, expect, it } from "bun:test";
import {
	assertStyledPreservesEpisodeText,
	extractStyledSpokenText,
	StylePreservationError,
	StyleValidationError,
	validateStyledTranscript,
} from "../../src/lib/styleTranscript";

const EPISODE = 'Luma saw a rainbow. "Hello!" she said brightly.';

const STYLED = [
	"Make Storyteller sound warm and gentle. Make Character sound bright.",
	"",
	"Storyteller: [gently] Luma saw a rainbow.",
	"Character: [brightly] Hello!",
	"Storyteller: she said brightly.",
].join("\n");

describe("validateStyledTranscript", () => {
	it("accepts a well-formed styled transcript", () => {
		expect(() => validateStyledTranscript(STYLED)).not.toThrow();
	});

	it("rejects output without a preamble", () => {
		const noPreamble = "Storyteller: Luma saw a rainbow.\nCharacter: Hello!";
		expect(() => validateStyledTranscript(noPreamble)).toThrow(
			StyleValidationError,
		);
	});

	it("rejects output missing one of the speakers", () => {
		const oneSpeaker = [
			"Make Storyteller sound warm.",
			"",
			"Storyteller: Luma saw a rainbow.",
		].join("\n");
		expect(() => validateStyledTranscript(oneSpeaker)).toThrow(
			StyleValidationError,
		);
	});
});

describe("extractStyledSpokenText", () => {
	it("drops the preamble, speaker labels, and audio tags", () => {
		const spoken = extractStyledSpokenText(STYLED);
		expect(spoken).not.toContain("Make Storyteller");
		expect(spoken).not.toContain("Storyteller:");
		expect(spoken).not.toContain("[gently]");
		expect(spoken).toContain("Luma saw a rainbow.");
		expect(spoken).toContain("Hello!");
	});
});

describe("assertStyledPreservesEpisodeText", () => {
	it("passes when spoken words match the episode (ignoring quotes/punctuation)", () => {
		expect(() =>
			assertStyledPreservesEpisodeText(STYLED, EPISODE),
		).not.toThrow();
	});

	it("fails when a word is added", () => {
		const tampered = STYLED.replace(
			"she said brightly.",
			"she said very brightly.",
		);
		expect(() =>
			assertStyledPreservesEpisodeText(tampered, EPISODE),
		).toThrow(StylePreservationError);
	});

	it("fails when a word is reworded", () => {
		const tampered = STYLED.replace("rainbow", "sunset");
		expect(() =>
			assertStyledPreservesEpisodeText(tampered, EPISODE),
		).toThrow(StylePreservationError);
	});

	it("fails when a word is dropped", () => {
		const tampered = STYLED.replace("Luma saw a rainbow.", "Luma saw a.");
		expect(() =>
			assertStyledPreservesEpisodeText(tampered, EPISODE),
		).toThrow(StylePreservationError);
	});
});
