import { describe, expect, it } from "vitest";
import { createMemoryWebSearchBudgetStore, createWebSearchBudget } from "../../extractor/budget.js";
import { fakeFetch } from "../../test/fake-fetch.js";
import { createSourceRegistry, DISABLED_REASONS } from "../registry.js";
import type { SourceDeps } from "../source.js";
import type { SearchHit, SearchProvider, SearchRequest } from "./provider.js";
import { createSearchRotator } from "./rotator.js";
import { BUDGET_SKIP_WARNING_PREFIX, createWebSearchSource } from "./source.js";

const NOW = new Date("2026-09-24T09:00:00Z");

const deps: SourceDeps = {
  fetch: fakeFetch([]).fetch,
  userAgent: "leadsight-test/0.1",
  now: () => NOW,
  sleep: async () => {},
  reddit: { clientId: "", clientSecret: "" },
};

function hit(path: string, snippet = "looking for a cto"): SearchHit {
  return { url: `https://www.reddit.com${path}`, title: path, snippet, raw: {} };
}

function fakeProvider(name: string, answer: (req: SearchRequest) => SearchHit[] | Error) {
  const requests: SearchRequest[] = [];
  const p: SearchProvider & { requests: SearchRequest[] } = {
    name,
    requests,
    async search(req) {
      requests.push(req);
      const out = answer(req);
      if (out instanceof Error) throw out;
      return { hits: out, units: 1 };
    },
  };
  return p;
}

const CONFIG = {
  platform: "reddit" as const,
  phrases: ["looking for a cto", "need a technical cofounder"],
  siteScope: "reddit.com/r/startups",
  lookback: "d1" as const,
};

describe("web_search source", () => {
  it("runs one OR-query scoped to the domain and window, keeps in-scope post pages, reports usage", async () => {
    const exa = fakeProvider("exa", () => [
      hit("/r/startups/comments/aaa/looking_for_a_cto/"),
      hit("/r/startups/comments/aaa/looking_for_a_cto/#comments"),
      hit("/r/SaaS/comments/bbb/other_sub/"),
      hit("/r/startups/"),
      hit("/r/startups/comments/ccc/need_a_technical_cofounder/"),
    ]);
    const source = createWebSearchSource(deps, { rotator: createSearchRotator({ providers: [exa] }) });
    const result = await source.run(source.validateConfig(CONFIG), undefined);

    expect(exa.requests).toEqual([
      {
        query: '"looking for a cto" OR "need a technical cofounder"',
        includeDomains: ["reddit.com"],
        since: new Date("2026-09-23T09:00:00Z"),
        maxResults: 20,
        platform: "reddit",
      },
    ]);
    expect(result.posts.map((p) => p.externalId)).toEqual([
      "https://www.reddit.com/r/startups/comments/aaa/looking_for_a_cto",
      "https://www.reddit.com/r/startups/comments/ccc/need_a_technical_cofounder",
    ]);
    expect(result.posts[0]).toMatchObject({ platform: "reddit", bodyIsSnippet: true });
    expect(result.usage).toEqual({ webSearch: [{ provider: "exa", units: 1 }] });
    expect(result.warnings).toEqual([
      "exa: 5 results in the last 1 day, 2 kept (1 outside reddit.com/r/startups, 1 not post pages, 1 duplicates)",
    ]);
    expect(result.nextCursor).toEqual({
      lastQueryAt: NOW.toISOString(),
      queries: ['"looking for a cto" OR "need a technical cofounder"'],
    });
  });

  it("returns nothing but a warning when every provider is at its monthly cap", async () => {
    const store = createMemoryWebSearchBudgetStore(() => NOW);
    const budget = createWebSearchBudget({ store, caps: { exa: 10 }, now: () => NOW });
    await store.record("org", "exa", 10);
    const exa = fakeProvider("exa", () => [hit("/r/startups/comments/aaa/t/")]);
    const source = createWebSearchSource(deps, {
      rotator: createSearchRotator({ providers: [exa], budget }),
    });

    const cursor = { lastQueryAt: "2026-09-23T09:00:00.000Z", queries: ["q"] };
    const result = await source.run(source.validateConfig(CONFIG), cursor);
    expect(exa.requests).toHaveLength(0);
    expect(result.posts).toEqual([]);
    expect(result.usage).toEqual({ webSearch: [] });
    expect(result.warnings[0]).toMatch(new RegExp(`^${BUDGET_SKIP_WARNING_PREFIX}.*monthly cap`));
    expect(result.nextCursor).toEqual(cursor);
  });

  it("throws when the first query fails everywhere, so last_error shows why", async () => {
    const exa = fakeProvider("exa", () => new Error("boom"));
    const source = createWebSearchSource(deps, { rotator: createSearchRotator({ providers: [exa] }) });
    await expect(source.run(source.validateConfig(CONFIG), undefined)).rejects.toMatchObject({
      name: "WebSearchUnavailableError",
    });
  });

  it("splits long phrase lists into two queries; a failing second query is a warning", async () => {
    const phrases = Array.from({ length: 10 }, (_, i) => `${"word ".repeat(12)}phrase number ${i}`);
    let n = 0;
    const exa = fakeProvider("exa", () =>
      ++n === 1 ? [hit("/r/startups/comments/aaa/t/")] : new Error("second fails"),
    );
    const source = createWebSearchSource(deps, { rotator: createSearchRotator({ providers: [exa] }) });
    const result = await source.run(source.validateConfig({ ...CONFIG, phrases }), undefined);

    expect(exa.requests).toHaveLength(2);
    expect(exa.requests.every((r) => r.query.length <= 400)).toBe(true);
    expect(result.posts).toHaveLength(1);
    expect(result.usage).toEqual({ webSearch: [{ provider: "exa", units: 1 }] });
    expect(result.warnings.some((w) => /did not fit in 2 queries/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /^query 2: .*second fails/.test(w))).toBe(true);
  });

  it("rejects configs without phrases or with more than ten", () => {
    const source = createWebSearchSource(deps, { rotator: createSearchRotator({ providers: [] }) });
    expect(() => source.validateConfig({ ...CONFIG, phrases: [] })).toThrow(/invalid web_search config/);
    expect(() =>
      source.validateConfig({ ...CONFIG, phrases: Array.from({ length: 11 }, (_, i) => `p${i}`) }),
    ).toThrow();
  });
});

