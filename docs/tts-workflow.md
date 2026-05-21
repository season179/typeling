# Episode Audio Generation Workflow

This document describes how to generate TTS audio for episodes of the Typeling typing stories. The pipeline supports multiple children — currently **Zack** and **Winni** — and uses **Gemini** for the final TTS step.

**This workflow does not modify the typing story source.** Season JSON files (e.g. `seasons/zack-s1.json`, `seasons/winni-s1.json`) are read-only. All derived artifacts are written to `data/audio/`.

## Pipeline overview

```
seasons/<child>-s1.json                              (source — never modified)
        │
        ▼  extract-audio-source.ts
data/audio/<child>-s1-e<n>-source.txt                (raw episode text)
        │
        ▼  convert-to-transcript.ts
data/audio/<child>-s1-e<n>-transcript.txt            (Storyteller/Character speaker labels)
        │
        ▼  style-transcript.ts                        (requires OPENROUTER_API_KEY)
data/audio/<child>-s1-e<n>-styled-transcript.txt     (Gemini-format: TTS preamble + [bracketed] tags)
        │
        ▼  generate-chapter-audio.ts                 (Gemini multi-speaker TTS)
data/audio/<child>-s1-e<n>.wav                       (final audio)
data/audio/<child>-s1-e<n>.meta.json                 (generation metadata)
        │
        ▼  Qwen3-ForcedAligner + generate-word-timings.ts
data/audio/<child>-s1-e<n>.words.json                (validated word timing sidecar)
```

## Quick start: build a chapter end-to-end

`scripts/build-chapter-audio.ts` walks all six steps for any season + episode. Each step writes a file in `data/audio/<season>-e<n>-*`; if a file already exists, the step is skipped (use `--force` to override). The orchestrator hard-fails up front if `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, or the `speech` CLI is missing.

```bash
# Build everything for Zack episode 0
bun run scripts/build-chapter-audio.ts --season zack-s1 --episode-idx 0

# Build everything for Winni episode 0
bun run scripts/build-chapter-audio.ts --season winni-s1 --episode-idx 0

# Re-run from step 4 onward, regenerating the audio + alignment + timings
bun run scripts/build-chapter-audio.ts --season zack-s1 --episode-idx 0 --from audio --force

# Force a clean re-run of every step
bun run scripts/build-chapter-audio.ts --season zack-s1 --episode-idx 0 --force
```

Flags:
- `--season <slug>` — required, e.g. `zack-s1`, `winni-s1`.
- `--episode-idx <n>` — required, 0-based episode index.
- `--from <step>` — start from one of `source | transcript | style | audio | align | timings`; earlier steps are skipped even if their outputs are missing.
- `--force` — re-run from the starting step regardless of whether outputs already exist.

After the run completes, inspect the three artifacts you'll listen to or ship:
- `data/audio/<season>-e<n>-styled-transcript.txt`
- `data/audio/<season>-e<n>.wav`
- `data/audio/<season>-e<n>.words.json`

The sections below describe each step in detail. Use them when you want to invoke a single step manually instead of the orchestrator.

## Per-step manual control

### Gemini TTS reference

This workflow uses the Gemini Speech Generation API. For the full API documentation, voice list, and limitations, see:

https://ai.google.dev/gemini-api/docs/speech-generation

### Prerequisites

| Requirement | Purpose |
|---|---|
| `GEMINI_API_KEY` | Calls the Gemini TTS endpoint. Get one at https://aistudio.google.com/apikey |
| `OPENROUTER_API_KEY` | Styles the transcript via an LLM (step 3). Only needed if not using `--fixture`. |
| `speech` CLI | Runs Qwen3-ForcedAligner for word timings (step 5). |
| `bun install` | Dependencies must be installed. |

### Speaker labels

The transcript and styled transcript use only two speaker labels regardless of the season:

- `Storyteller` — narration.
- `Character` — every quoted line of dialogue, no matter which named character in the story is speaking.

Gemini multi-speaker TTS allows two distinct voices per request, so all named characters in a season share the `Character` voice (Puck) while narration uses `Storyteller` (Kore).

### Step-by-step

Examples below use `zack-s1` episode 0. Substitute `--season winni-s1` or any other slug to run the same step against a different season.

#### 1. Extract the source text

Pulls the chosen episode from the season JSON into a plain-text file. This is the raw story text as typed by the child.

```bash
bun run scripts/extract-audio-source.ts \
  --season seasons/zack-s1.json \
  --episode-idx 0 \
  --output data/audio/zack-s1-e0-source.txt
```

#### 2. Build the two-speaker transcript

Converts the raw source text into a speaker-labelled transcript. Dialogue (text inside `"quotes"`) is assigned to **Character**; narration is assigned to **Storyteller**.

```bash
bun run scripts/convert-to-transcript.ts \
  --source data/audio/zack-s1-e0-source.txt \
  --output data/audio/zack-s1-e0-transcript.txt
