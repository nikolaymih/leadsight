import Parser from "rss-parser";
import { z } from "zod";
import { ProviderError } from "../errors.js";
import type { RawPost } from "../types.js";
import { type SourceConfigFor, validateSourceConfig } from "./config.js";
import { hydratePost } from "./hydrate/index.js";
import { REQUEST_TIMEOUT_MS, type Source, type SourceDeps, type SourceRunResult } from "./source.js";
import { stripHtml } from "./text.js";
import { canonicalUrl, unwrapGoogleRedirect } from "./url.js";

// Any RSS/Atom feed; built for Google Alerts. Items carry only a snippet, so posts are
// marked bodyIsSnippet and `hydrate` tries the platform-specific fetch later.

export type RssConfig = SourceConfigFor<"rss">;

const cursorSchema = z.object({ newestPublished: z.string().datetime() }).partial();

type FeedItem = Parser.Item & { published?: string };

export function createRssSource(deps: SourceDeps): Source<RssConfig> {
  const parser = new Parser<Record<string, never>, FeedItem>({ customFields: { item: ["published"] } });

  return {
    kind: "rss",

    validateConfig(config) {
      return validateSourceConfig("rss", config);
    },

    async run(config, rawCursor): Promise<SourceRunResult> {
      const cursor = cursorSchema.safeParse(rawCursor ?? {});
      const since =
        cursor.success && cursor.data.newestPublished ? new Date(cursor.data.newestPublished) : undefined;

      const res = await deps.fetch(config.url, {
        headers: {
          "user-agent": deps.userAgent,
          accept: "application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new ProviderError("rss", `GET feed: HTTP ${res.status}`, {
          status: res.status,
          retryable: res.status >= 500,
        });
      }

      let feed: { items: FeedItem[] };
      try {
        feed = await parser.parseString(await res.text());
      } catch (err) {
        throw new ProviderError("rss", "feed is not valid RSS/Atom", { cause: err });
      }

      const result: SourceRunResult = {
        posts: [],
        nextCursor: { newestPublished: since?.toISOString() },
        warnings: [],
      };
      let newest = since;

      feed.items.forEach((item, i) => {
        const published = parseDate(item.published ?? item.isoDate ?? item.pubDate);
        if (published && (!newest || published > newest)) newest = published;
        if (since && published && published <= since) return;

        const post = toRawPost(item, config.platform, published);
        if (!post) {
          result.warnings.push(`item ${i}: no usable link`);
          return;
        }
        result.posts.push(post);
      });

      result.nextCursor = { newestPublished: newest?.toISOString() };
      return result;
    },

    hydrate: (post) => hydratePost(post, deps),
  };
}

function toRawPost(
  item: FeedItem,
  platform: RssConfig["platform"],
  postedAt: Date | undefined,
): RawPost | undefined {
  if (!item.link) return undefined;
  const target = unwrapGoogleRedirect(item.link);
  let externalId: string;
  try {
    externalId = canonicalUrl(target);
  } catch {
    return undefined;
  }

  const title = item.title ? stripHtml(item.title) : undefined;
  const snippet = stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? "");

  return {
    platform,
    externalId,
    url: target,
    title: title || undefined,
    body: snippet || title || target,
    bodyIsSnippet: true,
    postedAt,
    raw: item,
  };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
