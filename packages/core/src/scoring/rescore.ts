import { getCampaign } from "../db/campaigns.js";
import type { Db } from "../db/client.js";
import { listLeadsForRescore, updateLeadScores } from "../db/lead-scores.js";
import { ValidationError } from "../errors.js";
import { applyRules, type RulesCampaign } from "../rules/index.js";
import {
  type Criteria,
  criteriaSchema,
  type Thresholds,
  thresholdsSchema,
  VERDICTS,
  type Verdict,
} from "../types.js";

// Rescoring — docs/design.md §2.5. Rules only, over stored evidence: free and instant,
// no LLM call. A full re-extract is a separate, explicit action.

const BATCH = 500;

export type VerdictCounts = Record<Verdict, number>;

export interface RescoreResult {
  rescored: number;
  /** Leads whose verdict changed, counted by the verdict they moved into. */
  moved: VerdictCounts;
}

export interface RescorePreview {
  total: number;
  /** Distribution after applying the edited rules. Nothing is written. */
  byVerdict: VerdictCounts;
}

export interface EditedRules {
  criteria: Criteria;
  thresholds: Thresholds;
  minConfidence: number;
}

export async function rescoreCampaign(db: Db, orgId: string, campaignId: string): Promise<RescoreResult> {
  const campaign = await getCampaign(db, orgId, campaignId);
  const rows = await listLeadsForRescore(db, orgId, campaignId);

  const moved = zeroCounts();
  const updates = rows.map((row) => {
    const scored = applyRules(campaign, row.evidence, { bodyIsSnippet: row.bodyIsSnippet });
    if (scored.verdict !== row.verdict) moved[scored.verdict] += 1;
    return {
      id: row.id,
      score: scored.score,
      scoreBreakdown: scored.breakdown,
      confidence: scored.confidence,
      verdict: scored.verdict,
      rulesVersion: campaign.rulesVersion,
    };
  });

  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await db.transaction((tx) => updateLeadScores(tx, orgId, chunk));
  }

  return { rescored: updates.length, moved };
}

/** "What if" for the campaign settings screen: verdict distribution under edited rules. */
export async function previewRescore(
  db: Db,
  orgId: string,
  campaignId: string,
  edited: EditedRules,
): Promise<RescorePreview> {
  await getCampaign(db, orgId, campaignId); // NotFound / org scoping
  const rules = validateRules(edited);
  const rows = await listLeadsForRescore(db, orgId, campaignId);

  const byVerdict = zeroCounts();
  for (const row of rows) {
    byVerdict[applyRules(rules, row.evidence, { bodyIsSnippet: row.bodyIsSnippet }).verdict] += 1;
  }
  return { total: rows.length, byVerdict };
}

function validateRules(edited: EditedRules): RulesCampaign {
  const criteria = criteriaSchema.safeParse(edited.criteria);
  if (!criteria.success) {
    throw new ValidationError(
      "invalid criteria",
      criteria.error.issues.map((i) => `criteria.${i.path.join(".")}: ${i.message}`),
    );
  }
  const thresholds = thresholdsSchema.safeParse(edited.thresholds);
  if (!thresholds.success) {
    throw new ValidationError(
      "invalid thresholds",
      thresholds.error.issues.map((i) => `thresholds.${i.path.join(".")}: ${i.message}`),
    );
  }
  return { criteria: criteria.data, thresholds: thresholds.data, minConfidence: edited.minConfidence };
}

export function zeroCounts(): VerdictCounts {
  return Object.fromEntries(VERDICTS.map((v) => [v, 0])) as VerdictCounts;
}
