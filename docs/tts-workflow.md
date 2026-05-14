# Episode Audio Generation Workflow

This document describes how to generate TTS audio for episodes of the Typeling typing stories. The pipeline supports multiple children — currently **Zack** and **Winni**. The TTS provider used in the final stage can vary by episode: **Gemini** is used for Zack, **MiMo** for Winni.

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
data/audio/<child>-s1-e<n>-styled-transcript.txt     (Gemini-format: TTS preamble + [bracketed] tags)
        │
        ├─▶ Gemini path (Zack)                       — multi-speaker, [bracket] tags consumed as-is
        │      generate-zack-ch1-audio.ts
        │
        └─▶ MiMo path (Winni)                        — single-voice; runner strips speaker labels
               generate-winni-ch1-mimo-audio.ts        and [bracket] tags before posting
        │
        ▼
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

## Winni chapter 1 (MiMo)

The Winni pipeline reuses the same extraction, transcript, and styling scripts as Zack — only the season file, output paths, and the final TTS provider differ. Npm scripts wrap the per-child steps.

### MiMo TTS reference

This workflow uses Xiaomi's MiMo `mimo-v2.5-tts` model via the OpenAI-compatible chat-completions endpoint. See:

https://platform.mimoai.com/docs

### Prerequisites

| Requirement | Purpose |
|---|---|
| `MIMO_API_KEY` | Calls the MiMo TTS endpoint. |
| `MIMO_API_BASE` | Optional override for the chat-completions base URL (defaults to `https://api.mimoai.com/v1`). |
| `OPENROUTER_API_KEY` | Styles the transcript via an LLM (step 3). Only needed if not using `--fixture`. |
| `bun install` | Dependencies must be installed. |

### Step-by-step

#### 1. Extract the source text

Pulls episode 0 from `seasons/winni-s1.json` into a plain-text file.

```bash
bun run audio:winni-s1-e0:extract
```

This runs:

```bash
bun run scripts/extract-audio-source.ts --season seasons/winni-s1.json --output data/audio/winni-s1-e0-source.txt --episode-idx 0
```

| Parameter | Value |
|---|---|
| Source | `seasons/winni-s1.json` |
| Episode index | `0` |
| Output | `data/audio/winni-s1-e0-source.txt` |

#### 2. Build the two-speaker transcript

Converts the raw source text into a speaker-labelled transcript. Dialogue (text inside `"quotes"`) is assigned to **Pixel**; narration is assigned to **Storyteller**.

```bash
bun run audio:winni-s1-e0:transcript
```

This runs:

```bash
bun run scripts/convert-to-transcript.ts --source data/audio/winni-s1-e0-source.txt --output data/audio/winni-s1-e0-transcript.txt
```

| Parameter | Value |
|---|---|
| Source | `data/audio/winni-s1-e0-source.txt` |
| Output | `data/audio/winni-s1-e0-transcript.txt` |

Output format is the same as Zack:
```
Storyteller: Once upon a time, in a little garden...
Pixel: Look at that butterfly!
Storyteller: said Pixel, pointing with a tiny paw.
```

#### 3. Style the transcript for TTS

```bash
bun run scripts/style-transcript.ts \
  --source data/audio/winni-s1-e0-transcript.txt \
  --output data/audio/winni-s1-e0-styled-transcript.txt \
  --target mimo-director
```

`--target mimo-director` tells the styler to emit a Director Mode preamble — a single-voice Character / Scene / Guidance description in the first line, suitable for `mimo-v2.5-tts-voicedesign`. The body still uses `Storyteller:` / `Pixel:` labels and `[bracket]` tags; the runner strips the labels and keeps the tags before the API call.

For the legacy built-in MiMo voices, omit `--target` (the default `gemini` preamble works there too — the runner strips both labels and bracket tags in that path).

Review the same checklist as the Zack flow (story meaning preserved, British English intact, etc.). For the Director Mode preamble specifically, sanity-check that it describes ONE performer voicing both roles (not "Make Storyteller sound… Make Pixel sound…"), since voicedesign synthesises a single designed voice per call.

#### 4. Generate TTS audio

```bash
bun run tts:winni-s1-e0:mimo
```

Equivalent to:

```bash
bun run scripts/generate-winni-ch1-mimo-audio.ts
```

**Default is Director Mode** (`mimo-v2.5-tts-voicedesign`) — the built-in voices aren't expressive enough for bedtime narration. Before calling MiMo, the runner adapts the styled transcript:

