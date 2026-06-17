# Plan: Episode Split (14→28) + Admin-Driven Generation

Status: CONSENSUS draft (pre-implementation, no code yet).
Authoring: Claude (Opus 4.8) ↔ Pi (GLM-5.2, Z.ai). Pi ran a code-grounded round-1 review
(20 tool calls) and found real gaps; resolutions below are incorporated. Pi's round-2
confirmation pass stalled three times on Z.ai API timeouts, so the consensus is synthesized
from Pi's round-1 findings + Claude's resolutions, with pushback noted explicitly.
Source of truth: design + impl plan in `~/.gstack/projects/typeling/`.

## Why
Kids report each session is too long. Halve per-session typing while preserving the whole
14-beat arc. Chosen approach: **split each of the 14 episodes into 2 shorter episodes (→28)**.
Reward cadence doubles (more frequent "unlock" wins). Admin-driven generation is a *separate,
later* want.

## Grounded facts (verified in code)
- Content model: season = `{ slug, name, theme, episodes[] }`; episode = `{ idx, text }` —
  **one text blob per episode**, no sub-segmentation. `season.ts` enforces **exactly 14**
  (`episodes.array(...).length(MAX_EPISODES)`, `MAX_EPISODES = 14`). Nav keys off `storySlug` + `episodeIdx`.
- **Two independent constant sources** (Pi finding): `src/lib/schemas/state.ts:3` defines its OWN
  `MAX_EPISODE_IDX = 13` / `MAX_CURRENT_EPISODE = 14`, gating `sessionSubmissionSchema.episode_idx.max(13)`
  (state.ts:33, POST /api/sessions) and `current_episode.max(14)` on `storyProgressSchema`/`childSchema`
  (state.ts:51). These are NOT imported from season.ts.
- DB (D1): `user_story_progress.current_episode CHECK (… <= 14)`; `typing_sessions.episode_idx CHECK (… <= 13)`.
  STRICT tables → CHECK can't be altered in place → **rebuild** (create→copy→drop→rename→reindex).
  Precedent: `0002_independent_stories.sql` already did exactly this rebuild dance in D1.
- Audio is generated + validated **per whole episode**. Sidecar `.words.json` stores
  `textHash = sha256(episode text)`, `audioHash = sha256(wav bytes)`, per-word start/end timings.
  On serve, mismatch → `409 EpisodeAudioStale`; never auto-regenerated.
  → **Audio cost = number of episode text blobs whose bytes change.**
- Pipeline (`scripts/build-chapter-audio.ts`) is a **Bun-CLI-on-your-Mac** process: extract→transcript
  (fs) · style (OpenRouter HTTP) · TTS (Gemini HTTP) · **align (`speech` CLI subprocess,
  Qwen3-ForcedAligner — LOCAL ONLY)** · word-timings (fs). Uses `Bun.spawn` + filesystem.
  Audio WAV is **mono PCM** (multi-speaker = voices mixed into one mono track).
