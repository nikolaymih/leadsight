import { describe, expect, it } from "vitest";
import { withTestDb } from "../test/db.js";
import { TEST_ORG } from "../test/seed.js";
import { createBudget, createDbBudgetStore } from "./budget.js";

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
