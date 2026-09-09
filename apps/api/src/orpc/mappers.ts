import type {
  campaignSchema,
  leadDetailSchema,
  leadSummarySchema,
  pipelineRunSchema,
  postSchema,
  sourceSchema,
} from "@leadsight/contract";
import {
  type LeadDetail,
  type LeadNoteWithUser,
  type LeadWithPost,
  type OrgRunReport,
  type SourceWithStats,
  type schema,
  sourceConfigSchema,
} from "@leadsight/core";
import type { z } from "zod";

// DB rows → wire shapes. Pure; dates become ISO strings; nothing here touches the DB.

export type CampaignWire = z.infer<typeof campaignSchema>;
export type SourceWire = z.infer<typeof sourceSchema>;
export type PostWire = z.infer<typeof postSchema>;
export type LeadSummaryWire = z.infer<typeof leadSummarySchema>;
export type LeadDetailWire = z.infer<typeof leadDetailSchema>;
export type PipelineRunWire = z.infer<typeof pipelineRunSchema>;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export function toCampaign(row: schema.Campaign): CampaignWire {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    offerDescription: row.offerDescription,
    icp: row.icp,
    disqualifiers: row.disqualifiers,
    keywords: row.keywords,
    criteria: row.criteria,
    rulesVersion: row.rulesVersion,
    thresholds: row.thresholds,
    minConfidence: row.minConfidence,
    minScoreAlert: row.minScoreAlert,
    fewshotLimit: row.fewshotLimit,
    notifications: row.notifications,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toSource(row: SourceWithStats): SourceWire {
  // Stored config was validated on write; parsing again keeps the wire type honest.
  const typed = sourceConfigSchema.parse({ kind: row.kind, config: row.config });
  return {
    id: row.id,
    campaignId: row.campaignId,
    enabled: row.enabled,
    lastRunAt: isoOrNull(row.lastRunAt),
    lastError: row.lastError,
    pollIntervalMin: row.pollIntervalMin,
    postsLast24h: row.postsLast24h,
    ...typed,
  };
}

export function toPost(row: schema.Post): PostWire {
  return {
    id: row.id,
    platform: row.platform,
    url: row.url,
    authorHandle: row.authorHandle,
    authorUrl: row.authorUrl,
    title: row.title,
    body: row.body,
    bodyIsSnippet: row.bodyIsSnippet,
    postedAt: isoOrNull(row.postedAt),
  };
}

export function toLeadSummary(row: LeadWithPost): LeadSummaryWire {
  return {
    id: row.id,
    campaignId: row.campaignId,
    verdict: row.verdict,
    score: row.score,
    confidence: row.confidence,
    summary: row.summary,
    status: row.status,
    assigneeId: row.assigneeId,
    scoredAt: iso(row.scoredAt),
    post: {
      id: row.post.id,
      platform: row.post.platform,
      url: row.post.url,
      authorHandle: row.post.authorHandle,
      title: row.post.title,
      postedAt: isoOrNull(row.post.postedAt),
    },
  };
}

export function toNote(row: LeadNoteWithUser): LeadDetailWire["notes"][number] {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    body: row.body,
    createdAt: iso(row.createdAt),
  };
}

export function toLeadDetail(row: LeadDetail): LeadDetailWire {
  return {
    ...toLeadSummary(row),
    evidence: row.evidence,
    scoreBreakdown: row.scoreBreakdown,
    extractorProvider: row.extractorProvider,
    promptVersion: row.promptVersion,
    rulesVersion: row.rulesVersion,
    post: toPost(row.post),
    notes: row.notes.map(toNote),
  };
}

export function toPipelineRun(report: OrgRunReport): PipelineRunWire {
  return {
    id: report.id,
    startedAt: report.startedAt,
    durationMs: report.durationMs,
    counts: report.counts,
    errors: report.errors,
    perSource: report.perSource.map((s) => ({
      sourceId: s.sourceId,
      name: s.name,
      posts: s.posts,
      error: s.error,
    })),
  };
}
