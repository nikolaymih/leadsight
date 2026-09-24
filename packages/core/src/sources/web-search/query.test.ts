import { describe, expect, it } from "vitest";
import {
  buildOrQuery,
  dedupePosts,
  hitToRawPost,
  inScope,
  isPostUrl,
  lookbackStart,
  MAX_QUERY_CHARS,
  normalizePhrases,
  packPhrases,
  parseSiteScope,
} from "./query.js";

describe("normalizePhrases", () => {
  it("strips quotes, collapses whitespace, dedupes case-insensitively and caps at 10", () => {
    const phrases = normalizePhrases([
      ' "Looking for a   CTO" ',
      "looking for a cto",
      "",
      ...Array.from({ length: 12 }, (_, i) => `phrase ${i}`),
    ]);
    expect(phrases[0]).toBe("Looking for a CTO");
    expect(phrases).toHaveLength(10);
    expect(normalizePhrases(['""', "  "])).toEqual([]);
  });
});

describe("buildOrQuery and packPhrases", () => {
  it("quotes phrases and joins them with OR", () => {
    expect(buildOrQuery(["looking for a cto", "need a technical cofounder"])).toBe(
      '"looking for a cto" OR "need a technical cofounder"',
    );
    expect(buildOrQuery(["solo"])).toBe('"solo"');
  });

  it("packs everything into one query when it fits", () => {
    const phrases = ["looking for a cto", "need a technical cofounder", "hiring a fractional cto"];
    expect(packPhrases(phrases)).toEqual([phrases]);
  });

  it("splits into several queries at the length limit, preserving order", () => {
    const phrases = Array.from({ length: 6 }, (_, i) => `${"x".repeat(20)} phrase ${i}`);
    const groups = packPhrases(phrases, 80);
    expect(groups.flat()).toEqual(phrases);
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) expect(buildOrQuery(g).length).toBeLessThanOrEqual(80);
  });

  it("truncates a single over-long phrase at a word boundary instead of dropping it", () => {
    const long = `${"word ".repeat(120)}end`;
    const [group] = packPhrases([long]);
    expect(group).toHaveLength(1);
    expect(buildOrQuery(group ?? []).length).toBeLessThanOrEqual(MAX_QUERY_CHARS);
    expect(group?.[0]?.endsWith("word")).toBe(true);
  });
});

describe("site scope", () => {
  it("parses pasted scopes and falls back to the platform default", () => {
    expect(parseSiteScope("https://www.Reddit.com/r/Startups/", "reddit")).toEqual({
      host: "reddit.com",
      pathPrefix: "/r/startups",
    });
    expect(parseSiteScope(undefined, "linkedin")).toEqual({ host: "linkedin.com", pathPrefix: "/posts" });
    expect(parseSiteScope("  ", "x")).toEqual({ host: "x.com", pathPrefix: "" });
    expect(parseSiteScope(undefined, "web")).toBeNull();
  });

  it("enforces host (with subdomains) and path prefix", () => {
    const sub = parseSiteScope("reddit.com/r/startups", "reddit");
    expect(inScope("https://www.reddit.com/r/startups/comments/abc/t/", sub)).toBe(true);
    expect(inScope("https://old.reddit.com/r/Startups/comments/abc/t/", sub)).toBe(true);
    expect(inScope("https://www.reddit.com/r/startupsfr/comments/abc/t/", sub)).toBe(false);
    expect(inScope("https://www.reddit.com/r/SaaS/comments/abc/t/", sub)).toBe(false);
    expect(inScope("https://notreddit.com/r/startups/comments/abc/t/", sub)).toBe(false);
    expect(inScope("not a url", sub)).toBe(false);
    expect(inScope("https://anything.example/x", null)).toBe(true);
  });
});

describe("lookbackStart", () => {
  it("subtracts whole days", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(lookbackStart("d1", now).toISOString()).toBe("2026-09-23T12:00:00.000Z");
    expect(lookbackStart("d7", now).toISOString()).toBe("2026-09-17T12:00:00.000Z");
  });
});

describe("isPostUrl", () => {
  it("keeps discussion pages and drops listings/profiles", () => {
    expect(isPostUrl("reddit", "https://www.reddit.com/r/startups/comments/1abc2d/looking_for_a_cto/")).toBe(
      true,
    );
    expect(isPostUrl("reddit", "https://www.reddit.com/r/startups/")).toBe(false);
    expect(isPostUrl("reddit", "https://www.reddit.com/user/someone/")).toBe(false);
    expect(isPostUrl("linkedin", "https://www.linkedin.com/posts/jane-doe_cto-activity-7123-abcd")).toBe(
      true,
    );
    expect(isPostUrl("linkedin", "https://www.linkedin.com/in/jane-doe/")).toBe(false);
    expect(isPostUrl("x", "https://x.com/jane/status/1234567890")).toBe(true);
    expect(isPostUrl("x", "https://x.com/jane")).toBe(false);
    expect(isPostUrl("facebook", "https://www.facebook.com/groups/startups/posts/123/")).toBe(true);
    expect(isPostUrl("web", "https://example.com/anything")).toBe(true);
    expect(isPostUrl("web", "not a url")).toBe(false);
  });
});

describe("hitToRawPost and dedupePosts", () => {
  it("builds a snippet post with a canonical external id and a platform-shaped author", () => {
    const post = hitToRawPost(
      {
        url: "https://X.com/Jane/status/123?utm_source=share",
        title: "Jane on X",
        snippet: "Looking for a CTO   to build our MVP",
        publishedAt: new Date("2026-09-23T10:00:00Z"),
        raw: {},
      },
      "x",
    );
    expect(post).toMatchObject({
      platform: "x",
      externalId: "https://x.com/Jane/status/123",
      url: "https://X.com/Jane/status/123?utm_source=share",
      bodyIsSnippet: true,
      body: "Looking for a CTO to build our MVP",
      authorHandle: "@Jane",
    });
    expect(post?.postedAt?.toISOString()).toBe("2026-09-23T10:00:00.000Z");

    const reddit = hitToRawPost(
      { url: "https://www.reddit.com/r/a/comments/x/t/", title: "Only title", author: "founder", raw: {} },
      "reddit",
    );
    expect(reddit).toMatchObject({ body: "Only title", authorHandle: "u/founder" });
    expect(hitToRawPost({ url: "::", raw: {} }, "reddit")).toBeUndefined();
  });

  it("keeps the first post per canonical URL", () => {
    const a = hitToRawPost(
      { url: "https://www.reddit.com/r/a/comments/x/t/", snippet: "first", raw: {} },
      "reddit",
    );
    const b = hitToRawPost(
      { url: "https://www.reddit.com/r/a/comments/x/t/#c", snippet: "second", raw: {} },
      "reddit",
    );
    if (!a || !b) throw new Error("expected posts");
    expect(dedupePosts([a, b]).map((p) => p.body)).toEqual(["first"]);
  });
});
