# Typeling Agent Guidelines

Typeling is a typing-as-story-time app for two young readers. Keep the product small and personal: story unlocks are the reward, WPM is tracked quietly, and kid-facing mistakes are not counted.

The source of truth is:

1. `~/.gstack/projects/typeling/season-main-design-20260508-235214.md`
2. `~/.gstack/projects/typeling/season-main-implementation-plan-20260509-090553.md`
3. `~/.gstack/projects/typeling/season-main-eng-review-test-plan-20260509-090553.md`
4. `./TODOS.md` for deferred work

The implementation plan wins over this file.

## Issue Contract

- Treat every acceptance criterion as a contract. If it asks for a file, config, script, dependency, lockfile change, or negative check, deliver that exact thing.
- Do not call work done from code inspection alone. Run the command named by the issue and fix it until green.
- When adding a package, use `bun add` or `bun add -d` so both `package.json` and `bun.lock` are updated.
- Respect version pins already in `package.json`; do not casually upgrade unrelated packages.
- Check `Blocked by` and HITL requirements before starting. Do not pick downstream issues just because they are labelled `ready-for-agent`.
- If an issue says fixture/offline/no-network/no-secrets, keep that boundary explicit and test it.
- If an issue looks wrong, say so explicitly instead of silently substituting your preferred shape.

## Stack Rules

- Bun is the package manager and test runner. Do not introduce Node tooling, npm, ESLint, Prettier, or Playwright.
- Persistence is Cloudflare D1 (database `typeling-content`, bound as `STORY_DB`). There is no longer a Durable Object `STATE_STORE` or `data/state.json` store. Schema changes are numbered `.sql` files in `migrations/`, applied with `bun run db:migrate:local` and, for production, `bun run db:migrate:remote`.
- Server is a Hono app in `src/server/index.ts` that exports a Workers `fetch` handler (`export default { fetch }`). In dev it runs inside the Cloudflare Workers runtime via `@cloudflare/vite-plugin`; the `dev:direct` fallback serves the same app through `Bun.serve`. Either way it binds `127.0.0.1` (HOSTNAME), never `0.0.0.0`, and rejects wildcard-address requests.
- Stores resolve by binding: when `STORY_DB` is present the server uses `D1StoryStore`/`D1ProgressStore`; otherwise it falls back to the in-memory stores (tests, D1-less dev).
- `bun run dev` applies local D1 migrations, starts the Portless HTTPS proxy (`PORTLESS_TLD=dev`), then serves both API and frontend from `https://typeling.dev` under the Workers runtime (`TYPELING_CLOUDFLARE=1`). The dev TLD is `.dev`, not `.localhost`, because Google OAuth rejects `*.localhost` redirect URIs. There is no separate `typeling-api` host anymore.
- Use `bun run dev:direct` only for the plain-localhost fallback: a separate Bun server on `SERVER_PORT` plus Vite proxying `/api`. Honour `PORT`/`SERVER_PORT`; use the documented fallback only when unset.
- Frontend is React 19, Vite, Tailwind, TypeScript.
- Lint and format with Biome. `bun run lint` checks `src/`; `bun run format` formats `src/`.
- Browser automation is `agent-browser` only. Run `agent-browser --help` if unsure.

## Worktree Hygiene

- Most work is done through Pi worktrees. Confirm `pwd`, `git status`, and branch before editing.
- Active `.pi/worktrees/*` snapshots may have stale `CLAUDE.md`; re-read the file in that worktree before relying on guidance.
- Keep issue/PR slices independent. If `main` already absorbed part of an issue, rebase and narrow the branch to the remaining value.
- If a push is rejected, `git fetch`, inspect the divergence, then rebase or choose the recovery path from evidence.

## Before Done

Run all checks that apply to your change:

```bash
bun test
bunx tsc --noEmit
bunx vite build
bun run lint
bun run format
```

For browser-facing changes, start `bun run dev`, verify with `agent-browser` against `https://typeling.dev`, then stop the server. For format changes, run `bun run format` twice and confirm the second run makes no diff.

For timing-sensitive typing checks, prefer reducer/unit coverage plus focused smoke tests. `agent-browser press` can behave differently from a child's single physical keypress.

## Product Constraints

- Do not expand scope before Episode 1 is validated with the kid.
- Do not add deploy, server-side mid-episode save, PIN gate, replay, iPad-specific work, illustrations, eval automation, backup rotation, or third-child UI unless the issue explicitly asks.
- Typing uses document-level `keydown`, not an input element. Wrong keys flash briefly and do not advance. Backspace/Delete/arrows/modifiers/repeats are no-ops. Paste and Space prevent default browser behavior.
- WPM uses the 5-character-word convention, starts on first keystroke, pauses after 5s idle, and pauses on `visibilitychange` hidden.
- `POST /api/sessions` must be idempotent by client-generated `sessionId` and reject stale episode/season submissions with `409`. Sessions are scoped to the authenticated user's email, not a child id.
- Progress is email-scoped and stored in D1 (`users`, `user_story_progress`, `typing_sessions`). Stories are decoupled from children: navigation and the API key off `storySlug`, and per-user progress/WPM is keyed by `(email, season_slug)`. All writes pass Zod validation first.
- Identity comes from Better Auth's Google sign-in (handled at `/api/auth/*`), mapped to a lowercase-normalised email. The auth instance is built per request from the Workers `env` bindings (`.dev.vars` in dev, `wrangler secret` in prod). There is no localhost dev fallback — local dev signs in with Google; tests and overrides inject identity via the `IDENTITY` binding seam.
- Generated story text must be British English, kid-safe, and within `[A-Za-z0-9 .,!?'";:\-()\n]+`; violations are hard failures.
- Generated stories must avoid real child names; use fictional protagonist names instead.
- For audio/TTS work, create deterministic derived artifacts first, then speaker-labelled transcripts, then model calls. Do not mutate source season JSON as the first step.

## Review Posture

Review for behavioural bugs first: broken acceptance criteria, missing lockfile/config/migration changes, ignored negative checks, unsafe bind addresses, stale session/progress writes, missing email/identity scoping, and child-facing product regressions. If no issue remains, say that plainly.
