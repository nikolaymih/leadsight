import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { campaigns } from "../schema/index.js";
import { createTestDb, withTestDb } from "./db.js";
import { seedCampaign } from "./seed.js";

describe("test database harness", () => {
  it("gives each test an isolated database and drops it on close", async () => {
    const a = await createTestDb();
    const b = await createTestDb();

    await seedCampaign(a.db);
    expect(await a.db.select().from(campaigns)).toHaveLength(1);
    expect(await b.db.select().from(campaigns)).toHaveLength(0);

    await a.close();
    const remaining = await b.db.execute(sql`select 1 from pg_database where datname = ${a.name}`);
    expect(remaining.length).toBe(0);
    await b.close();
  });

  it("withTestDb cleans up even when the callback throws", async () => {
    let name = "";
    await expect(
      withTestDb(async (db) => {
        const [row] = await db.execute<{ current_database: string }>(sql`select current_database()`);
        name = row?.current_database ?? "";
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(name).toMatch(/^leadsight_test_/);
    await withTestDb(async (db) => {
      const rows = await db.execute(sql`select 1 from pg_database where datname = ${name}`);
      expect(rows.length).toBe(0);
    });
  });
});
