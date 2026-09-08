import { z } from "zod";
import type { RawPost } from "../../types.js";
import { stripMarkdown } from "../text.js";

// Reddit listing payloads → RawPost. External data, so every child is validated
// individually; a malformed child becomes a warning, never a failed run.

export const redditPostSchema = z.object({
  kind: z.literal("t3"),
  data: z
    .object({
      id: z.string(),
      name: z.string(),
      title: z.string(),
      selftext: z.string().default(""),
      author: z.string(),
      permalink: z.string(),
      created_utc: z.number(),
      subreddit: z.string(),
      is_self: z.boolean().optional(),
      url: z.string().optional(),
    })
    .passthrough(),
});

export const redditListingSchema = z.object({
  data: z.object({
    children: z.array(z.unknown()),
    after: z.string().nullable().optional(),
    before: z.string().nullable().optional(),
  }),
});

export type RedditPost = z.infer<typeof redditPostSchema>;

export interface ParsedListing {
  posts: RawPost[];
  /** Fullnames in listing order, including posts skipped as removed/deleted. */
  names: string[];
  after: string | null;
  newestCreatedUtc: number | null;
  warnings: string[];
}

const GONE = new Set(["[removed]", "[deleted]"]);

export function parseListing(payload: unknown): ParsedListing {
  const listing = redditListingSchema.safeParse(payload);
  if (!listing.success) {
    return {
      posts: [],
      names: [],
      after: null,
      newestCreatedUtc: null,
      warnings: ["listing: unexpected payload shape"],
    };
  }

  const out: ParsedListing = {
    posts: [],
    names: [],
    after: listing.data.data.after ?? null,
    newestCreatedUtc: null,
    warnings: [],
  };
  let skipped = 0;

  listing.data.data.children.forEach((child, i) => {
    const parsed = redditPostSchema.safeParse(child);
    if (!parsed.success) {
      out.warnings.push(`listing: child ${i} did not match the post shape`);
      return;
    }
    const { data } = parsed.data;
    out.names.push(data.name);
    out.newestCreatedUtc = Math.max(out.newestCreatedUtc ?? 0, data.created_utc);

    if (GONE.has(data.selftext) || GONE.has(data.author)) {
      skipped += 1;
      return;
    }
    out.posts.push(toRawPost(parsed.data));
  });

  if (skipped > 0) out.warnings.push(`listing: skipped ${skipped} removed/deleted post(s)`);
  return out;
}

export function toRawPost(post: RedditPost): RawPost {
  const { data } = post;
  const body = stripMarkdown(data.selftext);
  return {
    platform: "reddit",
    externalId: data.name,
    url: `https://www.reddit.com${data.permalink}`,
    authorHandle: `u/${data.author}`,
    authorUrl: `https://www.reddit.com/user/${data.author}`,
    title: data.title,
    // Link posts have no selftext; the title is the only text we have.
    body: body.length > 0 ? body : data.title,
    bodyIsSnippet: false,
    postedAt: new Date(data.created_utc * 1000),
    raw: data,
  };
}
