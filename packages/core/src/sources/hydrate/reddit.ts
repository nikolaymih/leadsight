import type { RawPost } from "../../types.js";
import { REQUEST_TIMEOUT_MS, type SourceDeps } from "../source.js";
import { decodeEntities, extractMetaContent, stripHtml } from "../text.js";

// Public Reddit post pages render the post for crawlers (no API, no login). We fetch exactly
// the URL a search result pointed at — never listings — and read the server-rendered
// `<shreddit-post>` element; `og:description` is the fallback. Blocked or changed markup
// keeps the snippet. Best-effort: never throws.

const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const POST_TAG_RE = /<shreddit-post\b([^>]*)>/i;
const TEXT_BODY_RE = /<div[^>]*slot="text-body"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i;
const MD_RE = /<div[^>]*class="[^"]*\bmd\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;

export async function hydrateReddit(post: RawPost, deps: SourceDeps): Promise<RawPost> {
  try {
    const res = await deps.fetch(post.url, {
      headers: { "user-agent": CRAWLER_UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return post;

    const html = await res.text();
    const attrs = parseAttributes(POST_TAG_RE.exec(html)?.[1] ?? "");
    const bodyHtml = TEXT_BODY_RE.exec(html)?.[1] ?? MD_RE.exec(html)?.[1];
    const body = bodyHtml ? stripHtml(bodyHtml) : extractMetaContent(html, "og:description");
    const title = attrs["post-title"]
      ? decodeEntities(attrs["post-title"])
      : extractMetaContent(html, "og:title");
    const author = attrs.author;
    const created = attrs["created-timestamp"] ? new Date(attrs["created-timestamp"]) : undefined;

    // A link post has no text body; the title is still the best we have.
    const fullBody = body && body.length > 0 ? body : title;
    if (!fullBody || fullBody.length <= post.body.length) {
      return { ...post, title: post.title ?? title, authorHandle: post.authorHandle ?? withPrefix(author) };
    }
    return {
      ...post,
      body: fullBody,
      bodyIsSnippet: false,
      title: post.title ?? title,
      authorHandle: post.authorHandle ?? withPrefix(author),
      authorUrl: post.authorUrl ?? (author ? `https://www.reddit.com/user/${author}/` : undefined),
      postedAt: post.postedAt ?? (created && !Number.isNaN(created.getTime()) ? created : undefined),
    };
  } catch {
    return post;
  }
}

function withPrefix(author: string | undefined): string | undefined {
  return author ? `u/${author}` : undefined;
}

function parseAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-z-]+)="([^"]*)"/gi)) {
    const [, name, value] = m;
    if (name && value !== undefined) out[name.toLowerCase()] = value;
  }
  return out;
}
