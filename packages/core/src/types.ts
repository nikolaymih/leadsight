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
