import {
  campaignFormSchema,
  EMPTY_FORM,
  keyFromQuestion,
  platformForAlertQuery,
  weightTotal,
} from "./schema";
import { selectionFromDraft, sourcesToCreate } from "./source-suggestions";

describe("campaign form schema", () => {
  it("accepts the empty form only once a criterion has a key and question", () => {
    expect(campaignFormSchema.safeParse(EMPTY_FORM).success).toBe(false);
    const filled = {
      ...EMPTY_FORM,
      name: "n",
      offerDescription: "o",
      icp: "i",
      criteria: [{ key: "hiring", question: "Hiring?", type: "boolean", weight: 100 }],
    };
    expect(campaignFormSchema.safeParse(filled).success).toBe(true);
  });

  it("rejects weights that do not sum to 100", () => {
    const result = campaignFormSchema.safeParse({
      ...EMPTY_FORM,
      name: "n",
      offerDescription: "o",
      icp: "i",
      criteria: [{ key: "a", question: "A?", type: "boolean", weight: 60 }],
    });
    expect(result.success).toBe(false);
    expect(weightTotal([{ weight: 60 }, { weight: 30 }])).toBe(90);
  });
});

describe("keyFromQuestion", () => {
  it("produces a short snake_case key", () => {
    expect(keyFromQuestion("Is the poster hiring developers right now?")).toBe("is_the_poster_hiring");
    expect(keyFromQuestion("2 or more founders")).toBe("c_2_or_more");
  });
});

describe("alert queries → rss sources", () => {
  it("maps the site operator to a platform and skips queries without a feed URL", () => {
    expect(platformForAlertQuery('site:linkedin.com/posts "looking for a cto"')).toBe("linkedin");
    expect(platformForAlertQuery("site:x.com fractional cto")).toBe("x");
    expect(platformForAlertQuery("site:facebook.com/groups cto")).toBe("facebook");
    expect(platformForAlertQuery("fractional cto blog")).toBe("web");

    const sel = selectionFromDraft({
      suggestedSources: [
        { kind: "reddit_subreddit", config: { subreddit: "startups", listing: "new" } },
        { kind: "reddit_search", config: { query: "need a cto", subreddit: null, sort: "new" } },
      ],
      alertQueries: ["site:linkedin.com/posts cto", "site:x.com cto"],
    });
    sel.enabled[1] = false;
    sel.feedUrls[0] = "https://www.google.com/alerts/feeds/1/2";
    expect(sourcesToCreate(sel)).toEqual([
      { kind: "reddit_subreddit", config: { subreddit: "startups", listing: "new" } },
      { kind: "rss", config: { url: "https://www.google.com/alerts/feeds/1/2", platform: "linkedin" } },
    ]);
  });
});

describe("describeSourceConfig", () => {
  it("summarises google_search sources", async () => {
    const { describeSourceConfig } = await import("@/lib/sources");
    expect(
      describeSourceConfig({
        kind: "google_search",
        config: {
          platform: "reddit",
          phrases: ["looking for a cto", "need a cofounder"],
          siteScope: "reddit.com/r/startups",
          lookback: "d1",
        },
      }),
    ).toBe("Reddit: “looking for a cto” +1 in reddit.com/r/startups");
    expect(
      describeSourceConfig({
        kind: "google_search",
        config: { platform: "x", phrases: ["hiring a cto"], lookback: "d1" },
      }),
    ).toBe("X: “hiring a cto”");
  });
});
