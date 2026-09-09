import { z } from "zod";

// ---------------------------------------------------------------------------
// Campaign criteria — generated per campaign by the setup chat, stored as jsonb.
// The pipeline never knows what a key means; it only knows the shape.
// ---------------------------------------------------------------------------

const criterionBase = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key"),
  question: z.string().min(1),
  weight: z.number().int().min(0).max(100),
});

export const booleanCriterionSchema = criterionBase.extend({
  type: z.literal("boolean"),
});

export const enumCriterionSchema = criterionBase.extend({
  type: z.literal("enum"),
  options: z.array(z.string().min(1)).min(2),
  points: z.record(z.string(), z.number().int().min(0)),
});

export const numberCriterionSchema = criterionBase.extend({
  type: z.literal("number"),
  min: z.number(),
  max: z.number(),
});

export const criterionSchema = z.union([booleanCriterionSchema, enumCriterionSchema, numberCriterionSchema]);

export const criteriaSchema = z
  .array(criterionSchema)
  .min(1)
  .superRefine((list, ctx) => {
    const keys = new Set<string>();
    list.forEach((c, i) => {
      if (keys.has(c.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate key "${c.key}"`, path: [i, "key"] });
      }
      keys.add(c.key);

      if (c.type === "enum") {
        for (const opt of c.options) {
          if (!(opt in c.points)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `points missing for option "${opt}"`,
              path: [i, "points"],
            });
          }
        }
        for (const [opt, pts] of Object.entries(c.points)) {
          if (pts > c.weight) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `points for "${opt}" exceed weight`,
              path: [i, "points", opt],
            });
          }
        }
      }
      if (c.type === "number" && c.max <= c.min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "max must be > min", path: [i, "max"] });
      }
    });
    const total = list.reduce((s, c) => s + c.weight, 0);
    if (total !== 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `weights sum to ${total}, expected 100` });
    }
  });

export type Criterion = z.infer<typeof criterionSchema>;
export type Criteria = z.infer<typeof criteriaSchema>;

export const thresholdsSchema = z
  .object({
    hot: z.number().int().min(0).max(100),
    warm: z.number().int().min(0).max(100),
  })
  .refine((t) => t.hot > t.warm, { message: "hot must be > warm" });

export type Thresholds = z.infer<typeof thresholdsSchema>;

/**
 * Per-campaign notification settings, stored as jsonb. Email digest only for now; when a
 * chat notifier is added it gets its own optional field here and a Notifier implementation,
 * nothing else changes.
 */
export const notificationSettingsSchema = z.object({
  digestRecipients: z.array(z.string().email()).max(20),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const DEFAULT_NOTIFICATIONS: NotificationSettings = { digestRecipients: [] };

// ---------------------------------------------------------------------------
// Evidence — extractor output for one post against one campaign.
// ---------------------------------------------------------------------------

export const evidenceFieldSchema = z.object({
  value: z.union([z.boolean(), z.string(), z.number(), z.null()]),
  quote: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
});

export const evidenceSchema = z.object({
  criteria: z.record(z.string(), evidenceFieldSchema),
  disqualifier_hits: z.array(z.string()),
  summary: z.string(),
});

export type EvidenceField = z.infer<typeof evidenceFieldSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;

// ---------------------------------------------------------------------------
// Enums shared between schema and code.
// ---------------------------------------------------------------------------

export const PLATFORMS = ["reddit", "linkedin", "x", "facebook", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const SOURCE_KINDS = ["reddit_subreddit", "reddit_search", "rss"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const VERDICTS = ["hot", "warm", "cold", "insufficient", "disqualified"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const LEAD_STATUSES = ["new", "reviewed", "contacted", "replied", "won", "lost", "not_fit"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["active", "paused", "archived"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// ---------------------------------------------------------------------------
// Source configuration — one definition shared by the DB layer, the adapters and
// the API contract (which re-exports it for the web app).
// ---------------------------------------------------------------------------

export const sourceConfigSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reddit_subreddit"),
    config: z.object({ subreddit: z.string().min(1), listing: z.enum(["new", "hot"]).default("new") }),
  }),
  z.object({
    kind: z.literal("reddit_search"),
    config: z.object({
      query: z.string().min(1),
      subreddit: z.string().nullable().default(null),
      sort: z.enum(["new", "relevance"]).default("new"),
    }),
  }),
  z.object({
    kind: z.literal("rss"),
    config: z.object({ url: z.string().url(), platform: z.enum(PLATFORMS) }),
  }),
]);

export type SourceConfig = z.infer<typeof sourceConfigSchema>;

// ---------------------------------------------------------------------------
// Campaign draft — what the setup chat produces and the create endpoint accepts.
// Shared by the drafter (core), the contract and the web form.
// ---------------------------------------------------------------------------

export const campaignDraftSchema = z.object({
  name: z.string().min(1),
  offerDescription: z.string().min(1),
  icp: z.string().min(1),
  disqualifiers: z.array(z.string()),
  keywords: z.array(z.string()),
  criteria: criteriaSchema,
  thresholds: thresholdsSchema,
  suggestedSources: z.array(sourceConfigSchema),
  /** Google Alerts query strings the user creates by hand and pastes back as rss sources. */
  alertQueries: z.array(z.string()),
});

export type CampaignDraft = z.infer<typeof campaignDraftSchema>;

// ---------------------------------------------------------------------------
// A post as produced by a source adapter, before it is stored. Platform-agnostic.
// ---------------------------------------------------------------------------

export interface RawPost {
  platform: Platform;
  externalId: string;
  url: string;
  authorHandle?: string;
  authorUrl?: string;
  title?: string;
  body: string;
  /** Only a search snippet was available; hydration may fill the body later. */
  bodyIsSnippet: boolean;
  postedAt?: Date;
  /** Original payload, kept for debugging. */
  raw: unknown;
}
