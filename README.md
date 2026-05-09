# typeling

Typing-as-story-time app. Server is Hono on `127.0.0.1`; frontend is React 19 + Vite + Tailwind.

## Install

```bash
bun install
```

## Scripts

| Script             | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `bun run dev`      | Run the Hono server (watch mode) and the Vite dev server together. |
| `bun run server`   | Run the Hono API server only.                                       |
| `bun run web`      | Run the Vite dev server only.                                       |
| `bun run lint`     | Biome check on `src/`.                                               |
| `bun run format`   | Biome format-write on `src/`.                                        |
| `bun test`         | Run the test suite.                                                  |

Runtime state is written to `data/state.json` and is gitignored. The committed `data/state.seed.json` holds the initial Winni-only defaults. On first run, copy the seed into place:

```bash
cp data/state.seed.json data/state.json
```
