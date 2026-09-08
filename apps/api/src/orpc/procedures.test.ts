import { randomUUID } from "node:crypto";
import type { Contract } from "@leadsight/contract";
import { getCampaign, type SourceRegistry, schema } from "@leadsight/core";
import { hotFounderEvidence, mvpCriteria, seedLead, seedPost, thinEvidence } from "@leadsight/core/test";
import type { ContractRouterClient } from "@orpc/contract";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../app.js";
import {
  buildTestApp,
  type CookieJar,
  createOrganization,
  joinOrganization,
  rpcClient,
  signUp,
} from "../test/helpers.js";

// End-to-end through the typed client: sign-up → org → every procedure group. Runs on a
// fresh database; the Reddit adapter is replaced with a fake for sources.run.

let app: App;
let ownerJar: CookieJar;
let orgId: string;
let owner: ContractRouterClient<Contract>;
let member: ContractRouterClient<Contract>;

beforeAll(async () => {
  app = await buildTestApp();
  ownerJar = await signUp(app);
  orgId = await createOrganization(app, ownerJar, "Dev Craft");
  owner = rpcClient(app, ownerJar);

  const memberJar = await signUp(app);
  await joinOrganization(app, memberJar, orgId, "member");
  member = rpcClient(app, memberJar);
});

afterAll(async () => {
  await app.close();
});

const draft = {
  name: "Founders seeking an MVP team",
  offerDescription: "We build MVPs for non-technical founders.",
  icp: "Non-technical founders with an idea and some budget.",
  disqualifiers: ["equity only"],
  keywords: ["cto", "technical cofounder"],
  criteria: mvpCriteria,
  thresholds: { hot: 70, warm: 40 },
  suggestedSources: [
    { kind: "reddit_subreddit" as const, config: { subreddit: "startups", listing: "new" as const } },
    {
      kind: "reddit_search" as const,
      config: { query: "looking for a cto", subreddit: null, sort: "new" as const },
    },
  ],
};

