import { beforeAll, describe, expect, it } from "vitest";
import { ProviderError, ValidationError } from "../errors.js";
import { fakeFetch, jsonResponse, loadFixture, loadJsonFixture, textResponse } from "../test/fake-fetch.js";
import { hydrateLinkedIn } from "./hydrate/linkedin.js";
import { hydrateX } from "./hydrate/x.js";
import { createSourceRegistry } from "./registry.js";
import { createRssSource } from "./rss.js";
import type { SourceDeps } from "./source.js";

let alertsXml: string;
let linkedinHtml: string;
let authwallHtml: string;
let oembed: unknown;

beforeAll(async () => {
  alertsXml = await loadFixture("rss/google-alerts.xml");
  linkedinHtml = await loadFixture("linkedin/post.html");
  authwallHtml = await loadFixture("linkedin/authwall.html");
  oembed = await loadJsonFixture("x/oembed.json");
});

const FEED_URL = "https://www.google.com/alerts/feeds/1234567890/0987654321";

function deps(routes: Parameters<typeof fakeFetch>[0]): {
  deps: SourceDeps;
  http: ReturnType<typeof fakeFetch>;
} {
  const http = fakeFetch(routes);
  return {
    http,
    deps: {
      fetch: http.fetch,
      userAgent: "leadsight-test/0.1",
      now: () => new Date("2026-09-08T08:00:00Z"),
      sleep: async () => {},
      reddit: { clientId: "id", clientSecret: "secret" },
    },
  };
}

