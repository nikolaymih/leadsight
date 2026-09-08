import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateCampaign } from "../db/campaigns.js";
import { ValidationError } from "../errors.js";
import { leads } from "../schema/index.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { hotFounderEvidence, thinEvidence } from "../test/fixtures.js";
import { seedCampaign, seedLead, seedPost, TEST_ORG } from "../test/seed.js";
import { previewRescore, rescoreCampaign } from "./rescore.js";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

describe("rescore", () => {
  it("re-applies the rules over stored evidence, reports movement, and stamps the rules version", async () => {
    const c = await seedCampaign(t.db); // hot ≥ 70, warm ≥ 40
    const hot = await seedLead(t.db, c, await seedPost(t.db)); // score 100 → hot
    const thin = await seedLead(t.db, c, await seedPost(t.db), { evidence: thinEvidence }); // insufficient
    expect([hot.verdict, thin.verdict]).toEqual(["hot", "insufficient"]);

    // Raise the hot bar to 100 (the hot lead scores exactly 100, so it stays hot) and drop
    // minConfidence so the thin one becomes cold instead of insufficient.
    const bumped = await updateCampaign(t.db, TEST_ORG, c.id, {
      thresholds: { hot: 100, warm: 40 },
      minConfidence: 0,
    });
    expect(bumped.rulesVersion).toBe(1); // thresholds don't bump the version

    const result = await rescoreCampaign(t.db, TEST_ORG, c.id);
    expect(result.rescored).toBe(2);
    expect(result.moved).toEqual({ hot: 0, warm: 0, cold: 1, insufficient: 0, disqualified: 0 });

    const [hotNow] = await t.db.select().from(leads).where(eq(leads.id, hot.id));
    const [thinNow] = await t.db.select().from(leads).where(eq(leads.id, thin.id));
    expect(hotNow?.verdict).toBe("hot"); // 100 ≥ 100
    expect(thinNow?.verdict).toBe("cold");
    expect(hotNow?.rulesVersion).toBe(bumped.rulesVersion);
  });

  it("preview computes the distribution under edited rules without writing", async () => {
    const c = await seedCampaign(t.db);
    await seedLead(t.db, c, await seedPost(t.db));
    await seedLead(t.db, c, await seedPost(t.db), { evidence: thinEvidence });

    const preview = await previewRescore(t.db, TEST_ORG, c.id, {
      criteria: c.criteria,
      thresholds: { hot: 70, warm: 40 },
      minConfidence: 0,
    });
    expect(preview.total).toBe(2);
    expect(preview.byVerdict).toMatchObject({ hot: 1, cold: 1 });

    const untouched = await t.db.select().from(leads);
    expect(untouched.map((l) => l.verdict).sort()).toEqual(["hot", "insufficient"]);

    await expect(
      previewRescore(t.db, TEST_ORG, c.id, {
        criteria: [],
        thresholds: { hot: 70, warm: 40 },
        minConfidence: 50,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      previewRescore(t.db, "org_other", c.id, {
        criteria: c.criteria,
        thresholds: c.thresholds,
        minConfidence: 50,
      }),
    ).rejects.toThrow(/not found/);
    void hotFounderEvidence;
  });
});
