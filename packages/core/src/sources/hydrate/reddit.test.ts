import { beforeAll, describe, expect, it } from "vitest";
import { fakeFetch, loadFixture, textResponse } from "../../test/fake-fetch.js";
import type { RawPost } from "../../types.js";
import type { SourceDeps } from "../source.js";
import { hydratePost } from "./index.js";
import { hydrateReddit } from "./reddit.js";

let postHtml: string;
beforeAll(async () => {
  postHtml = await loadFixture("reddit/post.html");
});

const URL_ =
  "https://www.reddit.com/r/startups/comments/1abc2d/looking_for_a_cto_to_build_the_first_version/";

function snippet(): RawPost {
  return {
    platform: "reddit",
    externalId: "https://reddit.com/r/startups/comments/1abc2d/looking_for_a_cto_to_build_the_first_version",
    url: URL_,
    body: "I come from hospitality and have an idea for a booking SaaS. Haven't built …",
    bodyIsSnippet: true,
    raw: {},
  };
}

function deps(routes: Parameters<typeof fakeFetch>[0]): {
  deps: SourceDeps;
  http: ReturnType<typeof fakeFetch>;
} {
  const http = fakeFetch(routes);
  return {
    http,
    deps: {
      fetch: http.fetch,
      userAgent: "t",
      now: () => new Date(),
      sleep: async () => {},
      reddit: { clientId: "", clientSecret: "" },
    },
  };
}

describe("hydrateReddit", () => {
  it("reads the server-rendered post: body, title, author and timestamp, with a crawler UA", async () => {
    const { deps: d, http } = deps([
      {
        match: "reddit.com/r/startups",
        respond: [textResponse(postHtml, { headers: { "content-type": "text/html" } })],
      },
    ]);
    const post = await hydrateReddit(snippet(), d);

    expect(post.bodyIsSnippet).toBe(false);
    expect(post.body).toContain("happy to pay a proper rate");
    expect(post.body).toContain("shipped a marketplace before");
    expect(post.body).not.toContain("<p>");
    expect(post.title).toBe("Looking for a CTO to build the first version");
    expect(post.authorHandle).toBe("u/hospitality_founder");
    expect(post.authorUrl).toBe("https://www.reddit.com/user/hospitality_founder/");
    expect(post.postedAt?.toISOString()).toBe("2026-09-08T14:05:11.000Z");
    expect(http.calls[0]?.headers["user-agent"]).toMatch(/Googlebot/);
  });

  it("keeps the snippet when blocked or when the page has nothing longer", async () => {
    const { deps: blocked } = deps([
      { match: "reddit.com", respond: [new Response("blocked", { status: 403 })] },
    ]);
    expect(await hydrateReddit(snippet(), blocked)).toEqual(snippet());

    const { deps: bare } = deps([
      {
        match: "reddit.com",
        respond: [textResponse('<html><head><meta property="og:description" content="short"></head></html>')],
      },
    ]);
    const kept = await hydrateReddit(snippet(), bare);
    expect(kept.bodyIsSnippet).toBe(true);
    expect(kept.body).toBe(snippet().body);

    const { deps: offline } = deps([]);
    expect(await hydrateReddit(snippet(), offline)).toEqual(snippet());
  });

  it("hydratePost routes by platform and leaves full posts and facebook alone", async () => {
    const { deps: d, http } = deps([{ match: "reddit.com", respond: [textResponse(postHtml)] }]);
    expect((await hydratePost(snippet(), d)).bodyIsSnippet).toBe(false);
    expect(await hydratePost({ ...snippet(), bodyIsSnippet: false }, d)).toMatchObject({
      bodyIsSnippet: false,
    });
    expect(await hydratePost({ ...snippet(), platform: "facebook" }, d)).toMatchObject({
      bodyIsSnippet: true,
    });
    expect(http.calls).toHaveLength(1);
  });
});
