import type { RawPost } from "../../types.js";
import type { SourceDeps } from "../source.js";
import { hydrateLinkedIn } from "./linkedin.js";
import { hydrateReddit } from "./reddit.js";
import { hydrateX } from "./x.js";

// Hydration is per platform, not per source: a snippet from Google search and one from a
// Google Alerts feed are filled the same way. Facebook and generic web stay snippet-only.
// Best-effort and never throws; the caller compares bodies to see whether it helped.

export async function hydratePost(post: RawPost, deps: SourceDeps): Promise<RawPost> {
  if (!post.bodyIsSnippet) return post;
  switch (post.platform) {
    case "linkedin":
      return hydrateLinkedIn(post, deps);
    case "x":
      return hydrateX(post, deps);
    case "reddit":
      return hydrateReddit(post, deps);
    default:
      return post;
  }
}

export { hydrateLinkedIn, hydrateReddit, hydrateX };
