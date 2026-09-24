import { describe, expect, it } from "vitest";
import { escapeLike, isCandidate, matchesAnyKeyword } from "./prefilter.js";

describe("pre-filter", () => {
  it("matches keywords case-insensitively as substrings and ignores blank keywords", () => {
    expect(matchesAnyKeyword("Looking for a CTO to build", ["cto"])).toBe(true);
    expect(matchesAnyKeyword("need a Technical Cofounder", ["technical cofounder"])).toBe(true);
    expect(matchesAnyKeyword("weekend project", ["cto", "mvp"])).toBe(false);
    expect(matchesAnyKeyword("anything", ["", "   "])).toBe(false);
  });

  it("keyword-scoped sources always qualify; other sources need a keyword in title or body", () => {
    const campaign = { keywords: ["cto"] };
    expect(isCandidate({ title: null, body: "nothing relevant" }, campaign, "reddit_search")).toBe(true);
    expect(isCandidate({ title: null, body: "nothing relevant" }, campaign, "rss")).toBe(true);
    expect(isCandidate({ title: null, body: "nothing relevant" }, campaign, "reddit_subreddit")).toBe(false);
    expect(isCandidate({ title: "Hiring a CTO", body: "…" }, campaign, "reddit_subreddit")).toBe(true);
    expect(isCandidate({ title: null, body: "any" }, { keywords: [] }, "reddit_subreddit")).toBe(false);
  });

  it("escapes LIKE metacharacters", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
  });
});
