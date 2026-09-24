import { z } from "zod";
import { validateSourceConfig } from "../config.js";
import type { Source, SourceDeps, SourceRunResult } from "../source.js";
import {
  buildOrQuery,
  dedupePosts,
  hitToRawPost,
  inScope,
  isPostUrl,
  lookbackStart,
  MAX_QUERIES_PER_RUN,
  normalizePhrases,
  packPhrases,
  parseSiteScope,
  RESULTS_PER_QUERY,
  type WebSearchConfig,
} from "./query.js";
import type { SearchRotator } from "./rotator.js";

// Primary discovery source for Reddit, LinkedIn and X: phrases OR-ed into as few queries as
// fit (normally one), restricted to the platform's domain and the lookback window, served by
// whichever provider the rotator picks. Results are filtered to post pages inside the site
// scope, deduped by canonical URL and stored as snippets; hydration fetches full text later.
// A second packed query failing is a warning; the first failing throws so the source's
// last_error shows it. Usage goes back to the pipeline, which books it against the budgets.

export const BUDGET_SKIP_WARNING_PREFIX = "web search skipped:";

const cursorSchema = z.object({ lastQueryAt: z.string().datetime(), queries: z.array(z.string()) }).partial();

export interface WebSearchSourceOptions {
  rotator: SearchRotator;
}

export function createWebSearchSource(
  deps: SourceDeps,
  opts: WebSearchSourceOptions,
): Source<WebSearchConfig> {
  return {
    kind: "web_search",

    validateConfig(config) {
      return validateSourceConfig("web_search", config);
    },

    async run(config, rawCursor): Promise<SourceRunResult> {
      const previous = cursorSchema.safeParse(rawCursor ?? {});
      const result: SourceRunResult = {
        posts: [],
        nextCursor: previous.success ? previous.data : {},
        warnings: [],
        usage: { webSearch: [] },
      };

      const phrases = normalizePhrases(config.phrases);
      if (phrases.length === 0) {
        result.warnings.push("no usable phrases");
        return result;
      }
      const groups = packPhrases(phrases);
      if (groups.length > MAX_QUERIES_PER_RUN) {
        const dropped = groups.slice(MAX_QUERIES_PER_RUN).flat().length;
        result.warnings.push(
          `${dropped} phrase${dropped === 1 ? "" : "s"} did not fit in ${MAX_QUERIES_PER_RUN} queries`,
        );
      }
      const queries = groups.slice(0, MAX_QUERIES_PER_RUN).map(buildOrQuery);

      const scope = parseSiteScope(config.siteScope, config.platform);
      const now = deps.now();
      const since = lookbackStart(config.lookback, now);
      const posts: NonNullable<ReturnType<typeof hitToRawPost>>[] = [];
      let skipped = 0;

      for (const [i, query] of queries.entries()) {
        let out: Awaited<ReturnType<SearchRotator["search"]>>;
        try {
          out = await opts.rotator.search({
            query,
            includeDomains: scope ? [scope.host] : [],
            since,
            maxResults: RESULTS_PER_QUERY,
            platform: config.platform,
          });
        } catch (err) {
          if (i === 0) throw err;
          result.warnings.push(`query ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        if ("skipped" in out) {
          result.warnings.push(`${BUDGET_SKIP_WARNING_PREFIX} ${out.reason}`);
          break;
        }
        result.usage?.webSearch.push(...out.usage);
        for (const hit of out.hits) {
          if (!inScope(hit.url, scope) || !isPostUrl(config.platform, hit.url)) {
            skipped += 1;
            continue;
          }
          const post = hitToRawPost(hit, config.platform);
          if (post) posts.push(post);
        }
      }

      result.posts = dedupePosts(posts);
      if (skipped > 0) {
        result.warnings.push(
          `${skipped} result${skipped === 1 ? "" : "s"} skipped: outside scope or not a post page`,
        );
      }
      if ((result.usage?.webSearch.length ?? 0) > 0) {
        result.nextCursor = { lastQueryAt: now.toISOString(), queries };
      }
      return result;
    },
  };
}
