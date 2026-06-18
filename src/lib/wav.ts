/**
 * Pure PCM → WAV conversion. No network, no deps beyond the runtime.
 *
 * Gemini TTS returns 16-bit signed little-endian PCM at 24000 Hz mono.
 * This module wraps that raw PCM in a standard RIFF/WAV container.
 *
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */

const WAV_HEADER_SIZE = 44;
const PCM_FORMAT_TAG = 1; // 1 = uncompressed PCM

/**
 * Build a WAV file buffer from raw PCM samples.
 *
 * @param pcmData Raw 16-bit signed little-endian PCM samples
 * @param sampleRate Samples per second (Gemini default: 24000)
 * @param numChannels Number of channels (Gemini default: 1)
 * @param bitsPerSample Bits per sample (Gemini default: 16)
 */
export function pcmToWavBuffer(
	pcmData: Uint8Array,
	sampleRate = 24000,
	numChannels = 1,
	bitsPerSample = 16,
): Uint8Array {
	const bytesPerSample = bitsPerSample / 8;
	const byteRate = sampleRate * numChannels * bytesPerSample;
	const blockAlign = numChannels * bytesPerSample;
	const dataSize = pcmData.length;
	const fileSize = WAV_HEADER_SIZE + dataSize;

	const buffer = new ArrayBuffer(fileSize);
	const view = new DataView(buffer);

	// RIFF header
	writeFourCC(view, 0, "RIFF");
	// RIFF chunk size = fileSize minus 8 bytes for "RIFF" and this size field
	view.setUint32(4, fileSize - 8, true);
	writeFourCC(view, 8, "WAVE");

	// fmt  sub-chunk
	writeFourCC(view, 12, "fmt ");
	view.setUint32(16, 16, true); // sub-chunk size (16 for PCM)
	view.setUint16(20, PCM_FORMAT_TAG, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	// data sub-chunk
	writeFourCC(view, 36, "data");
	view.setUint32(40, dataSize, true);

	// Append PCM samples
	const out = new Uint8Array(buffer);
	out.set(pcmData, WAV_HEADER_SIZE);

	return out;
}

function writeFourCC(view: DataView, offset: number, fourcc: string): void {
	for (let i = 0; i < 4; i++) {
		view.setUint8(offset + i, fourcc.charCodeAt(i));
	}
}
