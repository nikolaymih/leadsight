import type { DbLike } from "../db/client.js";
import { appendEvent, sumLlmUsageSince, sumSearchUsageSince } from "../db/events.js";
import type { TokenUsage } from "./extractor.js";

// Daily budgets, all per UTC day and account-level (one API key each), so usage is summed
// across organizations; the events still carry the org for analytics.
// - LLM tokens per provider: a provider at ≥ 90% of its cap is skipped for the day.
// - Google Programmable Search queries: at ≥ 90% of the cap, google_search sources back off
//   to SEARCH_BACKOFF_MIN until the counter resets at midnight UTC.

export const BUDGET_SOFT_LIMIT = 0.9;

export interface BudgetStore {
  usedSince(provider: string, since: Date): Promise<number>;
  record(organizationId: string, provider: string, model: string, usage: TokenUsage): Promise<void>;
}

export interface Budget {
  /** False when the provider has spent ≥ 90% of its daily cap. Always true without a cap. */
  canSpend(provider: string): Promise<boolean>;
  record(organizationId: string, provider: string, model: string, usage: TokenUsage): Promise<void>;
  /** For the runs/budget endpoint. */
  status(provider: string): Promise<{ tokensUsedToday: number; dailyCap: number | null }>;
}

export interface BudgetOptions {
  store: BudgetStore;
  /** Tokens per UTC day, or null/undefined for uncapped. */
  caps: Record<string, number | null | undefined>;
  now?: () => Date;
}

export function createBudget(opts: BudgetOptions): Budget {
  const now = opts.now ?? (() => new Date());

  const used = (provider: string) => opts.store.usedSince(provider, startOfUtcDay(now()));

  return {
    async canSpend(provider) {
      const cap = opts.caps[provider];
      if (cap === null || cap === undefined) return true;
      return (await used(provider)) < cap * BUDGET_SOFT_LIMIT;
    },
    record: (organizationId, provider, model, usage) =>
      opts.store.record(organizationId, provider, model, usage),
    async status(provider) {
      return { tokensUsedToday: await used(provider), dailyCap: opts.caps[provider] ?? null };
    },
  };
}

/** Usage lives in `events` as `llm.usage` rows; no extra table. */
export function createDbBudgetStore(db: DbLike): BudgetStore {
  return {
    usedSince: (provider, since) => sumLlmUsageSince(db, provider, since),
    async record(organizationId, provider, model, usage) {
      await appendEvent(db, {
        organizationId,
        type: "llm.usage",
        entityType: "provider",
        entityId: provider,
        payload: {
          provider,
          model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.promptTokens + usage.completionTokens,
        },
      });
    },
  };
}

/** In-memory store for tests and one-off scripts. */
export function createMemoryBudgetStore(): BudgetStore & {
  entries: { provider: string; at: Date; total: number }[];
} {
  const entries: { provider: string; at: Date; total: number }[] = [];
  return {
    entries,
    async usedSince(provider, since) {
      return entries.filter((e) => e.provider === provider && e.at >= since).reduce((s, e) => s + e.total, 0);
    },
    async record(_organizationId, provider, _model, usage) {
      entries.push({ provider, at: new Date(), total: usage.promptTokens + usage.completionTokens });
    },
  };
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Search queries (Google Programmable Search JSON API; free tier = 100 queries/day)
// ---------------------------------------------------------------------------

export const SEARCH_PROVIDER = "google_cse";
/** Poll interval forced on google_search sources while the query budget is nearly spent. */
export const SEARCH_BACKOFF_MIN = 120;
export const DEFAULT_SEARCH_DAILY_QUERIES = 100;

export interface SearchBudgetStore {
  usedSince(since: Date): Promise<number>;
  record(organizationId: string, queries: number): Promise<void>;
}

export interface SearchBudget {
  /** False at ≥ 90% of the daily cap. Always true without a cap. */
  canQuery(): Promise<boolean>;
  record(organizationId: string, queries: number): Promise<void>;
  status(): Promise<{ queriesUsedToday: number; dailyCap: number | null }>;
}

export interface SearchBudgetOptions {
  store: SearchBudgetStore;
  /** Queries per UTC day, or null for uncapped. */
  dailyCap: number | null;
  now?: () => Date;
}

export function createSearchBudget(opts: SearchBudgetOptions): SearchBudget {
  const now = opts.now ?? (() => new Date());
  const used = () => opts.store.usedSince(startOfUtcDay(now()));
  return {
    async canQuery() {
      if (opts.dailyCap === null) return true;
      return (await used()) < opts.dailyCap * BUDGET_SOFT_LIMIT;
    },
    record: (organizationId, queries) => opts.store.record(organizationId, queries),
    async status() {
      return { queriesUsedToday: await used(), dailyCap: opts.dailyCap };
    },
  };
}

/**
 * The interval a google_search source should honour right now: its own while queries are
 * available, otherwise the back-off (never shorter than its own).
 */
export function searchPollIntervalMin(pollIntervalMin: number, budgetOk: boolean): number {
  return budgetOk ? pollIntervalMin : Math.max(pollIntervalMin, SEARCH_BACKOFF_MIN);
}

/** Usage lives in `events` as `search.usage` rows; no extra table. */
export function createDbSearchBudgetStore(db: DbLike): SearchBudgetStore {
  return {
    usedSince: (since) => sumSearchUsageSince(db, SEARCH_PROVIDER, since),
    async record(organizationId, queries) {
      if (queries <= 0) return;
      await appendEvent(db, {
        organizationId,
        type: "search.usage",
        entityType: "provider",
        entityId: SEARCH_PROVIDER,
        payload: { provider: SEARCH_PROVIDER, queries },
      });
    },
  };
}

export function createMemorySearchBudgetStore(now: () => Date = () => new Date()): SearchBudgetStore & {
  entries: { at: Date; queries: number }[];
} {
  const entries: { at: Date; queries: number }[] = [];
  return {
    entries,
    async usedSince(since) {
      return entries.filter((e) => e.at >= since).reduce((s, e) => s + e.queries, 0);
    },
    async record(_organizationId, queries) {
      entries.push({ at: now(), queries });
    },
  };
}
