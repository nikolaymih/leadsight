import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events } from "../schema/index.js";
import { withTestDb } from "../test/db.js";
import { hotFounderEvidence, thinEvidence } from "../test/fixtures.js";
import { seedCampaign, seedLead, seedPost } from "../test/seed.js";
import { createEmailDigestNotifier, EMAIL_DIGEST_EVENT, renderDigest } from "./email.js";
import type { Mailer, OutboundEmail } from "./mailer.js";

function fakeMailer(fail?: Error): Mailer & { sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  return {
    kind: "log",
    sent,
    async send(email) {
      if (fail) throw fail;
      sent.push(email);
    },
  };
}

const HOUR = 3_600_000;

describe("email digest notifier", () => {
  it("does nothing for a campaign without recipients", () =>
    withTestDb(async (db) => {
      const campaign = await seedCampaign(db);
      const lead = await seedLead(db, campaign, await seedPost(db));
      const mailer = fakeMailer();
      await createEmailDigestNotifier({ db, mailer }).notify([lead], campaign);
      expect(mailer.sent).toHaveLength(0);
    }));

  it("sends one digest with every alertable lead since the last one, then waits out the interval", () =>
    withTestDb(async (db) => {
      const campaign = await seedCampaign(db, {
        notifications: { digestRecipients: ["a@example.com", "b@example.com"] },
        minScoreAlert: 70,
      });
      const hot = await seedLead(db, campaign, await seedPost(db, { title: "Need a CTO for my SaaS" }));
      await seedLead(db, campaign, await seedPost(db, { title: "Thin post" }), { evidence: thinEvidence });
      await seedLead(db, campaign, await seedPost(db, { title: "Equity only" }), {
        evidence: { ...hotFounderEvidence, disqualifier_hits: ["equity only"] },
      });

      const mailer = fakeMailer();
      let clock = Date.now();
      const notifier = createEmailDigestNotifier({
        db,
        mailer,
        webOrigin: "https://leads.example.com",
        now: () => new Date(clock),
      });

      await notifier.notify([hot], campaign);
      expect(mailer.sent).toHaveLength(1);
      const mail = mailer.sent[0];
      expect(mail?.to).toEqual(["a@example.com", "b@example.com"]);
      expect(mail?.subject).toBe("[LeadSight] 1 new lead for Founders seeking an MVP team");
      expect(mail?.text).toContain("[HOT 100] Need a CTO for my SaaS by @u/founder");
      expect(mail?.text).not.toContain("Thin post");
      expect(mail?.text).not.toContain("Equity only");
      expect(mail?.text).toContain(`Inbox: https://leads.example.com/inbox?campaign=${campaign.id}`);

      const logged = await db.select().from(events).where(eq(events.type, EMAIL_DIGEST_EVENT));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ entityId: campaign.id, payload: { leads: 1, recipients: 2 } });

      // A second run an hour later with another hot lead: not due yet, nothing sent.
      clock += HOUR;
      const later = await seedLead(db, campaign, await seedPost(db, { title: "Another founder" }));
      await notifier.notify([later], campaign);
      expect(mailer.sent).toHaveLength(1);

      // A day later: due again, and the digest carries the lead that waited.
      clock += 24 * HOUR;
      const third = await seedLead(db, campaign, await seedPost(db, { title: "Third founder" }));
      await notifier.notify([third], campaign);
      expect(mailer.sent).toHaveLength(2);
      expect(mailer.sent[1]?.text).toContain("Another founder");
      expect(mailer.sent[1]?.text).toContain("Third founder");
      expect(mailer.sent[1]?.text).not.toContain("Need a CTO for my SaaS");
    }));

  it("records no digest event when the mailer fails, so the next run retries", () =>
    withTestDb(async (db) => {
      const campaign = await seedCampaign(db, { notifications: { digestRecipients: ["a@example.com"] } });
      const lead = await seedLead(db, campaign, await seedPost(db));
      const notifier = createEmailDigestNotifier({ db, mailer: fakeMailer(new Error("smtp down")) });
      await expect(notifier.notify([lead], campaign)).rejects.toThrow("smtp down");
      const logged = await db.select().from(events).where(eq(events.type, EMAIL_DIGEST_EVENT));
      expect(logged).toHaveLength(0);
    }));
});

describe("renderDigest", () => {
  it("lists verdict, score, title, summary and link per lead", () => {
    const text = renderDigest(
      { id: "c1", name: "Test", minScoreAlert: 60 },
      [
        {
          verdict: "warm",
          score: 64,
          summary: "Wants a dev shop.",
          post: { title: null, url: "https://x.test/1", authorHandle: null },
        } as never,
      ],
      { since: new Date("2026-09-08T00:00:00Z") },
    );
    expect(text).toContain('1 new lead scored 60+ for "Test" since 2026-09-08 00:00 UTC.');
    expect(text).toContain("[WARM 64] Wants a dev shop.");
    expect(text).toContain("https://x.test/1");
    expect(text).not.toContain("Inbox:");
  });
});
