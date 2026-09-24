// URL normalisation for dedupe keys. Pure; tested.

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "ref",
  "ref_src",
  "ref_url",
  "trk",
  "trackingid",
  "rcm",
  "s",
  "t",
  // Google redirect / Alerts noise
  "ct",
  "cd",
  "usg",
  "rct",
  "sa",
  "ved",
  "ei",
]);

/** Google Alerts wraps links as `https://www.google.com/url?…&url=<target>&…`. */
export function unwrapGoogleRedirect(raw: string): string {
  try {
    const u = new URL(raw);
    if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname === "/url") {
      const target = u.searchParams.get("url") ?? u.searchParams.get("q");
      if (target) return target;
    }
  } catch {
    // not a URL; fall through
  }
  return raw;
}

/**
 * Stable identity for a post URL: lowercase host, no hash, no tracking params,
 * no trailing slash. Used as `external_id` for RSS-sourced posts.
 */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  let out = u.toString();
  if (u.pathname.length > 1 && u.search === "" && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}
