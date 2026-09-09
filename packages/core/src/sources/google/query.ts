import { MAX_SEARCH_PHRASES, type Platform, type RawPost, type SearchLookback } from "../../types.js";
import type { SourceConfigFor } from "../config.js";
import { canonicalUrl } from "../url.js";

// Pure helpers for the google_search source: query text, request URL, result → RawPost and
// the per-platform "is this a post page" filter. No I/O, fully unit-tested.

export type GoogleSearchConfig = SourceConfigFor<"google_search">;

export const RESULTS_PER_PAGE = 10;
export const MAX_PAGES = 2;
export const SEARCH_ENDPOINT = "https://www.googleapis.com/customsearch/v1";

/** `site:` operand per platform when the source does not narrow it further. */
export const DEFAULT_SITE_SCOPE: Record<Platform, string | null> = {
  reddit: "reddit.com",
  linkedin: "linkedin.com/posts",
  x: "x.com",
  facebook: "facebook.com",
  web: null,
};

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

/** `example.com/path` from anything the user pasted: no scheme, no `www.`, no trailing slash. */
export function normalizeSiteScope(scope: string | undefined, platform: Platform): string | null {
  const cleaned = (scope ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
  return cleaned.length > 0 ? cleaned : DEFAULT_SITE_SCOPE[platform];
}

/** `site:reddit.com/r/startups ("looking for a cto" OR "need a technical cofounder")` */
export function buildSearchQuery(
  config: Pick<GoogleSearchConfig, "platform" | "phrases" | "siteScope">,
): string {
  const phrases = normalizePhrases(config.phrases);
  if (phrases.length === 0) throw new Error("google_search: no usable phrases");
  const quoted = phrases.map((p) => `"${p}"`);
  const group = quoted.length === 1 ? (quoted[0] as string) : `(${quoted.join(" OR ")})`;
  const scope = normalizeSiteScope(config.siteScope, config.platform);
  return scope ? `site:${scope} ${group}` : group;
}

export interface SearchRequest {
  key: string;
  cx: string;
  q: string;
  lookback: SearchLookback;
  /** 1-based index of the first result: 1 for page one, 11 for page two. */
  start: number;
}

export function searchRequestUrl(req: SearchRequest): URL {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("key", req.key);
  url.searchParams.set("cx", req.cx);
  url.searchParams.set("q", req.q);
  url.searchParams.set("num", String(RESULTS_PER_PAGE));
  url.searchParams.set("start", String(req.start));
  url.searchParams.set("dateRestrict", req.lookback);
  url.searchParams.set("sort", "date");
  return url;
}

/** Whether page `n` (1-based) should be fetched given how many results the previous page had. */
export function shouldFetchNextPage(previousPageCount: number, nextPage: number): boolean {
  return nextPage <= MAX_PAGES && previousPageCount === RESULTS_PER_PAGE;
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

export interface SearchResultItem {
  link: string;
  title?: string;
  snippet?: string;
  pagemap?: { metatags?: Record<string, string | undefined>[] };
}

const DATE_META_KEYS = ["article:published_time", "og:updated_time", "datepublished", "date"] as const;

export function resultToRawPost(item: SearchResultItem, platform: Platform): RawPost | undefined {
  let externalId: string;
  try {
    externalId = canonicalUrl(item.link);
  } catch {
    return undefined;
  }
  const meta = item.pagemap?.metatags?.[0] ?? {};
  const title = (item.title ?? meta["og:title"] ?? "").replace(/\s+/g, " ").trim();
  const snippet = (item.snippet ?? meta["og:description"] ?? "").replace(/\s+/g, " ").trim();

  return {
    platform,
    externalId,
    url: item.link,
    title: title || undefined,
    body: snippet || title || item.link,
    bodyIsSnippet: true,
    postedAt: parseMetaDate(meta),
    authorHandle: authorFromUrl(platform, item.link),
    raw: item,
  };
}

function parseMetaDate(meta: Record<string, string | undefined>): Date | undefined {
  for (const key of DATE_META_KEYS) {
    const value = meta[key];
    if (!value) continue;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
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
