import { describe, expect, it } from "vitest";
import { withTestDb } from "../test/db.js";
import { TEST_ORG } from "../test/seed.js";
import {
  budgetState,
  createBudget,
  createDbBudgetStore,
  createDbWebSearchBudgetStore,
  createMemoryWebSearchBudgetStore,
  createWebSearchBudget,
  WEB_SEARCH_BACKOFF_MIN,
  webSearchPollIntervalMin,
} from "./budget.js";

describe("db-backed budget store", () => {
  it("records llm.usage events and sums them per provider across organizations", () =>
    withTestDb(async (db) => {
      const store = createDbBudgetStore(db);
      const budget = createBudget({ store, caps: { groq: 1_000 } });

      await budget.record(TEST_ORG, "groq", "m", { promptTokens: 400, completionTokens: 100 });
      await budget.record("org_other", "groq", "m", { promptTokens: 300, completionTokens: 0 });
      await budget.record(TEST_ORG, "gemini", "m", { promptTokens: 999, completionTokens: 0 });

      expect(await budget.status("groq")).toEqual({ tokensUsedToday: 800, dailyCap: 1_000 });
      expect(await budget.canSpend("groq")).toBe(true);

      await budget.record(TEST_ORG, "groq", "m", { promptTokens: 100, completionTokens: 0 });
      expect(await budget.canSpend("groq")).toBe(false);
      expect(await budget.status("gemini")).toEqual({ tokensUsedToday: 999, dailyCap: null });
    }));
});

describe("web search monthly budget", () => {
  it("moves ok → backoff at 90% → exhausted at 100% per provider, and resets on the 1st (UTC)", async () => {
    let clock = new Date("2026-09-24T10:00:00Z");
    const store = createMemoryWebSearchBudgetStore(() => clock);
    const budget = createWebSearchBudget({ store, caps: { exa: 1000, tavily: 1000 }, now: () => clock });

    await budget.record("org", "exa", 899);
    expect(await budget.state("exa")).toBe("ok");
    expect(await budget.shouldBackOff()).toBe(false);

    await budget.record("org", "exa", 1);
    expect(await budget.status("exa")).toEqual({
      provider: "exa",
      usedThisMonth: 900,
      monthlyCap: 1000,
      state: "backoff",
    });
    // Tavily is still under 90%, so sources keep their own interval.
    expect(await budget.shouldBackOff()).toBe(false);

    await budget.record("org", "tavily", 950);
    expect(await budget.shouldBackOff()).toBe(true);
    expect(webSearchPollIntervalMin(30, true)).toBe(WEB_SEARCH_BACKOFF_MIN);
    expect(webSearchPollIntervalMin(240, true)).toBe(240);
    expect(webSearchPollIntervalMin(30, false)).toBe(30);

    await budget.record("org", "exa", 100);
    expect(await budget.state("exa")).toBe("exhausted");

    clock = new Date("2026-10-01T00:00:01Z");
    expect(await budget.status("exa")).toMatchObject({ usedThisMonth: 0, state: "ok" });
    expect(await budget.shouldBackOff()).toBe(false);
  });

  it("uncapped providers are always ok; no providers never backs off", async () => {
    const budget = createWebSearchBudget({ store: createMemoryWebSearchBudgetStore(), caps: { exa: null } });
    await budget.record("org", "exa", 1_000_000);
    expect(await budget.state("exa")).toBe("ok");
    expect(
      await createWebSearchBudget({ store: createMemoryWebSearchBudgetStore(), caps: {} }).shouldBackOff(),
    ).toBe(false);
    expect(budgetState(90, 100)).toBe("backoff");
    expect(budgetState(100, 100)).toBe("exhausted");
  });

  it("db store: records search.usage events per provider and sums them across organizations", () =>
    withTestDb(async (db) => {
      const budget = createWebSearchBudget({
        store: createDbWebSearchBudgetStore(db),
        caps: { exa: 10, tavily: 10 },
      });
      await budget.record(TEST_ORG, "exa", 2);
      await budget.record("org_other", "exa", 6);
      await budget.record(TEST_ORG, "tavily", 3);
      await budget.record(TEST_ORG, "exa", 0); // no-op
      expect(await budget.status("exa")).toMatchObject({ usedThisMonth: 8, state: "ok" });
      expect(await budget.status("tavily")).toMatchObject({ usedThisMonth: 3 });
      await budget.record(TEST_ORG, "exa", 1);
      expect(await budget.state("exa")).toBe("backoff");
      await budget.record(TEST_ORG, "exa", 1);
      expect(await budget.state("exa")).toBe("exhausted");
    }));
});
