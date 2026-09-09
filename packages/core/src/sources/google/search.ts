import { z } from "zod";
import type { RawPost } from "../../types.js";
import { validateSourceConfig } from "../config.js";
import type { Source, SourceDeps, SourceRunResult } from "../source.js";
import { createGoogleSearchClient, type GoogleSearchClient, type GoogleSearchCredentials } from "./client.js";
import {
  buildSearchQuery,
  type GoogleSearchConfig,
  isPostUrl,
  RESULTS_PER_PAGE,
  resultToRawPost,
  shouldFetchNextPage,
} from "./query.js";

// Primary discovery source: Google search over a platform's public pages, restricted to the
// last day and sorted by date. One query per source per poll (a second page only when the
// first was full), so a source costs 1–2 of the daily query budget per run. Results carry a
// snippet only; hydration fetches the full text per platform later.

export interface GoogleSearchSourceOptions {
  credentials: GoogleSearchCredentials;
  /** Budget gate, checked before every request. Default: always allowed. */
  canQuery?: () => Promise<boolean>;
  /** Injected for tests; default builds one over `deps`. */
  client?: GoogleSearchClient;
}

const cursorSchema = z.object({ lastQueryAt: z.string().datetime(), query: z.string() }).partial();

export const BUDGET_SKIP_WARNING =
  "search budget: daily query cap nearly reached; skipped until midnight UTC";

export function createGoogleSearchSource(
  deps: SourceDeps,
  opts: GoogleSearchSourceOptions,
): Source<GoogleSearchConfig> {
  const client = opts.client ?? createGoogleSearchClient(deps, opts.credentials);
  const canQuery = opts.canQuery ?? (async () => true);

  return {
    kind: "google_search",

    validateConfig(config) {
      return validateSourceConfig("google_search", config);
    },

    async run(config, rawCursor): Promise<SourceRunResult> {
      const previous = cursorSchema.safeParse(rawCursor ?? {});
      const q = buildSearchQuery(config);
      const result: SourceRunResult = {
        posts: [],
        nextCursor: previous.success ? previous.data : {},
        warnings: [],
        usage: { searchQueries: 0 },
      };

      if (!(await canQuery())) {
        result.warnings.push(BUDGET_SKIP_WARNING);
        return result;
      }

      const seen = new Set<string>();
      let skipped = 0;
      const collect = (items: Parameters<typeof resultToRawPost>[0][]) => {
        for (const item of items) {
          if (!isPostUrl(config.platform, item.link)) {
            skipped += 1;
            continue;
          }
          const post = resultToRawPost(item, config.platform);
          if (!post || seen.has(post.externalId)) continue;
          seen.add(post.externalId);
          result.posts.push(post);
        }
      };

      // Page 1 failures propagate (the pipeline records last_error); usage so far is on the error.
      const first = await client.search({ q, lookback: config.lookback, start: 1 });
      result.usage = { searchQueries: 1 };
      collect(first.items);

      if (shouldFetchNextPage(first.items.length, 2) && (await canQuery())) {
        try {
          const second = await client.search({ q, lookback: config.lookback, start: RESULTS_PER_PAGE + 1 });
          result.usage = { searchQueries: 2 };
          collect(second.items);
        } catch (err) {
          result.usage = { searchQueries: 2 };
          result.warnings.push(`page 2: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (skipped > 0)
        result.warnings.push(`${skipped} result${skipped === 1 ? "" : "s"} skipped: not a post page`);
      result.nextCursor = { lastQueryAt: deps.now().toISOString(), query: q };
      return result;
    },
  };
}

export type { RawPost };
