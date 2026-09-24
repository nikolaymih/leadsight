import { MAX_SEARCH_PHRASES, type Platform, type RawPost, type SearchLookback } from "../../types.js";
import type { SourceConfigFor } from "../config.js";
import { canonicalUrl } from "../url.js";
import type { SearchHit } from "./provider.js";

// Pure helpers for the web_search source: phrase normalisation and packing, OR-query text,
// site scope parsing and matching, the per-platform "is this a post page" filter, hit →
// RawPost and dedupe. No I/O, fully unit-tested. Provider-agnostic: Exa and Tavily both take
// a query string, a domain list and a start date.

export type WebSearchConfig = SourceConfigFor<"web_search">;

/**
 * Longest query we send. Tavily rejects queries over 400 characters; Exa accepts more, but
 * one limit keeps a source's queries identical whichever provider serves them.
 */
export const MAX_QUERY_CHARS = 400;
/** Queries per source per run. With ≤ 10 short phrases one query is the normal case. */
export const MAX_QUERIES_PER_RUN = 2;
/** Results asked of the provider per query. */
export const RESULTS_PER_QUERY = 20;

/** Scope per platform when the source does not narrow it further. */
export const DEFAULT_SITE_SCOPE: Record<Platform, string | null> = {
  reddit: "reddit.com",
  linkedin: "linkedin.com/posts",
  x: "x.com",
  facebook: "facebook.com",
  web: null,
};

const LOOKBACK_DAYS: Record<SearchLookback, number> = { d1: 1, d3: 3, d7: 7 };

/** Trimmed, de-quoted, de-duplicated (case-insensitive), capped at MAX_SEARCH_PHRASES. */
export function normalizePhrases(phrases: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of phrases) {
    const phrase = raw.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
    const key = phrase.toLowerCase();
    if (phrase.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length === MAX_SEARCH_PHRASES) break;
  }
  return out;
}

/** `"p1" OR "p2" OR "p3"`; a single phrase is just `"p1"`. */
export function buildOrQuery(phrases: readonly string[]): string {
  return phrases.map((p) => `"${p}"`).join(" OR ");
}

/**
 * Greedily packs phrases into OR-queries of at most `maxChars` each, preserving order. A
 * phrase longer than the limit on its own is truncated at a word boundary rather than dropped.
 */
export function packPhrases(phrases: readonly string[], maxChars = MAX_QUERY_CHARS): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const raw of phrases) {
    const phrase = fitPhrase(raw, maxChars);
    const candidate = [...current, phrase];
    if (current.length > 0 && buildOrQuery(candidate).length > maxChars) {
      groups.push(current);
      current = [phrase];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function fitPhrase(phrase: string, maxChars: number): string {
  const room = maxChars - 2; // the quotes
  if (phrase.length <= room) return phrase;
  const cut = phrase.slice(0, room);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

export interface SiteScope {
  /** Lower-case host without `www.`, e.g. `reddit.com`. Passed to the provider as a domain filter. */
  host: string;
  /** Lower-case path prefix without trailing slash, e.g. `/r/startups`; empty for the whole host. */
  pathPrefix: string;
}

/** Scope from anything the user pasted (`https://www.reddit.com/r/startups/`), or the platform default. */
export function parseSiteScope(scope: string | undefined, platform: Platform): SiteScope | null {
  const cleaned = (scope ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
  const value = cleaned.length > 0 ? cleaned : DEFAULT_SITE_SCOPE[platform];
  if (!value) return null;
  const slash = value.indexOf("/");
  const host = (slash === -1 ? value : value.slice(0, slash)).toLowerCase();
  const pathPrefix = slash === -1 ? "" : value.slice(slash).toLowerCase();
  return { host, pathPrefix };
}

/**
 * Providers filter by domain only, so path scopes (`/r/startups`) are enforced here. Subdomains
 * of the host (`old.reddit.com`, `mobile.x.com`) count as in scope.
 */
export function inScope(url: string, scope: SiteScope | null): boolean {
  if (!scope) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== scope.host && !host.endsWith(`.${scope.host}`)) return false;
  if (!scope.pathPrefix) return true;
  const path = parsed.pathname.toLowerCase();
  return path === scope.pathPrefix || path.startsWith(`${scope.pathPrefix}/`);
}

/** Start of the lookback window. */
export function lookbackStart(lookback: SearchLookback, now: Date): Date {
  return new Date(now.getTime() - LOOKBACK_DAYS[lookback] * 86_400_000);
}

/** Discussion/post pages only; profile, listing and search pages are noise for extraction. */
export function isPostUrl(platform: Platform, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const path = parsed.pathname;
  switch (platform) {
    case "reddit":
      return /\/r\/[^/]+\/comments\/[a-z0-9]+/i.test(path);
    case "linkedin":
      return /^\/(posts|pulse)\/[^/]+/i.test(path) || /^\/feed\/update\//i.test(path);
    case "x":
      return /^\/[^/]+\/status\/\d+/i.test(path);
    case "facebook":
      return /\/(posts|groups|permalink\.php|photo|videos|share)\b/i.test(path);
    case "web":
      return true;
  }
}

export function hitToRawPost(hit: SearchHit, platform: Platform): RawPost | undefined {
  let externalId: string;
  try {
    externalId = canonicalUrl(hit.url);
  } catch {
    return undefined;
  }
  const title = (hit.title ?? "").replace(/\s+/g, " ").trim();
  const snippet = (hit.snippet ?? "").replace(/\s+/g, " ").trim();
  return {
    platform,
    externalId,
    url: hit.url,
    title: title || undefined,
    body: snippet || title || hit.url,
    bodyIsSnippet: true,
    postedAt: hit.publishedAt,
    authorHandle: hit.author ? normalizeAuthor(platform, hit.author) : authorFromUrl(platform, hit.url),
    raw: hit.raw,
  };
}

/** One post per canonical URL, first occurrence wins (providers rank by relevance/date). */
export function dedupePosts(posts: readonly RawPost[]): RawPost[] {
  const seen = new Set<string>();
  const out: RawPost[] = [];
  for (const post of posts) {
    if (seen.has(post.externalId)) continue;
    seen.add(post.externalId);
    out.push(post);
  }
  return out;
}

function normalizeAuthor(platform: Platform, author: string): string {
  const a = author.trim();
  if (platform === "x" && !a.startsWith("@")) return `@${a}`;
  if (platform === "reddit" && !a.startsWith("u/")) return `u/${a.replace(/^\/?u\//, "")}`;
  return a;
}

/** Handles that live in the URL path; hydration fills in the rest. */
function authorFromUrl(platform: Platform, url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    if (platform === "x") {
      const m = /^\/([^/]+)\/status\//.exec(path);
      return m ? `@${m[1]}` : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
