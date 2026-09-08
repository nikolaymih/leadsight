import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../errors.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { jsJobsCriteria, mvpCriteria } from "../test/fixtures.js";
import { seedCampaign, TEST_ORG, TEST_USER } from "../test/seed.js";
import { createCampaign, getCampaign, listCampaigns, updateCampaign } from "./campaigns.js";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

const input = {
  name: "Founders",
  offerDescription: "We build MVPs.",
  icp: "Non-technical founders.",
  disqualifiers: [],
  keywords: ["cto"],
  criteria: mvpCriteria,
  thresholds: { hot: 70, warm: 40 },
  createdBy: TEST_USER,
};

describe("db/campaigns", () => {
  it("scopes reads to the organization", async () => {
    const mine = await seedCampaign(t.db);
    await seedCampaign(t.db, { organizationId: "org_other" });

    expect((await listCampaigns(t.db, TEST_ORG)).map((c) => c.id)).toEqual([mine.id]);
    await expect(getCampaign(t.db, "org_other", mine.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates at rulesVersion 1 and validates criteria and thresholds", async () => {
    const created = await createCampaign(t.db, TEST_ORG, input);
    expect(created.rulesVersion).toBe(1);
    expect(created.organizationId).toBe(TEST_ORG);

    const badWeights = mvpCriteria.map((c, i) => (i === 0 ? { ...c, weight: 10 } : c));
    await expect(createCampaign(t.db, TEST_ORG, { ...input, criteria: badWeights })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createCampaign(t.db, TEST_ORG, { ...input, thresholds: { hot: 40, warm: 40 } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("bumps rulesVersion only when criteria actually change", async () => {
    const c = await seedCampaign(t.db);

    const renamed = await updateCampaign(t.db, TEST_ORG, c.id, { name: "Renamed" });
    expect(renamed.name).toBe("Renamed");
    expect(renamed.rulesVersion).toBe(1);

    const same = await updateCampaign(t.db, TEST_ORG, c.id, { criteria: mvpCriteria });
    expect(same.rulesVersion).toBe(1);

    const changed = await updateCampaign(t.db, TEST_ORG, c.id, { criteria: jsJobsCriteria });
    expect(changed.rulesVersion).toBe(2);
    expect(changed.criteria).toEqual(jsJobsCriteria);

    const thresholds = await updateCampaign(t.db, TEST_ORG, c.id, { thresholds: { hot: 80, warm: 50 } });
    expect(thresholds.rulesVersion).toBe(2);
  });

  it("refuses to update a campaign from another organization", async () => {
    const c = await seedCampaign(t.db);
    await expect(updateCampaign(t.db, "org_other", c.id, { name: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
