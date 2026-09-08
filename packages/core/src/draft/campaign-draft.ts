import { z } from "zod";
import { ProviderError } from "../errors.js";
import { type ChainOptions, completeWithFallback, providerId, stripFences } from "../extractor/chain.js";
import { addUsage, type TokenUsage } from "../extractor/extractor.js";
import { type CampaignDraft, campaignDraftSchema } from "../types.js";
import { fetchPages } from "./fetch-pages.js";
import { buildDraftPrompt, type ChatMessage, DRAFT_PROMPT_VERSION, DRAFT_SYSTEM_PROMPT } from "./prompt.js";

// Setup chat → draft (design.md §5). One LLM call over the conversation plus any pasted
// pages; the answer is normalised (snake_case keys, weights that don't quite sum to 100,
// enum points over weight) and validated with campaignDraftSchema. An invalid draft is
// re-asked once with the validation issues; a second failure surfaces as a provider error.

export interface DraftInput {
  messages: readonly ChatMessage[];
  urls?: readonly string[];
}

export interface DraftResult {
  reply: string;
  draft: CampaignDraft | null;
  provider: string;
  promptVersion: string;
  usage: TokenUsage;
  warnings: string[];
}

export interface CampaignDrafter {
  draft(input: DraftInput): Promise<DraftResult>;
}

export type CampaignDrafterOptions = ChainOptions & { fetch: typeof fetch; userAgent: string };

const envelopeSchema = z.object({ reply: z.string().min(1), draft: z.unknown().nullable() });

export function createCampaignDrafter(opts: CampaignDrafterOptions): CampaignDrafter {
  const chain: ChainOptions = { ...opts, scope: "draft" };

  return {
    async draft(input) {
      const fetched = await fetchPages(input.urls ?? [], { fetch: opts.fetch, userAgent: opts.userAgent });
      const user = buildDraftPrompt({ messages: input.messages, pages: fetched.pages });

      const first = await completeWithFallback({ system: DRAFT_SYSTEM_PROMPT, user, json: true }, chain);
      let usage = first.usage;
      let parsed = parseDraftResponse(first.content);

      if (!parsed.ok) {
        const retryPrompt = `${user}\n\n## Your previous answer was rejected\n${parsed.issues
          .map((i) => `- ${i}`)
          .join("\n")}\nReturn the corrected JSON object only.`;
        const second = await completeWithFallback(
          { system: DRAFT_SYSTEM_PROMPT, user: retryPrompt, json: true },
          chain,
        );
        usage = addUsage(usage, second.usage);
        parsed = parseDraftResponse(second.content);
        if (!parsed.ok) {
          throw new ProviderError(
            first.provider.name,
            `model returned an invalid draft: ${parsed.issues.join("; ")}`,
            {
              retryable: false,
            },
          );
        }
      }

      return {
        reply: parsed.reply,
        draft: parsed.draft,
        provider: providerId(first.provider),
        promptVersion: DRAFT_PROMPT_VERSION,
        usage,
        warnings: fetched.warnings,
      };
    },
  };
}

type Parsed = { ok: true; reply: string; draft: CampaignDraft | null } | { ok: false; issues: string[] };

export function parseDraftResponse(content: string): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(content));
  } catch {
    return { ok: false, issues: ["response was not valid JSON"] };
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success)
    return { ok: false, issues: ['response must be {"reply": string, "draft": object | null}'] };
  if (envelope.data.draft === null) return { ok: true, reply: envelope.data.reply, draft: null };

  const draft = campaignDraftSchema.safeParse(normalizeDraft(envelope.data.draft));
  if (!draft.success) {
    return { ok: false, issues: draft.error.issues.map((i) => `draft.${i.path.join(".")}: ${i.message}`) };
  }
  return { ok: true, reply: envelope.data.reply, draft: draft.data };
}

// ---------------------------------------------------------------------------
// Normalisation: forgive the model's common slips before the strict schema runs.
// ---------------------------------------------------------------------------

const KEY_ALIASES: Record<string, string> = {
  offer_description: "offerDescription",
  ideal_poster: "icp",
  suggested_sources: "suggestedSources",
  alert_queries: "alertQueries",
};

export function normalizeDraft(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const d: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) d[KEY_ALIASES[key] ?? key] = value;

  return {
    ...d,
    disqualifiers: stringArray(d.disqualifiers),
    keywords: stringArray(d.keywords),
    alertQueries: stringArray(d.alertQueries),
    suggestedSources: Array.isArray(d.suggestedSources) ? d.suggestedSources : [],
    thresholds: isRecord(d.thresholds) ? d.thresholds : { hot: 70, warm: 40 },
    criteria: Array.isArray(d.criteria) ? normalizeCriteria(d.criteria) : d.criteria,
  };
}

type CriterionDraft = Record<string, unknown> & { weight: number | undefined };

function normalizeCriteria(list: unknown[]): unknown[] {
  const items: CriterionDraft[] = list.filter(isRecord).map((c) => ({
    ...c,
    key: typeof c.key === "string" ? snakeCase(c.key) : c.key,
    weight: toInt(c.weight),
  }));

  // Weights must sum to exactly 100: scale proportionally, then put the rounding
  // remainder on the heaviest criterion.
  const total = items.reduce((s, c) => s + (c.weight ?? 0), 0);
  if (total > 0 && total !== 100) {
    let scaledSum = 0;
    for (const c of items) {
      c.weight = Math.round(((c.weight ?? 0) * 100) / total);
      scaledSum += c.weight;
    }
    const heaviest = items.reduce((a, b) => ((b.weight ?? 0) > (a.weight ?? 0) ? b : a), items[0]);
    if (heaviest && heaviest.weight !== undefined) heaviest.weight += 100 - scaledSum;
  }

  // Enum points: every option gets an entry, none above the weight.
  for (const c of items) {
    if (c.type !== "enum" || !Array.isArray(c.options)) continue;
    const points = isRecord(c.points) ? c.points : {};
    const weight = c.weight ?? 0;
    const options = (c.options as unknown[]).filter((o): o is string => typeof o === "string");
    c.points = Object.fromEntries(options.map((o) => [o, Math.min(toInt(points[o]) ?? 0, weight)]));
  }
  return items;
}

function snakeCase(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c_$1");
}

function toInt(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
