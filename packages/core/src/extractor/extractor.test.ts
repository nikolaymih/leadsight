import { describe, expect, it } from "vitest";
import type { LabeledExample } from "../db/labels.js";
import { BudgetExhaustedError, ProviderError } from "../errors.js";
import { mvpCriteria } from "../test/fixtures.js";
import type { Evidence, RawPost } from "../types.js";
import { createBudget, createMemoryBudgetStore, startOfUtcDay } from "./budget.js";
import type { ExtractionInput } from "./extractor.js";
import { EXAMPLE_MAX_CHARS, formatExample, selectFewShot } from "./fewshot.js";
import { createLlmExtractor, parseResponse } from "./llm-extractor.js";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt.js";
import type { ChatProvider, ChatRequest } from "./providers/provider.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const campaign = {
  offerDescription: "We build MVPs for non-technical founders.",
  icp: "Non-technical founders with an idea and some budget.",
  disqualifiers: ["equity only"],
  criteria: mvpCriteria,
};

function post(id: string, body = `post ${id}`): RawPost {
  return { platform: "reddit", externalId: id, url: `https://r/${id}`, body, bodyIsSnippet: false, raw: {} };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    criteria: {
      explicit_ask: { value: true, quote: "looking for a CTO", confidence: 90 },
      stage: { value: "idea", quote: "haven't built anything", confidence: 80 },
      budget_signal: { value: null, quote: null, confidence: 20 },
      engagement_model: { value: "paid", quote: "happy to pay", confidence: 70 },
      author_is_nontechnical: { value: true, quote: "I come from hospitality", confidence: 85 },
    },
    disqualifier_hits: [],
    summary: "Founder looking for a paid CTO.",
    ...overrides,
  };
}

function label(kind: "positive" | "negative", body: string, note: string | null = null): LabeledExample {
  return {
    id: crypto.randomUUID(),
    campaignId: "c",
    postId: "p",
    label: kind,
    note,
    createdBy: "u",
    createdAt: new Date(),
    post: { platform: "reddit", title: null, body },
  };
}

/** A scripted provider: each call pops the next reply (a string, or an error to throw). */
function fakeProvider(
  name: string,
  replies: (string | ProviderError)[],
): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    name,
    model: `${name}-model`,
    requests,
    async complete(request) {
      requests.push(request);
      const next = replies.shift();
      if (next === undefined) throw new Error(`${name}: no scripted reply left`);
      if (next instanceof ProviderError) throw next;
      return { content: next, usage: { promptTokens: 100, completionTokens: 50 } };
    },
  };
}

const reply = (items: { id: string; evidence: unknown }[]) => JSON.stringify({ results: items });

