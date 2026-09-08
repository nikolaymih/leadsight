import { z } from "zod";
import { BudgetExhaustedError, ProviderError } from "../errors.js";
import { evidenceSchema } from "../types.js";
import type { Budget } from "./budget.js";
import {
  addUsage,
  type DroppedPost,
  type ExtractionInput,
  type ExtractionOutput,
  type ExtractionResult,
  type Extractor,
  type TokenUsage,
} from "./extractor.js";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt.js";
import type { ChatProvider } from "./providers/provider.js";

// Provider chain with one retry per provider on retryable failures, strict output
// validation per post, and a single re-ask for posts the model got wrong.

export interface LlmExtractorOptions {
  /** Tried in order; `[groq, gemini]` in production. */
  providers: readonly ChatProvider[];
  budget: Budget;
  /** Usage events are recorded against this organization. */
  organizationId: string;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const RETRY_DELAY_MS = 2_000;

const envelopeSchema = z.object({
  results: z.array(z.object({ id: z.string(), evidence: z.unknown() })),
});

interface Attempt {
  valid: ExtractionOutput[];
  invalid: Map<string, string>; // externalId → reason
  provider: ChatProvider;
  usage: TokenUsage;
}

export function createLlmExtractor(opts: LlmExtractorOptions): Extractor {
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = opts.log ?? (() => {});

  async function ask(input: ExtractionInput): Promise<Attempt> {
    const request = { system: SYSTEM_PROMPT, user: buildUserPrompt(input), json: true };
    let lastError: ProviderError | undefined;
    let skipped = 0;

    for (const provider of opts.providers) {
      if (!(await opts.budget.canSpend(provider.name))) {
        skipped += 1;
        log("extract.budget_skip", { provider: provider.name });
        continue;
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await provider.complete(request);
          await opts.budget.record(opts.organizationId, provider.name, provider.model, response.usage);
          return { ...parseResponse(response.content, input), provider, usage: response.usage };
        } catch (err) {
          if (!(err instanceof ProviderError)) throw err;
          // Anything not retryable is our bug (bad request, auth) — fail loudly.
          if (!err.retryable) throw err;
          lastError = err;
          log("extract.provider_error", {
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
    throw lastError ?? new ProviderError("extractor", "no providers configured");
  }

  return {
    async extract(input): Promise<ExtractionResult> {
      const first = await ask(input);
      let usage = first.usage;
      const results = [...first.valid];
      const dropped: DroppedPost[] = [];

      // Re-ask once, alone, for anything malformed or missing; then drop with the reason.
      const retryPosts = input.posts.filter((p) => first.invalid.has(p.externalId));
      if (retryPosts.length > 0) {
        const second = await ask({ ...input, posts: retryPosts });
        usage = addUsage(usage, second.usage);
        results.push(...second.valid);
        for (const post of retryPosts) {
          const reason = second.invalid.get(post.externalId);
          if (reason !== undefined) dropped.push({ postExternalId: post.externalId, reason });
        }
      }

      const providerId = `${first.provider.name}/${first.provider.model}`;
      log("extract.done", { provider: providerId, results: results.length, dropped: dropped.length, usage });
      return { results, dropped, provider: providerId, promptVersion: PROMPT_VERSION, usage };
    },
  };
}

/** Validate the model's JSON per post. Never throws for a bad item; unknown ids are ignored. */
export function parseResponse(content: string, input: ExtractionInput): Pick<Attempt, "valid" | "invalid"> {
  const invalid = new Map<string, string>();
  const valid: ExtractionOutput[] = [];
  const expected = new Set(input.posts.map((p) => p.externalId));
  const criteriaKeys = new Set(input.campaign.criteria.map((c) => c.key));

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch {
    for (const id of expected) invalid.set(id, "response was not valid JSON");
    return { valid, invalid };
  }

  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    for (const id of expected) invalid.set(id, "response did not match {results: [{id, evidence}]}");
    return { valid, invalid };
  }

  const seen = new Set<string>();
  for (const item of envelope.data.results) {
    if (!expected.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);

    const evidence = evidenceSchema.safeParse(item.evidence);
    if (!evidence.success) {
      invalid.set(item.id, `evidence invalid: ${evidence.error.issues[0]?.message ?? "schema mismatch"}`);
      continue;
    }
    // Keep only the criteria we asked about; the rules engine ignores unknown keys anyway.
    const criteria = Object.fromEntries(
      Object.entries(evidence.data.criteria).filter(([key]) => criteriaKeys.has(key)),
    );
    valid.push({ postExternalId: item.id, evidence: { ...evidence.data, criteria } });
  }

  for (const id of expected) {
    if (!seen.has(id)) invalid.set(id, "missing from response");
  }
  return { valid, invalid };
}

/** Some models wrap JSON in ```json fences even in JSON mode. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return m?.[1] ?? trimmed;
}
