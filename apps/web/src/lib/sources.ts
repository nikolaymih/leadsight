import type { sourceConfigSchema } from "@leadsight/contract";
import type { z } from "zod";
import { PLATFORM_LABEL } from "@/lib/format";

type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const SOURCE_KIND_LABEL: Record<SourceConfig["kind"], string> = {
  google_search: "Google search",
  rss: "RSS / Alerts",
  reddit_subreddit: "Subreddit (Reddit API)",
  reddit_search: "Reddit search (Reddit API)",
};

/** Kinds shown in the add-source form, primary first. Reddit API kinds only when the API has credentials. */
export function selectableKinds(enabled: readonly string[]): SourceConfig["kind"][] {
  const all: SourceConfig["kind"][] = ["google_search", "rss", "reddit_subreddit", "reddit_search"];
  return all.filter((k) => k === "rss" || enabled.includes(k));
}

/** One-line summary of a source's config, mirroring core's describeSource for the UI. */
export function describeSourceConfig(source: SourceConfig): string {
  switch (source.kind) {
    case "google_search": {
      const [first, ...rest] = source.config.phrases;
      const scope = source.config.siteScope ? ` in ${source.config.siteScope}` : "";
      return `${PLATFORM_LABEL[source.config.platform] ?? source.config.platform}: “${first ?? "?"}”${rest.length ? ` +${rest.length}` : ""}${scope}`;
    }
    case "reddit_subreddit":
      return `r/${source.config.subreddit}${source.config.listing === "hot" ? " (hot)" : ""}`;
    case "reddit_search":
      return `“${source.config.query}”${source.config.subreddit ? ` in r/${source.config.subreddit}` : ""}`;
    case "rss":
      return `${PLATFORM_LABEL[source.config.platform] ?? source.config.platform} feed`;
  }
}
