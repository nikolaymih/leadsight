import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../errors.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { seedCampaign, seedSource, TEST_ORG } from "../test/seed.js";
import type { RawPost } from "../types.js";
import { upsertPosts } from "./posts.js";
import { createSource, findDueSourcesAllOrgs, listSources, recordSourceRun } from "./sources.js";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

describe("db/sources", () => {
  it("validates config against the kind and applies defaults", async () => {
    const c = await seedCampaign(t.db);

    const created = await createSource(t.db, TEST_ORG, {
      campaignId: c.id,
      kind: "reddit_subreddit",
      config: { subreddit: "startups" },
    });
    expect(created.config).toEqual({ subreddit: "startups", listing: "new" });
    expect(created.pollIntervalMin).toBe(60);

    await expect(
      createSource(t.db, TEST_ORG, {
        campaignId: c.id,
        kind: "rss",
        config: { url: "not a url", platform: "web" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      createSource(t.db, "org_other", {
        campaignId: c.id,
        kind: "reddit_subreddit",
        config: { subreddit: "x" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("finds enabled sources that never ran or whose interval elapsed, across organizations", async () => {
    const mine = await seedCampaign(t.db);
    const theirs = await seedCampaign(t.db, { organizationId: "org_other" });

    const neverRan = await seedSource(t.db, mine);
    await seedSource(t.db, mine, { lastRunAt: minutesAgo(5), pollIntervalMin: 60 });
    const overdue = await seedSource(t.db, mine, { lastRunAt: minutesAgo(120), pollIntervalMin: 60 });
    await seedSource(t.db, mine, { enabled: false });
    const otherOrg = await seedSource(t.db, theirs);

    const due = await findDueSourcesAllOrgs(t.db);
    expect(due.map((s) => s.id).sort()).toEqual([neverRan.id, overdue.id, otherOrg.id].sort());
  });

  it("records a run: lastRunAt, cursor, and error state", async () => {
    const c = await seedCampaign(t.db);
    const s = await seedSource(t.db, c);

    await recordSourceRun(t.db, s.id, { ranAt: minutesAgo(1), error: "reddit: 503" });
    let [row] = await listSources(t.db, TEST_ORG, c.id);
    expect(row?.lastError).toBe("reddit: 503");
    expect(row?.cursor).toBeNull();

    const ranAt = new Date();
    await recordSourceRun(t.db, s.id, { ranAt, cursor: { after: "t3_abc" } });
    [row] = await listSources(t.db, TEST_ORG, c.id);
    expect(row?.lastError).toBeNull();
    expect(row?.cursor).toEqual({ after: "t3_abc" });
    expect(row?.lastRunAt?.getTime()).toBe(ranAt.getTime());
  });

  it("counts posts surfaced by each source in the last 24h", async () => {
    const c = await seedCampaign(t.db);
    const busy = await seedSource(t.db, c);
    const idle = await seedSource(t.db, c);

    await upsertPosts(t.db, TEST_ORG, busy.id, [raw("a"), raw("b")]);

    const listed = await listSources(t.db, TEST_ORG, c.id);
    expect(listed.find((s) => s.id === busy.id)?.postsLast24h).toBe(2);
    expect(listed.find((s) => s.id === idle.id)?.postsLast24h).toBe(0);
  });
});

function raw(id: string): RawPost {
  return {
    platform: "reddit",
    externalId: `t3_${id}`,
    url: `https://www.reddit.com/r/startups/comments/${id}/`,
    body: `post ${id}`,
    bodyIsSnippet: false,
    raw: { id },
  };
}
