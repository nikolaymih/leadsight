import type { LabeledExample } from "../db/labels.js";
import type { Criteria, Evidence, RawPost } from "../types.js";

// Extractor contract — docs/design.md §3.2. The model finds facts; rules assign points.
// Nothing here knows what a criterion key means, and the model never sees weights.

export interface CampaignForPrompt {
  offerDescription: string;
  icp: string;
  disqualifiers: readonly string[];
  criteria: Criteria;
}

export interface ExtractionInput {
  campaign: CampaignForPrompt;
  /** Already selected and balanced; see fewshot.ts. */
  examples: readonly LabeledExample[];
  /** One batch, typically 5–10 posts. */
  posts: readonly RawPost[];
}

export interface ExtractionOutput {
  postExternalId: string;
  evidence: Evidence;
}

export interface DroppedPost {
  postExternalId: string;
  reason: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ExtractionResult {
  results: ExtractionOutput[];
  /** Posts the model never returned a valid answer for, after one retry alone. */
  dropped: DroppedPost[];
  /** `<provider>/<model>`, stored on every lead. */
  provider: string;
  promptVersion: string;
  usage: TokenUsage;
}

export interface Extractor {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

/** Posts per LLM call. The pipeline slices its candidate list with this. */
export const EXTRACT_BATCH_SIZE = 8;

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
  };
}

export const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0 };
