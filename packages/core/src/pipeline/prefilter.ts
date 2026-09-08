import { ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import { posts, sources } from "../schema/index.js";
import type { SourceKind } from "../types.js";

// Pre-filter — docs/design.md §4 step 2. A post is a scoring candidate for a campaign
// when the source that surfaced it is already keyword-scoped, or the text contains one
// of the campaign's keywords. It runs inside the candidate query (see
// findExtractionCandidates) so filtered-out posts never occupy the batch window;
// `matchesAnyKeyword` is the same rule in TypeScript, kept for tests and callers.

export const KEYWORD_SCOPED_KINDS: readonly SourceKind[] = ["reddit_search", "rss"];

export function isKeywordScoped(kind: SourceKind): boolean {
  return KEYWORD_SCOPED_KINDS.includes(kind);
}

/** Case-insensitive substring match — deliberately cheap; the LLM does the real judging. */
export function matchesAnyKeyword(text: string, keywords: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((k) => k.trim().length > 0 && haystack.includes(k.trim().toLowerCase()));
}

export function isCandidate(
  post: { title: string | null; body: string },
  campaign: { keywords: readonly string[] },
  kind: SourceKind,
): boolean {
  return isKeywordScoped(kind) || matchesAnyKeyword(`${post.title ?? ""} ${post.body}`, campaign.keywords);
}

/** LIKE pattern escaping for `\`, `%` and `_` (Postgres default escape is `\`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * SQL form of `isCandidate`, evaluated against the `sources` row that surfaced the post
 * and the `posts` row itself. Callers place it inside a join of both tables.
 */
export function candidateCondition(campaign: { keywords: readonly string[] }): SQL {
  const keywords = campaign.keywords.map((k) => k.trim()).filter((k) => k.length > 0);
  const text = sql`coalesce(${posts.title}, '') || ' ' || ${posts.body}`;
  const keywordMatch =
    keywords.length > 0 ? or(...keywords.map((k) => ilike(text, `%${escapeLike(k)}%`))) : sql`false`;
  return or(inArray(sources.kind, [...KEYWORD_SCOPED_KINDS]), keywordMatch) ?? sql`false`;
}
