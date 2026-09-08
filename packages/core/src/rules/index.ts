import type { Criteria, Criterion, Evidence, EvidenceField, Thresholds, Verdict } from "../types.js";

export interface RulesCampaign {
  criteria: Criteria;
  thresholds: Thresholds;
  minConfidence: number;
}

export interface RulesOptions {
  /** Post body was only a search snippet; confidence is reduced. Default false. */
  bodyIsSnippet?: boolean;
  /** Confidence penalty applied when bodyIsSnippet. Default 20. */
  snippetPenalty?: number;
}

export interface RulesResult {
  score: number;
  breakdown: Record<string, number>;
  confidence: number;
  verdict: Verdict;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Points awarded for one criterion given its evidence field. Never exceeds weight. */
export function pointsFor(criterion: Criterion, field: EvidenceField | undefined): number {
  if (!field || field.value === null || field.value === undefined) return 0;

  switch (criterion.type) {
    case "boolean":
      return field.value === true ? criterion.weight : 0;

    case "enum": {
      if (typeof field.value !== "string") return 0;
      const pts = criterion.points[field.value];
      return pts === undefined ? 0 : clamp(pts, 0, criterion.weight);
    }

    case "number": {
      if (typeof field.value !== "number" || Number.isNaN(field.value)) return 0;
      const ratio = (field.value - criterion.min) / (criterion.max - criterion.min);
      return Math.round(clamp(ratio, 0, 1) * criterion.weight);
    }
    default:
      return 0;
  }
}

/**
 * Weighted mean of per-field confidence, weighted by criterion weight.
 * Missing fields count as confidence 0. Snippet-only posts are penalised.
 */
export function confidenceFor(criteria: Criteria, evidence: Evidence, opts: RulesOptions = {}): number {
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return 0;

  let acc = 0;
  for (const c of criteria) {
    const f = evidence.criteria[c.key];
    const conf = f ? clamp(f.confidence, 0, 100) : 0;
    acc += conf * c.weight;
  }
  let confidence = acc / totalWeight;

  if (opts.bodyIsSnippet) confidence -= opts.snippetPenalty ?? 20;

  return Math.round(clamp(confidence, 0, 100));
}

export function verdictFor(
  score: number,
  confidence: number,
  campaign: RulesCampaign,
  disqualified: boolean,
): Verdict {
  if (disqualified) return "disqualified";
  if (confidence < campaign.minConfidence) return "insufficient";
  if (score >= campaign.thresholds.hot) return "hot";
  if (score >= campaign.thresholds.warm) return "warm";
  return "cold";
}

/**
 * Pure function: same campaign + evidence always yields the same result.
 * No I/O. Safe to run over stored evidence for instant rescoring.
 */
export function applyRules(
  campaign: RulesCampaign,
  evidence: Evidence,
  opts: RulesOptions = {},
): RulesResult {
  const disqualified = evidence.disqualifier_hits.length > 0;

  const breakdown: Record<string, number> = {};
  let score = 0;
  for (const c of campaign.criteria) {
    const pts = pointsFor(c, evidence.criteria[c.key]);
    breakdown[c.key] = pts;
    score += pts;
  }
  score = clamp(Math.round(score), 0, 100);
  if (disqualified) score = 0;

  const confidence = confidenceFor(campaign.criteria, evidence, opts);
  const verdict = verdictFor(score, confidence, campaign, disqualified);

  return { score, breakdown, confidence, verdict };
}
