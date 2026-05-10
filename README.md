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
```

The happy-path test:
1. Opens the app
2. Clicks Winni's card
3. Types episode 0 correctly
4. Asserts the browser lands on the completion page
5. Asserts episode 0 is marked "completed" in the chapter map

The test exits 0 on success and non-zero on any assertion failure.

## Scripts

| Script             | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `bun run dev`      | Run the Hono server (watch mode) and the Vite dev server together. |
| `bun run server`   | Run the Hono API server only.                                       |
| `bun run web`      | Run the Vite dev server only.                                       |
| `bun run lint`     | Biome check on `src/`.                                               |
| `bun run format`   | Biome format-write on `src/`.                                        |
| `bun test`         | Run the test suite.                                                  |
| `bun run e2e:happy-path` | Run the end-to-end happy path test via agent-browser.    |

Runtime state is written to `data/state.json` and is gitignored. The committed `data/state.seed.json` holds the initial Winni-only defaults. On first run, copy the seed into place:

```bash
cp data/state.seed.json data/state.json
```
