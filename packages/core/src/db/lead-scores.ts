import { and, eq } from "drizzle-orm";
import { leads, posts } from "../schema/index.js";
import type { Evidence, Verdict } from "../types.js";
import type { DbLike } from "./client.js";

// Queries for rescoring: rules only, over stored evidence. No LLM involved.

export interface LeadForRescore {
  id: string;
  evidence: Evidence;
  verdict: Verdict;
  bodyIsSnippet: boolean;
}

export async function listLeadsForRescore(
  db: DbLike,
  orgId: string,
  campaignId: string,
): Promise<LeadForRescore[]> {
  return db
    .select({
      id: leads.id,
      evidence: leads.evidence,
      verdict: leads.verdict,
      bodyIsSnippet: posts.bodyIsSnippet,
    })
    .from(leads)
    .innerJoin(posts, eq(posts.id, leads.postId))
    .where(and(eq(leads.organizationId, orgId), eq(leads.campaignId, campaignId)));
}

export interface LeadScoreUpdate {
  id: string;
  score: number;
  scoreBreakdown: Record<string, number>;
  confidence: number;
  verdict: Verdict;
  rulesVersion: number;
}

/** Write new scores for a batch of leads. Run inside a transaction; the caller chunks at 500. */
export async function updateLeadScores(
  db: DbLike,
  orgId: string,
  updates: readonly LeadScoreUpdate[],
): Promise<void> {
  const now = new Date();
  for (const u of updates) {
    await db
      .update(leads)
      .set({
        score: u.score,
        scoreBreakdown: u.scoreBreakdown,
        confidence: u.confidence,
        verdict: u.verdict,
        rulesVersion: u.rulesVersion,
        updatedAt: now,
      })
      .where(and(eq(leads.organizationId, orgId), eq(leads.id, u.id)));
  }
}