describe("RssSource (Google Alerts)", () => {
  it("validates config", () => {
    const source = createRssSource(deps([]).deps);
    expect(source.validateConfig({ url: FEED_URL, platform: "linkedin" })).toEqual({
      url: FEED_URL,
      platform: "linkedin",
    });
    expect(() => source.validateConfig({ url: "nope", platform: "linkedin" })).toThrow(ValidationError);
    expect(() => source.validateConfig({ url: FEED_URL, platform: "myspace" })).toThrow(ValidationError);
  });

  it("unwraps redirects, canonicalises ids, strips markup, marks snippets, and sets the cursor", async () => {
    const h = deps([{ match: FEED_URL, respond: () => textResponse(alertsXml) }]);
    const source = createRssSource(h.deps);

    const run = await source.run({ url: FEED_URL, platform: "linkedin" }, null);
    expect(run.warnings).toEqual([]);
    expect(run.posts).toHaveLength(3);
    expect(run.nextCursor).toEqual({ newestPublished: "2026-09-08T05:30:00.000Z" });

    const [jane, jo] = run.posts;
    expect(jane).toMatchObject({
      platform: "linkedin",
      externalId:
        "https://www.linkedin.com/posts/jane-doe_startup-cofounder-activity-7100000000000000000-AbCd",
      url: "https://www.LinkedIn.com/posts/jane-doe_startup-cofounder-activity-7100000000000000000-AbCd/?utm_source=share&utm_medium=member_desktop&trk=public_post",
      title: "Non-technical founder looking for a technical cofounder | Jane Doe",
      bodyIsSnippet: true,
      postedAt: new Date("2026-09-08T05:30:00Z"),
    });
    expect(jane?.body).toContain("Looking for a technical cofounder who can build the first version");
    expect(jane?.body).not.toContain("<b>");
    expect(jo?.externalId).toBe("https://x.com/founder_jo/status/1830000000000000000");

    expect(h.http.calls[0]?.headers["user-agent"]).toBe("leadsight-test/0.1");
  });

  it("filters items at or before the cursor on later runs", async () => {
    const h = deps([{ match: FEED_URL, respond: () => textResponse(alertsXml) }]);
    const run = await createRssSource(h.deps).run(
      { url: FEED_URL, platform: "linkedin" },
      { newestPublished: "2026-09-08T04:10:00.000Z" },
    );
    expect(run.posts.map((p) => p.postedAt?.toISOString())).toEqual(["2026-09-08T05:30:00.000Z"]);
    expect(run.nextCursor).toEqual({ newestPublished: "2026-09-08T05:30:00.000Z" });
  });

  it("fails the run with ProviderError on HTTP errors or non-feed bodies", async () => {
    const down = deps([{ match: FEED_URL, respond: () => textResponse("nope", { status: 502 }) }]);
    await expect(
      createRssSource(down.deps).run({ url: FEED_URL, platform: "web" }, null),
    ).rejects.toMatchObject({
      name: "ProviderError",
      provider: "rss",
      status: 502,
      retryable: true,
    });

    const junk = deps([{ match: FEED_URL, respond: () => textResponse("<html>not a feed</html>") }]);
    await expect(
      createRssSource(junk.deps).run({ url: FEED_URL, platform: "web" }, null),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("hydrate dispatches by platform and leaves facebook/web untouched", async () => {
    const h = deps([
      { match: "linkedin.com/posts", respond: () => textResponse(linkedinHtml) },
      { match: "publish.twitter.com/oembed", respond: () => jsonResponse(oembed) },
    ]);
    const source = createRssSource(h.deps);
    if (!source.hydrate) throw new Error("rss source must hydrate");

    const li = await source.hydrate(snippet("linkedin", "https://www.linkedin.com/posts/jane_activity-1"));
    expect(li.bodyIsSnippet).toBe(false);
    const x = await source.hydrate(snippet("x", "https://x.com/founder_jo/status/1830000000000000000"));
    expect(x.bodyIsSnippet).toBe(false);
    const fb = await source.hydrate(snippet("facebook", "https://www.facebook.com/groups/1/posts/2"));
    expect(fb.bodyIsSnippet).toBe(true);
    expect(h.http.callsTo("facebook.com")).toHaveLength(0);
  });
});

describe("hydrators", () => {
  it("LinkedIn: joins the post paragraphs, fills author from the page, never shrinks the body", async () => {
    const h = deps([{ match: "linkedin.com/posts", respond: () => textResponse(linkedinHtml) }]);
    const post = await hydrateLinkedIn(
      snippet("linkedin", "https://www.linkedin.com/posts/jane_activity-1"),
      h.deps,
    );

    expect(post.bodyIsSnippet).toBe(false);
    expect(post.body).toBe(
      "I'm a founder with a booking idea for hotels. I come from hospitality and have run three properties for a decade.\n\nLooking for a technical cofounder who can build the first version. We have a small seed round and are happy to pay a proper rate — this is not an equity-only ask.",
    );
    expect(post.authorHandle).toBe("Jane Doe");
    expect(post.authorUrl).toBe("https://www.linkedin.com/in/jane-doe");
    expect(h.http.calls[0]?.headers["user-agent"]).toContain("Googlebot");
  });

  it("LinkedIn: keeps the snippet behind an auth wall or on HTTP errors or network failures", async () => {
    const original = snippet("linkedin", "https://www.linkedin.com/posts/jane_activity-1");

    const wall = deps([{ match: "linkedin.com", respond: () => textResponse(authwallHtml) }]);
    expect(await hydrateLinkedIn(original, wall.deps)).toEqual(original);

    const forbidden = deps([{ match: "linkedin.com", respond: () => textResponse("", { status: 403 }) }]);
    expect(await hydrateLinkedIn(original, forbidden.deps)).toEqual(original);

    const offline = deps([]); // no route → fetch throws
    expect(await hydrateLinkedIn(original, offline.deps)).toEqual(original);
  });

  it("X: takes the tweet text and handle from oEmbed; falls back to the snippet on errors", async () => {
    const ok = deps([{ match: "publish.twitter.com/oembed", respond: () => jsonResponse(oembed) }]);
    const post = await hydrateX(snippet("x", "https://x.com/founder_jo/status/1830000000000000000"), ok.deps);
    expect(post.body).toBe(
      "Anyone here looking for a technical cofounder? I have a prototype and paying customers, and I'd rather pay a fair rate than give away half the company. DM me.",
    );
    expect(post).toMatchObject({
      bodyIsSnippet: false,
      authorHandle: "@founder_jo",
      authorUrl: "https://twitter.com/founder_jo",
    });
    const call = ok.http.calls[0];
    expect(call?.url.searchParams.get("url")).toBe("https://x.com/founder_jo/status/1830000000000000000");
    expect(call?.url.searchParams.get("omit_script")).toBe("true");

    const gone = deps([{ match: "publish.twitter.com", respond: () => jsonResponse({}, { status: 404 }) }]);
    const original = snippet("x", "https://x.com/founder_jo/status/1");
    expect(await hydrateX(original, gone.deps)).toEqual(original);
  });
});

describe("source registry", () => {
  it("resolves every kind and rejects unknown ones", () => {
    const registry = createSourceRegistry({
      userAgent: "leadsight-test/0.1",
      reddit: { clientId: "id", clientSecret: "secret" },
      fetch: deps([]).deps.fetch,
    });
    expect(registry.kinds()).toEqual(["reddit_subreddit", "reddit_search", "rss", "google_search"]);
    for (const kind of registry.kinds()) expect(registry.get(kind).kind).toBe(kind);
    expect(() => registry.get("carrier_pigeon" as never)).toThrow(ValidationError);
  });
});

function snippet(platform: "linkedin" | "x" | "facebook" | "web", url: string) {
  return {
    platform,
    externalId: url,
    url,
    body: "short snippet …",
    bodyIsSnippet: true,
    raw: {},
  };
}
