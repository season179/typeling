/**
 * Disk-writing WAV helper. Kept separate from `wav.ts` so the pure
 * `pcmToWavBuffer` stays free of any `Bun`/fs dependency and is safe to bundle
 * into the Cloudflare Worker. This module uses `Bun.write` and is CLI-only.
 */

import { pcmToWavBuffer } from "./wav";

/**
 * Write a WAV file to disk from raw PCM bytes.
 */
export async function writeWav(
	outputPath: string,
	pcmData: Uint8Array,
	sampleRate?: number,
	numChannels?: number,
	bitsPerSample?: number,
): Promise<void> {
	const wavBuffer = pcmToWavBuffer(
		pcmData,
		sampleRate,
		numChannels,
		bitsPerSample,
	);
	await Bun.write(outputPath, wavBuffer);
}
