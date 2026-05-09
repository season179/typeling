# TODOS

Deferred work captured during /plan-eng-review on 2026-05-09. None of these block the MVP — the goal is Winni and Zack typing Episode 1.

## Deferred (revisit after first kid sessions)

### Hosting / deploy target
**What:** Pick a deploy target (Fly.io, self-host on a Pi, or stay local-only).
**Why:** Design doc says "private family web app, local or privately deployed" but didn't pick. MVP plan goes local-only (`bun run dev` on the dev laptop) to ship fastest.
**Pros:** Removes the constraint that the kid must use the dev laptop.
**Cons:** Forces auth + secret management + deploy pipeline + persistent volume.
**Context:** If Winni or Zack want to type on a tablet or different room, this becomes urgent. Otherwise defer indefinitely.
**Depends on:** First real kid session showing the device-shape constraint matters.

### Mid-episode beforeunload save (server-side)
**What:** Add a `beforeunload` handler that POSTs current cursor + active_ms as a "draft session" the server can resume.
**Why:** localStorage autosave covers tab-close on the same browser. If the kid uses a different browser or clears localStorage, progress is lost.
**Pros:** Server-side resume across browsers / devices (when deploy lands).
**Cons:** Adds a new API route, draft-session state in state.json, and cleanup logic for orphaned drafts.
**Context:** Wait and see — for ages 5-8 on one browser, localStorage is enough.

### PIN gate on /parent
**What:** Middleware on /parent that checks a PIN in env or config.
**Why:** Server is bound to 127.0.0.1, so reachability is only an issue if Winni or Zack figure out the URL on the dev laptop.
**Pros:** Defence in depth.
**Cons:** PIN management overhead; you'll forget it.
**Context:** Add when a kid finds the URL, not before.

### Episode replay support
**What:** Allow a child to re-play a completed episode.
**Why:** Some kids enjoy re-typing favourite episodes for comfort or to chase a higher WPM.
**Pros:** Extends replay value of finished seasons.
**Cons:** Schema change (current_episode no longer monotonic); replay sessions need to NOT count toward graduation rolling-3 to avoid gaming.
**Context:** Plan currently has "current_episode only advances" as a constraint. If a kid asks, revisit.

### iPad / touch keyboard handling
**What:** Test and adapt the typing engine for an iPad's on-screen keyboard or external keyboard.
**Why:** Plan currently targets laptop browsers. iPad smart keyboards have quirks (autocorrect, predictive text bar, dictation).
**Pros:** Lets the kid use the device that's actually closest to them.
**Cons:** Document-keydown approach may need re-validation on iOS Safari.
**Context:** If a kid wants to use an iPad, this becomes the gating issue.

### Generated illustrations
**What:** Per-episode illustrations generated alongside text.
**Why:** Pure-text experience may feel plain after the novelty wears off.
**Pros:** Stronger visual reward; closer to "story book" feel.
**Cons:** Image generation cost, content-safety risk, extra parent-review surface.
**Context:** Design doc explicitly defers. Revisit if "the text loop feels too plain" after a few sessions.

### Eval suite for generation
**What:** Automated suite that runs the gen prompt against a fixture and checks: spelling, charset, content tone, episode count, word-count distribution, sentence-length distribution.
**Why:** When you change the prompt or swap models, today there's no way to know if quality regressed.
**Pros:** Confidence on prompt changes; catches model drift.
**Cons:** A fixture suite to maintain; cost per run.
**Context:** Add when the prompt changes for the second time, not before.

### state.json backup rotation
**What:** Keep last N versions of state.json on rotation, not just one .bak.
**Why:** Atomic write protects against torn writes but not against bad data. If a bug corrupts state mid-flight, having .bak2, .bak3 lets you walk back.
**Pros:** Multi-step recovery if the file is logically corrupted.
**Cons:** Disk space (negligible) and a tiny bit of code complexity.
**Context:** Acceptable risk for MVP; revisit if you ever hit a "bad state.json" situation.

### Chrome E2E tests after first kid session
**What:** E2E coverage for chapter map render, profile select, parent view layout.
**Why:** Plan deferred these because the UI will likely change after watching Winni use it. Once the UI settles, lock it down.
**Pros:** Catches regressions on the chrome surfaces.
**Cons:** Premature now; tests would be rewritten after first iteration.
**Context:** Add after Winni completes Episode 1 and the chrome UI feels right.

### Add a third child (or generalize beyond two)
**What:** UI flow to enumerate N children rather than the current Winni / Zack assumption.
**Why:** Schema already supports N children via `state.children` map; just need UI iteration.
**Pros:** Friend's kid joins, third sibling appears, etc.
**Cons:** Profile select needs to scale visually; harder to keep it simple.
**Context:** Not needed until a third kid actually wants to use it.
