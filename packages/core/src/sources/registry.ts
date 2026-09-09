import { ProviderError, ValidationError } from "../errors.js";
import { type RawPost, SOURCE_KINDS, type SourceKind } from "../types.js";
import { validateSourceConfig } from "./config.js";
import type { GoogleSearchCredentials } from "./google/client.js";
import { createGoogleSearchSource } from "./google/search.js";
import { hydratePost } from "./hydrate/index.js";
import { createRedditClient } from "./reddit/client.js";
import { createRedditSearchSource } from "./reddit/search.js";
import { createRedditSubredditSource } from "./reddit/subreddit.js";
import { createRssSource } from "./rss.js";
import type { Source, SourceDeps } from "./source.js";

// The pipeline resolves adapters through the registry by `kind`; nothing else imports
// adapters directly. Kinds whose credentials are missing are still registered, as
// "disabled" adapters whose run() fails with a clear, non-retryable error — so a source of
// that kind shows the reason in its last_error instead of crashing the run or being silently
// skipped. `hydrate` lives here too because it is per platform, shared by every source kind.

export interface SourceRegistry {
  get(kind: SourceKind): Source;
  kinds(): readonly SourceKind[];
  /** Kinds whose credentials are configured. */
  enabledKinds(): readonly SourceKind[];
  isEnabled(kind: SourceKind): boolean;
  /** Fill a snippet-only post with the full text, per platform. Never throws. */
  hydrate(post: RawPost): Promise<RawPost>;
}

export interface SourceRegistryOptions extends Partial<Pick<SourceDeps, "fetch" | "now" | "sleep">> {
  userAgent: string;
  /** Reddit Data API app; optional and rarely approved (docs/reddit-access.md). */
  reddit?: { clientId: string; clientSecret: string } | null;
  /** Google Programmable Search; without it google_search sources are disabled. */
  google?: GoogleSearchCredentials | null;
  /** Search query budget gate; default always allowed. */
  canSearch?: () => Promise<boolean>;
}

export const DISABLED_REASONS = {
  reddit: "Reddit API access is not configured (REDDIT_CLIENT_ID/SECRET unset; see docs/reddit-access.md)",
  google: "Google Programmable Search is not configured (GOOGLE_CSE_KEY/GOOGLE_CSE_CX unset)",
} as const;

export function createSourceRegistry(options: SourceRegistryOptions): SourceRegistry {
  const reddit = options.reddit?.clientId && options.reddit.clientSecret ? options.reddit : null;
  const google = options.google?.key && options.google.cx ? options.google : null;

  const deps: SourceDeps = {
    fetch: options.fetch ?? fetch,
    now: options.now ?? (() => new Date()),
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    userAgent: options.userAgent,
    reddit: reddit ?? { clientId: "", clientSecret: "" },
  };

  const sources = new Map<SourceKind, { source: Source; enabled: boolean }>();
  sources.set("rss", { source: createRssSource(deps) as Source, enabled: true });

  if (google) {
    const source = createGoogleSearchSource(deps, { credentials: google, canQuery: options.canSearch });
    sources.set("google_search", { source: source as Source, enabled: true });
  } else {
    sources.set("google_search", {
      source: disabled("google_search", "google_cse", DISABLED_REASONS.google),
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
