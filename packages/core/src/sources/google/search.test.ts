import { describe, expect, it } from "vitest";
import { ProviderError } from "../../errors.js";
import { fakeFetch, jsonResponse } from "../../test/fake-fetch.js";
import { createSourceRegistry, DISABLED_REASONS } from "../registry.js";
import type { SourceDeps } from "../source.js";
import { createGoogleSearchClient } from "./client.js";
import { BUDGET_SKIP_WARNING, createGoogleSearchSource } from "./search.js";

const NOW = new Date("2026-09-09T09:00:00Z");

function deps(routes: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(routes);
  const d: SourceDeps = {
    fetch: http.fetch,
    userAgent: "leadsight-test/0.1",
    now: () => NOW,
    sleep: async () => {},
    reddit: { clientId: "", clientSecret: "" },
  };
  return { http, deps: d };
}

function item(i: number, sub = "startups") {
  return {
    link: `https://www.reddit.com/r/${sub}/comments/id${i}/post_${i}/`,
    title: `Post ${i}`,
    snippet: `Snippet ${i} looking for a cto`,
  };
}

const CONFIG = { platform: "reddit" as const, phrases: ["looking for a cto"], lookback: "d1" as const };
const creds = { key: "K", cx: "CX" };

describe("google_search source", () => {
  it("runs one query, keeps post pages only, and reports usage", async () => {
    const { http, deps: d } = deps([
      {
        match: /customsearch\/v1/,
        respond: [
          jsonResponse({
            items: [item(1), { link: "https://www.reddit.com/r/startups/", title: "listing" }, item(2)],
            searchInformation: { totalResults: "3" },
          }),
        ],
      },
    ]);
    const source = createGoogleSearchSource(d, { credentials: creds });
    const result = await source.run(source.validateConfig(CONFIG), undefined);

    expect(result.posts.map((p) => p.externalId)).toEqual([
      "https://www.reddit.com/r/startups/comments/id1/post_1",
      "https://www.reddit.com/r/startups/comments/id2/post_2",
    ]);
    expect(result.posts[0]).toMatchObject({
      platform: "reddit",
      bodyIsSnippet: true,
      body: "Snippet 1 looking for a cto",
    });
    expect(result.usage).toEqual({ searchQueries: 1 });
    expect(result.warnings).toEqual(["1 result skipped: not a post page"]);
    expect(result.nextCursor).toEqual({
      lastQueryAt: NOW.toISOString(),
      query: 'site:reddit.com "looking for a cto"',
    });

    const [call] = http.callsTo(/customsearch/);
    expect(call?.url.searchParams.get("q")).toBe('site:reddit.com "looking for a cto"');
    expect(call?.url.searchParams.get("dateRestrict")).toBe("d1");
    expect(call?.url.searchParams.get("start")).toBe("1");
  });

  it("fetches page 2 only when page 1 was full, dedupes across pages, and never a page 3", async () => {
    const full = Array.from({ length: 10 }, (_, i) => item(i));
    const { http, deps: d } = deps([
      {
        match: /customsearch\/v1/,
        respond: (call) =>
          jsonResponse({
            items:
              call.url.searchParams.get("start") === "1"
                ? full
                : [item(9), ...Array.from({ length: 9 }, (_, i) => item(10 + i))],
          }),
      },
    ]);
    const source = createGoogleSearchSource(d, { credentials: creds });
    const result = await source.run(source.validateConfig(CONFIG), undefined);

    expect(http.callsTo(/customsearch/).map((c) => c.url.searchParams.get("start"))).toEqual(["1", "11"]);
    expect(result.posts).toHaveLength(19);
    expect(result.usage).toEqual({ searchQueries: 2 });
  });

  it("skips the run with a warning when the budget gate says no, and skips page 2 when it turns no", async () => {
    const full = Array.from({ length: 10 }, (_, i) => item(i));
    const { http, deps: d } = deps([{ match: /customsearch\/v1/, respond: [jsonResponse({ items: full })] }]);

    const blocked = createGoogleSearchSource(d, { credentials: creds, canQuery: async () => false });
    const skipped = await blocked.run(blocked.validateConfig(CONFIG), {
      lastQueryAt: NOW.toISOString(),
      query: "q",
    });
    expect(skipped.posts).toEqual([]);
    expect(skipped.usage).toEqual({ searchQueries: 0 });
    expect(skipped.warnings).toEqual([BUDGET_SKIP_WARNING]);
    expect(skipped.nextCursor).toEqual({ lastQueryAt: NOW.toISOString(), query: "q" });
    expect(http.calls).toHaveLength(0);

    let calls = 0;
    const onePage = createGoogleSearchSource(d, { credentials: creds, canQuery: async () => calls++ === 0 });
    const result = await onePage.run(onePage.validateConfig(CONFIG), undefined);
    expect(result.posts).toHaveLength(10);
    expect(result.usage).toEqual({ searchQueries: 1 });
    expect(http.calls).toHaveLength(1);
  });

  it("turns a page-2 failure into a warning but keeps page 1; a page-1 failure throws", async () => {
    const full = Array.from({ length: 10 }, (_, i) => item(i));
    const { deps: d } = deps([
      {
        match: /customsearch\/v1/,
        respond: [
          jsonResponse({ items: full }),
          jsonResponse(
            { error: { code: 429, message: "Quota exceeded", errors: [{ reason: "rateLimitExceeded" }] } },
            { status: 429 },
          ),
        ],
      },
    ]);
    const source = createGoogleSearchSource(d, { credentials: creds });
    const result = await source.run(source.validateConfig(CONFIG), undefined);
    expect(result.posts).toHaveLength(10);
    expect(result.usage).toEqual({ searchQueries: 2 });
    expect(result.warnings[0]).toMatch(/page 2: google_cse: daily query quota exceeded/);

    const { deps: failing } = deps([
      {
        match: /customsearch\/v1/,
        respond: [
          jsonResponse({ error: { code: 403, errors: [{ reason: "dailyLimitExceeded" }] } }, { status: 403 }),
        ],
      },
    ]);
    const bad = createGoogleSearchSource(failing, { credentials: creds });
    await expect(bad.run(bad.validateConfig(CONFIG), undefined)).rejects.toMatchObject({
      name: "ProviderError",
      status: 403,
      retryable: false,
    });
  });

  it("client: 5xx is retryable, malformed items are dropped, network errors are wrapped", async () => {
    const { deps: d } = deps([
      {
        match: /customsearch\/v1/,
        respond: [
          new Response("upstream", { status: 503 }),
          jsonResponse({ items: [{ nolink: true }, item(1)] }),
        ],
      },
    ]);
    const client = createGoogleSearchClient(d, creds);
    await expect(client.search({ q: "x", lookback: "d1", start: 1 })).rejects.toMatchObject({
      retryable: true,
      status: 503,
    });
    const page = await client.search({ q: "x", lookback: "d1", start: 1 });
    expect(page.items).toHaveLength(1);

    const { deps: offline } = deps([]);
    const err = await createGoogleSearchClient(offline, creds)
      .search({ q: "x", lookback: "d1", start: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(true);
  });
});

describe("registry feature flags", () => {
  it("disables kinds without credentials but still validates their config", async () => {
    const registry = createSourceRegistry({ userAgent: "t", fetch: fakeFetch([]).fetch });
    expect(registry.enabledKinds()).toEqual(["rss"]);
    expect(registry.isEnabled("google_search")).toBe(false);

    const google = registry.get("google_search");
    expect(google.validateConfig(CONFIG)).toMatchObject({ platform: "reddit" });
    await expect(google.run(CONFIG, undefined)).rejects.toMatchObject({
      name: "ProviderError",
      retryable: false,
      message: `google_cse: ${DISABLED_REASONS.google}`,
    });
    await expect(registry.get("reddit_search").run({}, undefined)).rejects.toThrow(DISABLED_REASONS.reddit);

    const enabled = createSourceRegistry({
      userAgent: "t",
      fetch: fakeFetch([]).fetch,
      google: creds,
      reddit: { clientId: "id", clientSecret: "s" },
    });
    expect([...enabled.enabledKinds()].sort()).toEqual([
      "google_search",
      "reddit_search",
      "reddit_subreddit",
      "rss",
    ]);
  });
});