function extractor(providers: ChatProvider[], caps: Record<string, number | null> = {}) {
  const store = createMemoryBudgetStore();
  const budget = createBudget({ store, caps });
  const slept: number[] = [];
  const ex = createLlmExtractor({
    providers,
    budget,
    organizationId: "org_test",
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { ex, store, slept };
}

// ---------------------------------------------------------------------------

describe("few-shot selection", () => {
  it("alternates positive and negative from most recent and respects the limit", () => {
    const labels = [
      label("positive", "p1"),
      label("positive", "p2"),
      label("positive", "p3"),
      label("negative", "n1"),
      label("negative", "n2"),
    ];
    expect(selectFewShot(labels, 4).map((l) => l.post.body)).toEqual(["p1", "n1", "p2", "n2"]);
    expect(selectFewShot(labels, 5).map((l) => l.post.body)).toEqual(["p1", "n1", "p2", "n2", "p3"]);
    expect(selectFewShot(labels.slice(0, 3), 2).map((l) => l.post.body)).toEqual(["p1", "p2"]);
    expect(selectFewShot(labels, 0)).toEqual([]);
  });

  it("formats an example with verdict, platform, truncated text and the reviewer note", () => {
    const text = formatExample(label("negative", "x".repeat(EXAMPLE_MAX_CHARS + 50), "equity only"), 0);
    expect(text).toContain("NOT A FIT");
    expect(text).toContain("[reddit]");
    expect(text).toContain("Reviewer note: equity only");
    expect(text.length).toBeLessThan(EXAMPLE_MAX_CHARS + 120);
  });
});

describe("prompt", () => {
  const input: ExtractionInput = {
    campaign,
    examples: [label("positive", "great fit", "signed")],
    posts: [post("a")],
  };
  const prompt = buildUserPrompt(input);

  it("shows criterion keys, questions, types and options — never weights or thresholds", () => {
    for (const c of mvpCriteria) {
      expect(prompt).toContain(c.key);
      expect(prompt).toContain(c.question);
    }
    expect(prompt).toContain("(one of: idea, prototype, live)");
    expect(prompt).not.toMatch(/weight/i);
    expect(prompt).not.toMatch(/threshold/i);
    expect(prompt).not.toMatch(/\b30\b|\b25\b/); // the weights themselves
  });

  it("includes offer, icp, disqualifiers, examples and posts by id", () => {
    expect(prompt).toContain(campaign.offerDescription);
    expect(prompt).toContain("- equity only");
    expect(prompt).toContain("Reviewer note: signed");
    expect(prompt).toContain("### Post id: a [reddit]");
    expect(SYSTEM_PROMPT).toContain("Return only JSON");
    expect(PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("budget", () => {
  it("allows spending below 90% of the cap, blocks at or above it, and ignores missing caps", async () => {
    const store = createMemoryBudgetStore();
    const budget = createBudget({ store, caps: { groq: 1_000, gemini: null } });

    expect(await budget.canSpend("groq")).toBe(true);
    await budget.record("org", "groq", "m", { promptTokens: 800, completionTokens: 99 });
    expect(await budget.canSpend("groq")).toBe(true);
    await budget.record("org", "groq", "m", { promptTokens: 1, completionTokens: 0 });
    expect(await budget.canSpend("groq")).toBe(false);
    expect(await budget.status("groq")).toEqual({ tokensUsedToday: 900, dailyCap: 1_000 });

    expect(await budget.canSpend("gemini")).toBe(true);
    expect(await budget.status("gemini")).toEqual({ tokensUsedToday: 0, dailyCap: null });
  });

  it("counts from the start of the UTC day", () => {
    expect(startOfUtcDay(new Date("2026-09-08T23:59:59Z")).toISOString()).toBe("2026-09-08T00:00:00.000Z");
  });
});

describe("parseResponse", () => {
  const input: ExtractionInput = { campaign, examples: [], posts: [post("a"), post("b")] };

  it("accepts valid items, drops unknown criteria keys, and flags missing or malformed posts", () => {
    const content = reply([
      {
        id: "a",
        evidence: {
          ...evidence(),
          criteria: { ...evidence().criteria, bogus: { value: 1, quote: null, confidence: 5 } },
        },
      },
      { id: "b", evidence: { criteria: {}, summary: 42 } },
      { id: "zzz", evidence: evidence() },
    ]);
    const { valid, invalid } = parseResponse(content, input);
    expect(valid.map((v) => v.postExternalId)).toEqual(["a"]);
    expect(Object.keys(valid[0]?.evidence.criteria ?? {})).not.toContain("bogus");
    expect(invalid.get("b")).toMatch(/evidence invalid/);
  });

  it("handles fenced JSON and non-JSON", () => {
    const fenced = `\`\`\`json\n${reply([{ id: "a", evidence: evidence() }])}\n\`\`\``;
    expect(parseResponse(fenced, input).valid).toHaveLength(1);
    expect(parseResponse(fenced, input).invalid.get("b")).toBe("missing from response");

    const junk = parseResponse("Sure! Here is the analysis:", input);
    expect([...junk.invalid.values()]).toEqual([
      "response was not valid JSON",
      "response was not valid JSON",
    ]);
  });
});

describe("LlmExtractor", () => {
  it("returns validated evidence and records usage against the provider", async () => {
    const groq = fakeProvider("groq", [
      reply([
        { id: "a", evidence: evidence() },
        { id: "b", evidence: evidence() },
      ]),
    ]);
    const { ex, store } = extractor([groq]);

    const out = await ex.extract({ campaign, examples: [], posts: [post("a"), post("b")] });
    expect(out.results.map((r) => r.postExternalId)).toEqual(["a", "b"]);
    expect(out.dropped).toEqual([]);
    expect(out.provider).toBe("groq/groq-model");
    expect(out.promptVersion).toBe(PROMPT_VERSION);
    expect(out.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
    expect(store.entries).toEqual([expect.objectContaining({ provider: "groq", total: 150 })]);
    expect(groq.requests[0]?.json).toBe(true);
  });

  it("re-asks once, alone, for malformed or missing posts, then drops with a reason", async () => {
    const groq = fakeProvider("groq", [
      reply([
        { id: "a", evidence: evidence() },
        { id: "b", evidence: { nope: true } },
      ]), // c missing, b malformed
      reply([{ id: "b", evidence: evidence() }]), // retry: b fixed, c still missing
    ]);
    const { ex } = extractor([groq]);

    const out = await ex.extract({ campaign, examples: [], posts: [post("a"), post("b"), post("c")] });
    expect(out.results.map((r) => r.postExternalId).sort()).toEqual(["a", "b"]);
    expect(out.dropped).toEqual([{ postExternalId: "c", reason: "missing from response" }]);
    expect(groq.requests).toHaveLength(2);
    expect(groq.requests[1]?.user).toContain("Post id: b");
    expect(groq.requests[1]?.user).toContain("Post id: c");
    expect(groq.requests[1]?.user).not.toContain("Post id: a");
    expect(out.usage).toEqual({ promptTokens: 200, completionTokens: 100 });
  });

  it("retries a retryable failure once after a delay, then falls through to the next provider", async () => {
    const busy = new ProviderError("groq", "HTTP 503", { status: 503, retryable: true, retryAfterMs: 5_000 });
    const groq = fakeProvider("groq", [busy, busy]);
    const gemini = fakeProvider("gemini", [reply([{ id: "a", evidence: evidence() }])]);
    const { ex, slept, store } = extractor([groq, gemini]);

    const out = await ex.extract({ campaign, examples: [], posts: [post("a")] });
    expect(out.provider).toBe("gemini/gemini-model");
    expect(groq.requests).toHaveLength(2);
    expect(slept).toEqual([5_000]); // Retry-After wins over the 2s default
    expect(store.entries.map((e) => e.provider)).toEqual(["gemini"]);
  });

  it("fails fast on a non-retryable provider error (it's our bug)", async () => {
    const bad = new ProviderError("groq", "HTTP 400: bad request", { status: 400, retryable: false });
    const { ex } = extractor([fakeProvider("groq", [bad]), fakeProvider("gemini", [])]);
    await expect(ex.extract({ campaign, examples: [], posts: [post("a")] })).rejects.toBe(bad);
  });

  it("skips providers over budget and throws BudgetExhaustedError when none is left", async () => {
    const groq = fakeProvider("groq", [reply([{ id: "a", evidence: evidence() }])]);
    const gemini = fakeProvider("gemini", [reply([{ id: "a", evidence: evidence() }])]);
    const { ex, store } = extractor([groq, gemini], { groq: 100, gemini: 100 });
    await store.record("org", "groq", "m", { promptTokens: 95, completionTokens: 0 });

    const out = await ex.extract({ campaign, examples: [], posts: [post("a")] });
    expect(out.provider).toBe("gemini/gemini-model");
    expect(groq.requests).toHaveLength(0);

    await store.record("org", "gemini", "m", { promptTokens: 95, completionTokens: 0 });
    await expect(ex.extract({ campaign, examples: [], posts: [post("a")] })).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
  });

  it("surfaces the last retryable error when every provider fails", async () => {
    const down = new ProviderError("gemini", "HTTP 502", { status: 502, retryable: true });
    const { ex } = extractor([fakeProvider("gemini", [down, down])]);
    await expect(ex.extract({ campaign, examples: [], posts: [post("a")] })).rejects.toBe(down);
  });
});
