import type { DbLike } from "../db/client.js";
import { appendEvent, sumLlmUsageSince } from "../db/events.js";
import type { TokenUsage } from "./extractor.js";

// Daily token budget per provider. Caps are account-level (one API key per provider),
// so usage is summed across organizations; the events still carry the org for analytics.
// When the primary is near its cap we skip it for the day rather than silently failing.

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
