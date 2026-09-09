import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetExhaustedError, ProviderError } from "../errors.js";
import type { ExtractionInput, ExtractionResult, Extractor } from "../extractor/extractor.js";
import type { Notifier } from "../notify/notifier.js";
import { type Campaign, events, leads, posts, sources } from "../schema/index.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { Source as SourceAdapter, SourceRunResult } from "../sources/source.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { hotFounderEvidence, thinEvidence } from "../test/fixtures.js";
import { seedCampaign, seedSource, TEST_ORG } from "../test/seed.js";
import { type RawPost, SOURCE_KINDS, type SourceKind } from "../types.js";
import { PIPELINE_EVENTS, type PipelineDeps, runPipeline } from "./run.js";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

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

interface FakeAdapterOptions {
  posts?: RawPost[];
  nextCursor?: unknown;
  warnings?: string[];
  fail?: Error;
  hydrate?: (post: RawPost) => RawPost;
}

function adapter(kind: SourceKind, opts: FakeAdapterOptions = {}): SourceAdapter & { runs: unknown[] } {
  const runs: unknown[] = [];
  const result: SourceRunResult = {
    posts: opts.posts ?? [],
    nextCursor: opts.nextCursor ?? null,
    warnings: opts.warnings ?? [],
  };
  return {
    kind,
    runs,
    validateConfig: (config) => config,
    async run(_config, cursor) {
      runs.push(cursor);
      if (opts.fail) throw opts.fail;
      return result;
    },
    ...(opts.hydrate ? { hydrate: async (post: RawPost) => (opts.hydrate ?? ((p) => p))(post) } : {}),
  };
}

function registry(adapters: Partial<Record<SourceKind, SourceAdapter>>): SourceRegistry {
  const enabled = SOURCE_KINDS.filter((k) => adapters[k] !== undefined);
  return {
    get(kind) {
      const a = adapters[kind];
      if (!a) throw new Error(`no fake adapter for ${kind}`);
      return a;
    },
    kinds: () => SOURCE_KINDS,
    enabledKinds: () => enabled,
    isEnabled: (kind) => adapters[kind] !== undefined,
    // Hydration is per platform in the real registry; the fake delegates to the rss adapter's hook.
    hydrate: async (post) => (adapters.rss?.hydrate ? adapters.rss.hydrate(post) : post),
  };
}

function extractor(
  opts: { drop?: string[]; thin?: string[]; fail?: Error } = {},
): Extractor & { calls: ExtractionInput[] } {
  const calls: ExtractionInput[] = [];
  return {
    calls,
    async extract(input): Promise<ExtractionResult> {
      calls.push(input);
      if (opts.fail) throw opts.fail;
      const drop = new Set(opts.drop ?? []);
      const thin = new Set(opts.thin ?? []);
      return {
        results: input.posts
          .filter((p) => !drop.has(p.externalId))
          .map((p) => ({
            postExternalId: p.externalId,
            evidence: thin.has(p.externalId) ? thinEvidence : hotFounderEvidence,
          })),
        dropped: input.posts
          .filter((p) => drop.has(p.externalId))
          .map((p) => ({ postExternalId: p.externalId, reason: "missing from response" })),
        provider: "fake/model",
        promptVersion: "test.1",
        usage: { promptTokens: 10, completionTokens: 5 },
      };
    },
  };
}

function notifier(
  name = "fake",
  fail?: Error,
): Notifier & { calls: { campaignId: string; leadIds: string[] }[] } {
  const calls: { campaignId: string; leadIds: string[] }[] = [];
  return {
    name,
    calls,
    async notify(leadsIn, campaign) {
      calls.push({ campaignId: campaign.id, leadIds: leadsIn.map((l) => l.id) });
      if (fail) throw fail;
    },
  };
}

const silentLogger = { info() {}, warn() {}, error() {} };

function deps(
  overrides: Partial<PipelineDeps> & Pick<PipelineDeps, "registry" | "extractorFor">,
): PipelineDeps {
  return { db: t.db, notifiers: [], logger: silentLogger, ...overrides };
}

async function eventsOfType(type: string) {
  return t.db.select().from(events).where(eq(events.type, type));
}

// ---------------------------------------------------------------------------

