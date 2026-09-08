import type { RawPost, SourceKind } from "../types.js";

// Adapter contract — see docs/design.md §3.1. Adapters receive their dependencies
// (fetch, credentials, clock) at construction through the registry, so `run` keeps
// the documented shape and tests inject a fake fetch.

export interface SourceRunResult {
  posts: RawPost[];
  /** Opaque, persisted to sources.cursor. Return it even on partial failure. */
  nextCursor: unknown;
  warnings: string[];
}

export interface Source<C = unknown> {
  readonly kind: SourceKind;
  /** Throws ValidationError on bad config. */
  validateConfig(config: unknown): C;
  /** Read-only and idempotent for a given cursor. Never throws for a single bad item. */
  run(config: C, cursor: unknown): Promise<SourceRunResult>;
  /** Best-effort: fetch the full body when only a snippet was available. Never throws. */
  hydrate?(post: RawPost): Promise<RawPost>;
}

/** Everything an adapter may touch in the outside world. Tests replace all of it. */
export interface SourceDeps {
  fetch: typeof fetch;
  userAgent: string;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  reddit: { clientId: string; clientSecret: string };
}

export const REQUEST_TIMEOUT_MS = 15_000;
