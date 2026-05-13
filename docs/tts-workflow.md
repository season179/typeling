# Episode Audio Generation Workflow

This document describes how to generate TTS audio for episodes of the Typeling typing stories. The pipeline supports multiple children — currently **Zack** and **Winni**. The TTS provider used in the final stage can vary by episode: **Gemini** is in use today; **MiMo** has an offline contract only.

**This workflow does not modify the typing story source.** Season JSON files (e.g. `seasons/zack-s1.json`, `seasons/winni-s1.json`) are read-only. All derived artifacts are written to `data/audio/`.

## Pipeline overview

```
seasons/<child>-s1.json                              (source — never modified)
        │
        ▼  extract-audio-source.ts
data/audio/<child>-s1-e<n>-source.txt                (raw episode text)
        │
        ▼  convert-to-transcript.ts
data/audio/<child>-s1-e<n>-transcript.txt            (Storyteller/Pixel speaker labels)
        │
        ▼  style-transcript.ts                        (requires OPENROUTER_API_KEY)
data/audio/<child>-s1-e<n>-styled-transcript.txt     (TTS preamble + audio tags)
        │
        ▼  TTS provider                               (Gemini today, MiMo experimental)
data/audio/<child>-s1-e<n>.wav                       (final audio)
data/audio/<child>-s1-e<n>.meta.json                 (generation metadata)
```

## Zack chapter 1 (Gemini)

### Gemini TTS reference

This workflow uses the Gemini Speech Generation API. For the full API documentation, voice list, and limitations, see:

https://ai.google.dev/gemini-api/docs/speech-generation

### Prerequisites

| Requirement | Purpose |
|---|---|
| `GEMINI_API_KEY` | Calls the Gemini TTS endpoint. Get one at https://aistudio.google.com/apikey |
| `OPENROUTER_API_KEY` | Styles the transcript via an LLM (step 3). Only needed if not using `--fixture`. |
| `bun install` | Dependencies must be installed. |

### Step-by-step

#### 1. Extract the source text

Pulls episode 0 from `seasons/zack-s1.json` into a plain-text file. This is the raw story text as typed by the child.

```bash
bun run scripts/extract-audio-source.ts
```

Options:
- `--season <path>` — Season JSON file (default: `seasons/zack-s1.json`)
- `--episode-idx <n>` — Episode index to extract (default: `0`)
- `--output <path>` — Output file (default: `data/audio/zack-s1-e0-source.txt`)

#### 2. Build the two-speaker transcript

Converts the raw source text into a speaker-labelled transcript. Dialogue (text inside `"quotes"`) is assigned to **Pixel**; narration is assigned to **Storyteller**.

```bash
bun run scripts/convert-to-transcript.ts
```

Options:
- `--source <path>` — Input file (default: `data/audio/zack-s1-e0-source.txt`)
- `--output <path>` — Output file (default: `data/audio/zack-s1-e0-transcript.txt`)

Output format:
```
Storyteller: In a cosy workshop filled with soft light...
Pixel: What a lovely day!
Storyteller: said Pixel in a soft, buzzy voice.
```

#### 3. Style the transcript for TTS

Sends the raw transcript to an LLM (via OpenRouter) which adds a TTS preamble and sparse `[audio tags]` for performance direction. The LLM does not change any story words — it only adds `[softly]`, `[gently]`, `[excitedly]`, etc.

```bash
bun run scripts/style-transcript.ts
```

Options:
- `--source <path>` — Input file (default: `data/audio/zack-s1-e0-transcript.txt`)
- `--output <path>` — Output file (default: `data/audio/zack-s1-e0-styled-transcript.txt`)
- `--fixture <path>` — Skip the LLM call and use a pre-made file instead (useful for offline dev or re-running step 4 without paying for step 3 again).

**Review the styled transcript before generating audio.** Open `data/audio/zack-s1-e0-styled-transcript.txt` and check:

