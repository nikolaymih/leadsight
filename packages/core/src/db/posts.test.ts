import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postSources, posts } from "../schema/index.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { seedCampaign, seedLead, seedSource, TEST_ORG } from "../test/seed.js";
import type { RawPost } from "../types.js";
import { findExtractionCandidates, upsertPosts } from "./posts.js";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

describe("db/posts", () => {
  it("dedupes on (org, platform, externalId), links every source, and is idempotent", async () => {
    const c = await seedCampaign(t.db);
    const s1 = await seedSource(t.db, c);
    const s2 = await seedSource(t.db, c);

    const first = await upsertPosts(t.db, TEST_ORG, s1.id, [raw("a"), raw("b")]);
    expect(first).toMatchObject({ inserted: 2, linked: 2 });
    expect(first.postIds).toHaveLength(2);

    const overlap = await upsertPosts(t.db, TEST_ORG, s2.id, [raw("a"), raw("c")]);
    expect(overlap).toMatchObject({ inserted: 1, linked: 2 });
    expect(overlap.postIds[0]).toBe(first.postIds[0]); // same row for "a"

    const again = await upsertPosts(t.db, TEST_ORG, s2.id, [raw("a"), raw("c")]);
    expect(again).toMatchObject({ inserted: 0, linked: 0 });

    expect(await t.db.select().from(posts)).toHaveLength(3);
    expect(await t.db.select().from(postSources)).toHaveLength(4);
  });

  it("keeps organizations apart even for the same external post", async () => {
    const mine = await seedSource(t.db, await seedCampaign(t.db));
    const theirs = await seedSource(t.db, await seedCampaign(t.db, { organizationId: "org_other" }));

    await upsertPosts(t.db, TEST_ORG, mine.id, [raw("a")]);
    const other = await upsertPosts(t.db, "org_other", theirs.id, [raw("a")]);

    expect(other.inserted).toBe(1);
    expect(await t.db.select().from(posts)).toHaveLength(2);
  });

  it("returns the campaign's posts without a lead, oldest first, honouring limit", async () => {
    const a = await seedCampaign(t.db);
    const b = await seedCampaign(t.db, { name: "Other campaign" });
    const sourceA = await seedSource(t.db, a);
    const sourceB = await seedSource(t.db, b);

    const { postIds } = await upsertPosts(t.db, TEST_ORG, sourceA.id, [raw("1"), raw("2"), raw("3")]);
    await upsertPosts(t.db, TEST_ORG, sourceB.id, [raw("b-only")]);

    const [scoredId] = postIds;
    if (!scoredId) throw new Error("expected post ids");
    const [scoredPost] = await t.db.select().from(posts).where(eq(posts.id, scoredId));
    if (!scoredPost) throw new Error("expected the post row");
    await seedLead(t.db, a, scoredPost);

    // Posts from one batch share a fetched_at, so their relative order is by uuid — arbitrary.
    const unscored = await findExtractionCandidates(t.db, TEST_ORG, a);
    expect(unscored.map((p) => p.externalId).sort()).toEqual(["t3_2", "t3_3"]);

    expect(await findExtractionCandidates(t.db, TEST_ORG, a, 1)).toHaveLength(1);
    expect(await findExtractionCandidates(t.db, "org_other", a)).toHaveLength(0);
  });

  it("pre-filters: keyword-scoped sources always qualify, others need a campaign keyword in the text", async () => {
    const c = await seedCampaign(t.db); // keywords: cto, technical cofounder, mvp
    const subreddit = await seedSource(t.db, c, {
      kind: "reddit_subreddit",
      config: { subreddit: "startups" },
    });
    const search = await seedSource(t.db, c); // reddit_search → keyword-scoped

    await upsertPosts(t.db, TEST_ORG, subreddit.id, [
      raw("hit-body", { body: "Looking for a CTO to build our app" }),
      raw("hit-title", { title: "Need a technical cofounder", body: "details inside" }),
      raw("miss", { body: "Show HN: my weekend project" }),
      raw("like-chars", { body: "100% unrelated_text" }),
    ]);
    await upsertPosts(t.db, TEST_ORG, search.id, [raw("scoped", { body: "no keyword here at all" })]);

    const ids = (await findExtractionCandidates(t.db, TEST_ORG, c)).map((p) => p.externalId).sort();
    expect(ids).toEqual(["t3_hit-body", "t3_hit-title", "t3_scoped"]);

    // No keywords at all: only keyword-scoped sources can contribute.
    expect(
      (await findExtractionCandidates(t.db, TEST_ORG, { id: c.id, keywords: [] })).map((p) => p.externalId),
    ).toEqual(["t3_scoped"]);
    // LIKE metacharacters in keywords are literal.
    expect(
      (await findExtractionCandidates(t.db, TEST_ORG, { id: c.id, keywords: ["100%"] }))
        .map((p) => p.externalId)
        .sort(),
    ).toEqual(["t3_like-chars", "t3_scoped"]);
  });
});

function raw(id: string, overrides: Partial<RawPost> = {}): RawPost {
  return {
    platform: "reddit",
    externalId: `t3_${id}`,
    url: `https://www.reddit.com/r/startups/comments/${id}/`,
    body: `post ${id}`,
    bodyIsSnippet: false,
    raw: { id },
    ...overrides,
  };
}
