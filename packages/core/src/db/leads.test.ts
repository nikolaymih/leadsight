import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../errors.js";
import type { Campaign } from "../schema/index.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { hotFounderEvidence } from "../test/fixtures.js";
import { seedCampaign, seedLead, seedPost, seedUser, TEST_ORG, TEST_USER } from "../test/seed.js";
import type { Verdict } from "../types.js";
import { listRecentLabels } from "./labels.js";
import {
  addLeadNote,
  bulkUpdateLeads,
  getLead,
  type LeadSort,
  type LeadWithPost,
  listLeads,
  updateLead,
  upsertLead,
} from "./leads.js";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

// hot → disqualified, with ties inside "hot"; every lead shares the same evidence so
// the confidence sort is all ties and exercises the tiebreakers.
const RANKED: [Verdict, number][] = [
  ["hot", 90],
  ["hot", 75],
  ["hot", 75],
  ["warm", 60],
  ["warm", 55],
  ["cold", 20],
  ["insufficient", 10],
  ["disqualified", 0],
];

async function seedRanked(campaign: Campaign) {
  for (const [verdict, score] of RANKED) {
    await seedLead(t.db, campaign, await seedPost(t.db), { verdict, score });
  }
}

async function collectPages(campaignId: string, sort: LeadSort, limit: number): Promise<LeadWithPost[]> {
  const items: LeadWithPost[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await listLeads(t.db, TEST_ORG, { campaignId }, { sort, limit, cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor);
  expect(pages).toBe(Math.ceil(RANKED.length / limit));
  return items;
}

describe("db/leads: scoring writes", () => {
  it("upsertLead overwrites scoring fields but keeps triage state", async () => {
    const c = await seedCampaign(t.db);
    const p = await seedPost(t.db);
    const base = {
      campaignId: c.id,
      postId: p.id,
      evidence: hotFounderEvidence,
      score: 80,
      scoreBreakdown: { explicit_ask: 30 },
      confidence: 90,
      verdict: "hot" as const,
      summary: "first pass",
      extractorProvider: "fake",
      promptVersion: "v1",
      rulesVersion: 1,
    };

    const first = await upsertLead(t.db, TEST_ORG, base);
    await updateLead(t.db, TEST_ORG, first.id, { status: "contacted", actorId: TEST_USER });

    const second = await upsertLead(t.db, TEST_ORG, { ...base, score: 55, verdict: "warm", rulesVersion: 2 });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("contacted");
    expect(second).toMatchObject({ score: 55, verdict: "warm", rulesVersion: 2 });
  });
});

describe("db/leads: inbox list", () => {
  let campaign: Campaign;
  beforeEach(async () => {
    campaign = await seedCampaign(t.db);
    await seedRanked(campaign);
  });

  it("rank sort: verdict order, score desc, stable across pages", async () => {
    const all = await collectPages(campaign.id, "rank", 3);
    expect(all).toHaveLength(RANKED.length);
    expect(new Set(all.map((l) => l.id)).size).toBe(RANKED.length);
    expect(all.map((l) => [l.verdict, l.score])).toEqual(RANKED);
    expect(all.every((l) => l.post.id === l.postId)).toBe(true);
  });

  it("newest and confidence sorts paginate through ties without gaps", async () => {
    for (const sort of ["newest", "confidence"] as const) {
      const all = await collectPages(campaign.id, sort, 3);
      expect(new Set(all.map((l) => l.id)).size).toBe(RANKED.length);
      for (let i = 1; i < all.length; i++) {
        const prev = all[i - 1];
        const cur = all[i];
        if (!prev || !cur) throw new Error("unreachable");
        expect(prev.scoredAt.getTime()).toBeGreaterThanOrEqual(cur.scoredAt.getTime());
      }
    }
  });

  it("applies filters and org scoping", async () => {
    const { items: hot } = await listLeads(t.db, TEST_ORG, { campaignId: campaign.id, verdict: ["hot"] });
    expect(hot).toHaveLength(3);

    const { items: strong } = await listLeads(t.db, TEST_ORG, { campaignId: campaign.id, minScore: 55 });
    expect(strong.map((l) => l.score)).toEqual([90, 75, 75, 60, 55]);

    const [target] = hot;
    if (!target) throw new Error("expected a hot lead");
    await updateLead(t.db, TEST_ORG, target.id, {
      status: "contacted",
      assigneeId: "user_2",
      actorId: TEST_USER,
    });

    const { items: contacted } = await listLeads(t.db, TEST_ORG, {
      campaignId: campaign.id,
      status: ["contacted"],
    });
    expect(contacted.map((l) => l.id)).toEqual([target.id]);
    const { items: assigned } = await listLeads(t.db, TEST_ORG, {
      campaignId: campaign.id,
      assigneeId: "user_2",
    });
    expect(assigned.map((l) => l.id)).toEqual([target.id]);

    const linkedin = await seedLead(t.db, campaign, await seedPost(t.db, { platform: "linkedin" }));
    const { items: byPlatform } = await listLeads(t.db, TEST_ORG, {
      campaignId: campaign.id,
      platform: ["linkedin"],
    });
    expect(byPlatform.map((l) => l.id)).toEqual([linkedin.id]);

    const { items: otherOrg } = await listLeads(t.db, "org_other", { campaignId: campaign.id });
    expect(otherOrg).toHaveLength(0);
  });

  it("rejects a malformed cursor", async () => {
    await expect(
      listLeads(t.db, TEST_ORG, { campaignId: campaign.id }, { cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("db/leads: triage and the label loop", () => {
  it("writes a label on won/lost/not_fit, replacing the previous one, and ignores other statuses", async () => {
    const c = await seedCampaign(t.db);
    const lead = await seedLead(t.db, c, await seedPost(t.db));

    await updateLead(t.db, TEST_ORG, lead.id, { status: "won", labelNote: "signed", actorId: TEST_USER });
    let labels = await listRecentLabels(t.db, TEST_ORG, c.id);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ label: "positive", note: "signed", createdBy: TEST_USER });
    expect(labels[0]?.post.body).toContain("hospitality");

    await updateLead(t.db, TEST_ORG, lead.id, { status: "lost", actorId: TEST_USER });
    labels = await listRecentLabels(t.db, TEST_ORG, c.id);
    expect(labels.map((l) => l.label)).toEqual(["negative"]);

    await updateLead(t.db, TEST_ORG, lead.id, { status: "reviewed", actorId: TEST_USER });
    expect(await listRecentLabels(t.db, TEST_ORG, c.id)).toHaveLength(1);

    expect(await listRecentLabels(t.db, "org_other", c.id)).toHaveLength(0);
    await expect(
      updateLead(t.db, "org_other", lead.id, { status: "won", actorId: TEST_USER }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("bulk-updates only the organization's leads and labels each of them", async () => {
    const mine = await seedCampaign(t.db);
    const theirs = await seedCampaign(t.db, { organizationId: "org_other" });
    const ownLeads = [];
    for (let i = 0; i < 3; i++) ownLeads.push(await seedLead(t.db, mine, await seedPost(t.db)));
    const foreign = await seedLead(t.db, theirs, await seedPost(t.db, { organizationId: "org_other" }));

    const updated = await bulkUpdateLeads(t.db, TEST_ORG, [...ownLeads.map((l) => l.id), foreign.id], {
      status: "not_fit",
      actorId: TEST_USER,
    });
    expect(updated).toBe(3);

    const labels = await listRecentLabels(t.db, TEST_ORG, mine.id);
    expect(labels.map((l) => l.label)).toEqual(["negative", "negative", "negative"]);
    expect((await getLead(t.db, "org_other", foreign.id)).status).toBe("new");
  });
});

describe("db/leads: detail and notes", () => {
  it("returns the post and notes with author names; scopes by org", async () => {
    await seedUser(t.db);
    const c = await seedCampaign(t.db);
    const post = await seedPost(t.db);
    const lead = await seedLead(t.db, c, post);

    const note = await addLeadNote(t.db, TEST_ORG, lead.id, TEST_USER, "Reached out on Reddit");
    expect(note.userName).toBe("Test User");

    const detail = await getLead(t.db, TEST_ORG, lead.id);
    expect(detail.post.id).toBe(post.id);
    expect(detail.notes.map((n) => [n.body, n.userName])).toEqual([["Reached out on Reddit", "Test User"]]);

    await expect(getLead(t.db, "org_other", lead.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addLeadNote(t.db, "org_other", lead.id, TEST_USER, "x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
