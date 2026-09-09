import { describe, expect, it } from "vitest";
import { withTestDb } from "../test/db.js";
import { TEST_ORG } from "../test/seed.js";
import {
  createBudget,
  createDbBudgetStore,
  createDbSearchBudgetStore,
  createMemorySearchBudgetStore,
  createSearchBudget,
  SEARCH_BACKOFF_MIN,
  searchPollIntervalMin,
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

describe("search query budget", () => {
  it("allows queries until 90% of the daily cap, then backs google_search off to 2h until midnight UTC", async () => {
    let clock = new Date("2026-09-09T10:00:00Z");
    const store = createMemorySearchBudgetStore(() => clock);
    const budget = createSearchBudget({ store, dailyCap: 100, now: () => clock });

    await budget.record("org", 89);
    expect(await budget.canQuery()).toBe(true);
    expect(searchPollIntervalMin(30, await budget.canQuery())).toBe(30);

    await budget.record("org", 1);
    expect(await budget.status()).toEqual({ queriesUsedToday: 90, dailyCap: 100 });
    expect(await budget.canQuery()).toBe(false);
    expect(searchPollIntervalMin(30, false)).toBe(SEARCH_BACKOFF_MIN);
    // A source that already polls slower than the back-off keeps its own interval.
    expect(searchPollIntervalMin(240, false)).toBe(240);

    // Midnight UTC resets the counter.
    clock = new Date("2026-09-10T00:00:01Z");
    expect(await budget.status()).toEqual({ queriesUsedToday: 0, dailyCap: 100 });
    expect(await budget.canQuery()).toBe(true);

    expect(await createSearchBudget({ store, dailyCap: null }).canQuery()).toBe(true);
  });

  it("db store: records search.usage events and sums them across organizations", () =>
    withTestDb(async (db) => {
      const budget = createSearchBudget({ store: createDbSearchBudgetStore(db), dailyCap: 10 });
      await budget.record(TEST_ORG, 2);
      await budget.record("org_other", 6);
      await budget.record(TEST_ORG, 0); // no-op
      expect(await budget.status()).toEqual({ queriesUsedToday: 8, dailyCap: 10 });
      expect(await budget.canQuery()).toBe(true);
      await budget.record(TEST_ORG, 1);
      expect(await budget.canQuery()).toBe(false);
    }));
});