describe("runPipeline", () => {
  let campaign: Campaign;
  beforeEach(async () => {
    campaign = await seedCampaign(t.db); // keywords: cto, technical cofounder, mvp; minScoreAlert 70
  });

  it("polls due sources, dedupes, pre-filters, hydrates, extracts, scores, notifies and logs per org", async () => {
    const subreddit = await seedSource(t.db, campaign, {
      kind: "reddit_subreddit",
      config: { subreddit: "startups" },
    });
    const search = await seedSource(t.db, campaign, { kind: "reddit_search", config: { query: "cto" } });
    const alerts = await seedSource(t.db, campaign, {
      kind: "rss",
      config: { url: "https://x", platform: "linkedin" },
    });

    const subredditAdapter = adapter("reddit_subreddit", {
      posts: [
        raw("A", { body: "Founder looking for a CTO" }),
        raw("B", { body: "unrelated weekend project" }),
      ],
      nextCursor: { newest: "t3_A" },
      warnings: ["listing: skipped 1 removed/deleted post(s)"],
    });
    const rssAdapter = adapter("rss", {
      posts: [
        raw("D", {
          platform: "linkedin",
          url: "https://www.linkedin.com/posts/d",
          body: "short snippet",
          bodyIsSnippet: true,
        }),
      ],
      hydrate: (p) => ({
        ...p,
        body: "the full hydrated post body about a CTO search",
        bodyIsSnippet: false,
        authorHandle: "Jane",
      }),
    });
    const ex = extractor({ drop: ["t3_C"] });
    const slack = notifier("slack");

    const result = await runPipeline(
      deps({
        registry: registry({
          reddit_subreddit: subredditAdapter,
          reddit_search: adapter("reddit_search", {
            posts: [raw("C", { body: "no keyword, but search is scoped" })],
          }),
          rss: rssAdapter,
        }),
        extractorFor: () => ex,
        notifiers: [slack],
      }),
    );

    // Counts: 4 posts polled, B filtered out, D hydrated, C dropped by the model, A + D scored & hot.
    const report = result.perOrg[TEST_ORG];
    expect(report?.counts).toEqual({
      polled: 4,
      prefiltered: 3,
      hydrated: 1,
      extracted: 2,
      scored: 2,
      notified: 2,
    });
    expect(report?.errors).toEqual([]);
    expect(report?.perSource.map((s) => [s.sourceId, s.posts, s.error])).toEqual(
      expect.arrayContaining([
        [subreddit.id, 2, null],
        [search.id, 1, null],
        [alerts.id, 1, null],
      ]),
    );
    expect(report?.perSource.find((s) => s.sourceId === subreddit.id)?.warnings).toEqual([
      "listing: skipped 1 removed/deleted post(s)",
    ]);
    expect(report?.perSource.find((s) => s.sourceId === subreddit.id)?.name).toBe("r/startups");

    // Cursor + lastRunAt persisted
    const [sub] = await t.db.select().from(sources).where(eq(sources.id, subreddit.id));
    expect(sub?.cursor).toEqual({ newest: "t3_A" });
    expect(sub?.lastRunAt).toBeInstanceOf(Date);
    expect(sub?.lastError).toBeNull();

    // The extractor saw only candidates (not B), with the campaign's criteria and no weights leaking
    expect(ex.calls).toHaveLength(1);
    expect(ex.calls[0]?.posts.map((p) => p.externalId).sort()).toEqual(["t3_A", "t3_C", "t3_D"]);
    expect(ex.calls[0]?.campaign.criteria).toEqual(campaign.criteria);

    // Hydration wrote through to the post row
    const [d] = await t.db.select().from(posts).where(eq(posts.externalId, "t3_D"));
    expect(d).toMatchObject({ bodyIsSnippet: false, authorHandle: "Jane" });
    expect(d?.body).toContain("full hydrated");

    // Leads scored with the real rules
    const scored = await t.db.select().from(leads);
    expect(scored).toHaveLength(2);
    expect(
      scored.every(
        (l) => l.verdict === "hot" && l.extractorProvider === "fake/model" && l.promptVersion === "test.1",
      ),
    ).toBe(true);
    expect(scored.every((l) => l.rulesVersion === campaign.rulesVersion)).toBe(true);

    // Notified once with both hot leads
    expect(slack.calls).toEqual([
      { campaignId: campaign.id, leadIds: expect.arrayContaining(scored.map((l) => l.id)) },
    ]);

    // Events: per-org run report, one per source, one dropped
    const runs = await eventsOfType(PIPELINE_EVENTS.run);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.payload).toMatchObject({ id: result.id, counts: report?.counts });
    expect(await eventsOfType(PIPELINE_EVENTS.sourceRun)).toHaveLength(3);
    const dropped = await eventsOfType(PIPELINE_EVENTS.extractDropped);
    const [c] = await t.db.select().from(posts).where(eq(posts.externalId, "t3_C"));
    expect(dropped.map((e) => e.entityId)).toEqual([c?.id]);

    // Second run: nothing due, only the dropped post is still a candidate
    const again = await runPipeline(
      deps({ registry: registry({}), extractorFor: () => extractor({ drop: ["t3_C"] }), notifiers: [slack] }),
    );
    expect(again.perOrg[TEST_ORG]?.counts).toEqual({
      polled: 0,
      prefiltered: 1,
      hydrated: 0,
      extracted: 0,
      scored: 0,
      notified: 0,
    });
    expect(subredditAdapter.runs).toHaveLength(1);
  });

  it("records a failing source and keeps going with the others", async () => {
    const broken = await seedSource(t.db, campaign, { kind: "reddit_subreddit", config: { subreddit: "x" } });
    await seedSource(t.db, campaign, { kind: "reddit_search", config: { query: "cto" } });

    const result = await runPipeline(
      deps({
        registry: registry({
          reddit_subreddit: adapter("reddit_subreddit", {
            fail: new ProviderError("reddit", "HTTP 503", { status: 503, retryable: true }),
          }),
          reddit_search: adapter("reddit_search", { posts: [raw("ok", { body: "hello" })] }),
        }),
        extractorFor: () => extractor(),
      }),
    );

    const report = result.perOrg[TEST_ORG];
    expect(report?.counts.polled).toBe(1);
    expect(report?.errors).toEqual(["r/x: reddit: HTTP 503"]);
    expect(report?.perSource.find((s) => s.sourceId === broken.id)?.error).toBe("reddit: HTTP 503");

    const [row] = await t.db.select().from(sources).where(eq(sources.id, broken.id));
    expect(row?.lastError).toBe("reddit: HTTP 503");
    expect(row?.lastRunAt).toBeInstanceOf(Date); // waits its interval instead of hammering
    expect(await eventsOfType(PIPELINE_EVENTS.sourceError)).toHaveLength(1);
  });

  it("stops extracting when the budget is exhausted and leaves posts unscored for next time", async () => {
    await seedSource(t.db, campaign, { kind: "reddit_search", config: { query: "cto" } });
    const result = await runPipeline(
      deps({
        registry: registry({ reddit_search: adapter("reddit_search", { posts: [raw("a"), raw("b")] }) }),
        extractorFor: () => extractor({ fail: new BudgetExhaustedError(["groq", "gemini"]) }),
      }),
    );

    expect(result.perOrg[TEST_ORG]?.counts).toMatchObject({
      polled: 2,
      prefiltered: 2,
      extracted: 0,
      scored: 0,
    });
    expect(result.perOrg[TEST_ORG]?.errors[0]).toMatch(/budget exhausted/);
    expect(await t.db.select().from(leads)).toHaveLength(0);
    expect(await eventsOfType(PIPELINE_EVENTS.budgetExhausted)).toHaveLength(1);
  });

  it("does not alert on insufficient/low leads, and a failing notifier is recorded, not fatal", async () => {
    await seedSource(t.db, campaign, { kind: "reddit_search", config: { query: "cto" } });
    const failing = notifier("email", new Error("smtp down"));
    const ok = notifier("slack");

    const result = await runPipeline(
      deps({
        registry: registry({ reddit_search: adapter("reddit_search", { posts: [raw("hot"), raw("thin")] }) }),
        extractorFor: () => extractor({ thin: ["t3_thin"] }),
        notifiers: [failing, ok],
      }),
    );

    expect(result.perOrg[TEST_ORG]?.counts).toMatchObject({ scored: 2, notified: 1 });
    expect(ok.calls[0]?.leadIds).toHaveLength(1);
    expect(result.perOrg[TEST_ORG]?.errors).toEqual(["notify email: smtp down"]);
  });

  it("manual run: polls exactly the given source even when it is not due", async () => {
    const recent = await seedSource(t.db, campaign, {
      kind: "reddit_search",
      config: { query: "cto" },
      lastRunAt: new Date(),
    });
    const other = await seedSource(t.db, campaign, { kind: "reddit_subreddit", config: { subreddit: "x" } });
    const searchAdapter = adapter("reddit_search", { posts: [raw("m")] });
    const subAdapter = adapter("reddit_subreddit", { posts: [raw("n")] });

    const result = await runPipeline(
      deps({
        registry: registry({ reddit_search: searchAdapter, reddit_subreddit: subAdapter }),
        extractorFor: () => extractor(),
        sourceIds: [recent.id],
      }),
    );

    expect(searchAdapter.runs).toHaveLength(1);
    expect(subAdapter.runs).toHaveLength(0);
    expect(result.perOrg[TEST_ORG]?.perSource.map((s) => s.sourceId)).toEqual([recent.id]);
    void other;
  });
});
