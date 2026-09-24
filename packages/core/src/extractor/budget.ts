import type { DbLike } from "../db/client.js";
import { appendEvent, sumLlmUsageSince, sumSearchUsageSince } from "../db/events.js";
import type { TokenUsage } from "./extractor.js";

// Budgets are account-level (one API key each), so usage is summed across organizations; the
// events still carry the org for analytics.
// - LLM tokens per provider per UTC day: a provider at ≥ 90% of its cap is skipped for the day.
// - Web search units (Exa requests, Tavily credits) per provider per UTC calendar month:
//   at ≥ 90% the provider is only used when no provider is below 90%, and web_search sources
//   back off to WEB_SEARCH_BACKOFF_MIN once every provider is there; at 100% the provider is
//   never called again until the month rolls over.

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
// Web search (Exa, Tavily): monthly budgets per provider
// ---------------------------------------------------------------------------

/**
 * `ok` below 90% of the monthly cap, `backoff` from 90%, `exhausted` at 100% (hard stop:
 * the rotator never calls that provider again until the next UTC month).
 */
export type WebSearchBudgetState = "ok" | "backoff" | "exhausted";

/** Poll interval floor for web_search sources while no provider is below 90% of its cap. */
export const WEB_SEARCH_BACKOFF_MIN = 120;
export const WEB_SEARCH_HARD_LIMIT = 1;

export interface WebSearchBudgetStore {
  usedSince(provider: string, since: Date): Promise<number>;
  record(organizationId: string, provider: string, units: number): Promise<void>;
}

export interface WebSearchProviderStatus {
  provider: string;
  usedThisMonth: number;
  monthlyCap: number | null;
  state: WebSearchBudgetState;
}

export interface WebSearchBudget {
  /** Providers this budget tracks, i.e. the configured ones, in fallback order. */
  readonly providers: readonly string[];
  state(provider: string): Promise<WebSearchBudgetState>;
  record(organizationId: string, provider: string, units: number): Promise<void>;
  status(provider: string): Promise<WebSearchProviderStatus>;
  /** True when every configured provider is at ≥ 90% (so sources should poll less often). */
  shouldBackOff(): Promise<boolean>;
}

export interface WebSearchBudgetOptions {
  store: WebSearchBudgetStore;
  /** Configured providers with their monthly cap (null = uncapped), in fallback order. */
  caps: Record<string, number | null>;
  now?: () => Date;
}

export function budgetState(used: number, cap: number | null): WebSearchBudgetState {
  if (cap === null) return "ok";
  if (used >= cap * WEB_SEARCH_HARD_LIMIT) return "exhausted";
  if (used >= cap * BUDGET_SOFT_LIMIT) return "backoff";
  return "ok";
}

export function createWebSearchBudget(opts: WebSearchBudgetOptions): WebSearchBudget {
  const now = opts.now ?? (() => new Date());
  const providers = Object.keys(opts.caps);

  async function status(provider: string): Promise<WebSearchProviderStatus> {
    const cap = opts.caps[provider] ?? null;
    const used = await opts.store.usedSince(provider, startOfUtcMonth(now()));
    return { provider, usedThisMonth: used, monthlyCap: cap, state: budgetState(used, cap) };
  }

  return {
    providers,
    status,
    state: async (provider) => (await status(provider)).state,
    record: (organizationId, provider, units) => opts.store.record(organizationId, provider, units),
    async shouldBackOff() {
      if (providers.length === 0) return false;
      const states = await Promise.all(providers.map(async (p) => (await status(p)).state));
      return states.every((s) => s !== "ok");
    },
  };
}

/**
 * The interval a web_search source should honour right now: its own while some provider is
 * under 90%, otherwise the back-off (never shorter than its own).
 */
export function webSearchPollIntervalMin(pollIntervalMin: number, backOff: boolean): number {
  return backOff ? Math.max(pollIntervalMin, WEB_SEARCH_BACKOFF_MIN) : pollIntervalMin;
}

export function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Usage lives in `events` as `search.usage` rows (`entityId` = provider); no extra table. */
export function createDbWebSearchBudgetStore(db: DbLike): WebSearchBudgetStore {
  return {
    usedSince: (provider, since) => sumSearchUsageSince(db, provider, since),
    async record(organizationId, provider, units) {
      if (units <= 0) return;
      await appendEvent(db, {
        organizationId,
        type: "search.usage",
        entityType: "provider",
        entityId: provider,
        payload: { provider, units },
      });
    },
  };
}

export function createMemoryWebSearchBudgetStore(now: () => Date = () => new Date()): WebSearchBudgetStore & {
  entries: { provider: string; at: Date; units: number }[];
} {
  const entries: { provider: string; at: Date; units: number }[] = [];
  return {
    entries,
    async usedSince(provider, since) {
      return entries.filter((e) => e.provider === provider && e.at >= since).reduce((s, e) => s + e.units, 0);
    },
    async record(_organizationId, provider, units) {
      if (units > 0) entries.push({ provider, at: now(), units });
    },
  };
}