describe("registry feature flags", () => {
  it("reports web_search as not configured without providers, but still validates its config", async () => {
    const registry = createSourceRegistry({ userAgent: "t", fetch: fakeFetch([]).fetch });
    expect(registry.enabledKinds()).toEqual(["rss"]);
    expect(registry.webSearchProviders()).toEqual([]);

    const web = registry.get("web_search");
    expect(web.validateConfig(CONFIG)).toMatchObject({ platform: "reddit", lookback: "d1" });
    await expect(web.run(CONFIG, undefined)).rejects.toMatchObject({
      name: "ProviderError",
      retryable: false,
      message: `web_search: ${DISABLED_REASONS.webSearch}`,
    });
    await expect(registry.get("reddit_search").run({}, undefined)).rejects.toThrow(DISABLED_REASONS.reddit);
  });

  it("enables web_search with any one provider and lists providers in fallback order", () => {
    const tavily = fakeProvider("tavily", () => []);
    const exa = fakeProvider("exa", () => []);
    const one = createSourceRegistry({
      userAgent: "t",
      fetch: fakeFetch([]).fetch,
      webSearchProviders: [tavily],
    });
    expect(one.isEnabled("web_search")).toBe(true);
    expect(one.webSearchProviders()).toEqual(["tavily"]);

    const both = createSourceRegistry({
      userAgent: "t",
      fetch: fakeFetch([]).fetch,
      webSearchProviders: [exa, tavily],
      reddit: { clientId: "id", clientSecret: "s" },
    });
    expect([...both.enabledKinds()].sort()).toEqual([
      "reddit_search",
      "reddit_subreddit",
      "rss",
      "web_search",
    ]);
    expect(both.webSearchProviders()).toEqual(["exa", "tavily"]);
  });
});
