# typeling

Typing-as-story-time app. Server is Hono on `127.0.0.1`; frontend is React 19 + Vite + Tailwind.

## Install

```bash
bun install
```

## Dev server

```bash
bun run dev
```

Runs the full Portless HTTPS stack: Hono at `https://typeling-api.localhost` and Vite at `https://typeling.localhost`. Use `bun run dev:direct` for the plain `127.0.0.1` fallback (override Hono with `SERVER_PORT`).

On first run, copy the seed state into place:

```bash
cp data/state.seed.json data/state.json
```

Runtime state is written to `data/state.json` and is gitignored. The committed `data/state.seed.json` holds the initial Winni-only defaults.

## End-to-end tests

E2E tests live in `scripts/e2e/` and use `agent-browser` (not Playwright).

```bash
npm i -g agent-browser && agent-browser install
```

Start the dev server in one terminal, then run a test in another:

```bash
bun run e2e:happy-path   # Winni → episode 0 → completion page → chapter map marks it completed
bun run e2e:wrong-key    # wrong key flashes red, does not advance; correct key advances by 1
bun run e2e:idle         # 8s pause mid-episode → recorded active_ms excludes the idle gap
```

All three exit `0` on success and non-zero on any assertion failure.

## Audio generation

Episodes are narrated with Gemini multi-speaker TTS and aligned word-by-word with Qwen3 forced alignment. Source season JSON (`seasons/<child>-s1.json`) is **read-only** — every artifact lands in `data/audio/`.

### Pipeline

```
seasons/<child>-s1.json
        │  extract-audio-source.ts
data/audio/<season>-e<n>-source.txt
        │  convert-to-transcript.ts
data/audio/<season>-e<n>-transcript.txt
        │  style-transcript.ts                (OPENROUTER_API_KEY)
data/audio/<season>-e<n>-styled-transcript.txt
        │  generate-chapter-audio.ts         (GEMINI_API_KEY)
data/audio/<season>-e<n>.wav + .meta.json
        │  speech align  →  generate-word-timings.ts
data/audio/<season>-e<n>.words.json
```

Speaker labels are always `Storyteller` (narration, Kore voice) and `Character` (every quoted line, Puck voice) regardless of season.

### Prerequisites

| Requirement | Purpose |
|---|---|
| `GEMINI_API_KEY` | Calls Gemini TTS. Get one at <https://aistudio.google.com/apikey>. |
| `OPENROUTER_API_KEY` | Styles the transcript via an LLM (skip with `--fixture`). |
| `speech` CLI | Runs Qwen3-ForcedAligner for word timings. `brew install soniqo/tap/speech`. |

### Build a chapter end-to-end

`scripts/build-chapter-audio.ts` walks all six steps for any season + episode. Each step writes a file under `data/audio/<season>-e<n>-*`; if a file already exists, the step is skipped (use `--force` to override). The orchestrator hard-fails up front if `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, or the `speech` CLI is missing.

```bash
# Build everything for Winni episode 0
bun run scripts/build-chapter-audio.ts --season winni-s1 --episode-idx 0

# Build everything for Zack episode 0
bun run scripts/build-chapter-audio.ts --season zack-s1 --episode-idx 0

# Re-run from step 4 onward, regenerating audio + alignment + timings
bun run scripts/build-chapter-audio.ts --season zack-s1 --episode-idx 0 --from audio --force