```

Output format:
```
Storyteller: In a cosy workshop filled with soft light...
Character: What a lovely day!
Storyteller: said Pixel in a soft, buzzy voice.
```

#### 3. Style the transcript for TTS

Sends the raw transcript to an LLM (via OpenRouter) which adds a TTS preamble and sparse `[audio tags]` for performance direction. The LLM does not change any story words — it only adds `[softly]`, `[gently]`, `[excitedly]`, etc.

```bash
bun run scripts/style-transcript.ts \
  --source data/audio/zack-s1-e0-transcript.txt \
  --output data/audio/zack-s1-e0-styled-transcript.txt
```

Options:
- `--fixture <path>` — Skip the LLM call and use a pre-made file instead (useful for offline dev or re-running step 4 without paying for step 3 again).

**Review the styled transcript before generating audio.** Open `data/audio/<season>-e<n>-styled-transcript.txt` and check:

1. The story meaning is preserved — no words added, removed, or reworded.
2. British English spelling is intact ("colour", "favourite", "centre").
3. Tone is warm, kind, and kid-safe.
4. Only `Storyteller:` and `Character:` speaker labels are present.
5. Audio tags are sparse (one every 2–3 lines, not on every sentence).
6. A TTS preamble exists on the first line (e.g. "Make Storyteller sound warm and gentle...").

If anything looks wrong, edit the file by hand before proceeding.

#### 4. Generate TTS audio

Calls the Gemini TTS API with the styled transcript and writes a WAV file plus metadata.

```bash
bun run scripts/generate-chapter-audio.ts \
  --season zack-s1 \
  --episode-idx 0
```

`tts:zack-s1-e0` is a package.json shortcut for the same command.

Options:
- `--season <slug>` — required, season slug used for metadata + default file paths.
- `--episode-idx <n>` — required, episode index.
- `--transcript <path>` — Styled transcript file (default: `data/audio/<season>-e<n>-styled-transcript.txt`).
- `--output <path>` — WAV output path (default: `data/audio/<season>-e<n>.wav`).
- `--max-retries <n>` — Max retry attempts for transient failures (default: `3`).

#### 5. Listen and check the output

Play the generated WAV file:

```bash
# macOS
afplay data/audio/zack-s1-e0.wav

# Linux (with sox)
play data/audio/zack-s1-e0.wav
```

Check:
- Both speakers are audible and distinct (Storyteller = Kore, Character = Puck).
- The full story is present — no truncated or missing lines.
- The tone is warm and bedtime-appropriate.
- Audio tags were respected (gentle/soft delivery where tagged).

If the output is bad, re-run step 4. Gemini occasionally returns degraded audio; the script handles transient non-audio responses automatically, but quality varies.

#### 6. Generate word timings

Run Qwen3-ForcedAligner through the local `speech` CLI, then normalize the raw output into the Typeling sidecar format:

```bash
speech align data/audio/zack-s1-e0.wav \
  --text "$(cat data/audio/zack-s1-e0-source.txt)" \
  --language en \
  --aligner-model aufklarer/Qwen3-ForcedAligner-0.6B-4bit \
  > data/audio/zack-s1-e0.qwen-align.raw.txt

bun run scripts/generate-word-timings.ts --season zack-s1 --episode-idx 0
```

The Bun script hard-fails if the aligned words drift from the source text, timestamps move backwards, or timings exceed the WAV duration.

## Where artifacts are written

All intermediate and final artifacts go in `data/audio/`:

| File | Description |
|---|---|
| `<child>-s1-e<n>-source.txt` | Raw episode text extracted from the season file |
| `<child>-s1-e<n>-transcript.txt` | Two-speaker transcript (Storyteller/Character) |
| `<child>-s1-e<n>-styled-transcript.txt` | Styled transcript with TTS preamble and audio tags |
| `<child>-s1-e<n>.wav` | Generated TTS audio (PCM, 24 kHz, WAV-wrapped) |
| `<child>-s1-e<n>.meta.json` | Generation metadata (model, voices, transcript hash, timestamp) |
| `<child>-s1-e<n>.qwen-align.raw.txt` | Raw Qwen forced-alignment output |
| `<child>-s1-e<n>.words.json` | Validated word timing sidecar for playback/highlighting |

## Are generated audio artifacts committed?

**No.** The entire `data/` directory is gitignored (only `data/.gitkeep` and `data/state.seed.json` are tracked). Audio artifacts are local-only and must be regenerated from the pipeline. This keeps the repo small and avoids committing large binary files.

## Gemini TTS limitations

These are known limitations of the Gemini TTS API that affect this workflow:

- **Non-streaming only.** The API returns the full audio in a single response. There is no streaming mode. For long episodes this means the full generation happens in one request — expect a few seconds of latency.
- **Occasional non-audio responses.** Gemini sometimes returns text instead of audio data. The `generate-chapter-audio.ts` script retries these automatically (up to `--max-retries` times with exponential backoff). If all retries fail, the script exits with a clear error.
- **Rate limits.** Heavy usage may trigger HTTP 429 responses. These are also retried automatically.
- **Voice quality varies.** The same transcript can produce noticeably different audio on repeated runs. If the output sounds off, re-run the generation. The script does not cache or deduplicate outputs.
- **Audio tags are hints, not commands.** Gemini interprets `[softly]`, `[gently]`, etc. as best-effort. The model does not always obey them precisely.