1. **Split**: the first non-empty line is the preamble → `user` message; the body after the blank-line separator → `assistant` message.
2. **Strip speaker labels**: `Storyteller:` and `Pixel:` prefixes are removed from each line of the spoken text. The model produces a single designed voice that performs both roles; the labels would otherwise be read aloud.
3. **Keep `[bracket]` tags** — voicedesign interprets `[warmly]`, `[gently]`, `[excitedly]`, etc. as audio-tag control.
4. **Build request** with `model: mimo-v2.5-tts-voicedesign`, `audio.format: wav`, and no `audio.voice`; POST to `${MIMO_API_BASE}/chat/completions`.

Implemented in `scripts/generate-winni-ch1-mimo-audio.ts`:
- `splitStyledTranscript()` — does step 1.
- `cleanSpokenTextForMimo()` — does steps 2 + 3.

Options:
- `--transcript <path>` — Styled transcript file (default: `data/audio/winni-s1-e0-styled-transcript.txt`)
- `--output <path>` — WAV output path (default: `data/audio/winni-s1-e0.wav`)
- `--builtin` — Opt into the legacy `mimo-v2.5-tts` built-in voice path (defaults to `Mia`). See [Built-in voice path](#built-in-voice-path) below.
- `--voice <name>` — Built-in voice: `Mia`, `Chloe`, `Milo`, or `Dean`. Implicitly switches to built-in mode.
- `--max-retries <n>` — Max retry attempts for transient failures (default: `3`)

##### Built-in voice path

Pass `--builtin` (or `--voice <name>`) to use the `mimo-v2.5-tts` model instead of voicedesign. This swaps the runner behaviour:

| | Director Mode (default) | Built-in (`--builtin`) |
|---|---|---|
| Model | `mimo-v2.5-tts-voicedesign` | `mimo-v2.5-tts` |
| `audio.voice` | **Omitted** — voice is described in user msg | Required (e.g. `Mia`) |
| `[bracket]` tags in body | **Kept** — audio-tag control | Stripped (unreliable in this model) |
| `Storyteller:` / `Pixel:` labels | Stripped (single designed voice) | Stripped (single built-in voice) |
| `selected_voice` in meta.json | `null` | Built-in voice name |
| `model` in meta.json | `mimo-v2.5-tts-voicedesign` | `mimo-v2.5-tts` |

Director Mode produces a **single designed voice** per call — it doesn't synthesize two independent voices in one audio output. The benefit is layered, performative delivery of a single voice that adapts within a scene, guided by the Character / Scene / Guidance preamble plus inline `[bracket]` audio tags.

#### 5. Listen and check the output

```bash
# macOS
afplay data/audio/winni-s1-e0.wav
```

## MiMo provider reference

The MiMo path reaches the model `mimo-v2.5-tts`. The live runner (`scripts/generate-winni-ch1-mimo-audio.ts`, documented above) sits on top of three pure modules in `src/lib/` that define the request shape, response shape, and WAV writer, plus two adapter helpers exported from the runner itself (`splitStyledTranscript`, `cleanSpokenTextForMimo`). These modules are exercised by offline tests against `fixtures/mimo-audio-response.json` — no API key and no network are required for the unit tests.

### Building blocks

- `src/lib/mimoTtsRequest.ts` — pure request builder. Validates that style guidance and spoken text are non-empty, then returns a `mimo-v2.5-tts` chat-completion request body with the right message roles, voice, and audio format. Exposes the four built-in English voices (`Mia`, `Chloe`, `Milo`, `Dean`) with `Mia` as the default and `wav` as the default response format. No network calls.

- `src/lib/mimoTtsResponse.ts` — pure response extractor. Reads base64 audio data and the declared format from `choices[0].message.audio`. A separate `validateMimoAudioResponse` helper returns a non-throwing error string so the live client can drive retries. Reports failures like missing/empty `choices`, a message that returned text content instead of audio (transient non-audio response), and a missing or empty `audio.data` field.

- `src/lib/mimoTtsClient.ts` — live network client. Posts the built request to Xiaomi's OpenAI-compatible chat-completions endpoint with `Authorization: Bearer <MIMO_API_KEY>`. Retries `HTTP 429`, `HTTP 5xx`, network errors, and missing-audio responses with exponential backoff. Fails fast on `HTTP 400`, `HTTP 401`, and `HTTP 403`. The base URL defaults to `https://api.mimoai.com/v1` and can be overridden via the `MIMO_API_BASE` env var or an explicit `apiBase` argument.

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

Gemini returns raw PCM samples; the Gemini runner (`scripts/generate-zack-ch1-audio.ts`, via helpers in `src/lib/generateWav.ts` and `src/lib/wav.ts`) wraps those samples in a RIFF/WAV header before writing to disk. MiMo is different — the base64 payload **already is** a full WAV file, so `mimoGenerateWav.ts` decodes the base64 and writes the bytes directly with no extra wrapping. Adding a second header would produce a malformed file.

### Offline fixture and tests

The MiMo offline tests drive the pure modules using `fixtures/mimo-audio-response.json`, which mirrors the shape of a real `mimo-v2.5-tts` response. The client and runner tests inject a mock `fetch` and never touch the network. Run them with:

```bash
bun test src/lib/mimoTtsRequest.test.ts src/lib/mimoTtsResponse.test.ts src/lib/mimoGenerateWav.test.ts src/lib/mimoTtsClient.test.ts scripts/generate-winni-ch1-mimo-audio.test.ts
```

## Where artifacts are written

All intermediate and final artifacts go in `data/audio/`:

| File | Description |
|---|---|
| `zack-s1-e0-source.txt` | Raw episode text extracted from the season file |
| `zack-s1-e0-transcript.txt` | Two-speaker transcript (Storyteller/Pixel) |
| `zack-s1-e0-styled-transcript.txt` | Styled transcript with TTS preamble and audio tags |
| `zack-s1-e0.wav` | Generated TTS audio (PCM, 24 kHz) |
| `zack-s1-e0.meta.json` | Generation metadata (model, voices, transcript hash, timestamp) |
| `winni-s1-e0-source.txt` | Raw episode text extracted from `seasons/winni-s1.json` |
| `winni-s1-e0-transcript.txt` | Two-speaker transcript for Winni chapter 1 |
| `winni-s1-e0-styled-transcript.txt` | Styled transcript (TTS preamble + spoken body) |
| `winni-s1-e0.wav` | Generated MiMo TTS audio (WAV) |
| `winni-s1-e0.meta.json` | MiMo generation metadata (provider, model, voice, format, transcript hash, timestamp) |

## Are generated audio artifacts committed?

**No.** The entire `data/` directory is gitignored (only `data/.gitkeep` and `data/state.seed.json` are tracked). Audio artifacts are local-only and must be regenerated from the pipeline. This keeps the repo small and avoids committing large binary files.

## Gemini TTS limitations

These are known limitations of the Gemini TTS API that affect this workflow:

- **Non-streaming only.** The API returns the full audio in a single response. There is no streaming mode. For long episodes this means the full generation happens in one request — expect a few seconds of latency.
- **Occasional non-audio responses.** Gemini sometimes returns text instead of audio data. The `generate-zack-ch1-audio.ts` script retries these automatically (up to `--max-retries` times with exponential backoff). If all retries fail, the script exits with a clear error.
- **Rate limits.** Heavy usage may trigger HTTP 429 responses. These are also retried automatically.
- **Voice quality varies.** The same transcript can produce noticeably different audio on repeated runs. If the output sounds off, re-run the generation. The script does not cache or deduplicate outputs.
- **Audio tags are hints, not commands.** Gemini interprets `[softly]`, `[gently]`, etc. as best-effort. The model does not always obey them precisely.

## MiMo TTS limitations

These are known limitations of the MiMo TTS API that affect this workflow:

- **Single voice per request.** Built-in voices select one voice via the `audio` object. The styled transcript still carries `Storyteller:` / `Pixel:` labels (for Gemini compatibility), so the Winni runner strips those prefixes and the Gemini `[bracket]` mood tags automatically before posting — otherwise MiMo would read words like "Storyteller" aloud. If you want distinct narration vs. dialogue voices, generate separate segments and stitch them later (out of scope for the first experiment). Director Mode (`--director`) doesn't change this — it still produces a single designed voice per call.
- **Audio-tag syntax depends on the model.** For `mimo-v2.5-tts` (built-in voices), square-bracket `[warmly]` mid-text tags are not reliably honoured, so the runner strips them and relies on the natural-language preamble in the `user` message for tone. For `mimo-v2.5-tts-voicedesign` (Director Mode), inline `[style]` tags **are** documented as audio-tag control and are kept in the spoken body.
- **Director Mode is opt-in via `--director`.** It targets `mimo-v2.5-tts-voicedesign`, omits `audio.voice`, and treats the preamble as a Character/Scene/Guidance description. `VoiceClone` is still unused.
- **Non-streaming.** Per Xiaomi's docs, low-latency streaming is downgraded to a compatibility mode that returns after inference. This script always uses non-streaming (`stream: false`).
- **Transient failures retried automatically.** HTTP 429 and 5xx responses, network errors, and missing-audio responses are retried with exponential backoff (`--max-retries`, default 3). HTTP 400, 401, and 403 fail immediately.
- **WAV is returned directly.** Unlike Gemini (raw PCM that needs wrapping), MiMo returns a full WAV container; the script writes the bytes straight to disk without double-wrapping.
