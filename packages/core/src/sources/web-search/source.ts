import { z } from "zod";
import { validateSourceConfig } from "../config.js";
import type { Source, SourceDeps, SourceRunResult } from "../source.js";
import {
  buildOrQuery,
  dedupePosts,
  hitToRawPost,
  inScope,
  isPostUrl,
  LOOKBACK_DAYS,
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
      const providers = new Set<string>();
      let total = 0;
      let outsideScope = 0;
      let notPost = 0;

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
        providers.add(out.provider);
        total += out.hits.length;
        for (const hit of out.hits) {
          if (!inScope(hit.url, scope)) {
            outsideScope += 1;
            continue;
          }
          if (!isPostUrl(config.platform, hit.url)) {
            notPost += 1;
            continue;
          }
          const post = hitToRawPost(hit, config.platform);
          if (post) posts.push(post);
        }
      }

      result.posts = dedupePosts(posts);
      // One line saying what the search returned, so a run with 0 new posts explains itself.
      if (providers.size > 0) {
        result.warnings.push(
          describeResults({
            providers: [...providers],
            total,
            kept: result.posts.length,
            outsideScope,
            notPost,
            scope: scope ? `${scope.host}${scope.pathPrefix}` : null,
            lookbackDays: LOOKBACK_DAYS[config.lookback],
          }),
        );
      }
      if ((result.usage?.webSearch.length ?? 0) > 0) {
        result.nextCursor = { lastQueryAt: now.toISOString(), queries };
      }
      return result;
    },
  };
}

export function describeResults(r: {
  providers: readonly string[];
  total: number;
  kept: number;
  outsideScope: number;
  notPost: number;
  scope: string | null;
  lookbackDays: number;
}): string {
  const who = r.providers.join("+");
  const window = `the last ${r.lookbackDays} day${r.lookbackDays === 1 ? "" : "s"}`;
  if (r.total === 0) {
    return `${who}: no results in ${window}; try a longer lookback or broader phrases`;
  }
  const dropped = [
    r.outsideScope > 0 ? `${r.outsideScope} outside ${r.scope ?? "scope"}` : null,
    r.notPost > 0 ? `${r.notPost} not post pages` : null,
    r.total - r.outsideScope - r.notPost - r.kept > 0
      ? `${r.total - r.outsideScope - r.notPost - r.kept} duplicates`
      : null,
  ].filter((d) => d !== null);
  const plural = r.total === 1 ? "" : "s";
  return `${who}: ${r.total} result${plural} in ${window}, ${r.kept} kept${dropped.length > 0 ? ` (${dropped.join(", ")})` : ""}`;
}
