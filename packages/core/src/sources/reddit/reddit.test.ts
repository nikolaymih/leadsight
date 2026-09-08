import { beforeAll, describe, expect, it } from "vitest";
import { ProviderError, ValidationError } from "../../errors.js";
import { type FakeFetch, fakeFetch, jsonResponse, loadJsonFixture } from "../../test/fake-fetch.js";
import type { SourceDeps } from "../source.js";
import { createRedditClient } from "./client.js";
import { parseListing } from "./listing.js";
import { createRedditSearchSource } from "./search.js";
import { createRedditSubredditSource } from "./subreddit.js";

let token: unknown;
let subredditNew: unknown;
let searchNew: unknown;

beforeAll(async () => {
  token = await loadJsonFixture("reddit/token.json");
  subredditNew = await loadJsonFixture("reddit/subreddit-new.json");
  searchNew = await loadJsonFixture("reddit/search-new.json");
});

interface Harness {
  http: FakeFetch;
  deps: SourceDeps;
  slept: number[];
  clock: { now: Date };
}

function harness(routes: Parameters<typeof fakeFetch>[0]): Harness {
  const slept: number[] = [];
  const clock = { now: new Date("2026-09-08T08:00:00Z") };
  const http = fakeFetch([{ match: "/api/v1/access_token", respond: () => jsonResponse(token) }, ...routes]);
  const deps: SourceDeps = {
    fetch: http.fetch,
    userAgent: "leadsight-test/0.1",
    now: () => clock.now,
    sleep: async (ms) => {
      slept.push(ms);
    },
    reddit: { clientId: "id", clientSecret: "secret" },
  };
  return { http, deps, slept, clock };
}

const emptyListing = { kind: "Listing", data: { children: [], after: null, before: null } };

describe("reddit client", () => {
  it("mints a token with basic auth once and reuses it until it nears expiry", async () => {
    const h = harness([{ match: "oauth.reddit.com", respond: () => jsonResponse(emptyListing) }]);
    const client = createRedditClient(h.deps);

    await client.get("/r/startups/new.json");
    await client.get("/r/startups/new.json");
    expect(h.http.callsTo("/api/v1/access_token")).toHaveLength(1);

    const [tokenCall] = h.http.callsTo("/api/v1/access_token");
    expect(tokenCall?.method).toBe("POST");
    expect(tokenCall?.headers.authorization).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(tokenCall?.headers["user-agent"]).toBe("leadsight-test/0.1");
    expect(tokenCall?.body).toBe("grant_type=client_credentials");

    const [apiCall] = h.http.callsTo("oauth.reddit.com");
    expect(apiCall?.headers.authorization).toBe("Bearer fixture-token-abc123");
    expect(apiCall?.url.searchParams.get("raw_json")).toBe("1");

    h.clock.now = new Date(h.clock.now.getTime() + 86_400_000); // past expiry
    await client.get("/r/startups/new.json");
    expect(h.http.callsTo("/api/v1/access_token")).toHaveLength(2);
  });

  it("waits for the rate-limit window when remaining requests run low", async () => {
    const h = harness([
      {
        match: "oauth.reddit.com",
        respond: () =>
          jsonResponse(emptyListing, {
            headers: { "x-ratelimit-remaining": "2.0", "x-ratelimit-reset": "37" },
          }),
      },
    ]);
    await createRedditClient(h.deps).get("/r/startups/new.json");
    expect(h.slept).toEqual([37_000]);
  });

  it("retries once on 5xx/429 honouring Retry-After, then fails with a retryable ProviderError", async () => {
    const h = harness([
      {
        match: "oauth.reddit.com",
        respond: [
          jsonResponse({ error: "busy" }, { status: 503, headers: { "retry-after": "5" } }),
          jsonResponse(emptyListing),
        ],
      },
    ]);
    await expect(createRedditClient(h.deps).get("/search.json")).resolves.toEqual(emptyListing);
    expect(h.slept).toEqual([5_000]);
    expect(h.http.callsTo("oauth.reddit.com")).toHaveLength(2);

    const always503 = harness([
      { match: "oauth.reddit.com", respond: () => jsonResponse({}, { status: 503 }) },
    ]);
    const err = await createRedditClient(always503.deps)
      .get("/search.json")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ provider: "reddit", status: 503, retryable: true });
    expect(always503.http.callsTo("oauth.reddit.com")).toHaveLength(2);
  });

  it("re-authenticates once on 401", async () => {
    const h = harness([
      { match: "oauth.reddit.com", respond: [jsonResponse({}, { status: 401 }), jsonResponse(emptyListing)] },
    ]);
    await createRedditClient(h.deps).get("/r/x/new.json");
    expect(h.http.callsTo("/api/v1/access_token")).toHaveLength(2);
  });
});

