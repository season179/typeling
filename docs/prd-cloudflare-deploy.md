# PRD: Deploy Typeling to Cloudflare

Status: draft
Owner: Season
Audience: Winni and Zack (Windows machine)

## Problem

Right now Winni and Zack can only play Typeling when Dad's Mac is on and running `bun run dev`. They're on Windows, so they can't reach the app on their own. We want the kids to open Typeling like any other website, from any browser, whenever they want.

## Solution

Move the whole thing onto Cloudflare. The React app and the Hono server run as a Cloudflare Worker, the story text lives in Cloudflare D1, audio files live in Cloudflare R2, the progress file becomes a Durable Object (tiny database), and a login gate keeps strangers out. Audio generation keeps running on Dad's Mac as it does today.

## The 7 steps (in build order)

Do these in order. Each step is shippable on its own — at every step the app still runs locally and the cloud version gets a little more real.

### Step 1 — Stop using Bun on the server

The server today says "Bun, give me this file" and "Bun, start a server." Cloudflare doesn't run Bun, so those calls have to be rewritten to use Cloudflare's equivalents (Workers `fetch` handler, R2 reads, Durable Object reads/writes). The Hono routes themselves barely change — only the bits that touch files or boot the server.

Nothing else can run on Cloudflare until this is done, so it has to come first.

**Done when:** `wrangler dev` boots the API locally and every route returns the same shape it does under `bun run server`.

### Step 2 — Move the story text off the laptop

The story JSON in `seasons/` seeds a Cloudflare D1 database. The route that loads a child's season reads it from D1 instead of disk.

Seasons go first because they're tiny (~44 KB total) and the read path is simple — good way to prove out the content-store pattern before touching audio.

**Done when:** `GET /api/children/:id/season` and the episode endpoints return correct content with no local `seasons/` folder needed.

### Step 3 — Move the audio files off the laptop

The WAVs and word-timing JSON in `data/audio/` go into R2, so the kids can stream them from anywhere. The audio route forwards browser `Range` requests through to R2 so the scrub bar still works.

Audio comes after story content because it reuses the same episode text hashes but adds R2 object reads and `Range` header forwarding.

**Done when:** opening a chapter in the deployed app plays audio synced word-by-word, and the scrub bar can jump mid-chapter.

### Step 4 — Replace `data/state.json` with a Durable Object

The file that tracks "Winni is on episode 3" can't live on disk anymore. It moves into a Durable Object — Cloudflare's tiny per-app database with a single writer and strong consistency, which is what the current file-based scheme effectively gives us. The same `readState` / `mutateState(fn)` shape from `src/server/state.ts` is preserved so route handlers don't change.

This is the riskiest correctness change (idempotent sessions, mismatch 409s, current-episode rules), so it goes after R2 is solid — that way the Durable Object is the only moving part when you debug it.

**Done when:** session POSTs are idempotent by `sessionId`, the three `409` mismatch codes still fire, `current_episode` advances correctly, and a one-time seed step loads the defaults from `data/state.seed.json` on first run.

### Step 5 — Add a one-command publishing step

A small Bun script (`scripts/publish-assets.ts`) walks `data/audio/` and uploads anything new to R2. Idempotent — unchanged files are skipped via a content-hash check. Story text is seeded separately into D1.

Up to this point you've been doing manual `wrangler r2 object put`s. Now codify it.

**Done when:** running the script twice in a row only uploads on the first run, and a `--dry-run` prints what would change.

### Step 6 — Add a login gate

Turn on Cloudflare Access with an email allowlist (Dad, Winni, Zack). Configured in the Cloudflare dashboard, no code. Once on, the URL prompts for an email and only the three allowed addresses can reach the Worker.

This is a safety gate, not a finishing touch — turn it on *before* you share any URL with the kids, even a throwaway `workers.dev` one.

**Done when:** an unlisted email is blocked at the edge, and the allowed three pass through to the app.

### Step 7 — Point a domain at it

Pick something like `typeling.<our-domain>` and wire it to the Worker via Workers Routes. The kids bookmark that URL and never see `workers.dev` URLs again.

This is genuinely last — only do it once the app works end-to-end on a `workers.dev` URL with Access enabled.

**Done when:** the domain serves the app over HTTPS and the old `bun run dev` flow still works as a local fallback.

## What we're not changing

- React UI, typing rules, WPM, reducers, sentence-boundary logic, charset / British-English / fictional-name validators.
- The audio generation pipeline (Gemini TTS, Qwen3 alignment, `speech` CLI) — stays on Dad's Mac.
- Bun as the local toolchain — `bun add`, `bun.lock`, `bun test` all still apply.
- The `bun run dev` flow stays as a local rollback option until both kids have used the cloud version end-to-end.

## Tests

Four scopes, all hitting observable behaviour, none hitting Cloudflare internals:

1. **Asset reads.** The sidecar / episode integrity check (audio hash, text hash, word order, durations) moves behind an interface and is tested against an in-memory backend. Same failure cases as today's `EpisodeAudioStale` triggers.
2. **State writes.** The Durable Object's mutate contract is tested via an in-memory implementation: idempotent session POSTs, three mismatch 409s, `current_episode` only advances on a fresh episode, reset rewinds correctly.
3. **Route handlers end-to-end.** Use `app.request(new Request(...))` with the in-memory asset + state backends bound to `c.env`. Cover the access-code matrix (`ChildNotFound` 404, `InvalidEpisode` 400, `EpisodeNotFound` 404, `EpisodeLocked` 403), the audio 404 / 409 cases, and `Range`-honouring 206 responses.
4. **Publishing script.** Idempotency: given a fake remote with matching hashes, no uploads fire; change one file, only that key re-uploads; `--dry-run` writes nothing.

## Out of scope

- Anything beyond Winni and Zack (multi-tenant, third-child UI).
- Server-side mid-episode save, PIN gate, replay, iPad work, eval automation, backup rotation.
- Generating audio from inside the Worker.
- Server-side rendering of the React app.
- Public deploy without Cloudflare Access.
- Edge caching of audio via the Cache API.

## Further notes

- The integrity check uses `node:crypto` so the Worker needs `nodejs_compat`. A follow-up could swap to Web Crypto and drop the flag.
- The Durable Object class name (`StateStore`) is locked in by its migration tag — don't rename casually after first deploy.
- R2 charges per write, so the publish script's `HEAD`-then-`PUT` pattern keeps the bill proportional to actual changes.
- If a kid breaks the URL by sharing it, Cloudflare Access has audit logs and rate limits.
