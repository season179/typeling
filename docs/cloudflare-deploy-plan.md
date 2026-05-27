# Cloudflare Deploy Plan

## Overview

Typeling can run on Cloudflare Workers with R2 for asset storage and Durable Objects for state. The Worker serves both the React SPA and the Hono API from a single deployment.

## Architecture

- **Worker entry**: `src/server/index.ts` — exports `default { fetch }` and the `StateStore` Durable Object class.
- **SPA assets**: Built by Vite into `dist/client/`, served by Cloudflare's asset binding with SPA fallback.
- **API routing**: Requests matching `/api/*` hit the Worker first (`run_worker_first`); everything else falls through to static assets.
- **State**: Durable Object with SQLite storage (`StateStore` class) replaces the local `data/state.json` file.
- **Assets (R2)**: `ASSETS_BUCKET` binding for future audio/file storage.

## Configuration

See `wrangler.jsonc` for bindings and compatibility settings.

Key settings:
- `compatibility_date`: kept current.
- `compatibility_flags`: `nodejs_compat` for Hono/Node APIs.
- `assets.not_found_handling`: `single-page-application` for client-side routing.
- `assets.run_worker_first`: `["/api/*"]` so API calls always reach the Worker.

## Commands

| Command | Description |
| --- | --- |
| `bun run dev:cloud` | Local Cloudflare dev via Vite plugin (Workers runtime, no Bun server). |
| `bun run deploy` | Build the SPA and deploy to Cloudflare (`vite build && wrangler deploy`). |
| `bun run dev` | Legacy Portless HTTPS stack (Bun + Hono + Vite proxy). |

## When to use which dev mode

- **`bun run dev` (Portless)**: Full local Bun server with `data/state.json`. Use for everyday kid-facing testing — real file I/O, hot reload, easy state inspection.
- **`bun run dev:cloud`**: Workers runtime locally via `@cloudflare/vite-plugin`. Use when testing Durable Object state, R2 bindings, or Worker-specific behaviour before deploying.
- **`bun run deploy`**: Ship to Cloudflare. Requires `wrangler` auth (`wrangler login`).

## Prerequisites

- Node.js / Bun with wrangler installed as a dev dependency.
- `wrangler login` run once to authenticate.
- R2 bucket `typeling-assets` created (`wrangler r2 bucket create typeling-assets`).

## Secrets

No secrets are committed to the repo. Wrangler auth is handled via `wrangler login` or `CLOUDFLARE_API_TOKEN` in CI. The Gemini/OpenRouter API keys used for audio generation are runtime-only and not needed for the deployed app.