describe("reddit listing parser", () => {
  it("maps posts, strips markdown, skips removed posts and non-post children with warnings", () => {
    const parsed = parseListing(subredditNew);

    expect(parsed.names).toEqual(["t3_1n1c0a1", "t3_1n1c0a2", "t3_1n1c0a3"]);
    expect(parsed.after).toBe("t3_1n1c0d3");
    expect(parsed.posts.map((p) => p.externalId)).toEqual(["t3_1n1c0a1", "t3_1n1c0a3"]);
    expect(parsed.warnings).toEqual([
      "listing: child 3 did not match the post shape",
      "listing: skipped 1 removed/deleted post(s)",
    ]);

    const [founder, link] = parsed.posts;
    expect(founder).toMatchObject({
      platform: "reddit",
      url: "https://www.reddit.com/r/startups/comments/1n1c0a1/nontechnical_founder_looking_for_a_cto/",
      authorHandle: "u/hosp_founder",
      authorUrl: "https://www.reddit.com/user/hosp_founder",
      title: "Non-technical founder looking for a CTO to build our MVP",
      bodyIsSnippet: false,
      postedAt: new Date(1757310000 * 1000),
    });
    expect(founder?.body).toBe(
      "I come from hospitality and have an idea for a booking SaaS. Haven't built anything yet.\n\nWe have a small seed round and are happy to pay a proper rate. More on our landing page.\n\nNot looking for equity-only arrangements.",
    );
    // Link posts have no selftext: the title stands in for the body.
    expect(link?.body).toBe("Interesting read on pricing experiments");
  });

  it("reports an unexpected payload as a single warning", () => {
    expect(parseListing({ nope: true })).toMatchObject({
      posts: [],
      warnings: ["listing: unexpected payload shape"],
    });
  });
});

describe("RedditSubredditSource", () => {
  it("validates config with defaults", () => {
    const source = createRedditSubredditSource(createRedditClient(harness([]).deps));
    expect(source.validateConfig({ subreddit: "startups" })).toEqual({
      subreddit: "startups",
      listing: "new",
    });
    expect(() => source.validateConfig({})).toThrow(ValidationError);
  });

  it("first run fetches the latest page; later runs pass `before` and advance the cursor", async () => {
    const h = harness([{ match: "/r/startups/new.json", respond: () => jsonResponse(subredditNew) }]);
    const source = createRedditSubredditSource(createRedditClient(h.deps));

    const first = await source.run({ subreddit: "startups", listing: "new" }, null);
    expect(first.posts).toHaveLength(2);
    expect(first.nextCursor).toEqual({ newest: "t3_1n1c0a1" });
    expect(h.http.callsTo("/r/startups/new.json")[0]?.url.searchParams.has("before")).toBe(false);

    const second = await source.run({ subreddit: "startups", listing: "new" }, first.nextCursor);
    const [, call] = h.http.callsTo("/r/startups/new.json");
    expect(call?.url.searchParams.get("before")).toBe("t3_1n1c0a1");
    expect(call?.url.searchParams.get("limit")).toBe("100");
    expect(second.nextCursor).toEqual({ newest: "t3_1n1c0a1" });
  });

  it("keeps the cursor when nothing is new, and refetches the latest page if the cursor post vanished", async () => {
    const h = harness([
      {
        match: "/r/startups/new.json",
        respond: (call) => jsonResponse(call.url.searchParams.has("before") ? emptyListing : subredditNew),
      },
    ]);
    const source = createRedditSubredditSource(createRedditClient(h.deps));

    const run = await source.run({ subreddit: "startups", listing: "new" }, { newest: "t3_deleted" });
    expect(h.http.callsTo("/r/startups/new.json")).toHaveLength(2);
    expect(run.posts).toHaveLength(2);
    expect(run.nextCursor).toEqual({ newest: "t3_1n1c0a1" });
    expect(run.warnings).toContain("cursor yielded no posts; refetched the latest page");
  });
});

describe("RedditSearchSource", () => {
  it("searches site-wide or within a subreddit, and filters results older than the cursor", async () => {
    const h = harness([{ match: "search.json", respond: () => jsonResponse(searchNew) }]);
    const source = createRedditSearchSource(createRedditClient(h.deps));

    const config = source.validateConfig({ query: "looking for a technical cofounder" });
    expect(config).toEqual({ query: "looking for a technical cofounder", subreddit: null, sort: "new" });

    const first = await source.run(config, null);
    expect(first.posts.map((p) => p.externalId)).toEqual(["t3_1s3arch1", "t3_1s3arch2", "t3_1s3arch3"]);
    expect(first.nextCursor).toEqual({ newestCreatedUtc: 1757320000 });
    const [call] = h.http.callsTo("search.json");
    expect(call?.url.pathname).toBe("/search.json");
    expect(call?.url.searchParams.get("q")).toBe("looking for a technical cofounder");
    expect(call?.url.searchParams.get("sort")).toBe("new");
    expect(call?.url.searchParams.has("restrict_sr")).toBe(false);

    const second = await source.run(config, { newestCreatedUtc: 1757300000 });
    expect(second.posts.map((p) => p.externalId)).toEqual(["t3_1s3arch1"]);
    expect(second.nextCursor).toEqual({ newestCreatedUtc: 1757320000 });

    await source.run(source.validateConfig({ query: "cto", subreddit: "startups" }), null);
    const scoped = h.http.callsTo("search.json").at(-1);
    expect(scoped?.url.pathname).toBe("/r/startups/search.json");
    expect(scoped?.url.searchParams.get("restrict_sr")).toBe("1");
  });
});
