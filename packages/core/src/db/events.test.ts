import { describe, expect, it } from "vitest";
import { withTestDb } from "../test/db.js";
import { TEST_ORG } from "../test/seed.js";
import { appendEvent, listPipelineRuns } from "./events.js";

describe("db/events", () => {
  it("appends an event with optional fields defaulting to null", () =>
    withTestDb(async (db) => {
      const minimal = await appendEvent(db, { organizationId: TEST_ORG, type: "pipeline.run" });
      expect(minimal).toMatchObject({
        organizationId: TEST_ORG,
        type: "pipeline.run",
        entityType: null,
        payload: null,
      });
      expect(minimal.createdAt).toBeInstanceOf(Date);

      const full = await appendEvent(db, {
        organizationId: TEST_ORG,
        type: "lead.status_changed",
        entityType: "lead",
        entityId: "abc",
        payload: { from: "new", to: "contacted" },
      });
      expect(full.payload).toEqual({ from: "new", to: "contacted" });
    }));

  it("pages pipeline runs newest first by cursor, scoped to the organization, with no gaps or repeats", () =>
    withTestDb(async (db) => {
      for (let n = 0; n < 5; n++) {
        await appendEvent(db, { organizationId: TEST_ORG, type: "pipeline.run", payload: { n } });
      }
      await appendEvent(db, { organizationId: "org_other", type: "pipeline.run", payload: { n: 99 } });
      await appendEvent(db, { organizationId: TEST_ORG, type: "source.run", payload: { n: 98 } });

      const seen: unknown[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await listPipelineRuns(db, TEST_ORG, { limit: 2, cursor });
        seen.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toEqual([{ n: 4 }, { n: 3 }, { n: 2 }, { n: 1 }, { n: 0 }]);
      await expect(listPipelineRuns(db, TEST_ORG, { cursor: "garbage" })).rejects.toThrow(/invalid cursor/);
    }));
});
