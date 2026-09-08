import { and, desc, eq } from "drizzle-orm";
import { campaigns, type Label, labels, posts } from "../schema/index.js";
import type { Platform } from "../types.js";
import type { DbLike } from "./client.js";

export interface LabeledExample extends Label {
  post: { platform: Platform; title: string | null; body: string };
}

/**
 * Most recent labels for a campaign joined to the post text — the raw material for
 * few-shot examples. Labels carry no organization_id, so the campaign row scopes them.
 */
export async function listRecentLabels(
  db: DbLike,
  orgId: string,
  campaignId: string,
  opts: { limit?: number; label?: "positive" | "negative" } = {},
): Promise<LabeledExample[]> {
  const rows = await db
    .select({ label: labels, platform: posts.platform, title: posts.title, body: posts.body })
    .from(labels)
    .innerJoin(campaigns, eq(campaigns.id, labels.campaignId))
    .innerJoin(posts, eq(posts.id, labels.postId))
    .where(
      and(
        eq(campaigns.organizationId, orgId),
        eq(labels.campaignId, campaignId),
        opts.label ? eq(labels.label, opts.label) : undefined,
      ),
    )
    .orderBy(desc(labels.createdAt), desc(labels.id))
    .limit(opts.limit ?? 50);

  return rows.map((r) => ({ ...r.label, post: { platform: r.platform, title: r.title, body: r.body } }));
}
