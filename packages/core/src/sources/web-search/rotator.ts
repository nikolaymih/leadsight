import { ProviderError } from "../../errors.js";
import { startOfUtcMonth, type WebSearchBudget } from "../../extractor/budget.js";
import type { WebSearchUsage } from "../source.js";
import type { SearchFailureKind, SearchHit, SearchProvider, SearchRequest } from "./provider.js";

// Chooses which provider serves a query. Order of preference:
//   1. providers under 90% of their monthly cap, rotated round-robin across calls so both
//      free tiers are spent evenly;
//   2. providers in back-off (90–100%), same rotation;
//   never providers at 100% (hard stop) or cooling down after a failure.
// A failed call falls through to the next candidate in the same request. Cooldowns are
// in-memory: quota → until the next UTC month, rate limit → 15 min, auth → 60 min, anything
// else → no cooldown. Usage is only counted for successful calls (failed requests are not
// billed by either provider) and returned to the caller; the pipeline books it.

export const RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
export const AUTH_COOLDOWN_MS = 60 * 60_000;

export interface RotatorResult {
  hits: SearchHit[];
  provider: string;
  usage: WebSearchUsage[];
}

/** No provider could be asked: all at 100% or cooling down. Not an error; the source skips. */
export interface RotatorSkipped {
  skipped: true;
  reason: string;
}

export interface SearchRotator {
  readonly providers: readonly string[];
  search(request: SearchRequest): Promise<RotatorResult | RotatorSkipped>;
}

/** Every candidate failed. Carries the per-provider reasons. */
export class WebSearchUnavailableError extends ProviderError {
  constructor(
    readonly failures: readonly { provider: string; failure: SearchFailureKind; message: string }[],
  ) {
    super(
      "web_search",
      `all providers failed: ${failures.map((f) => `${f.provider} (${f.failure}): ${f.message}`).join("; ")}`,
      {
        retryable: failures.some((f) => f.failure === "transient" || f.failure === "rate_limit"),
      },
    );
    this.name = "WebSearchUnavailableError";
  }
}

export interface SearchRotatorOptions {
  /** Configured providers in fallback order. */
  providers: readonly SearchProvider[];
  budget?: WebSearchBudget;
  now?: () => Date;
}

export function createSearchRotator(opts: SearchRotatorOptions): SearchRotator {
  const now = opts.now ?? (() => new Date());
  const cooldownUntil = new Map<string, number>();
  let turn = 0;

  async function candidates(): Promise<{ provider: SearchProvider; tier: 0 | 1 }[]> {
    const at = now().getTime();
    const out: { provider: SearchProvider; tier: 0 | 1 }[] = [];
    for (const provider of opts.providers) {
      if ((cooldownUntil.get(provider.name) ?? 0) > at) continue;
      const state = opts.budget ? await opts.budget.state(provider.name) : "ok";
      if (state === "exhausted") continue;
      out.push({ provider, tier: state === "ok" ? 0 : 1 });
    }
    // Rotate the starting point, then keep under-budget providers ahead of backed-off ones.
    const n = out.length;
    const rotated = n > 0 ? [...out.slice(turn % n), ...out.slice(0, turn % n)] : out;
    turn += 1;
    return rotated.sort((a, b) => a.tier - b.tier);
  }

  function coolDown(provider: string, failure: SearchFailureKind): void {
    const at = now();
    if (failure === "quota") {
      const next = startOfUtcMonth(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)));
      cooldownUntil.set(provider, next.getTime());
    } else if (failure === "rate_limit") {
      cooldownUntil.set(provider, at.getTime() + RATE_LIMIT_COOLDOWN_MS);
    } else if (failure === "auth") {
      cooldownUntil.set(provider, at.getTime() + AUTH_COOLDOWN_MS);
    }
  }

  return {
    providers: opts.providers.map((p) => p.name),
    async search(request) {
      const list = await candidates();
      if (list.length === 0) {
        return {
          skipped: true,
          reason:
            opts.providers.length === 0
              ? "no web search provider configured"
              : "web search budget: every provider is at its monthly cap or cooling down; skipped",
        };
      }

      const failures: { provider: string; failure: SearchFailureKind; message: string }[] = [];
      for (const { provider } of list) {
        try {
          const res = await provider.search(request);
          return {
            hits: res.hits,
            provider: provider.name,
            usage: [{ provider: provider.name, units: res.units }],
          };
        } catch (err) {
          const failure: SearchFailureKind =
            typeof err === "object" && err !== null && "failure" in err
              ? (err.failure as SearchFailureKind)
              : "transient";
          coolDown(provider.name, failure);
          failures.push({
            provider: provider.name,
            failure,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      throw new WebSearchUnavailableError(failures);
    },
  };
}