1. The story meaning is preserved — no words added, removed, or reworded.
2. British English spelling is intact ("colour", "favourite", "centre").
3. Tone is warm, kind, and kid-safe.
4. Only `Storyteller:` and `Pixel:` speaker labels are present.
5. Audio tags are sparse (one every 2–3 lines, not on every sentence).
6. A TTS preamble exists on the first line (e.g. "Make Storyteller sound warm and gentle...").

If anything looks wrong, edit the file by hand before proceeding.

#### 4. Generate TTS audio

Calls the Gemini TTS API with the styled transcript and writes a WAV file plus metadata.

```bash
bun run tts:zack-s1-e0
```

This is equivalent to:

```bash
bun run scripts/generate-zack-ch1-audio.ts
```

Options:
- `--transcript <path>` — Styled transcript file (default: `data/audio/zack-s1-e0-styled-transcript.txt`)
- `--output <path>` — WAV output path (default: `data/audio/zack-s1-e0.wav`)
- `--max-retries <n>` — Max retry attempts for transient failures (default: `3`)

#### 5. Listen and check the output

Play the generated WAV file:

```bash
# macOS
afplay data/audio/zack-s1-e0.wav

# Linux (with sox)
play data/audio/zack-s1-e0.wav
```

Check:
- Both speakers are audible and distinct (Storyteller = Kore, Pixel = Puck).
- The full story is present — no truncated or missing lines.
- The tone is warm and bedtime-appropriate.
- Audio tags were respected (gentle/soft delivery where tagged).

If the output is bad, re-run step 4. Gemini occasionally returns degraded audio; the script handles transient non-audio responses automatically, but quality varies.

## Winni chapter 1 (TBD)

To be documented in a follow-up issue.

## MiMo provider (offline contract, experimental)

> **No live MiMo runner script exists yet.** This section documents the offline building blocks already in the codebase. There is no `scripts/generate-*-mimo-audio.ts`, no `tts:*:mimo` npm script, and no documented env var for a MiMo endpoint key — the live caller does not exist, so neither does the wiring around it.

The MiMo path is **experimental** and reaches the model `mimo-v2.5-tts`. Three pure modules in `src/lib/` define the request shape, response shape, and WAV writer. They are exercised by offline tests against `fixtures/mimo-audio-response.json` — no API key and no network are required.

### Building blocks

- `src/lib/mimoTtsRequest.ts` — pure request builder. Validates that style guidance and spoken text are non-empty, then returns a `mimo-v2.5-tts` chat-completion request body with the right message roles, voice, and audio format. Exposes the four built-in English voices (`Mia`, `Chloe`, `Milo`, `Dean`) with `Mia` as the default and `wav` as the default response format. No network calls.

- `src/lib/mimoTtsResponse.ts` — pure response extractor. Reads base64 audio data and the declared format from `choices[0].message.audio`. A separate `validateMimoAudioResponse` helper returns a non-throwing error string so a future caller can drive retries. Reports failures like missing/empty `choices`, a message that returned text content instead of audio (transient non-audio response), and a missing or empty `audio.data` field.

- `src/lib/mimoGenerateWav.ts` — decodes the base64 audio, sanity-checks the `RIFF` header (rejecting payloads under 44 bytes or with a non-RIFF prefix), and writes the bytes straight to the requested `.wav` path. Also writes a sidecar `.meta.json` containing `source_season`, `episode_idx`, `provider` (`"mimo"`), `model` (`"mimo-v2.5-tts"`), `selected_voice`, `audio_format`, `transcript_hash`, and `generated_at` (ISO-8601). The sidecar path is derived from the WAV path by swapping the extension.

### Request shape

MiMo uses an OpenAI-compatible chat-completion endpoint. `buildMimoTtsRequest` produces:

| Field | Value |
|---|---|
| `model` | `mimo-v2.5-tts` |
| `messages[0]` | `{ role: "user", content: <style guidance> }` |
| `messages[1]` | `{ role: "assistant", content: <spoken text> }` |
| `audio.voice` | One of `Mia`, `Chloe`, `Milo`, `Dean` (default `Mia`) |
| `audio.format` | `wav` (default), `mp3`, or `pcm` |
| `stream` | `false` |

