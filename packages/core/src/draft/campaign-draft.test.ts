import { describe, expect, it } from "vitest";
import { ProviderError } from "../errors.js";
import { createBudget, createMemoryBudgetStore } from "../extractor/budget.js";
import { fakeFetch, textResponse } from "../test/fake-fetch.js";
import { fakeProvider } from "../test/fake-provider.js";
import { createCampaignDrafter, normalizeDraft, parseDraftResponse } from "./campaign-draft.js";
import { buildDraftPrompt, DRAFT_PROMPT_VERSION } from "./prompt.js";

// A plausible model answer with the slips we expect: snake_case keys, weights summing to
// 95, an enum option without points, a camelCase criterion key.
const modelDraft = {
  name: "Founders seeking an MVP team",
  offer_description: "We build MVPs for non-technical founders.",
  icp: "Non-technical founders with an idea and some budget.",
  disqualifiers: ["equity only"],
  keywords: ["looking for a cto", "technical cofounder"],
  criteria: [
    {
      key: "explicitAsk",
      question: "Is the author asking for a developer or CTO?",
      type: "boolean",
      weight: 30,
    },
    {
      key: "stage",
      question: "What stage is the product at?",
      type: "enum",
      options: ["idea", "prototype", "live"],
      points: { idea: 25, prototype: 15 },
      weight: 20,
    },
    { key: "budget_signal", question: "Is budget or funding mentioned?", type: "boolean", weight: 25 },
    {
      key: "hourly_rate",
      question: "Hourly rate in USD, if any",
      type: "number",
      min: 20,
      max: 150,
      weight: 20,
    },
  ],
  thresholds: { hot: 70, warm: 40 },
  suggested_sources: [
    { kind: "reddit_subreddit", config: { subreddit: "startups" } },
    { kind: "reddit_search", config: { query: "looking for a cto" } },
  ],
  alert_queries: ['site:linkedin.com/posts "looking for a technical cofounder"'],
};

const reply = (draft: unknown, text = "Drafted a campaign for founders seeking an MVP team.") =>
  JSON.stringify({ reply: text, draft });

function drafter(
  providers: Parameters<typeof createCampaignDrafter>[0]["providers"],
  routes: Parameters<typeof fakeFetch>[0] = [],
) {
  const http = fakeFetch(routes);
  return {
    http,
    drafter: createCampaignDrafter({
      providers,
      budget: createBudget({ store: createMemoryBudgetStore(), caps: {} }),
      organizationId: "org_test",
      fetch: http.fetch,
      userAgent: "leadsight-test/0.1",
      sleep: async () => {},
    }),
  };
}

describe("draft normalisation", () => {
  it("accepts snake_case keys, rescales weights to 100, fills missing enum points, snake_cases criterion keys", () => {
    const parsed = parseDraftResponse(reply(modelDraft));
    if (!parsed.ok) throw new Error(parsed.issues.join("; "));
    const draft = parsed.draft;
    if (!draft) throw new Error("expected a draft");

    expect(draft.offerDescription).toBe(modelDraft.offer_description);
    expect(draft.suggestedSources).toHaveLength(2);
    expect(draft.suggestedSources[0]).toEqual({
      kind: "reddit_subreddit",
      config: { subreddit: "startups", listing: "new" },
    });
    expect(draft.alertQueries).toEqual(modelDraft.alert_queries);

    expect(draft.criteria.map((c) => c.key)).toEqual([
      "explicit_ask",
      "stage",
      "budget_signal",
      "hourly_rate",
    ]);
    expect(draft.criteria.reduce((s, c) => s + c.weight, 0)).toBe(100);
    expect(draft.criteria.map((c) => c.weight)).toEqual([32, 21, 26, 21]); // 30/20/25/20 of 95 → rounding remainder on the heaviest
    const stage = draft.criteria.find((c) => c.key === "stage");
    expect(stage?.type === "enum" && stage.points).toEqual({ idea: 21, prototype: 15, live: 0 }); // capped at weight, missing → 0
  });

  it("passes through a follow-up question with draft null", () => {
    const parsed = parseDraftResponse(JSON.stringify({ reply: "What do you sell?", draft: null }));
    expect(parsed).toEqual({ ok: true, reply: "What do you sell?", draft: null });
  });

  it("reports issues for junk, wrong envelope, and an unfixable draft", () => {
    expect(parseDraftResponse("nope")).toEqual({ ok: false, issues: ["response was not valid JSON"] });
    expect(parseDraftResponse(JSON.stringify({ foo: 1 })).ok).toBe(false);
    const missingName = parseDraftResponse(reply({ ...modelDraft, name: "" }));
    expect(missingName.ok).toBe(false);
    if (!missingName.ok) expect(missingName.issues[0]).toMatch(/^draft\.name/);
  });

  it("normalizeDraft leaves non-objects alone and defaults optional lists", () => {
    expect(normalizeDraft("x")).toBe("x");
    expect(normalizeDraft({ name: "n" })).toMatchObject({
      disqualifiers: [],
      keywords: [],
      alertQueries: [],
      suggestedSources: [],
      thresholds: { hot: 70, warm: 40 },
    });
  });
});