- `/admin` exists: lists per-episode status (ready/missing/**stale**), **edits episode text**
  (validated), plays audio, serves VTT. Gated **local-only by hostname**. **No generation trigger.**
- Server runtime is **workerd** in prod and under primary `bun run dev`; `dev:direct` is the only
  Bun.serve path. Workers have **no subprocess / no fs**.
- Assets: local `data/audio/` (DiskAssetStore) → R2 (R2AssetStore), pushed by `publish-assets.ts`
  (content-hash idempotent: `asset-publisher.ts` skips unchanged keys).

---

## PART 1 — Episode Split (14 → 28)

### 1.1 Episode-count model — single source of truth
Don't trade magic `14` for magic `28`. Make count **per-season**, derived from `episodes.length`,
range `.min(1).max(40)`. **Unify `season.ts` and `state.ts` onto ONE shared episode-count source**
(Pi finding #1) so the two can't drift. Read `total_episodes` from the season everywhere.

### 1.2 De-hardcode surface (server AND frontend — Pi findings #1, #2)
- `season.ts`: per-season length (1.1).
- `state.ts`: `sessionSubmissionSchema.episode_idx` cap → keep as a **generous absolute bound**
  (sanity only); `storyProgressSchema`/`childSchema.current_episode` caps raised. Real per-season
  gating moves into the handler (see 1.6).
- `src/server/index.ts:783`: `assertEpisodeIsOpen(episodeIdx, current_episode, MAX_EPISODES)` must
  read `season.episodes.length`, not the constant.
- Chapter map UI: render **N nodes from season length**, not a hardcoded 14.
- Tests/fixtures pinned to 14 / `MAX_EPISODES` / idx≤13 updated.

### 1.3 Content: where to cut (DECIDED — mechanical)
For each old episode `i`, pick split word-index `k` at the **sentence-final boundary** nearest the
word-count midpoint (natural pause; balances halves). Audio: **re-slice, zero TTS**.
- **Decision (you, in review):** mechanical cuts everywhere — no upfront cliffhanger hand-tuning.
- If a seam reads flat once the kids try it, **reannotate that one episode and regenerate its audio**
  locally — accepted as a low, occasional cost (you: "the cost is not high").

### 1.4 Audio re-slice module (cheap path — reusable core)
Pure local TS, **no aligner, no subprocess**. Input: `<season>-e<i>.wav` + `.words.json` + cut `k`.
Output two sets `…-e<2i>` / `…-e<2i+1>`:
- WAV: slice mono PCM at the sample for cut-time (gap midpoint between `words[k-1].end` and
  `words[k].start`; sentence-final boundaries carry a real pause so cuts are clean). Fresh WAV headers.
- Sidecar: split `words[]` (A = 0..k-1 unchanged; B = k.. rebased by −cut-time); recompute
  `audioHash`, `textHash`, `durationSeconds`, paths, `episodeIdx`; keep `alignerModel`.
- **Inventory and handle ALL per-episode artifacts** (Pi finding #4): `.wav`, `.words.json`,
  `.meta.json`, `-source.txt`, `-transcript.txt`, `-styled-transcript.txt`, `.qwen-align.raw.txt`.
  Regenerate deterministic `-source.txt` per half; transcript/styled only needed when re-rendering.
- **Acceptance test (Pi finding #3): export `assertSidecarMatchesEpisodeText`** (currently
  module-private in stores.ts) or a pure variant, and run it verbatim against each new episode —
  it checks slug/idx/textHash/audioHash, word count, `word.start ≥ previousEnd`, `word.end ≤ durationSeconds`.
- Module lives in a shared place (`src/lib/audio/*`) so the CLI and any future admin path import it.
  It's also **Worker-portable** (byte+JSON only) — relevant to Part 2.

### 1.5 Fallback re-render path (only for flat seams found later)
If a mechanical cut reads flat, run `build-chapter-audio.ts` locally for that one episode
(style→TTS→align→timings) and re-publish via `publish-assets.ts` (only changed files upload).
Not part of the first pass.

### 1.6 DB migration `0005_split_episodes.sql`
STRICT-table rebuild (precedent: `0002`):
1. Rebuild `user_story_progress` with `CHECK (current_episode <= 28)`; copy with
   **`current_episode = current_episode * 2`** (old i→2i; terminal 14→28 = complete).
2. Rebuild `typing_sessions` with `CHECK (episode_idx <= 27)`; **leave historical `episode_idx`
   unchanged** (≤13 still valid; it's WPM history, and ParentView does not surface it). Recreate the
   `typing_sessions_user_story_finished_at` index.
3. Transaction-wrapped; numbered = run-once. Apply local then remote.
- In-flight clients on an old index may submit a now-stale session → transient `409` (refresh fixes).
- Edge cases: finished (14→28), mid-season (c→2c), never-started (0→0).

### 1.7 Session-submit gating (Pi finding #6 resolution)
Zod can't know season length at submit time. Keep the Zod `episode_idx` cap a generous absolute
bound; do the **real gating in the POST /api/sessions handler**, which already loads the season for
the stale-409 check → verify `episode_idx < season.episodes.length` there.

### 1.8 R2 keys (Pi affirmation)
No orphan cleanup needed: indices 0..13 get overwritten with new (halved) content, 14..27 are new.
`publish-assets.ts` content-hash idempotency uploads only changed keys.

### 1.9 WPM / graduation
Shorter sessions ⇒ shorter, noisier WPM samples; "rolling avg of 3" now spans half the typing.
**Decision: don't change the algorithm yet** — observe with real kids first. Watch-item.

### 1.10 Order of work
a. Single-source episode count + de-hardcode (1.1, 1.2).
b. Author 28-episode JSON; pick cut points; mark hand-tuned seams.
c. Build + run re-slice module → 28 audio sets from 14 (with the exported acceptance check).
d. Re-render hand-tuned seam episodes locally.
e. Write + apply `0005` (local → remote).
f. Chapter map → N nodes.
g. Re-publish to R2.
h. Full gate: `bun test` · `bunx tsc --noEmit` · `bunx vite build` · `bun run lint` · `bun run format` (twice).

---

## PART 2 — Admin-Driven Generation (future design only)

### 2.1 Scope (DECIDED — build it; do not stay on the CLI)
**Decision (you, in review):** admin generation is a committed Phase 2, not a maybe. The CLI is not
the long-term home. Pi argued it was over-engineering for two kids; you overrode that — it gets built
**after Part 1 ships** (sequencing unchanged; Part 1 is the kid-facing value and is independent).
Keep the shape minimal (2.3); full *cloud* generation stays out of scope — generation runs locally.

### 2.2 The runtime wall
`/admin` is served by workerd (no `Bun.spawn`, no fs) — the aligner can't run there. So generation
can't be inline.

### 2.3 Minimal local trigger (consensus: NO D1 jobs table in v0)
If built: admin (workerd) drops a **watched marker file**; a small **Bun sidecar** (separate process)
polls it, runs the re-slice module / `build-chapter-audio.ts`, writes status back; admin UI extends
its existing ready/missing/stale display with `generating`/`failed`. No Cloudflare Queues, no
`generation_jobs` table.

### 2.4 The one cloud blocker
Styling (OpenRouter) + TTS (Gemini) are HTTP and Worker-portable; R2 writes are fine. **Only the
forced aligner is non-portable.** True cloud generation later = replace it with a hosted
word-timestamp API or a remote aligner box; nothing else moves. Keep the pipeline free of *new*
local-only deps meanwhile.

### 2.5 Auth
Hostname-gating is fine while local. Remote admin would need real auth (Better Auth email allowlist).
Out of scope now.

---

## Sequencing verdict (consensus + your decision)
**Part 1 first, then Part 2 (committed).** Part 1 is the kid-facing value, is bounded, and doesn't
depend on Part 2 — so it ships first. Part 2 (admin generation) follows; you've decided to build it
rather than stay on the CLI.

## Pi review → resolution (the two-sided record)
| # | Pi (GLM-5.2) round-1 finding | Resolution |
|---|---|---|
| 1 | `state.ts` has its own caps gating session/progress writes; new idx 14..27 would 400 | Unify onto one count source; Zod = absolute bound; gate per-season in handler |
| 2 | `index.ts:783 assertEpisodeIsOpen(..., MAX_EPISODES)` uses the constant | De-hardcode server call site too (1.2) |
| 3 | `assertSidecarMatchesEpisodeText` is private; checks more than textHash | Export it; use verbatim as re-slice acceptance test |
| 4 | Re-slice must handle ALL data/audio artifacts, not just wav+words.json | Full artifact inventory in the module (1.4) |
| 5 | Admin generation is over-engineering for 2 kids — drop it | **Pushback:** human wants it. Kept as future design; no D1 jobs table; marker-file trigger; gated |
| 6 | Zod can't know season length at submit time | Keep Zod absolute bound; real gating in handler (1.7) |
| — | Affirmed: mono-PCM sentence-final cuts clean; 0002 rebuild precedent; no orphan R2 keys; idx unchanged safe | Kept as-is |

## Decisions settled in review (2026-06-17)
- **A — Episode count:** flexible per-season (you: "very likely we'll change again"). → §1.1.
- **B — Cut policy:** mechanical cuts; regenerate a flat seam later if needed (you: "the cost is not high"). → §1.3.
- **C — Admin generation:** build it; don't stay on the CLI. → Part 2 committed.
- **D — Unlock cadence:** decide after trying with the kids; implement first. → §1.9 watch-item.

## Remaining risks
1. Re-slice audio quality at cut points — mitigate: sentence-final cuts + spot-listen, regenerate the odd flat one.
2. STRICT-table rebuild correctness + migration edge cases (covered; `0002` precedent exists).
3. Pi's round-2 confirmation never landed (Z.ai API down); optionally revisit for literal sign-off when healthy.
