import { z } from "zod";
import { type SourceConfigFor, validateSourceConfig } from "../config.js";
import type { Source, SourceRunResult } from "../source.js";
import type { RedditClient } from "./client.js";
import { parseListing } from "./listing.js";

// /search with sort=new. Search has no reliable `before`, so the cursor is the newest
// created_utc seen and older results are filtered client-side.

export type RedditSearchConfig = SourceConfigFor<"reddit_search">;

const cursorSchema = z.object({ newestCreatedUtc: z.number() }).partial();

const PAGE_SIZE = 100;
const MAX_PAGES = 3;

export function createRedditSearchSource(client: RedditClient): Source<RedditSearchConfig> {
  return {
    kind: "reddit_search",

    validateConfig(config) {
      return validateSourceConfig("reddit_search", config);
    },

    async run(config, rawCursor): Promise<SourceRunResult> {
      const cursor = cursorSchema.safeParse(rawCursor ?? {});
      const since = cursor.success ? cursor.data.newestCreatedUtc : undefined;

      const path = config.subreddit
        ? `/r/${encodeURIComponent(config.subreddit)}/search.json`
        : "/search.json";
      const params = {
        q: config.query,
        sort: config.sort,
        limit: PAGE_SIZE,
        t: "week",
        restrict_sr: config.subreddit ? 1 : undefined,
        type: "link",
      };

      const result: SourceRunResult = { posts: [], nextCursor: { newestCreatedUtc: since }, warnings: [] };
      let newestSeen = since;
      let after: string | undefined;

      for (let page = 0; page < MAX_PAGES; page++) {
        const listing = parseListing(await client.get(path, { ...params, after }));
        result.warnings.push(...listing.warnings);
        if (listing.names.length === 0) break;

        if (listing.newestCreatedUtc !== null) {
          newestSeen = Math.max(newestSeen ?? 0, listing.newestCreatedUtc);
        }

        let sawOld = false;
        for (const post of listing.posts) {
          const createdUtc = post.postedAt ? post.postedAt.getTime() / 1000 : 0;
          if (since !== undefined && createdUtc <= since) {
            sawOld = true;
            continue;
          }
          result.posts.push(post);
        }

        if (sawOld || !listing.after) break;
        after = listing.after;
      }

      result.nextCursor = { newestCreatedUtc: newestSeen };
      return result;
    },
  };
}
