/**
 * The forced-alignment model used by the local aligner service and recorded as
 * provenance in word-timing sidecars. Single source of truth so the model that
 * actually runs (scripts/aligner-server.ts) and the model name stamped into the
 * sidecar (src/server/audioGeneration.ts) can never drift apart.
 *
 * Worker-safe: a plain string constant with no fs/Bun dependencies.
 */
export const ALIGNER_MODEL = "aufklarer/Qwen3-ForcedAligner-0.6B-4bit";