describe("prompt", () => {
  it("includes the conversation, page text and the output rules", () => {
    const prompt = buildDraftPrompt({
      messages: [{ role: "user", content: "We build MVPs" }],
      pages: [{ url: "https://example.com", title: "Example", text: "Pricing from $5k" }],
    });
    expect(prompt).toContain("User: We build MVPs");
    expect(prompt).toContain("### Example\nhttps://example.com\nPricing from $5k");
    expect(prompt).toContain("sum to exactly 100");
    expect(DRAFT_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("CampaignDrafter", () => {
  it("fetches pasted pages, drafts, and reports provider, version, usage", async () => {
    const groq = fakeProvider("groq", [reply(modelDraft)]);
    const { drafter: d, http } = drafter(
      [groq],
      [
        {
          match: "example.com",
          respond: () =>
            textResponse(
              '<html><head><title>Acme MVP Studio</title><meta property="og:description" content="We ship MVPs in 6 weeks"></head><body><nav>menu</nav><p>Fixed price from $5,000.</p></body></html>',
            ),
        },
      ],
    );

    const out = await d.draft({
      messages: [{ role: "user", content: "We build MVPs for founders" }],
      urls: ["https://example.com/"],
    });
    expect(out.draft?.name).toBe(modelDraft.name);
    expect(out.provider).toBe("groq/groq-model");
    expect(out.promptVersion).toBe(DRAFT_PROMPT_VERSION);
    expect(out.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
    expect(out.warnings).toEqual([]);
    expect(http.calls[0]?.headers["user-agent"]).toBe("leadsight-test/0.1");

    const prompt = groq.requests[0]?.user ?? "";
    expect(prompt).toContain("### Acme MVP Studio");
    expect(prompt).toContain("We ship MVPs in 6 weeks");
    expect(prompt).toContain("Fixed price from $5,000.");
    expect(prompt).not.toContain("menu"); // nav stripped
  });

  it("re-asks once with the validation issues, then gives up with a provider error", async () => {
    const fixer = fakeProvider("groq", [reply({ ...modelDraft, name: "" }), reply(modelDraft)]);
    const okAfterRetry = await drafter([fixer]).drafter.draft({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(okAfterRetry.draft?.name).toBe(modelDraft.name);
    expect(okAfterRetry.usage.promptTokens).toBe(200);
    expect(fixer.requests[1]?.user).toContain("Your previous answer was rejected");
    expect(fixer.requests[1]?.user).toContain("draft.name");

    const hopeless = fakeProvider("groq", ["garbage", "still garbage"]);
    const err = await drafter([hopeless])
      .drafter.draft({ messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ retryable: false });
    expect((err as Error).message).toMatch(/invalid draft/);
  });

  it("a page that cannot be fetched becomes a warning, not a failure", async () => {
    const groq = fakeProvider("groq", [reply(null, "What do you sell?")]);
    const out = await drafter(
      [groq],
      [{ match: "down.example", respond: () => textResponse("", { status: 503 }) }],
    ).drafter.draft({
      messages: [{ role: "user", content: "hi" }],
      urls: ["https://down.example/", "https://unrouted.example/"],
    });
    expect(out.draft).toBeNull();
    expect(out.reply).toBe("What do you sell?");
    expect(out.warnings).toEqual([
      "https://down.example/: HTTP 503",
      expect.stringContaining("https://unrouted.example/: "),
    ]);
  });
});
