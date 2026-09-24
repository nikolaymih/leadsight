import { randomUUID } from "node:crypto";
import type { DbLike } from "../db/client.js";
import { applyRules } from "../rules/index.js";
import {
  type Campaign,
  campaigns,
  type Lead,
  leads,
  type NewCampaign,
  type NewLead,
  type NewPost,
  type NewSource,
  type Post,
  posts,
  type Source,
  sources,
  user,
} from "../schema/index.js";
import { hotFounderEvidence, mvpCriteria } from "./fixtures.js";

// Seed helpers for DB tests. Use these instead of hand-written inserts.
// Offer-specific text is fine here: this is test data, not product code.

export const TEST_ORG = "org_test";
export const TEST_USER = "user_test";

export async function seedUser(db: DbLike, overrides: { id?: string; name?: string; email?: string } = {}) {
  const id = overrides.id ?? TEST_USER;
  const [row] = await db
    .insert(user)
    .values({ id, name: overrides.name ?? "Test User", email: overrides.email ?? `${id}@example.com` })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function seedCampaign(db: DbLike, overrides: Partial<NewCampaign> = {}): Promise<Campaign> {
  const [row] = await db
    .insert(campaigns)
    .values({
      organizationId: TEST_ORG,
      name: "Founders seeking an MVP team",
      offerDescription: "We build MVPs for non-technical founders.",
      icp: "Non-technical founders with an idea and some budget.",
      disqualifiers: ["equity only"],
      keywords: ["cto", "technical cofounder", "mvp"],
      criteria: mvpCriteria,
      createdBy: TEST_USER,
      ...overrides,
    })
    .returning();
  return must(row);
}

export async function seedSource(
  db: DbLike,
  campaign: Campaign,
  overrides: Partial<NewSource> = {},
): Promise<Source> {
  const [row] = await db
    .insert(sources)
    .values({
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      kind: "reddit_search",
      config: { query: "looking for a technical cofounder", subreddit: null, sort: "new" },
      ...overrides,
    })
    .returning();
  return must(row);
}

export async function seedPost(db: DbLike, overrides: Partial<NewPost> = {}): Promise<Post> {
  const externalId = overrides.externalId ?? `t3_${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(posts)
    .values({
      organizationId: TEST_ORG,
      platform: "reddit",
      externalId,
      url: `https://www.reddit.com/r/startups/comments/${externalId}/`,
      authorHandle: "u/founder",
      title: "Looking for a CTO to build the first version",
      body: "I come from hospitality and have an idea for a booking SaaS. Haven't built anything yet.",
      bodyIsSnippet: false,
      postedAt: new Date(),
      ...overrides,
    })
    .returning();
  return must(row);
}

/** A lead scored with the real rules over the given evidence (default: a hot founder). */
export async function seedLead(
  db: DbLike,
  campaign: Campaign,
  post: Post,
  overrides: Partial<NewLead> = {},
): Promise<Lead> {
  const evidence = overrides.evidence ?? hotFounderEvidence;
  const scored = applyRules(campaign, evidence, { bodyIsSnippet: post.bodyIsSnippet });
  const [row] = await db
    .insert(leads)
    .values({
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      postId: post.id,
      evidence,
      score: scored.score,
      scoreBreakdown: scored.breakdown,
      confidence: scored.confidence,
      verdict: scored.verdict,
      summary: evidence.summary,
      extractorProvider: "fake",
      promptVersion: "test",
      rulesVersion: campaign.rulesVersion,
      ...overrides,
    })
    .returning();
  return must(row);
}

function must<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("insert returned no row");
  return row;
}
