import { truncate } from "../sources/text.js";
import type { Criterion, RawPost } from "../types.js";
import type { ExtractionInput } from "./extractor.js";
import { formatExample } from "./fewshot.js";

// Prompt v1 — docs/design.md §6. Bump PROMPT_VERSION on any wording change; it is
// stored on every lead so results can be compared across prompt revisions.

export const PROMPT_VERSION = "2026-09-08.1";

/** Posts longer than this are cut; the model does not need the whole essay. */
export const POST_MAX_CHARS = 2_000;

export const SYSTEM_PROMPT = [
  "You extract evidence from public social posts to judge how well each post's author fits an offer.",
  "For every post and every criterion, answer strictly from the post text.",
  "Quote the exact supporting text in `quote`. If the post does not address a criterion, set `value` to null,",
  "`quote` to null and give a low `confidence`. Never guess and never infer from the platform or author name.",
  "Also report which of the listed disqualifiers apply, quoting the text that triggers each one.",
  "Write a one-sentence neutral summary of each post.",
  "Return only JSON matching the requested shape. No prose, no markdown fences.",
].join(" ");

export function buildUserPrompt(input: ExtractionInput): string {
  const { campaign, examples, posts } = input;

  const sections = [
    `## Offer\n${campaign.offerDescription}`,
    `## Ideal poster\n${campaign.icp}`,
    `## Disqualifiers (report any that apply, by exact text below)\n${
      campaign.disqualifiers.length > 0 ? campaign.disqualifiers.map((d) => `- ${d}`).join("\n") : "- (none)"
    }`,
    `## Criteria\n${campaign.criteria.map(formatCriterion).join("\n")}`,
  ];

  if (examples.length > 0) {
    sections.push(`## Labeled examples from reviewers\n${examples.map(formatExample).join("\n\n")}`);
  }

  sections.push(`## Posts to analyse\n${posts.map(formatPost).join("\n\n")}`);
  sections.push(outputInstructions(campaign.criteria));

  return sections.join("\n\n");
}

/** Key, question, type and options only. Weights and thresholds never reach the model. */
function formatCriterion(c: Criterion): string {
  switch (c.type) {
    case "boolean":
      return `- ${c.key} (boolean): ${c.question}`;
    case "enum":
      return `- ${c.key} (one of: ${c.options.join(", ")}): ${c.question}`;
    case "number":
      return `- ${c.key} (number): ${c.question}`;
  }
}

function formatPost(post: RawPost): string {
  const header = `### Post id: ${post.externalId} [${post.platform}]${post.bodyIsSnippet ? " (snippet only)" : ""}`;
  const title = post.title ? `Title: ${post.title}\n` : "";
  return `${header}\n${title}${truncate(post.body, POST_MAX_CHARS)}`;
}

function outputInstructions(criteria: readonly Criterion[]): string {
  const keys = criteria.map((c) => `"${c.key}"`).join(", ");
  return [
    "## Output",
    "Return a single JSON object of the form:",
    '{"results": [{"id": "<post id exactly as given>", "evidence": {',
    `  "criteria": { <one entry per criterion key: ${keys}> : {"value": <boolean|string|number|null>, "quote": <string|null>, "confidence": <integer 0-100>} },`,
    '  "disqualifier_hits": [<disqualifier text that applies, verbatim>],',
    '  "summary": "<one sentence>"',
    "}}]}",
    "Include every post id exactly once. For enum criteria `value` must be one of the listed options or null.",
  ].join("\n");
}
