import { describe, expect, it } from "vitest";
import {
  hotFounderEvidence,
  jsJobsCampaign,
  jsJobsCriteria,
  mvpCampaign,
  mvpCriteria,
  thinEvidence,
} from "../test/fixtures.js";
import type { Evidence } from "../types.js";
import { criteriaSchema, thresholdsSchema } from "../types.js";
import { applyRules, confidenceFor, pointsFor } from "./index.js";

describe("criteria validation", () => {
  it("accepts both fixture criteria sets", () => {
    expect(criteriaSchema.safeParse(mvpCriteria).success).toBe(true);
    expect(criteriaSchema.safeParse(jsJobsCriteria).success).toBe(true);
  });

  it("rejects weights that do not sum to 100", () => {
    const bad = mvpCriteria.map((c, i) => (i === 0 ? { ...c, weight: 10 } : c));
    const res = criteriaSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it("rejects duplicate keys", () => {
    const bad = [...mvpCriteria, { ...mvpCriteria[0], weight: 0 }];
    expect(criteriaSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects enum points above weight and missing options", () => {
    const bad = mvpCriteria.map((c) =>
      c.key === "stage" ? { ...c, points: { idea: 50, prototype: 15 } } : c,
    );
    expect(criteriaSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects thresholds where hot <= warm", () => {
    expect(thresholdsSchema.safeParse({ hot: 40, warm: 40 }).success).toBe(false);
    expect(thresholdsSchema.safeParse({ hot: 70, warm: 40 }).success).toBe(true);
  });
});

describe("pointsFor", () => {
  it("boolean: full weight on true, zero otherwise", () => {
    const c = mvpCriteria[0];
    expect(pointsFor(c, { value: true, quote: null, confidence: 90 })).toBe(30);
    expect(pointsFor(c, { value: false, quote: null, confidence: 90 })).toBe(0);
    expect(pointsFor(c, { value: null, quote: null, confidence: 10 })).toBe(0);
    expect(pointsFor(c, undefined)).toBe(0);
  });

  it("enum: points per option, unknown option is zero", () => {
    const c = mvpCriteria[1];
    expect(pointsFor(c, { value: "idea", quote: null, confidence: 80 })).toBe(20);
    expect(pointsFor(c, { value: "live", quote: null, confidence: 80 })).toBe(5);
    expect(pointsFor(c, { value: "banana", quote: null, confidence: 80 })).toBe(0);
    expect(pointsFor(c, { value: true, quote: null, confidence: 80 })).toBe(0);
  });

  it("number: linear between min and max, clamped", () => {
    const c = jsJobsCriteria[4]; // hourly_rate 20..100, weight 10
    expect(pointsFor(c, { value: 20, quote: null, confidence: 80 })).toBe(0);
    expect(pointsFor(c, { value: 60, quote: null, confidence: 80 })).toBe(5);
    expect(pointsFor(c, { value: 100, quote: null, confidence: 80 })).toBe(10);
    expect(pointsFor(c, { value: 500, quote: null, confidence: 80 })).toBe(10);
    expect(pointsFor(c, { value: 5, quote: null, confidence: 80 })).toBe(0);
    expect(pointsFor(c, { value: "60", quote: null, confidence: 80 })).toBe(0);
  });
});

describe("applyRules", () => {
  it("scores the hot founder as hot with a full breakdown", () => {
    const r = applyRules(mvpCampaign, hotFounderEvidence);
    expect(r.score).toBe(100);
    expect(r.breakdown).toEqual({
      explicit_ask: 30,
      stage: 20,
      budget_signal: 25,
      engagement_model: 15,
      author_is_nontechnical: 10,
    });
    expect(r.confidence).toBeGreaterThanOrEqual(80);
    expect(r.verdict).toBe("hot");
  });

  it("is deterministic", () => {
    const a = applyRules(mvpCampaign, hotFounderEvidence);
    const b = applyRules(mvpCampaign, hotFounderEvidence);
    expect(a).toEqual(b);
  });

  it("returns insufficient when confidence is below the campaign minimum", () => {
    const r = applyRules(mvpCampaign, thinEvidence);
    expect(r.score).toBe(30); // only explicit_ask
    expect(r.confidence).toBeLessThan(50);
    expect(r.verdict).toBe("insufficient");
  });

  it("disqualifier hits force score 0 and verdict disqualified", () => {
    const ev: Evidence = { ...hotFounderEvidence, disqualifier_hits: ["developer seeking a job"] };
    const r = applyRules(mvpCampaign, ev);
    expect(r.score).toBe(0);
    expect(r.verdict).toBe("disqualified");
  });

  it("snippet-only posts lose confidence", () => {
    const full = applyRules(mvpCampaign, hotFounderEvidence);
    const snip = applyRules(mvpCampaign, hotFounderEvidence, { bodyIsSnippet: true });
    expect(snip.confidence).toBe(full.confidence - 20);
    expect(snip.score).toBe(full.score);
  });

  it("warm and cold thresholds", () => {
    const warm: Evidence = {
      ...hotFounderEvidence,
      criteria: {
        ...hotFounderEvidence.criteria,
        budget_signal: { value: false, quote: null, confidence: 80 },
        engagement_model: { value: "equity_only", quote: null, confidence: 80 },
        author_is_nontechnical: { value: false, quote: null, confidence: 80 },
      },
    };
    expect(applyRules(mvpCampaign, warm).score).toBe(50);
    expect(applyRules(mvpCampaign, warm).verdict).toBe("warm");

    const cold: Evidence = {
      ...warm,
      criteria: {
        ...warm.criteria,
        explicit_ask: { value: false, quote: null, confidence: 90 },
      },
    };
    expect(applyRules(mvpCampaign, cold).score).toBe(20);
    expect(applyRules(mvpCampaign, cold).verdict).toBe("cold");
  });

  it("ignores evidence keys the campaign does not define", () => {
    const ev: Evidence = {
      ...hotFounderEvidence,
      criteria: { ...hotFounderEvidence.criteria, extra_key: { value: true, quote: null, confidence: 99 } },
    };
    const r = applyRules(mvpCampaign, ev);
    expect(r.score).toBe(100);
    expect("extra_key" in r.breakdown).toBe(false);
  });

  it("works for a completely different campaign with the same code path", () => {
    const ev: Evidence = {
      criteria: {
        is_hiring_post: { value: true, quote: "we are hiring", confidence: 95 },
        stack_match: { value: "full", quote: "TypeScript + React + Node", confidence: 90 },
        engagement: { value: "contract", quote: "6-month B2B contract", confidence: 85 },
        remote: { value: true, quote: "fully remote, EU hours", confidence: 90 },
        hourly_rate: { value: 60, quote: "$60/h", confidence: 80 },
      },
      disqualifier_hits: [],
      summary: "Remote 6-month TS/React contract at $60/h.",
    };
    const r = applyRules(jsJobsCampaign, ev);
    expect(r.breakdown).toEqual({
      is_hiring_post: 30,
      stack_match: 25,
      engagement: 20,
      remote: 15,
      hourly_rate: 5,
    });
    expect(r.score).toBe(95);
    expect(r.verdict).toBe("hot");
  });
});

describe("confidenceFor", () => {
  it("weights per-field confidence by criterion weight", () => {
    const ev: Evidence = {
      criteria: {
        explicit_ask: { value: true, quote: null, confidence: 100 }, // w30
        stage: { value: "idea", quote: null, confidence: 0 }, // w20
        budget_signal: { value: true, quote: null, confidence: 100 }, // w25
        engagement_model: { value: "paid", quote: null, confidence: 0 }, // w15
        author_is_nontechnical: { value: true, quote: null, confidence: 100 }, // w10
      },
      disqualifier_hits: [],
      summary: "",
    };
    expect(confidenceFor(mvpCriteria, ev)).toBe(65);
  });
});
