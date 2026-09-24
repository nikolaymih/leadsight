import { z } from "zod";
import { type SourceConfigFor, validateSourceConfig } from "../config.js";
import type { Source, SourceRunResult } from "../source.js";
import type { RedditClient } from "./client.js";
import { parseListing } from "./listing.js";

// /r/{sub}/{listing}: walk newer-than-cursor pages with `before`. Cursor is the newest
// fullname seen. See docs/design.md §3.1.

export type RedditSubredditConfig = SourceConfigFor<"reddit_subreddit">;

const cursorSchema = z.object({ newest: z.string() }).partial();

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export function createRedditSubredditSource(client: RedditClient): Source<RedditSubredditConfig> {
  return {
    kind: "reddit_subreddit",

    validateConfig(config) {
      return validateSourceConfig("reddit_subreddit", config);
    },

    async run(config, rawCursor): Promise<SourceRunResult> {
      const cursor = cursorSchema.safeParse(rawCursor ?? {});
      const startFrom = cursor.success ? cursor.data.newest : undefined;
      const path = `/r/${encodeURIComponent(config.subreddit)}/${config.listing}.json`;

      const result: SourceRunResult = { posts: [], nextCursor: { newest: startFrom }, warnings: [] };
      let before = startFrom;
      let newest: string | undefined;

      for (let page = 0; page < MAX_PAGES; page++) {
        const listing = parseListing(await client.get(path, { limit: PAGE_SIZE, before }));
        result.warnings.push(...listing.warnings);

        if (listing.names.length === 0) {
          // Either nothing new, or the cursor post was deleted and Reddit returns an
          // empty page. Fall back to one plain page so the cursor can move again;
          // dedupe on insert makes re-seeing posts harmless.
          if (page === 0 && before !== undefined) {
            const fresh = parseListing(await client.get(path, { limit: PAGE_SIZE }));
            result.warnings.push("cursor yielded no posts; refetched the latest page", ...fresh.warnings);
            result.posts.push(...fresh.posts);
            newest = fresh.names[0] ?? newest;
          }
          break;
        }

        result.posts.push(...listing.posts);
        newest ??= listing.names[0];
        before = listing.names[0];
        if (listing.names.length < PAGE_SIZE) break;
      }

      result.nextCursor = { newest: newest ?? startFrom };
      return result;
    },
  };
}
