import { describe, expect, it } from "vitest";
import { createExaProvider, type ExaClientLike } from "./exa.js";
import { SearchProviderError } from "./provider.js";
import { classifyTavilyError, createTavilyProvider, type TavilyClientLike } from "./tavily.js";

// Providers are tested against fake SDK clients with the same `search(query, options)` shape,
// the same way the adapters are tested against a fake fetch: no network, no keys.

const REQUEST = {
  query: '"looking for a cto" OR "need a technical cofounder"',
  includeDomains: ["reddit.com"],
  since: new Date("2026-09-23T12:00:00Z"),
  maxResults: 20,
  platform: "reddit" as const,
};

function fakeClient(respond: (query: string, options: Record<string, unknown>) => unknown) {
  const calls: { query: string; options: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      async search(query: string, options: Record<string, unknown>) {
        calls.push({ query, options });
        const out = respond(query, options);
        if (out instanceof Error) throw out;
        return out;
      },
    } satisfies ExaClientLike & TavilyClientLike,
  };
}

class FakeExaError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

describe("Exa provider", () => {
  it("sends the query with domain, start date, result count and highlights, and maps results", async () => {
    const { client, calls } = fakeClient(() => ({
      requestId: "r1",
      results: [
        {
          id: "1",
          url: "https://www.reddit.com/r/startups/comments/abc/looking_for_a_cto/",
          title: "Looking for a CTO",
          publishedDate: "2026-09-23T15:00:00.000Z",
          author: "founder",
          highlights: ["We have a seed round", "happy to pay a proper rate"],
        },
        { id: "2", url: "not a url" },
      ],
    }));
    const exa = createExaProvider({ apiKey: "k", client });
    const res = await exa.search(REQUEST);

    expect(calls[0]).toEqual({
      query: REQUEST.query,
      options: {
        type: "auto",
        numResults: 20,
        includeDomains: ["reddit.com"],
        startPublishedDate: "2026-09-23T12:00:00.000Z",
        contents: { highlights: true },
      },
    });
    expect(res.units).toBe(1);
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]).toMatchObject({
      url: "https://www.reddit.com/r/startups/comments/abc/looking_for_a_cto/",
      title: "Looking for a CTO",
      snippet: "We have a seed round … happy to pay a proper rate",
      author: "founder",
    });
    expect(res.hits[0]?.publishedAt?.toISOString()).toBe("2026-09-23T15:00:00.000Z");
  });

  it("keeps results whose optional fields are null (undated pages, no author)", async () => {
    const { client } = fakeClient(() => ({
      results: [
        {
          url: "https://www.reddit.com/r/startups/comments/def/need_a_cto/",
          title: null,
          publishedDate: null,
          author: null,
          highlights: null,
          text: "Need a CTO for our MVP",
        },
      ],
    }));
    const res = await createExaProvider({ apiKey: "k", client }).search(REQUEST);
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]).toMatchObject({ snippet: "Need a CTO for our MVP", publishedAt: undefined });
  });

  it("omits the domain filter for the open web", async () => {
    const { client, calls } = fakeClient(() => ({ results: [] }));
    await createExaProvider({ apiKey: "k", client }).search({
      ...REQUEST,
      includeDomains: [],
      platform: "web",
    });
    expect(calls[0]?.options).not.toHaveProperty("includeDomains");
  });

  it("classifies failures by status code", async () => {
    const cases: [unknown, string, boolean][] = [
      [new FakeExaError("Invalid API key", 401), "auth", false],
      [new FakeExaError("Payment required", 402), "quota", false],
      [new FakeExaError("Too many requests", 429), "rate_limit", true],
      [new FakeExaError("Upstream", 502), "transient", true],
      [new FakeExaError("Bad request", 400), "invalid", false],
      [new TypeError("fetch failed"), "transient", true],
    ];
    for (const [thrown, failure, retryable] of cases) {
      const { client } = fakeClient(() => thrown);
      const err = await createExaProvider({ apiKey: "k", client })
        .search(REQUEST)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SearchProviderError);
      expect(err).toMatchObject({ provider: "exa", failure, retryable });
    }

    const { client: bad } = fakeClient(() => ({ nope: true }));
    await expect(createExaProvider({ apiKey: "k", client: bad }).search(REQUEST)).rejects.toMatchObject({
      failure: "invalid",
    });
  });
});

describe("Tavily provider", () => {
  it("sends a basic search with domain, start date and usage, and maps results and credits", async () => {
    const { client, calls } = fakeClient(() => ({
      query: REQUEST.query,
      responseTime: 0.8,
      images: [],
      requestId: "t1",
      usage: { credits: 2 },
      results: [
        {
          title: "Need a technical cofounder",
          url: "https://www.reddit.com/r/SaaS/comments/def/need_a_technical_cofounder/",
          content: "I have customers lined up and need someone to build",
          score: 0.9,
          publishedDate: "Tue, 23 Sep 2026 14:00:00 GMT",
        },
        { title: "broken" },
      ],
    }));
    const res = await createTavilyProvider({ apiKey: "k", client }).search(REQUEST);

    expect(calls[0]).toEqual({
      query: REQUEST.query,
      options: {
        searchDepth: "basic",
        topic: "general",
        maxResults: 20,
        includeDomains: ["reddit.com"],
        startDate: "2026-09-23",
        includeUsage: true,
      },
    });
    expect(res.units).toBe(2);
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]).toMatchObject({ snippet: "I have customers lined up and need someone to build" });
    expect(res.hits[0]?.publishedAt?.toISOString()).toBe("2026-09-23T14:00:00.000Z");
  });

  it("keeps results whose optional fields are null", async () => {
    const { client } = fakeClient(() => ({
      results: [
        {
          url: "https://www.reddit.com/r/startups/comments/ghi/x/",
          title: null,
          content: null,
          publishedDate: null,
        },
      ],
    }));
    const res = await createTavilyProvider({ apiKey: "k", client }).search(REQUEST);
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.title).toBeUndefined();
  });

  it("counts one credit when the response has no usage block", async () => {
    const { client } = fakeClient(() => ({ results: [] }));
    expect((await createTavilyProvider({ apiKey: "k", client }).search(REQUEST)).units).toBe(1);
  });

  it("classifies the SDK's plain-Error messages", async () => {
    expect(classifyTavilyError('432 Error: {"detail":{}}')).toEqual({ failure: "quota", status: 432 });
    expect(classifyTavilyError('429 Error: {"detail":{}}')).toEqual({ failure: "rate_limit", status: 429 });
    expect(classifyTavilyError('500 Error: "oops"')).toEqual({ failure: "transient", status: 500 });
    expect(classifyTavilyError("Unauthorized: missing or invalid API key.")).toEqual({ failure: "auth" });
    expect(classifyTavilyError("This request exceeds your plan's set usage limit.")).toEqual({
      failure: "quota",
    });
    expect(classifyTavilyError("Request timed out after 60 seconds.")).toEqual({ failure: "transient" });
    expect(classifyTavilyError("Query is too long. Max query length is 400 characters.")).toEqual({
      failure: "invalid",
    });

    const { client } = fakeClient(() => new Error("This request exceeds your plan's set usage limit."));
    await expect(createTavilyProvider({ apiKey: "k", client }).search(REQUEST)).rejects.toMatchObject({
      provider: "tavily",
      failure: "quota",
      retryable: false,
    });
  });
});
