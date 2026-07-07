import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPath = resolve("public/rainbow-door-music.wav");
const sampleRate = 44100;
const durationSeconds = 22;
const channels = 2;
const bytesPerSample = 2;
const totalSamples = sampleRate * durationSeconds;
const bpm = 132;
const beatSeconds = 60 / bpm;
const melody = [523.25, 587.33, 659.25, 783.99, 880, 783.99, 659.25, 587.33];
const bassline = [130.81, 146.83, 164.81, 196];
const eventTimes = [0.7, 3.9, 7.1, 10.9, 14.9, 16.5, 18.8];
const defaultMelody = 523.25;
const defaultBass = 130.81;

function envelope(phase: number, attack: number, release: number) {
	if (phase < attack) return phase / attack;
	return Math.exp(-(phase - attack) * release);
}

function beatPhase(time: number, divisor = 1) {
	const length = beatSeconds * divisor;
	return time % length;
}

function pulse(time: number, center: number, width: number) {
	const distance = Math.abs(time - center);
	return Math.max(0, 1 - distance / width);
}

function eventChimes(time: number) {
	let value = 0;
	for (const eventTime of eventTimes) {
		const delta = time - eventTime;
		if (delta >= 0 && delta < 1.4) {
			const falloff = Math.exp(-delta * 3.8);
			value +=
				falloff *
				(0.62 * Math.sin(2 * Math.PI * 1046.5 * time) +
					0.42 * Math.sin(2 * Math.PI * 1567.98 * time) +
					0.24 * Math.sin(2 * Math.PI * 2093 * time));
		}
	}
	return value;
}

function kick(time: number) {
	const phase = beatPhase(time);
	const env = envelope(phase, 0.006, 28);
	const pitch = 68 - phase * 38;
	return Math.sin(2 * Math.PI * pitch * time) * env;
}

function clap(time: number) {
	const phase = Math.abs(beatPhase(time) - beatSeconds * 0.5);
	const env = Math.exp(-phase * 48);
	const metallic =
		Math.sin(2 * Math.PI * 1520 * time) +
		0.6 * Math.sin(2 * Math.PI * 2100 * time) +
		0.32 * Math.sin(2 * Math.PI * 3160 * time);
	return metallic * env;
}

function lead(time: number) {
	const step = Math.floor(time / (beatSeconds / 2));
	const note = melody[step % melody.length] ?? defaultMelody;
	const phase = beatPhase(time, 0.5);
	const env = envelope(phase, 0.015, 5.2);
	const vibrato = 1 + Math.sin(2 * Math.PI * 6 * time) * 0.004;
	return (
		env *
		(0.72 * Math.sin(2 * Math.PI * note * vibrato * time) +
			0.28 * Math.sin(2 * Math.PI * note * 2 * time))
	);
}

function bass(time: number) {
	const step = Math.floor(time / beatSeconds);
	const note = bassline[step % bassline.length] ?? defaultBass;
	const phase = beatPhase(time);
	const env = envelope(phase, 0.012, 6.5);
	return Math.sin(2 * Math.PI * note * time) * env;
}

function magicRiser(time: number) {
	const progress = Math.min(Math.max((time - 12.6) / 4.0, 0), 1);
	if (progress === 0) return 0;
	const freq = 620 + progress * 1360;
	return (
		progress *
		progress *
		(0.58 * Math.sin(2 * Math.PI * freq * time) +
			0.32 * Math.sin(2 * Math.PI * (freq * 1.5) * time))
	);
}

function revealWhoosh(time: number) {
	const burst = pulse(time, 16.45, 1.35);
	const shimmer =
		Math.sin(2 * Math.PI * 920 * time) +
		0.7 * Math.sin(2 * Math.PI * 1240 * time) +
		0.44 * Math.sin(2 * Math.PI * 1840 * time);
	return burst * burst * shimmer;
}

function softLimit(value: number) {
	return Math.tanh(value * 1.45) * 0.92;
}

function sampleAt(index: number) {
	const time = index / sampleRate;
	const fadeIn = Math.min(time / 0.28, 1);
	const fadeOut = Math.min((durationSeconds - time) / 1.1, 1);
	const groove = time < 2.8 ? 0.55 + time * 0.12 : 1;
	const finaleLift = time > 17 ? 1.12 : 1;

	const leftRaw =
		0.32 * kick(time) +
		0.12 * clap(time) +
		0.21 * bass(time) +
		0.28 * lead(time) +
		0.22 * eventChimes(time) +
		0.16 * magicRiser(time) +
		0.18 * revealWhoosh(time);
	const rightRaw =
		0.32 * kick(time) +
		0.12 * clap(time + 0.003) +
		0.21 * bass(time) +
		0.27 * lead(time + 0.004) +
		0.25 * eventChimes(time + 0.002) +
		0.17 * magicRiser(time + 0.001) +
		0.2 * revealWhoosh(time + 0.003);

	return [
		softLimit(leftRaw * groove * finaleLift * fadeIn * fadeOut),
		softLimit(rightRaw * groove * finaleLift * fadeIn * fadeOut),
	] as const;
}

function createWav() {
	const dataBytes = totalSamples * channels * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataBytes);

	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + dataBytes, 4);
	buffer.write("WAVE", 8);
	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channels, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
	buffer.writeUInt16LE(channels * bytesPerSample, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write("data", 36);
	buffer.writeUInt32LE(dataBytes, 40);

	for (let i = 0; i < totalSamples; i += 1) {
		const [left, right] = sampleAt(i);
		const offset = 44 + i * channels * bytesPerSample;
		buffer.writeInt16LE(Math.round(left * 32767), offset);
		buffer.writeInt16LE(Math.round(right * 32767), offset + bytesPerSample);
	}

	return buffer;
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, createWav());
console.log(`Wrote ${outputPath}`);
