import { z } from "zod";
import { evidenceSchema } from "../types.js";
import type { Budget } from "./budget.js";
import { completeWithFallback, providerId, stripFences } from "./chain.js";
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
  const log = opts.log ?? (() => {});

  async function ask(input: ExtractionInput): Promise<Attempt> {
    const request = { system: SYSTEM_PROMPT, user: buildUserPrompt(input), json: true };
    const response = await completeWithFallback(request, { ...opts, scope: "extract" });
    return { ...parseResponse(response.content, input), provider: response.provider, usage: response.usage };
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

      const provider = providerId(first.provider);
      log("extract.done", { provider, results: results.length, dropped: dropped.length, usage });
      return { results, dropped, provider, promptVersion: PROMPT_VERSION, usage };
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
