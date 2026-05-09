# Typeling Agent Guidelines

Typeling is a typing-as-story-time app for Winni and Zack. Keep the product small and personal: story unlocks are the reward, WPM is tracked quietly, and kid-facing mistakes are not counted.

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
- If an issue looks wrong, say so explicitly instead of silently substituting your preferred shape.

## Stack Rules

- Bun only. Do not introduce Node, npm, ESLint, Prettier, Playwright, or a database.
- Server is Hono and must bind `127.0.0.1`, never `0.0.0.0`.
- Honour `PORT` for server ports; use the documented fallback only when it is unset.
- Frontend is React 19, Vite, Tailwind, TypeScript.
- Lint and format with Biome. `bun run lint` checks `src/`; `bun run format` formats `src/`.
- Browser automation is `agent-browser` only. Run `agent-browser --help` if unsure.

## Before Done

Run all checks that apply to your change:

```bash
bun test
bunx tsc --noEmit
bunx vite build
bun run lint
bun run format
bun run web
```

For browser-facing changes, start `bun run web`, verify with `agent-browser`, then stop the server. For format changes, run `bun run format` twice and confirm the second run makes no diff.

## Product Constraints

- Do not expand scope before Episode 1 is validated with the kid.
- Do not add deploy, server-side mid-episode save, PIN gate, replay, iPad-specific work, illustrations, eval automation, backup rotation, or third-child UI unless the issue explicitly asks.
- Typing uses document-level `keydown`, not an input element. Wrong keys flash briefly and do not advance. Backspace/Delete/arrows/modifiers/repeats are no-ops. Paste and Space prevent default browser behavior.
- WPM uses the 5-character-word convention, starts on first keystroke, pauses after 5s idle, and pauses on `visibilitychange` hidden.
- `POST /api/sessions` must be idempotent by client-generated `sessionId` and reject stale child/episode/season submissions with `409`.
- Runtime state is `data/state.json`: single-process, single-writer, Zod-validated, atomic `.tmp` to rename, with one `.bak`.
- Generated story text must be British English, kid-safe, and within `[A-Za-z0-9 .,!?'";:\-()\n]+`; violations are hard failures.

## Review Posture

Review for behavioural bugs first: broken acceptance criteria, missing lockfile/config changes, ignored negative checks, unsafe bind addresses, stale state writes, and child-facing product regressions. If no issue remains, say that plainly.
