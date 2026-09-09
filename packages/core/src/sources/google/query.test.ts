import { describe, expect, it } from "vitest";
import {
  buildSearchQuery,
  isPostUrl,
  normalizePhrases,
  normalizeSiteScope,
  resultToRawPost,
  searchRequestUrl,
  shouldFetchNextPage,
} from "./query.js";

describe("buildSearchQuery", () => {
  it("scopes to the platform default and ORs quoted phrases", () => {
    expect(
      buildSearchQuery({ platform: "reddit", phrases: ["looking for a cto", "need a technical cofounder"] }),
    ).toBe('site:reddit.com ("looking for a cto" OR "need a technical cofounder")');
    expect(buildSearchQuery({ platform: "linkedin", phrases: ["hiring a fractional cto"] })).toBe(
      'site:linkedin.com/posts "hiring a fractional cto"',
    );
  });

  it("honours an explicit site scope and cleans it", () => {
    expect(
      buildSearchQuery({
        platform: "reddit",
        phrases: ["cto"],
        siteScope: "https://www.reddit.com/r/startups/",
      }),
    ).toBe('site:reddit.com/r/startups "cto"');
  });

  it("emits no site operator for the open web", () => {
    expect(buildSearchQuery({ platform: "web", phrases: ["fractional cto"] })).toBe('"fractional cto"');
  });

  it("strips quotes, collapses whitespace, dedupes case-insensitively and caps at 10", () => {
    const phrases = normalizePhrases([
      ' "Looking for a   CTO" ',
      "looking for a cto",
      "",
      ...Array.from({ length: 12 }, (_, i) => `phrase ${i}`),
    ]);
    expect(phrases[0]).toBe("Looking for a CTO");
    expect(phrases).toHaveLength(10);
    expect(() => buildSearchQuery({ platform: "x", phrases: ['""', "  "] })).toThrow(/no usable phrases/);
  });

  it("normalizes site scopes", () => {
    expect(normalizeSiteScope(undefined, "x")).toBe("x.com");
    expect(normalizeSiteScope("  ", "facebook")).toBe("facebook.com");
    expect(normalizeSiteScope("http://Linkedin.com/pulse/", "linkedin")).toBe("Linkedin.com/pulse");
  });
});

describe("searchRequestUrl", () => {
  it("sets key, cx, q, num, start, dateRestrict and date sort", () => {
    const url = searchRequestUrl({ key: "K", cx: "CX", q: 'site:x.com "a"', lookback: "d1", start: 11 });
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/customsearch/v1");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      key: "K",
      cx: "CX",
      q: 'site:x.com "a"',
      num: "10",
      start: "11",
      dateRestrict: "d1",
      sort: "date",
    });
  });
});

describe("shouldFetchNextPage", () => {
  it("fetches page 2 only after a full page 1, and never page 3", () => {
    expect(shouldFetchNextPage(10, 2)).toBe(true);
    expect(shouldFetchNextPage(9, 2)).toBe(false);
    expect(shouldFetchNextPage(10, 3)).toBe(false);
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

describe("resultToRawPost", () => {
  it("builds a snippet post with a canonical external id, meta date and X handle", () => {
    const post = resultToRawPost(
      {
        link: "https://X.com/Jane/status/123?utm_source=share",
        title: 'Jane on X: "Looking for a CTO"',
        snippet: "Looking for a CTO to build our MVP …",
        pagemap: { metatags: [{ "article:published_time": "2026-09-08T10:00:00Z" }] },
      },
      "x",
    );
    expect(post).toMatchObject({
      platform: "x",
      externalId: "https://x.com/Jane/status/123",
      url: "https://X.com/Jane/status/123?utm_source=share",
      bodyIsSnippet: true,
      authorHandle: "@Jane",
    });
    expect(post?.postedAt?.toISOString()).toBe("2026-09-08T10:00:00.000Z");
    expect(post?.body).toBe("Looking for a CTO to build our MVP …");
  });

  it("falls back to the title, then the link, and rejects unparsable links", () => {
    expect(
      resultToRawPost({ link: "https://www.reddit.com/r/a/comments/x/t/", title: "Only title" }, "reddit")
        ?.body,
    ).toBe("Only title");
    expect(resultToRawPost({ link: "::" }, "reddit")).toBeUndefined();
  });
});
