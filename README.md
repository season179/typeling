# typeling

Typing-as-story-time app. Server is Hono on `127.0.0.1`; frontend is React 19 + Vite + Tailwind.

## Install

```bash
bun install
```

## End-to-end tests

E2E tests live in `scripts/e2e/` and use `agent-browser` (not Playwright).

### Prerequisites

```bash
npm i -g agent-browser && agent-browser install
```

### Running

Start the dev server in one terminal, then run the test:

```bash
# Terminal 1
bun run dev

# Terminal 2
bun run e2e:happy-path
bun run e2e:wrong-key
bun run e2e:idle
```

### Happy path
1. Opens the app
2. Clicks Winni's card
3. Types episode 0 correctly
4. Asserts the browser lands on the completion page
5. Asserts episode 0 is marked "completed" in the chapter map

The idle handling test:
1. Opens the app and starts episode 0
2. Types the first 10 chars, then sleeps 8 seconds (>5s idle threshold)
3. Types the rest of the episode
4. Asserts the recorded `active_ms` is significantly less than wall-clock
   elapsed, proving the idle gap was excluded

Both tests exit 0 on success and non-zero on any assertion failure.

### Wrong-key isolation

The wrong-key test:
1. Opens the app, clicks Winni, waits for the episode runner
2. Reads the next expected character, dispatches a wrong key
3. Asserts the red flash appears (polled, tolerance of timing)
4. Asserts cursorIdx did not advance
5. Dispatches the correct key; asserts cursor advances by 1

## Scripts

| Script             | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `bun run dev`      | Run Hono at `https://typeling-api.localhost` and Vite at `https://typeling.localhost` through Portless. |
| `bun run dev:direct` | Run Hono on `127.0.0.1:3001` and Vite on `127.0.0.1:5173`; override Hono with `SERVER_PORT`. |
| `bun run server`   | Run the Hono API server only.                                       |
| `bun run web`      | Run the Vite dev server only.                                       |
| `bun run lint`     | Biome check on `src/`.                                               |
| `bun run format`   | Biome format-write on `src/`.                                        |
| `bun test`         | Run the test suite.                                                  |
| `bun run e2e:happy-path` | Run the end-to-end happy path test via agent-browser.    |
| `bun run e2e:wrong-key`  | Run the wrong-key isolation test via agent-browser.      |
| `bun run e2e:idle`       | Run the end-to-end idle handling test via agent-browser. |

Runtime state is written to `data/state.json` and is gitignored. The committed `data/state.seed.json` holds the initial Winni-only defaults. On first run, copy the seed into place:

```bash
cp data/state.seed.json data/state.json
```
