import { describe, expect, it } from "vitest";
import { withTestDb } from "../test/db.js";
import { TEST_ORG } from "../test/seed.js";
import { appendEvent } from "./events.js";

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
});