Style guidance — e.g. "Speak warmly and gently, like a parent reading a bedtime story." — goes in the **user** message so MiMo treats it as performance direction rather than text to speak. The text to synthesize goes in the **assistant** message. Voice selection lives on the `audio` object, not inside a message.

### Response shape

MiMo returns an OpenAI-compatible chat-completion response. The audio lives at:

```
choices[0].message.audio.data    // base64 string
choices[0].message.audio.format  // optional; defaults to "wav" in the extractor
```

The base64 payload decodes to a **complete WAV container** — RIFF header and audio samples are already packaged together. `extractMimoAudioData` returns `{ data, format }`.

### MiMo vs Gemini: audio format

Gemini returns raw PCM samples; the Gemini runner (`scripts/generate-zack-ch1-audio.ts`, via helpers in `scripts/generate-wav.ts`) wraps those samples in a RIFF/WAV header before writing to disk. MiMo is different — the base64 payload **already is** a full WAV file, so `mimoGenerateWav.ts` decodes the base64 and writes the bytes directly with no extra wrapping. Adding a second header would produce a malformed file.

### Offline fixture and tests

The MiMo tests drive the three modules using `fixtures/mimo-audio-response.json`, which mirrors the shape of a real `mimo-v2.5-tts` response. Run them with:

```bash
bun test src/lib/mimoTtsRequest.test.ts src/lib/mimoTtsResponse.test.ts src/lib/mimoGenerateWav.test.ts
```

### MiMo quirks

- **Base64-encoded full WAV, not raw PCM.** Decode the base64 and write to disk as-is — do not feed the bytes through any PCM-to-WAV wrapper.
- **No live caller wired up yet.** MiMo is reachable only through the three offline modules and their fixture-driven tests until a runner is wired up.
- **Non-streaming only.** `buildMimoTtsRequest` sets `stream: false`; streaming is not yet supported.
- **Small built-in voice list.** Only the four voices listed in the request-shape table above. `mimo_default` varies by deployed cluster, so the builder forces an explicit choice.

## Where artifacts are written

All intermediate and final artifacts go in `data/audio/`:

| File | Description |
|---|---|
| `zack-s1-e0-source.txt` | Raw episode text extracted from the season file |
| `zack-s1-e0-transcript.txt` | Two-speaker transcript (Storyteller/Pixel) |
| `zack-s1-e0-styled-transcript.txt` | Styled transcript with TTS preamble and audio tags |
| `zack-s1-e0.wav` | Generated TTS audio (PCM, 24 kHz) |
| `zack-s1-e0.meta.json` | Generation metadata (model, voices, transcript hash, timestamp) |

## Are generated audio artifacts committed?

**No.** The entire `data/` directory is gitignored (only `data/.gitkeep` and `data/state.seed.json` are tracked). Audio artifacts are local-only and must be regenerated from the pipeline. This keeps the repo small and avoids committing large binary files.

## Gemini TTS limitations

These are known limitations of the Gemini TTS API that affect this workflow:

- **Non-streaming only.** The API returns the full audio in a single response. There is no streaming mode. For long episodes this means the full generation happens in one request — expect a few seconds of latency.
- **Occasional non-audio responses.** Gemini sometimes returns text instead of audio data. The `generate-zack-ch1-audio.ts` script retries these automatically (up to `--max-retries` times with exponential backoff). If all retries fail, the script exits with a clear error.
- **Rate limits.** Heavy usage may trigger HTTP 429 responses. These are also retried automatically.
- **Voice quality varies.** The same transcript can produce noticeably different audio on repeated runs. If the output sounds off, re-run the generation. The script does not cache or deduplicate outputs.
- **Audio tags are hints, not commands.** Gemini interprets `[softly]`, `[gently]`, etc. as best-effort. The model does not always obey them precisely.

## MiMo TTS limitations (TBD)

To be documented in a follow-up issue.
