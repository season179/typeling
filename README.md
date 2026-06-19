# typeling

Typing-as-story-time app for two young readers. Story unlocks are the reward, WPM is tracked quietly, and kid-facing mistakes are not counted.

The whole app is a single Hono Worker (`src/server/index.ts`, `export default { fetch }`) that runs inside the Cloudflare Workers runtime and serves both the JSON API (`/api/*`) and the React 19 + Vite + Tailwind SPA from one origin. Persistence is Cloudflare D1 (`typeling-content`, bound as `STORY_DB`); episode audio lives in R2 (`typeling-prod-assets`, bound as `ASSETS_BUCKET`). Identity is Better Auth Google sign-in at `/api/auth/*`, normalised to a lowercase email; progress and WPM are email-scoped.

## Install

```bash
bun install
```

Local Worker secrets live in `.dev.vars` (gitignored). At minimum you need the Better Auth and Google OAuth keys for sign-in to work — see [Secrets](#secrets).

## Dev server

```bash
bun run dev
```

This applies local D1 migrations, starts the Portless HTTPS proxy (`PORTLESS_TLD=dev`), the forced-alignment aligner service, and Vite under the Cloudflare Workers runtime (`TYPELING_CLOUDFLARE=1`). API and frontend are served from a single origin: **https://typeling.dev**.

The TLD is `.dev`, not `.localhost`, because Google OAuth rejects `*.localhost` redirect URIs. There is no localhost auth fallback — you sign in with Google even in dev. (Tests and overrides inject identity through the `IDENTITY` binding instead.)

Seed story content into local D1 once the server is up (the app and `/admin` read content from D1, not from `seasons/*.json`):

```bash
bun run db:seed:local       # seed story content into local D1
bun run assets:seed:local   # optional: seed episode audio into local R2
```

Use `bun run dev:direct` only for the plain-`127.0.0.1` fallback that skips the Workers runtime: a Bun server on `SERVER_PORT` (default `3001`) plus Vite on `5173` proxying `/api`. Without the `STORY_DB` binding it uses in-memory stores, so it is only useful for quick non-D1, non-auth checks.

### Secrets

`.dev.vars` holds the local Worker secrets (set with `wrangler secret` in production):

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` | Better Auth session configuration. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. |
| `GEMINI_API_KEY` | Gemini multi-speaker TTS (audio generation). |
| `OPENROUTER_API_KEY` | Transcript styling during audio generation. |
| `ALIGNER_URL` | Loopback URL of the forced-alignment service used by `/admin` audio generation. |
| `ADMIN_AUDIO_GENERATION_ENABLED`, `ADMIN_AUDIO_PUBLISH_ENABLED` | Feature flags for the `/admin` audio tools. |

The `/parent` dashboard is gated by a `parent_viewers` allowlist table managed from local via `wrangler`; every Google account is otherwise treated as a reader.

## End-to-end tests

E2E tests live in `scripts/e2e/` and use `agent-browser` (not Playwright).

```bash
npm i -g agent-browser && agent-browser install
```

Start the dev server in one terminal, then run a test in another:

```bash
bun run e2e:happy-path   # story card → episode 0 → completion page → chapter map marks it completed
bun run e2e:wrong-key    # wrong key flashes red, does not advance; correct key advances by 1
bun run e2e:idle         # 8s pause mid-episode → recorded active_ms excludes the idle gap
```

All three exit `0` on success and non-zero on any assertion failure.

## Audio generation

Episodes are narrated with Gemini multi-speaker TTS and aligned word-by-word with Qwen3 forced alignment. Source story JSON (`seasons/<story-slug>.json`) is **read-only** — every artifact lands in `data/audio/`.

### Pipeline

```
seasons/<story-slug>.json
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
# Build everything for Rainbow Door episode 0
bun run scripts/build-chapter-audio.ts --season rainbow-door-s1 --episode-idx 0

# Build everything for Pixel's Science Garden episode 0
bun run scripts/build-chapter-audio.ts --season pixel-garden-s1 --episode-idx 0

# Re-run from step 4 onward, regenerating audio + alignment + timings
bun run scripts/build-chapter-audio.ts --season pixel-garden-s1 --episode-idx 0 --from audio --force

# Force a clean re-run of every step
bun run scripts/build-chapter-audio.ts --season pixel-garden-s1 --episode-idx 0 --force
```

Flags:

- `--season <slug>` — required, e.g. `pixel-garden-s1`, `rainbow-door-s1`.
- `--episode-idx <n>` — required, 0-based episode index.
- `--from <step>` — start from one of `source | transcript | style | audio | align | timings`. Earlier steps are skipped even if outputs are missing.
- `--force` — re-run from the starting step regardless of existing outputs.

After it finishes, the three artifacts worth inspecting are:

- `data/audio/<season>-e<n>-styled-transcript.txt` — review for British spelling, kid-safe tone, sparse `[audio tags]`, and a TTS preamble on line 1. Edit by hand if anything looks off, then re-run from `--from audio`.
- `data/audio/<season>-e<n>.wav` — play with `afplay` and check both voices are distinct, the full story is present, and the tone is bedtime-appropriate.
- `data/audio/<season>-e<n>.words.json` — validated word timing sidecar consumed by `StoryAudioPlayer.tsx`. The generator hard-fails if aligned words drift from the source text, timestamps move backwards, or timings exceed the WAV duration.

### Per-step manual control

Each step is also a standalone script under `scripts/` (`extract-audio-source.ts`, `convert-to-transcript.ts`, `style-transcript.ts`, `generate-chapter-audio.ts`, `generate-word-timings.ts`). Run any one with `--help` for its flags. The orchestrator is just a thin wrapper around them.

### Re-slicing episodes (no TTS, no alignment)

When a season's episodes are split or re-cut (the 14→28 split, or regenerating one flat seam later), existing audio can be re-sliced from the original word timings instead of re-running TTS and forced alignment. The same `chooseEpisodeSplit` sentence-boundary logic drives both the text split and the audio cut, so the re-sliced `2i`/`2i+1` audio always matches the split `2i`/`2i+1` episode text.

First author the split season JSON in place:

```bash
bun run scripts/split-season.ts --dry-run                 # preview cuts for the two real seasons
bun run scripts/split-season.ts seasons/rainbow-door-s1.json      # write the split episodes in place
```

Then re-slice the existing audio to match:

```bash
bun run scripts/reslice-episodes.ts                       # verify every half passes the serve-time check (no writes)
bun run scripts/reslice-episodes.ts --write               # write the new .wav / .words.json / -source.txt halves
bun run scripts/reslice-episodes.ts --write rainbow-door-s1      # limit to one season
```

Every half is run through the exact serve-time `EpisodeAudioStale` check (`src/lib/audio/sidecarMatch.ts`) before anything is written. Under `--write`, stale build intermediates (`-transcript.txt`, `-styled-transcript.txt`, `.meta.json`, `.qwen-align.raw.txt`) for the touched episodes are removed, since they cannot be regenerated here and would otherwise publish as stale. Publish the new halves to R2 afterwards with `bun run scripts/publish-assets.ts` (see `docs/r2-keys.md` for key layout).

### Gemini TTS notes

- Non-streaming: full audio comes back in one response; expect a few seconds of latency for long episodes.
- Gemini occasionally returns text instead of audio. `generate-chapter-audio.ts` retries transient failures (`--max-retries`, default `3`) with exponential backoff.
- Voice quality varies run-to-run. If output sounds off, re-run step 4.
- Audio tags (`[softly]`, `[gently]`, …) are best-effort hints, not commands.

Full Gemini API reference: <https://ai.google.dev/gemini-api/docs/speech-generation>.

## Cloudflare deployment

The same Hono Worker that backs local dev is what ships to production — no separate server. State is Cloudflare D1 (`STORY_DB`, database `typeling-content`) and R2 (`ASSETS_BUCKET`, bucket `typeling-prod-assets`); see `wrangler.jsonc` for the bindings.

| Command | What it does |
| --- | --- |
| `bun run dev:cloud` | Local Workers runtime via the Cloudflare Vite plugin on plain `127.0.0.1` (no Portless HTTPS proxy). |
| `bun run deploy` | Build the SPA and deploy to Cloudflare (`vite build && wrangler deploy`). Requires `wrangler login`. |
| `bun run db:migrate:remote` | Apply the numbered `migrations/*.sql` to the production D1 database. |

**Which dev mode should I use?**

- **`bun run dev` (Portless)** — default for everyday development and kid testing. Runs the Workers runtime at `https://typeling.dev` with real D1 + R2 bindings, so Google sign-in works.
- **`bun run dev:cloud`** — the same Workers runtime on plain `127.0.0.1`, for quick Worker checks when you do not need the HTTPS proxy or OAuth redirect.
- **`bun run dev:direct`** — non-Workers fallback: a plain Bun server plus a Vite proxy, with in-memory stores. No D1, no R2, no auth.
- **`bun run deploy`** — ship to production on Cloudflare.

Bindings: `wrangler.jsonc`. R2 key layout: [`docs/r2-keys.md`](docs/r2-keys.md).

## Scripts

| Script | What it does |
| --- | --- |
| `bun run dev` | Full dev stack: D1 migrations + Portless HTTPS + aligner + Vite under the Workers runtime, served at `https://typeling.dev`. |
| `bun run dev:proxy` | Ensure the standard HTTPS Portless proxy is running. |
| `bun run dev:aligner` | Run the forced-alignment loopback service used by `/admin` audio generation. |
| `bun run dev:direct` | Non-Workers fallback: Bun server on `127.0.0.1:3001` (override with `SERVER_PORT`), Vite on `127.0.0.1:5173` proxying `/api`. |
| `bun run dev:cloud` | Local Cloudflare Workers dev via the Vite plugin on plain `127.0.0.1`. |
| `bun run deploy` | Build SPA and deploy to Cloudflare. |
| `bun run db:migrate:local` | Apply `migrations/*.sql` to the local D1 database. |
| `bun run db:migrate:remote` | Apply `migrations/*.sql` to the production D1 database. |
| `bun run db:seed:local` | Seed story content into local D1. |
| `bun run assets:seed:local` | Seed episode audio into local R2. |
| `bun run audio:publish` | Publish episode audio to R2. |
| `bun run lint` | Biome check on `src/`. |
| `bun run format` | Biome format-write on `src/`. |
| `bun test` | Run the test suite. |
| `bun run e2e:happy-path` | End-to-end happy path via agent-browser. |
| `bun run e2e:wrong-key` | Wrong-key isolation test via agent-browser. |
| `bun run e2e:idle` | End-to-end idle handling test via agent-browser. |
| `bun run gen:season` | Generate a season JSON from prompts. |
