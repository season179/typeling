# Typeling

Typing-as-story-time for two kids (Winni, Zack). 14 episodes per season; typing each unlocks the next. WPM tracked, never shown to the kid.

**Source-of-truth:** design doc, implementation plan, test plan (in `~/.gstack/projects/typeling/`). Deferred work in `./TODOS.md`. Implementation plan wins over this file.

## Stack

- **Runtime:** Bun. No Node.
- **Server:** Hono. **Bind `127.0.0.1`, never `0.0.0.0`.**
- **Frontend:** React 19 + TypeScript + Vite + Tailwind. Vite binds `127.0.0.1`. Prod build → root `dist/` (Hono serves static + `/api/*`).
- **Validation:** Zod at every boundary (HTTP, file I/O, generation output).
- **Lint/format:** Biome.
- **Tests:** `bun test` unit; `agent-browser` E2E. **No Playwright.**

## Before calling done

Run all that apply, fix until green:
```
bun test
bunx tsc --noEmit
bunx vite build
bun run web        # then agent-browser verify acceptance criteria
```

## Working conventions

- **Match acceptance criteria literally.** If an issue asks for a file or config, include it. Push back explicitly if it's wrong — don't silently skip.
- **Preserve existing behaviour on rebase/merge.** When adding to the project, keep what's already there and layer on top.
- **Version pins matter.** Respect pinned versions in CLAUDE.md and package.json. Don't let `bun add` override them.
- **Run `tsc --noEmit` after adding browser code.** Ensure `tsconfig.json` includes DOM libs (`"lib": ["ESNext", "DOM", "DOM.Iterable"]`).

## Persistence

`./data/state.json` — single-process, single-writer, no database. Atomic write (write `.tmp` → `rename`), keep one `.bak`. Zod-validated on every read and write. Seasons live in `./seasons/<slug>.json`, committed to repo.

## Charset

`[A-Za-z0-9 .,!?'";:\-()\n]+` — kid-typability choice, not a shortcut. Smart quotes, em dashes, non-ASCII stripped/normalised. Asserted post-gen; charset failure is a hard error.

## British spelling

Prompt requests British English. Post-process American→British dictionary. Zero American tokens tolerated.

## Typing engine

- Document-level `keydown`, no input element.
- Correct char → advance cursor, style as "typed".
- Wrong char → flash red ~200ms, no advance, no mistake counter.
- Backspace, Delete, arrows, modifiers, `event.repeat`: no-op.
- Paste (`Cmd+V`): `preventDefault`.
- Space: `preventDefault` (don't scroll). Case-sensitive.

## WPM

5-char-word convention. Timer: first keystroke → last. **5s idle pause** (resume on next keystroke). `visibilitychange → hidden` also pauses. `WPM = (char_count / 5) / (active_ms / 60000)`.

## POST /api/sessions

Client generates `sessionId` (crypto.randomUUID). Server: Zod-validate → if exists, return prior result → verify episode matches `child.current_episode` + `active_season` (mismatch → 409) → append session → advance episode (cap at 13) → atomic write.

## Mid-episode resume

`localStorage` autosave per keystroke (`{ sessionId, cursorIdx, activeMs, lastKeystrokeAt }`, keyed by child+episode). Restore on mount if same child/episode/season. Clear on completion.

## Word-count budget

`min = max(50, target_wpm × 5)`, `max = min(400, target_wpm × 15)`. ~5–15 min typing time.

## Content guardrails

No death, killing, hate, scary/blood/gore, shame, punitive language. Blacklist regex post-gen; hit = hard fail, regenerate.

## File layout

```
data/state.json         # gitignored runtime state
seasons/<slug>.json     # committed episodes
scripts/gen-season.ts   # generation pipeline
src/server/             # Hono routes, state helpers
src/lib/                # shared zod schemas, normalize, dictionary, wpm
src/web/                # React app
tests/                  # bun test
```

## Test strategy

Unit: Zod schemas, EpisodeRunner reducer, WPM calc, British dictionary, charset normalize, rolling-3 graduation. E2E: typing engine (correct flow, wrong-key, idle). Chrome surfaces not E2E-tested yet — wait for Winni's first session.

## Not building yet

See `TODOS.md`. Don't add: deploy, server-side mid-episode save, PIN gate, episode replay, iPad, illustrations, eval-suite automation, backup rotation, third-child UI.

## Design gate

Validate Episode 1 with the kid before expanding scope. Don't polish chrome or add features beyond the locked plan until that's done.

## Skill routing

- Brainstorm → /office-hours | Strategy → /plan-ceo-review | Architecture → /plan-eng-review
- Design → /design-consultation or /plan-design-review | Full review → /autoplan
- Bugs → /investigate | QA → /qa | Code review → /review | Ship → /ship
- Save → /context-save | Resume → /context-restore

## Lessons learned

- **Respect the exact export contract.** If an issue specifies an export shape, test that exact public contract — don't substitute a close-enough equivalent.
- **Run every acceptance check, especially negative ones.** A failing negative check is a bug, not a platform quirk. Fix it.
- **Honour `PORT`, never hardcode.** Read `process.env.PORT` and fall back to the documented default. Same for any environment-sensitive value.
- **Verify branch ancestry before PRing.** Branch must be based on `origin/main` with clean linear history.
- **Tailwind config: follow the issue, not your defaults.** If the issue asks for `tailwind.config.js`, include it — even if you think the version doesn't need it.
