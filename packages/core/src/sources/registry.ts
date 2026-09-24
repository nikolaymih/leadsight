import { ProviderError, ValidationError } from "../errors.js";
import type { WebSearchBudget } from "../extractor/budget.js";
import { type RawPost, SOURCE_KINDS, type SourceKind } from "../types.js";
import { validateSourceConfig } from "./config.js";
import { hydratePost } from "./hydrate/index.js";
import { createRedditClient } from "./reddit/client.js";
import { createRedditSearchSource } from "./reddit/search.js";
import { createRedditSubredditSource } from "./reddit/subreddit.js";
import { createRssSource } from "./rss.js";
import type { Source, SourceDeps } from "./source.js";
import type { SearchProvider } from "./web-search/provider.js";
import { createSearchRotator, type SearchRotator } from "./web-search/rotator.js";
import { createWebSearchSource } from "./web-search/source.js";

// The pipeline resolves adapters through the registry by `kind`; nothing else imports
// adapters directly. Kinds whose credentials are missing (web_search without an Exa or Tavily
// key, the Reddit API kinds without REDDIT_CLIENT_ID) are still registered, as
// "disabled" adapters whose run() fails with a clear, non-retryable error — so a source of
// that kind shows the reason in its last_error instead of crashing the run or being silently
// skipped. `hydrate` lives here too because it is per platform, shared by every source kind.

export interface SourceRegistry {
  get(kind: SourceKind): Source;
  kinds(): readonly SourceKind[];
  /** Kinds whose credentials are configured. */
  enabledKinds(): readonly SourceKind[];
  isEnabled(kind: SourceKind): boolean;
  /** Configured web search providers in fallback order (empty = web_search disabled). */
  webSearchProviders(): readonly string[];
  /** Fill a snippet-only post with the full text, per platform. Never throws. */
  hydrate(post: RawPost): Promise<RawPost>;
}

export interface SourceRegistryOptions extends Partial<Pick<SourceDeps, "fetch" | "now" | "sleep">> {
  userAgent: string;
  /** Reddit Data API app; our request was denied, so normally unset (docs/reddit-access.md). */
  reddit?: { clientId: string; clientSecret: string } | null;
  /** Web search providers in fallback order (Exa, Tavily); without any, web_search is disabled. */
  webSearchProviders?: readonly SearchProvider[];
  /** Monthly budgets the rotator consults (90% back-off, 100% hard stop). */
  webSearchBudget?: WebSearchBudget;
}

export const DISABLED_REASONS = {
  reddit: "Reddit API access is not configured (REDDIT_CLIENT_ID/SECRET unset; see docs/reddit-access.md)",
  webSearch: "Web search is not configured (EXA_API_KEY and TAVILY_API_KEY unset)",
} as const;

export function createSourceRegistry(options: SourceRegistryOptions): SourceRegistry {
  const reddit = options.reddit?.clientId && options.reddit.clientSecret ? options.reddit : null;
  const providers = options.webSearchProviders ?? [];

  const deps: SourceDeps = {
    fetch: options.fetch ?? fetch,
    now: options.now ?? (() => new Date()),
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    userAgent: options.userAgent,
    reddit: reddit ?? { clientId: "", clientSecret: "" },
  };

  const sources = new Map<SourceKind, { source: Source; enabled: boolean }>();
  sources.set("rss", { source: createRssSource(deps) as Source, enabled: true });

  let rotator: SearchRotator | null = null;
  if (providers.length > 0) {
    rotator = createSearchRotator({ providers, budget: options.webSearchBudget, now: deps.now });
    sources.set("web_search", { source: createWebSearchSource(deps, { rotator }) as Source, enabled: true });
  } else {
    sources.set("web_search", {
      source: disabled("web_search", "web_search", DISABLED_REASONS.webSearch),
      enabled: false,
    });
  }

  if (reddit) {
    const client = createRedditClient(deps);
    sources.set("reddit_subreddit", { source: createRedditSubredditSource(client) as Source, enabled: true });
    sources.set("reddit_search", { source: createRedditSearchSource(client) as Source, enabled: true });
  } else {
    sources.set("reddit_subreddit", {
      source: disabled("reddit_subreddit", "reddit", DISABLED_REASONS.reddit),
      enabled: false,
    });
    sources.set("reddit_search", {
      source: disabled("reddit_search", "reddit", DISABLED_REASONS.reddit),
      enabled: false,
    });
  }

  return {
    get(kind) {
      const entry = sources.get(kind);
      if (!entry) throw new ValidationError(`unknown source kind "${kind}"`);
      return entry.source;
    },
    kinds: () => SOURCE_KINDS,
    enabledKinds: () => SOURCE_KINDS.filter((k) => sources.get(k)?.enabled),
    isEnabled: (kind) => sources.get(kind)?.enabled ?? false,
    webSearchProviders: () => rotator?.providers ?? [],
    hydrate: (post) => hydratePost(post, deps),
  };
}

/** Validates config like the real adapter (so saved sources stay valid) but cannot run. */
function disabled(kind: SourceKind, provider: string, reason: string): Source {
  return {
    kind,
    validateConfig: (config) => validateSourceConfig(kind, config),
    async run() {
      throw new ProviderError(provider, reason, { retryable: false });
    },
  };
}
