# Typeling — Project Conventions

A typing-as-story-time web app for two kids (Winni, Zack). Each child gets a 14-episode season; correctly typing the current episode unlocks the next. WPM is tracked but never shown to the kid.

**Source-of-truth artifacts** (read before changing direction):
- Design doc: `~/.gstack/projects/typeling/season-main-design-20260508-235214.md`
- Locked implementation plan: `~/.gstack/projects/typeling/season-main-implementation-plan-20260509-090553.md`
- Test plan: `~/.gstack/projects/typeling/season-main-eng-review-test-plan-20260509-090553.md`
- Deferred work: `./TODOS.md`

If a decision in this file conflicts with the implementation plan, the plan wins — update this file to match.

## Stack

- **Runtime:** Bun (server + scripts + tests). No Node.
- **Server:** Hono. **Bind to `127.0.0.1`, never `0.0.0.0`** — `/parent` must not be LAN-reachable.
- **Frontend:** React 18 + TypeScript + Vite + Tailwind. Dev = Vite proxy to Hono; prod = `vite build` → Hono serves `dist/` static + `/api/*`.
- **Validation:** Zod, everywhere data crosses a boundary (HTTP, file I/O, generation output).
- **Lint/format:** Biome.
- **Tests:** `bun test` for unit; `agent-browser` for E2E. **Do not use Playwright** — global rule.

## Persistence — JSON file, not SQLite

State lives in `./data/state.json`. There is no database. Single-process, single-writer.

- All writes go through one helper that does **atomic write**: write `state.json.tmp` → `fs.rename` to `state.json`. Keep one `.bak` of the prior version.
- Read-modify-write must be serialised in-process (one in-flight write at a time).
- Schema is Zod-validated on every read and every write.

`state.json` shape:
```json
{
  "children": {
    "winni": {
      "name": "Winni",
      "theme": "pink unicorn",
      "target_wpm": 15,
      "active_season": "winni-s1",
      "current_episode": 0,
      "current_session_id": null
    }
  },
  "sessions": [
    {
      "id": "uuid",
      "child_id": "winni",
      "season_slug": "winni-s1",
      "episode_idx": 0,
      "wpm": 18.4,
      "char_count": 412,
      "active_ms": 134000,
      "started_at": "2026-05-09T...",
      "finished_at": "2026-05-09T..."
    }
  ]
}
```

Seasons themselves are JSON files in `./seasons/<slug>.json`, committed to the repo. Parent reviews via `git diff` before merging.

## Charset — intentionally narrow, not "ASCII because lazy"

Episode text is restricted to `[A-Za-z0-9 .,!?'";:\-()\n]+` — straight quotes, hyphens, normal punctuation. Smart quotes, em dashes, ellipses, and any non-ASCII are stripped/normalised. This is a **kid-typability choice**, not an implementation shortcut. The generation pipeline asserts charset after normalisation; a charset failure is a hard error, not a warning.

## British spelling

Generation prompt asks for British English. Post-process runs an American→British dictionary (`color`→`colour`, `organize`→`organise`, `defense`→`defence`, `behavior`→`behaviour`, `favorite`→`favourite`, `traveled`→`travelled`, etc.). Eval suite asserts zero American tokens remain. Add to dictionary when you spot a miss; don't bypass.

## Typing engine — strict correction, no backspace

- Document-level `keydown` listener (single-page focus model, no input element).
- Correct char → cursor advances, char joins the "typed" region (rendered in a different shade).
- Wrong char → cursor flashes red ~200ms, **does not advance**. No mistake counter is rendered.
- Backspace, Delete, arrows, function keys, modifiers: no-op.
- Paste / `Cmd+V`: `preventDefault`, ignored.
- `event.repeat`: ignored (held-down keys don't auto-type).
- Space: `preventDefault` (don't scroll the page).
- Case-sensitive: `T` ≠ `t`.

## WPM spec

5-character-word convention. Timer starts at first keystroke, stops at last. **Idle pause: 5 seconds with no keystroke pauses the active-typing timer; resume on next keystroke.** `visibilitychange → hidden` also pauses. Recorded WPM = `(char_count / 5) / (active_ms / 60000)`. Clock-time WPM is wrong and not stored.

## Idempotency on POST /api/sessions

Client generates `sessionId` (crypto.randomUUID) at episode start. Server:
1. Zod-validate body.
2. If `sessionId` already in `sessions[]`, return prior result (idempotent).
3. Verify `episode_idx === child.current_episode` and `season_slug === child.active_season`. Mismatch → 409.
4. Append session, advance `current_episode` (or freeze at 13 if just finished episode 13), atomic write.

## Mid-episode resume

`localStorage` autosave on every keystroke (`{ sessionId, cursorIdx, activeMs, lastKeystrokeAt }`, keyed by child + episode). On `/play/:childId` mount, restore if same child + same episode + same season. Cleared on completion.

Server-side `beforeunload` POST is deferred — see TODOS.md.

## Word-count budget per episode

`min = max(50, target_wpm × 5)`, `max = min(400, target_wpm × 15)`. Targets ~5–15 minutes of typing for the child's current speed. Generation prompt receives these numbers; eval suite asserts each episode falls in range.

## Content guardrails

Generation prompt forbids: death, killing, hate, scary/blood/gore, shame language, anything punitive. Post-gen blacklist regex catches misses. A blacklist hit is a hard fail — regenerate, don't patch.

## File layout

```
data/state.json            # runtime state (gitignored)
seasons/<slug>.json        # committed episode content
scripts/gen-season.ts      # generation pipeline
src/server/                # Hono routes, state.json helpers
src/lib/                   # shared zod schemas, normalize, dictionary, wpm, rolling-3
src/web/                   # React app (profile select, runner, parent view)
tests/                     # bun test files for load-bearing logic
```

Lane parallelisation (after shared schema+lib lands): see implementation plan §Worktree Parallelisation.

## Test strategy — load-bearing logic only

Unit tests cover: Zod schemas, EpisodeRunner reducer, WPM calc with idle-pause, American→British dictionary, charset normalize, rolling-3 graduation. Three `agent-browser` E2E tests for the typing engine (correct flow, wrong-key isolation, idle handling). **Chrome surfaces (chapter map, profile select, parent view) intentionally not E2E-tested yet** — wait until UI settles after Winni's first real session, then lock down. See TODOS.md.

## Things we are NOT building (yet)

See `./TODOS.md`. Highlights: deploy target, server-side mid-episode save, PIN gate on `/parent`, episode replay, iPad support, illustrations, eval-suite automation, state.json backup rotation, third-child UI. Don't add these without revisiting the plan.

## Working with the design

The design doc has an "Assignment" section directing the parent to validate Episode 1 with the kid before scope grows. Treat that as a gate: if you find yourself wanting to expand chrome, polish the parent view, or add features beyond what's in the locked plan, stop and ask whether Episode 1 has actually been kid-tested.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

- Product ideas/brainstorming → /office-hours
- Strategy/scope → /plan-ceo-review
- Architecture → /plan-eng-review
- Design system/plan review → /design-consultation or /plan-design-review
- Full review pipeline → /autoplan
- Bugs/errors → /investigate
- QA/testing site behavior → /qa or /qa-only
- Code review/diff check → /review
- Visual polish → /design-review
- Ship/deploy/PR → /ship or /land-and-deploy
- Save progress → /context-save
- Resume context → /context-restore
