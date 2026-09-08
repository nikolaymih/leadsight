import {
  CAMPAIGN_STATUSES,
  campaignDraftSchema,
  criteriaSchema,
  evidenceSchema,
  LEAD_STATUSES,
  PLATFORMS,
  sourceConfigSchema,
  thresholdsSchema,
  VERDICTS,
} from "@leadsight/core/types";
import { oc } from "@orpc/contract";
import { z } from "zod";

// The contract imports core's types entry only (`@leadsight/core/types`, Zod-only) so that the
// web bundle never pulls in core's DB/LLM/Node code through the main barrel.
// Re-exported so apps/web can validate forms without importing core.
export { campaignDraftSchema, criteriaSchema, sourceConfigSchema, thresholdsSchema };

// ---------------------------------------------------------------------------
// Shared schemas (wire shapes; DB rows are mapped to these in the api layer)
// ---------------------------------------------------------------------------

const id = z.string().uuid();
const isoDate = z.string().datetime();

export const campaignSchema = z.object({
  id,
  name: z.string(),
  status: z.enum(CAMPAIGN_STATUSES),
  offerDescription: z.string(),
  icp: z.string(),
  disqualifiers: z.array(z.string()),
  keywords: z.array(z.string()),
  criteria: criteriaSchema,
  rulesVersion: z.number().int(),
  thresholds: thresholdsSchema,
  minConfidence: z.number().int(),
  minScoreAlert: z.number().int(),
  fewshotLimit: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const sourceSchema = z
  .object({
    id,
    campaignId: id,
    enabled: z.boolean(),
    lastRunAt: isoDate.nullable(),
    lastError: z.string().nullable(),
    pollIntervalMin: z.number().int(),
    postsLast24h: z.number().int(),
  })
  .and(sourceConfigSchema);

export const postSchema = z.object({
  id,
  platform: z.enum(PLATFORMS),
  url: z.string(),
  authorHandle: z.string().nullable(),
  authorUrl: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string(),
  bodyIsSnippet: z.boolean(),
  postedAt: isoDate.nullable(),
});

export const leadSummarySchema = z.object({
  id,
  campaignId: id,
  verdict: z.enum(VERDICTS),
  score: z.number().int(),
  confidence: z.number().int(),
  summary: z.string(),
  status: z.enum(LEAD_STATUSES),
  assigneeId: z.string().nullable(),
  scoredAt: isoDate,
  post: postSchema.pick({
    id: true,
    platform: true,
    url: true,
    authorHandle: true,
    title: true,
    postedAt: true,
  }),
});

export const leadDetailSchema = leadSummarySchema.extend({
  evidence: evidenceSchema,
  scoreBreakdown: z.record(z.string(), z.number()),
  extractorProvider: z.string(),
  promptVersion: z.string(),
  rulesVersion: z.number().int(),
  post: postSchema,
  notes: z.array(
    z.object({ id, userId: z.string(), userName: z.string(), body: z.string(), createdAt: isoDate }),
  ),
});

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const pipelineRunSchema = z.object({
  id,
  startedAt: isoDate,
  durationMs: z.number().int(),
  counts: z.object({
    polled: z.number().int(),
    prefiltered: z.number().int(),
    hydrated: z.number().int(),
    extracted: z.number().int(),
    scored: z.number().int(),
    notified: z.number().int(),
  }),
  errors: z.array(z.string()),
  perSource: z.array(
    z.object({ sourceId: id, name: z.string(), posts: z.number().int(), error: z.string().nullable() }),
  ),
});

// ---------------------------------------------------------------------------
// Errors shared by every procedure
// ---------------------------------------------------------------------------

const base = oc.errors({
  UNAUTHORIZED: { message: "Sign in required" },
  FORBIDDEN: { message: "Not allowed for this organization" },
  NOT_FOUND: { message: "Not found" },
});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export const contract = {
  campaigns: {
    list: base.route({ method: "GET", path: "/campaigns" }).output(z.array(campaignSchema)),

    get: base
      .route({ method: "GET", path: "/campaigns/{id}" })
      .input(z.object({ id }))
      .output(campaignSchema),

    draft: base
      .route({ method: "POST", path: "/campaigns/draft" })
      .input(
        z.object({
          messages: z.array(chatMessageSchema).min(1),
          urls: z.array(z.string().url()).default([]),
        }),
      )
      .output(z.object({ reply: z.string(), draft: campaignDraftSchema.nullable() })),

    create: base
      .route({ method: "POST", path: "/campaigns" })
      .input(campaignDraftSchema.omit({ alertQueries: true }))
      .output(campaignSchema),

    update: base
      .route({ method: "PATCH", path: "/campaigns/{id}" })
      .input(
        z.object({ id }).merge(
          campaignSchema
            .pick({
              name: true,
              status: true,
              offerDescription: true,
              icp: true,
              disqualifiers: true,
              keywords: true,
              criteria: true,
              thresholds: true,
              minConfidence: true,
              minScoreAlert: true,
              fewshotLimit: true,
            })
            .partial(),
        ),
      )
      .output(campaignSchema),

    /** Re-run rules over stored evidence. No LLM call. */
    rescore: base
      .route({ method: "POST", path: "/campaigns/{id}/rescore" })
      .input(z.object({ id }))
      .output(z.object({ rescored: z.number().int(), moved: z.record(z.enum(VERDICTS), z.number().int()) })),

    /** Preview verdict movement for edited criteria/thresholds without saving. */
    previewRescore: base
      .route({ method: "POST", path: "/campaigns/{id}/rescore/preview" })
      .input(
        z.object({
          id,
          criteria: criteriaSchema,
          thresholds: thresholdsSchema,
          minConfidence: z.number().int(),
        }),
      )
      .output(z.object({ total: z.number().int(), byVerdict: z.record(z.enum(VERDICTS), z.number().int()) })),
  },

  sources: {
    list: base
      .route({ method: "GET", path: "/campaigns/{campaignId}/sources" })
      .input(z.object({ campaignId: id }))
      .output(z.array(sourceSchema)),

    create: base
      .route({ method: "POST", path: "/campaigns/{campaignId}/sources" })
      .input(
        z
          .object({ campaignId: id, pollIntervalMin: z.number().int().min(5).default(60) })
          .and(sourceConfigSchema),
      )
      .output(sourceSchema),

    update: base
      .route({ method: "PATCH", path: "/sources/{id}" })
      .input(
        z.object({
          id,
          enabled: z.boolean().optional(),
          pollIntervalMin: z.number().int().min(5).optional(),
        }),
      )
      .output(sourceSchema),

    remove: base
      .route({ method: "DELETE", path: "/sources/{id}" })
      .input(z.object({ id }))
      .output(z.object({ ok: z.literal(true) })),

    run: base
      .route({ method: "POST", path: "/sources/{id}/run" })
      .input(z.object({ id }))
      .output(z.object({ posts: z.number().int(), warnings: z.array(z.string()) })),
  },

  leads: {
    list: base
      .route({ method: "GET", path: "/leads" })
      .input(
        z.object({
          campaignId: id,
          verdict: z.array(z.enum(VERDICTS)).optional(),
          status: z.array(z.enum(LEAD_STATUSES)).optional(),
          platform: z.array(z.enum(PLATFORMS)).optional(),
          assigneeId: z.string().optional(),
          minScore: z.number().int().min(0).max(100).optional(),
          sort: z.enum(["rank", "newest", "confidence"]).default("rank"),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50),
        }),
      )
      .output(z.object({ items: z.array(leadSummarySchema), nextCursor: z.string().nullable() })),

    get: base.route({ method: "GET", path: "/leads/{id}" }).input(z.object({ id })).output(leadDetailSchema),

    update: base
      .route({ method: "PATCH", path: "/leads/{id}" })
      .input(
        z.object({
          id,
          status: z.enum(LEAD_STATUSES).optional(),
          assigneeId: z.string().nullable().optional(),
          /** Reviewer note attached to the label when status is won/lost/not_fit. */
          labelNote: z.string().optional(),
        }),
      )
      .output(leadSummarySchema),

    bulkUpdate: base
      .route({ method: "PATCH", path: "/leads" })
      .input(
        z.object({
          ids: z.array(id).min(1).max(200),
          status: z.enum(LEAD_STATUSES).optional(),
          assigneeId: z.string().nullable().optional(),
        }),
      )
      .output(z.object({ updated: z.number().int() })),

    addNote: base
      .route({ method: "POST", path: "/leads/{id}/notes" })
      .input(z.object({ id, body: z.string().min(1) }))
      .output(leadDetailSchema.shape.notes.element),
  },

  runs: {
    list: base
      .route({ method: "GET", path: "/runs" })
      .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
      .output(z.array(pipelineRunSchema)),

    budget: base.route({ method: "GET", path: "/runs/budget" }).output(
      z.array(
        z.object({
          provider: z.string(),
          tokensUsedToday: z.number().int(),
          dailyCap: z.number().int().nullable(),
        }),
      ),
    ),
  },
};

export type Contract = typeof contract;
