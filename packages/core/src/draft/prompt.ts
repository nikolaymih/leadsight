import { PLATFORMS } from "../types.js";
import type { FetchedPage } from "./fetch-pages.js";

// Draft prompt v1 — docs/design.md §5. Bump DRAFT_PROMPT_VERSION on any wording change.

export const DRAFT_PROMPT_VERSION = "2026-09-09.1";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const DRAFT_SYSTEM_PROMPT = [
  "You help a small team set up a social-listening campaign: they describe what they sell and who buys it,",
  "and you turn that into a precise, machine-checkable campaign definition.",
  "If you do not yet know what is being sold or who the ideal poster is, ask ONE short follow-up question",
  "and return `draft: null`. Otherwise produce the full draft and a one-sentence reply describing it.",
  "Criteria are questions an LLM will later answer about a single public post, strictly from its text;",
  "every criterion must be answerable that way. Never invent facts about the offer that the user or the",
  "pages did not state. Return only JSON matching the requested shape. No prose, no markdown fences.",
].join(" ");

export function buildDraftPrompt(input: {
  messages: readonly ChatMessage[];
  pages: readonly FetchedPage[];
}): string {
  const sections: string[] = [];

  sections.push(
    `## Conversation so far\n${input.messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n")}`,
  );

  if (input.pages.length > 0) {
    sections.push(
      `## Pages the user shared\n${input.pages
        .map((p) => `### ${p.title ?? p.url}\n${p.url}\n${p.text}`)
        .join("\n\n")}`,
    );
  }

  sections.push(OUTPUT_INSTRUCTIONS);
  return sections.join("\n\n");
}

const OUTPUT_INSTRUCTIONS = `## Output
Return a single JSON object:
{"reply": "<one or two sentences for the user, or ONE follow-up question>",
 "draft": null | {
  "name": "<short campaign name>",
  "offerDescription": "<what is sold, plain language, 1-3 sentences>",
  "icp": "<who the ideal poster is, 1-3 sentences>",
  "disqualifiers": ["<explicit non-fit, e.g. 'equity only'>", ...],
  "keywords": ["<3-8 short search phrases people would actually write>", ...],
  "criteria": [
    {"key": "<snake_case>", "question": "<yes/no question>", "type": "boolean", "weight": <int>},
    {"key": "<snake_case>", "question": "<which of these?>", "type": "enum", "options": ["a", "b", "c"], "points": {"a": <int>, "b": <int>, "c": <int>}, "weight": <int>},
    {"key": "<snake_case>", "question": "<a number, e.g. budget in USD>", "type": "number", "min": <n>, "max": <n>, "weight": <int>}
  ],
  "thresholds": {"hot": <int>, "warm": <int>},
  "suggestedSources": [
    {"kind": "google_search", "config": {"platform": "reddit", "phrases": ["<exact phrase a poster would write>", ...], "siteScope": "reddit.com/r/<subreddit>"}},
    {"kind": "google_search", "config": {"platform": "linkedin", "phrases": [...]}},
    {"kind": "google_search", "config": {"platform": "x", "phrases": [...]}}
  ],
  "alertQueries": ["<Google Alerts query, e.g. site:linkedin.com/posts \\"looking for a cto\\">", ...]
 }}

Rules for the draft:
- 4 to 7 criteria. Weights are integers and sum to exactly 100. Each criterion must be
  answerable from one post's text alone. Keys are unique snake_case.
- Enum criteria list 2-5 options and give points for every option; no option's points exceed
  the criterion's weight. Number criteria give min < max.
- thresholds: hot > warm, both 0-100 (70/40 is a sensible default).
- 3-5 suggestedSources, all of kind "google_search": one per platform (reddit, linkedin, x),
  plus optionally one per especially relevant subreddit with siteScope "reddit.com/r/<name>".
  Each has 3-8 phrases (max 10): short, literal things a poster would type ("looking for a
  cto", "need a technical cofounder"), no boolean operators, no quotes. Never suggest
  reddit_subreddit or reddit_search (Reddit API access is restricted).
- 2-4 alertQueries targeting linkedin.com/posts, x.com or facebook.com (Google Alerts syntax).
- Platforms that exist: ${PLATFORMS.join(", ")}.`;
