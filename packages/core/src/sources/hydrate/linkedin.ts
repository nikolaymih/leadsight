import type { RawPost } from "../../types.js";
import { REQUEST_TIMEOUT_MS, type SourceDeps } from "../source.js";
import { extractMetaContent, stripHtml } from "../text.js";

// Public LinkedIn post pages render the text server-side for crawlers. Behind an auth
// wall (HTTP 999, a redirect to /authwall, or an authwall page body) we keep the snippet.
// Best-effort: never throws.

const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const PARAGRAPH_RE = /<p[^>]*class="[^"]*attributed-text-segment-list__content[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;

export async function hydrateLinkedIn(post: RawPost, deps: SourceDeps): Promise<RawPost> {
  try {
    const res = await deps.fetch(post.url, {
      headers: { "user-agent": CRAWLER_UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok || res.url.includes("/authwall")) return post;

    const html = await res.text();
    if (html.includes("/authwall") && !PARAGRAPH_RE.test(html)) return post;
    PARAGRAPH_RE.lastIndex = 0;

    const paragraphs = [...html.matchAll(PARAGRAPH_RE)].map((m) => stripHtml(m[1] ?? "")).filter(Boolean);
    const body = paragraphs.length > 0 ? paragraphs.join("\n\n") : extractMetaContent(html, "og:description");
    if (!body || body.length <= post.body.length) return post;

    const author = extractAuthor(html);
    return {
      ...post,
      body,
      bodyIsSnippet: false,
      authorHandle: post.authorHandle ?? author?.name,
      authorUrl: post.authorUrl ?? author?.url,
      title: post.title ?? extractMetaContent(html, "og:title"),
    };
  } catch {
    return post;
  }
}

function extractAuthor(html: string): { name?: string; url?: string } | undefined {
  // <a class="… update-components-actor__meta-link …" href="https://www.linkedin.com/in/jane">Jane Doe</a>
  const m = /<a[^>]+href="(https:\/\/www\.linkedin\.com\/in\/[^"?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  if (!m) return undefined;
  const name = stripHtml(m[2] ?? "");
  return { name: name || undefined, url: m[1] };
}
