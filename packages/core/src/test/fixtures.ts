import type { RulesCampaign } from "../rules/index.js";
import type { Criteria, Evidence } from "../types.js";

export const mvpCriteria: Criteria = [
  {
    key: "explicit_ask",
    question:
      "Is the author explicitly asking for a CTO, technical co-founder, developer, agency or team to build something?",
    type: "boolean",
    weight: 30,
  },
  {
    key: "stage",
    question: "What stage is the product at?",
    type: "enum",
    options: ["idea", "prototype", "live"],
    points: { idea: 20, prototype: 15, live: 5 },
    weight: 20,
  },
  {
    key: "budget_signal",
    question: "Does the author mention funding, budget, or willingness to pay?",
    type: "boolean",
    weight: 25,
  },
  {
    key: "engagement_model",
    question: "Do they want an equity-only co-founder, a paid partner, or unclear?",
    type: "enum",
    options: ["equity_only", "paid", "unclear"],
    points: { equity_only: 0, paid: 15, unclear: 7 },
    weight: 15,
  },
  {
    key: "author_is_nontechnical",
    question: "Does the author present as non-technical (business/domain background)?",
    type: "boolean",
    weight: 10,
  },
];

export const jsJobsCriteria: Criteria = [
  {
    key: "is_hiring_post",
    question: "Is the author offering work (not seeking it)?",
    type: "boolean",
    weight: 30,
  },
  {
    key: "stack_match",
    question: "Which of these are required: JavaScript, TypeScript, Node, React?",
    type: "enum",
    options: ["none", "partial", "full"],
    points: { none: 0, partial: 10, full: 25 },
    weight: 25,
  },
  {
    key: "engagement",
    question: "Contract/B2B, full-time, or unclear?",
    type: "enum",
    options: ["contract", "fulltime", "unclear"],
    points: { contract: 20, fulltime: 5, unclear: 8 },
    weight: 20,
  },
  {
    key: "remote",
    question: "Is remote work allowed?",
    type: "boolean",
    weight: 15,
  },
  {
    key: "hourly_rate",
    question: "Hourly rate mentioned, in USD (null if none)",
    type: "number",
    min: 20,
    max: 100,
    weight: 10,
  },
];

export const mvpCampaign: RulesCampaign = {
  criteria: mvpCriteria,
  thresholds: { hot: 70, warm: 40 },
  minConfidence: 50,
};

export const jsJobsCampaign: RulesCampaign = {
  criteria: jsJobsCriteria,
  thresholds: { hot: 70, warm: 40 },
  minConfidence: 50,
};

export const hotFounderEvidence: Evidence = {
  criteria: {
    explicit_ask: { value: true, quote: "looking for a CTO to build the first version", confidence: 95 },
    stage: { value: "idea", quote: "haven't built anything yet", confidence: 85 },
    budget_signal: { value: true, quote: "we have a small seed round", confidence: 80 },
    engagement_model: { value: "paid", quote: "happy to pay a proper rate", confidence: 75 },
    author_is_nontechnical: { value: true, quote: "I come from hospitality", confidence: 80 },
  },
  disqualifier_hits: [],
  summary: "Hospitality founder with seed money looking for a paid CTO to build a booking SaaS.",
};

export const thinEvidence: Evidence = {
  criteria: {
    explicit_ask: { value: true, quote: "need a dev", confidence: 60 },
    stage: { value: null, quote: null, confidence: 20 },
    budget_signal: { value: null, quote: null, confidence: 10 },
    engagement_model: { value: null, quote: null, confidence: 10 },
    author_is_nontechnical: { value: null, quote: null, confidence: 15 },
  },
  disqualifier_hits: [],
  summary: "Very short post asking for a dev, no details.",
};
