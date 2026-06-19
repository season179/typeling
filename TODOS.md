# Deferred work

Items intentionally out of scope until Episode 1 is validated with the kid.

- Deploy automation beyond manual `bun run deploy`
- Server-side mid-episode save to D1 (client autosave only today)
- PIN gate, replay mode, iPad-specific UI
- Episode illustrations and eval automation
- Backup rotation for local `data/audio/`
- Third-child / third-story picker UX

# Follow-ups from architecture migrations

- Consider folding `scripts/publish-assets.ts` and `audio:publish` docs into one operator runbook once R2 promotion is routine.
- Revisit colocated `src/**/*.test.ts` files — most coverage lives under `tests/`; merge or move when touching those modules.
