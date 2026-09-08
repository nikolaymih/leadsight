import type { sourceConfigSchema } from "@leadsight/contract";
import type { z } from "zod";
import { PLATFORM_LABEL } from "@/lib/format";

type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const SOURCE_KIND_LABEL: Record<SourceConfig["kind"], string> = {
  reddit_subreddit: "Subreddit",
  reddit_search: "Reddit search",
  rss: "RSS / Alerts",
};

/** One-line summary of a source's config, mirroring core's describeSource for the UI. */
export function describeSourceConfig(source: SourceConfig): string {
  switch (source.kind) {
    case "reddit_subreddit":
      return `r/${source.config.subreddit}${source.config.listing === "hot" ? " (hot)" : ""}`;
    case "reddit_search":
      return `“${source.config.query}”${source.config.subreddit ? ` in r/${source.config.subreddit}` : ""}`;
    case "rss":
      return `${PLATFORM_LABEL[source.config.platform] ?? source.config.platform} feed`;
  }
}