# Force a clean re-run of every step
bun run scripts/build-chapter-audio.ts --season zack-s1 --episode-idx 0 --force
```

Flags:

- `--season <slug>` — required, e.g. `zack-s1`, `winni-s1`.
- `--episode-idx <n>` — required, 0-based episode index.
- `--from <step>` — start from one of `source | transcript | style | audio | align | timings`. Earlier steps are skipped even if outputs are missing.
- `--force` — re-run from the starting step regardless of existing outputs.

After it finishes, the three artifacts worth inspecting are:

- `data/audio/<season>-e<n>-styled-transcript.txt` — review for British spelling, kid-safe tone, sparse `[audio tags]`, and a TTS preamble on line 1. Edit by hand if anything looks off, then re-run from `--from audio`.
- `data/audio/<season>-e<n>.wav` — play with `afplay` and check both voices are distinct, the full story is present, and the tone is bedtime-appropriate.
- `data/audio/<season>-e<n>.words.json` — validated word timing sidecar consumed by `StoryAudioPlayer.tsx`. The generator hard-fails if aligned words drift from the source text, timestamps move backwards, or timings exceed the WAV duration.

### Per-step manual control

Each step is also a standalone script under `scripts/` (`extract-audio-source.ts`, `convert-to-transcript.ts`, `style-transcript.ts`, `generate-chapter-audio.ts`, `generate-word-timings.ts`). Run any one with `--help` for its flags. The orchestrator is just a thin wrapper around them.

The package.json shortcuts `tts:zack-s1-e0`, `audio:winni-s1-e0:extract`, `audio:winni-s1-e0:transcript`, and `audio:zack-s1-e0:timings` invoke individual steps for those specific season/episode pairs.

### Gemini TTS notes

- Non-streaming: full audio comes back in one response; expect a few seconds of latency for long episodes.
- Gemini occasionally returns text instead of audio. `generate-chapter-audio.ts` retries transient failures (`--max-retries`, default `3`) with exponential backoff.
- Voice quality varies run-to-run. If output sounds off, re-run step 4.
- Audio tags (`[softly]`, `[gently]`, …) are best-effort hints, not commands.

Full Gemini API reference: <https://ai.google.dev/gemini-api/docs/speech-generation>.

## Cloudflare deployment

Typeling can deploy to Cloudflare Workers. The same Hono app runs inside a Worker with Durable Object state and R2 storage.

| Command | What it does |
| --- | --- |
| `bun run dev:cloud` | Local Workers runtime via the Cloudflare Vite plugin. No Bun server needed. |
| `bun run deploy` | Build the SPA and deploy to Cloudflare (`vite build && wrangler deploy`). Requires `wrangler login`. |

**Which dev mode should I use?**

- **`bun run dev` (Portless)** — default for everyday development and kid testing. Runs the real Bun server with `data/state.json`.
- **`bun run dev:cloud`** — use when testing Worker-specific behaviour (Durable Objects, R2 bindings) before a deploy.
- **`bun run deploy`** — ship to production on Cloudflare.

Full details: [`docs/cloudflare-deploy-plan.md`](docs/cloudflare-deploy-plan.md).

## Scripts

| Script | What it does |
| --- | --- |
| `bun run dev` | Portless HTTPS stack: Hono at `https://typeling-api.localhost`, Vite at `https://typeling.localhost`. |
| `bun run dev:proxy` | Ensure the standard HTTPS Portless proxy is running. |
| `bun run dev:direct` | Hono on `127.0.0.1:3001`, Vite on `127.0.0.1:5173`; override Hono with `SERVER_PORT`. |
| `bun run dev:cloud` | Local Cloudflare Workers dev via Vite plugin. |
| `bun run deploy` | Build SPA and deploy to Cloudflare. |
| `bun run server` | Hono API server only. |
| `bun run web` | Vite dev server only. |
| `bun run lint` | Biome check on `src/`. |
| `bun run format` | Biome format-write on `src/`. |
| `bun test` | Run the test suite. |
| `bun run e2e:happy-path` | End-to-end happy path via agent-browser. |
| `bun run e2e:wrong-key` | Wrong-key isolation test via agent-browser. |
| `bun run e2e:idle` | End-to-end idle handling test via agent-browser. |
| `bun run gen:season` | Generate a season JSON from prompts. |
| `bun run tts:zack-s1-e0` | Shortcut for `generate-chapter-audio.ts --season zack-s1 --episode-idx 0`. |
| `bun run audio:winni-s1-e0:extract` | Step 1 for Winni episode 0. |
| `bun run audio:winni-s1-e0:transcript` | Step 2 for Winni episode 0. |
| `bun run audio:zack-s1-e0:timings` | Step 6 for Zack episode 0. |
