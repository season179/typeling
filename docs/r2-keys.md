# R2 Object Key Layout

Single source of truth for every key pattern stored in the
`typeling-assets` R2 bucket and consumed by the Worker, publish script,
and tests.

## Bucket

**`typeling-assets`** (configured in `wrangler.jsonc` → `r2_buckets.bucket_name`,
binding name `ASSETS_BUCKET`).

## Runtime Source Selection

Production and `wrangler dev` Worker requests read assets through
`env.ASSETS_BUCKET`. Wrangler's default local mode uses local R2 storage for
that binding; use a `remote = true` R2 binding only for an intentional smoke
test against the real bucket.

The legacy Bun server keeps the disk fallback for local family testing:
`TYPELING_SEASONS_DIR` and `TYPELING_AUDIO_DIR` still point at `seasons/` and
`data/audio/` when no `ASSETS_BUCKET` binding is present.

---

## Season JSON

| R2 key pattern                   | Local source         | Content-Type |
|----------------------------------|----------------------|--------------|
| `seasons/{seasonSlug}.json`      | `seasons/{slug}.json`| `application/json` |

### Current slugs

| Slug       | Child | File                    |
|------------|-------|-------------------------|
| `winni-s1` | Winni | `seasons/winni-s1.json` |
| `zack-s1`  | Zack  | `seasons/zack-s1.json`  |

Test slugs (`winni-s1-test`, `zack-s1-test`) are also uploaded if the
JSON files exist under `seasons/`.

The Worker resolves a season via `AssetStore.readSeason(seasonSlug)`,
which reads `seasons/{seasonSlug}.json` from R2 (or disk in legacy Bun mode).

---

## Audio artifacts

All audio artifacts live under the `audio/` prefix. The **base name**
for a given episode is `{seasonSlug}-e{episodeIdx}` (zero-indexed).

### WAV files

| R2 key pattern                          | Local source                            | Content-Type |
|-----------------------------------------|-----------------------------------------|--------------|
| `audio/{seasonSlug}-e{episodeIdx}.wav`  | `data/audio/{seasonSlug}-e{episodeIdx}.wav` | `audio/wav` |

Served by `GET /api/children/:id/episodes/:episodeIdx/audio/file`
as either a full `200` response or a ranged `206` response with
`Content-Range`.

### Word-timing sidecar

| R2 key pattern                                | Local source                                       | Content-Type |
|-----------------------------------------------|----------------------------------------------------|--------------|
| `audio/{seasonSlug}-e{episodeIdx}.words.json` | `data/audio/{seasonSlug}-e{episodeIdx}.words.json` | `application/json` |

Schema: `WordTimingSidecar` (`src/lib/wordTimings.ts`). Contains:

| Field               | Type       | Notes                                 |
|---------------------|------------|---------------------------------------|
| `seasonSlug`        | `string`   | Must match the season JSON slug       |
| `episodeIdx`        | `number`   | Zero-indexed episode number           |
| `audioPath`         | `string`   | Relative path to the WAV on disk      |
| `sourceTextPath`    | `string`   | Relative path to the source text      |
| `rawAlignmentPath`  | `string`   | Relative path to raw Qwen alignment   |
| `audioHash`         | `string`   | SHA-256 hex of WAV bytes              |
| `textHash`          | `string`   | SHA-256 hex of episode text           |
| `alignerModel`      | `string`   | Model used for forced alignment       |
| `durationSeconds`   | `number`   | Computed from WAV byte rate + data    |
| `generatedAt`       | `string`   | ISO-8601 timestamp                    |
| `words`             | `array`    | `{ index, text, start, end }[]`       |

### Build-pipeline intermediates (also uploaded)

The publish script walks `data/audio/` recursively and uploads **all**
files it finds, so intermediate build artifacts are also present in R2:

| R2 key pattern                                              | Description                     |
|-------------------------------------------------------------|---------------------------------|
| `audio/{baseName}-source.txt`                               | Extracted episode source text   |
| `audio/{baseName}-transcript.txt`                           | Speaker-labelled transcript     |
| `audio/{baseName}-styled-transcript.txt`                    | TTS-styled transcript           |
| `audio/{baseName}.meta.json`                                | WAV generation metadata         |
| `audio/{baseName}.qwen-align.raw.txt`                       | Raw forced-aligner output       |

These intermediates are **not** read by the Worker at runtime. They are
uploaded for reproducibility and debugging only.

---

## Metadata headers (idempotency)

The publish script (`scripts/publish-assets.ts`) uses a single custom
metadata header to skip unchanged uploads:

| R2 custom metadata key | Value           | Purpose                                      |
|------------------------|-----------------|----------------------------------------------|
| `sha256`               | Hex SHA-256     | `publish-assets.ts` HEADs the object; if `x-amz-meta-sha256` matches the local file hash, PUT is skipped |

Implemented in `src/lib/asset-publisher.ts` → `publishAssets()`. The R2
S3-compatible API stores custom metadata as `x-amz-meta-*` headers.

---

## Key examples

For `zack-s1` episode 0 (`baseName = zack-s1-e0`):

```
seasons/zack-s1.json
audio/zack-s1-e0.wav
audio/zack-s1-e0.words.json
audio/zack-s1-e0-source.txt
audio/zack-s1-e0-transcript.txt
audio/zack-s1-e0-styled-transcript.txt
audio/zack-s1-e0.meta.json
audio/zack-s1-e0.qwen-align.raw.txt
```

---

## Naming convention

- **`{seasonSlug}`** — matches the `slug` field in the season JSON
  (e.g. `winni-s1`, `zack-s1`). Format: `{childId}-s{seasonNumber}`.
- **`{episodeIdx}`** — zero-indexed integer matching `episode.idx` in
  the season JSON.
- **`{baseName}`** — `{seasonSlug}-e{episodeIdx}`.

All key segments use `-` (hyphen) as the separator. No `/`-delimited
subdirectories under `audio/` — files are flat.

### Cross-reference with issues

| Issue | R2 keys it reads/writes                              |
|-------|------------------------------------------------------|
| #187  | Publishes all keys above (write via `publish-assets.ts`) |
| #189  | Reads `seasons/{slug}.json` + `audio/{base}.words.json` |
| #192  | Reads `audio/{baseName}.wav` with Range header       |

---

## ⚠ Naming divergence note

Issue #187's description specifies a different audio key layout:
`audio/{seasonSlug}/e{episodeIdx}/chapter.wav`. The implemented
`publish-assets.ts` uses a flat layout mirroring `data/audio/`:
`audio/{seasonSlug}-e{episodeIdx}.wav`. **The flat layout is canonical**
— any future R2 AssetStore (#189) must match the keys that
`publish-assets.ts` actually produces.
