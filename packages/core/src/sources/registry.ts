import { ValidationError } from "../errors.js";
import { SOURCE_KINDS, type SourceKind } from "../types.js";
import { createRedditClient } from "./reddit/client.js";
import { createRedditSearchSource } from "./reddit/search.js";
import { createRedditSubredditSource } from "./reddit/subreddit.js";
import { createRssSource } from "./rss.js";
import type { Source, SourceDeps } from "./source.js";

// The pipeline resolves adapters through the registry by `kind`; nothing else imports
// adapters directly.

export interface SourceRegistry {
  get(kind: SourceKind): Source;
  kinds(): readonly SourceKind[];
}

export type SourceRegistryOptions = Partial<Pick<SourceDeps, "fetch" | "now" | "sleep">> &
  Pick<SourceDeps, "userAgent" | "reddit">;

export function createSourceRegistry(options: SourceRegistryOptions): SourceRegistry {
  const deps: SourceDeps = {
    fetch: options.fetch ?? fetch,
    now: options.now ?? (() => new Date()),
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    userAgent: options.userAgent,
    reddit: options.reddit,
  };

  const reddit = createRedditClient(deps);
  const sources = new Map<SourceKind, Source>([
    ["reddit_subreddit", createRedditSubredditSource(reddit) as Source],
    ["reddit_search", createRedditSearchSource(reddit) as Source],
    ["rss", createRssSource(deps) as Source],
  ]);

  return {
    get(kind) {
      const source = sources.get(kind);
      if (!source) throw new ValidationError(`unknown source kind "${kind}"`);
      return source;
    },
    kinds: () => SOURCE_KINDS,
  };
}
