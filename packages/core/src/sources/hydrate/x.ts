import { z } from "zod";
import type { RawPost } from "../../types.js";
import { REQUEST_TIMEOUT_MS, type SourceDeps } from "../source.js";
import { stripHtml } from "../text.js";

// X/Twitter's public oEmbed endpoint returns the tweet text as HTML. Free, official,
// no auth. Best-effort: never throws.

const OEMBED_URL = "https://publish.twitter.com/oembed";

const oembedSchema = z.object({
  html: z.string(),
  author_name: z.string().optional(),
  author_url: z.string().optional(),
});

export async function hydrateX(post: RawPost, deps: SourceDeps): Promise<RawPost> {
  try {
    const url = new URL(OEMBED_URL);
    url.searchParams.set("url", post.url);
    url.searchParams.set("omit_script", "true");
    url.searchParams.set("dnt", "true");

    const res = await deps.fetch(url, {
      headers: { "user-agent": deps.userAgent, accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return post;

    const parsed = oembedSchema.safeParse(await res.json());
    if (!parsed.success) return post;

    // <blockquote><p>tweet text</p>&mdash; Name (@handle) <a>date</a></blockquote>
    const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(parsed.data.html)?.[1];
    const body = stripHtml(paragraph ?? parsed.data.html);
    if (!body) return post;

    const handle = parsed.data.author_url
      ? `@${new URL(parsed.data.author_url).pathname.replace(/^\//, "")}`
      : undefined;
    return {
      ...post,
      body,
      bodyIsSnippet: false,
      authorHandle: post.authorHandle ?? handle,
      authorUrl: post.authorUrl ?? parsed.data.author_url,
    };
  } catch {
    return post;
  }
}