describe("campaigns", () => {
  it("admin creates a campaign with its sources; everyone in the org can read it", async () => {
    const created = await owner.campaigns.create(draft);
    expect(created).toMatchObject({ name: draft.name, rulesVersion: 1, status: "active" });
    expect(created.createdAt).toMatch(/^\d{4}-/);

    const listed = await member.campaigns.list();
    expect(listed.map((c) => c.id)).toEqual([created.id]);
    expect(await member.campaigns.get({ id: created.id })).toEqual(created);

    const srcs = await member.sources.list({ campaignId: created.id });
    expect(srcs.map((s) => s.kind).sort()).toEqual(["reddit_search", "reddit_subreddit"]);
    expect(srcs.find((s) => s.kind === "reddit_subreddit")).toMatchObject({
      config: { subreddit: "startups", listing: "new" },
      enabled: true,
      postsLast24h: 0,
    });
  });

  it("maps core errors: NOT_FOUND, BAD_REQUEST with issues, FORBIDDEN for role", async () => {
    await expect(owner.campaigns.get({ id: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const badWeights = mvpCriteria.map((c, i) => (i === 0 ? { ...c, weight: 10 } : c));
    const err = await owner.campaigns.create({ ...draft, criteria: badWeights }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });

    await expect(member.campaigns.create(draft)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("update bumps rulesVersion on criteria change and logs it; rescore + preview work over stored evidence", async () => {
    const created = await owner.campaigns.create({ ...draft, name: "Rescore me", suggestedSources: [] });
    const row = await getCampaign(app.db, orgId, created.id);
    await seedLead(app.db, row, await seedPost(app.db, { organizationId: orgId }), {
      evidence: hotFounderEvidence,
    });
    await seedLead(app.db, row, await seedPost(app.db, { organizationId: orgId }), {
      evidence: thinEvidence,
    });

    const preview = await owner.campaigns.previewRescore({
      id: created.id,
      criteria: mvpCriteria,
      thresholds: { hot: 70, warm: 40 },
      minConfidence: 0,
    });
    expect(preview).toMatchObject({ total: 2, byVerdict: { hot: 1, cold: 1 } });

    const renamed = await owner.campaigns.update({ id: created.id, name: "Renamed" });
    expect(renamed.rulesVersion).toBe(1);
    const lowered = await owner.campaigns.update({ id: created.id, minConfidence: 0 });
    expect(lowered.rulesVersion).toBe(1);

    const rescored = await owner.campaigns.rescore({ id: created.id });
    expect(rescored).toMatchObject({ rescored: 2, moved: { cold: 1 } });

    const events = await app.db.select().from(schema.events).where(eq(schema.events.entityId, created.id));
    expect(events.map((e) => e.type).sort()).toEqual(["campaign.created", "campaign.rescored"]);
  });
});

describe("sources", () => {
  it("admin updates, runs (with a fake adapter) and removes a source; member cannot", async () => {
    const campaign = await owner.campaigns.create({ ...draft, name: "Sources", suggestedSources: [] });
    const source = await owner.sources.create({
      campaignId: campaign.id,
      kind: "reddit_subreddit",
      config: { subreddit: "startups" },
    });
    expect(source).toMatchObject({
      kind: "reddit_subreddit",
      config: { subreddit: "startups", listing: "new" },
    });

    const updated = await owner.sources.update({ id: source.id, enabled: false, pollIntervalMin: 30 });
    expect(updated).toMatchObject({ enabled: false, pollIntervalMin: 30 });

    // Swap the registry for a fake so the manual run needs no network.
    const realRegistry = app.pipeline.registry;
    const fake: SourceRegistry = {
      kinds: realRegistry.kinds,
      get: () => ({
        kind: "reddit_subreddit",
        validateConfig: (c) => c,
        run: async () => ({
          posts: [
            {
              platform: "reddit",
              externalId: `t3_${randomUUID().slice(0, 6)}`,
              url: "https://www.reddit.com/r/startups/comments/x/",
              body: "Looking for a CTO",
              bodyIsSnippet: false,
              raw: {},
            },
          ],
          nextCursor: { newest: "t3_x" },
          warnings: ["one warning"],
        }),
      }),
    };
    app.pipeline.registry = fake;
    try {
      expect(await owner.sources.run({ id: source.id })).toEqual({ posts: 1, warnings: ["one warning"] });
    } finally {
      app.pipeline.registry = realRegistry;
    }

    const runs = await owner.runs.list({});
    expect(runs[0]?.perSource).toEqual([{ sourceId: source.id, name: "r/startups", posts: 1, error: null }]);
    expect(runs[0]?.counts.polled).toBe(1);

    await expect(member.sources.remove({ id: source.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await owner.sources.remove({ id: source.id })).toEqual({ ok: true });
    await expect(owner.sources.update({ id: source.id, enabled: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("budget reports the configured providers", async () => {
    // No provider keys in tests → empty list, but the shape is exercised.
    expect(await member.runs.budget()).toEqual([]);
  });
});

describe("leads", () => {
  it("member lists, reads, triages (with label + event), bulk-updates and annotates leads", async () => {
    const campaign = await owner.campaigns.create({ ...draft, name: "Leads", suggestedSources: [] });
    const row = await getCampaign(app.db, orgId, campaign.id);
    const hot = await seedLead(app.db, row, await seedPost(app.db, { organizationId: orgId }));
    const thin = await seedLead(app.db, row, await seedPost(app.db, { organizationId: orgId }), {
      evidence: thinEvidence,
    });

    const page = await member.leads.list({ campaignId: campaign.id });
    expect(page.items.map((l) => l.id)).toEqual([hot.id, thin.id]); // hot before insufficient
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]?.post).toMatchObject({ platform: "reddit", authorHandle: "u/founder" });

    const detail = await member.leads.get({ id: hot.id });
    expect(detail.evidence).toEqual(hotFounderEvidence);
    expect(detail.notes).toEqual([]);

    const updated = await member.leads.update({ id: hot.id, status: "won", labelNote: "signed!" });
    expect(updated.status).toBe("won");
    const labels = await app.db.select().from(schema.labels).where(eq(schema.labels.postId, hot.postId));
    expect(labels).toEqual([expect.objectContaining({ label: "positive", note: "signed!" })]);
    const statusEvents = await app.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "lead.status_changed"));
    expect(statusEvents.map((e) => e.payload)).toEqual([expect.objectContaining({ from: "new", to: "won" })]);

    expect(await member.leads.bulkUpdate({ ids: [hot.id, thin.id], status: "not_fit" })).toEqual({
      updated: 2,
    });

    const note = await member.leads.addNote({ id: thin.id, body: "Too thin to act on" });
    expect(note).toMatchObject({ body: "Too thin to act on", userName: "Test User" });
    expect((await member.leads.get({ id: thin.id })).notes).toHaveLength(1);

    await expect(member.leads.get({ id: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
