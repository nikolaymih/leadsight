import { BudgetExhaustedError, ProviderError } from "../errors.js";
import type { Budget } from "./budget.js";
import type { TokenUsage } from "./extractor.js";
import type { ChatProvider, ChatRequest } from "./providers/provider.js";

// The provider chain every LLM caller shares: skip providers over budget, try each in
// order, retry a retryable failure once (Retry-After or 2s), fail fast on our own bugs,
// record usage. Used by the extractor and the campaign drafter.

export interface ChainOptions {
  /** Tried in order; `[groq, gemini]` in production. */
  providers: readonly ChatProvider[];
  budget: Budget;
  /** Usage events are recorded against this organization. */
  organizationId: string;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, data: Record<string, unknown>) => void;
  /** Prefix for log events, e.g. `extract` → `extract.provider_error`. Default `llm`. */
  scope?: string;
}

export interface ChainResult {
  content: string;
  provider: ChatProvider;
  usage: TokenUsage;
}

const RETRY_DELAY_MS = 2_000;

export async function completeWithFallback(request: ChatRequest, opts: ChainOptions): Promise<ChainResult> {
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = opts.log ?? (() => {});
  const scope = opts.scope ?? "llm";
  let lastError: ProviderError | undefined;
  let skipped = 0;

  for (const provider of opts.providers) {
    if (!(await opts.budget.canSpend(provider.name))) {
      skipped += 1;
      log(`${scope}.budget_skip`, { provider: provider.name });
      continue;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await provider.complete(request);
        await opts.budget.record(opts.organizationId, provider.name, provider.model, response.usage);
        return { content: response.content, provider, usage: response.usage };
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        // Anything not retryable is our bug (bad request, auth) — fail loudly.
        if (!err.retryable) throw err;
        lastError = err;
        log(`${scope}.provider_error`, {
          provider: provider.name,
          attempt,
          status: err.status,
          message: err.message,
        });
        if (attempt === 0) await sleep(err.retryAfterMs ?? RETRY_DELAY_MS);
      }
    }
  }

  if (skipped === opts.providers.length) throw new BudgetExhaustedError(opts.providers.map((p) => p.name));
  throw lastError ?? new ProviderError(scope, "no providers configured");
}

export function providerId(provider: ChatProvider): string {
  return `${provider.name}/${provider.model}`;
}

/** Some models wrap JSON in ```json fences even in JSON mode. */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return m?.[1] ?? trimmed;
}
