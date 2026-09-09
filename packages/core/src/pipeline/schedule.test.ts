import { describe, expect, it } from "vitest";
import { effectivePollIntervalMin, hourInZone, isSourceDue, isWithinActiveHours } from "./schedule.js";

// 2026-09-09T05:30Z is 08:30 in Sofia (UTC+3, summer time) and 22:30 the day before in Los Angeles.
const MORNING_UTC = new Date("2026-09-09T05:30:00Z");
const NIGHT_UTC = new Date("2026-09-09T22:30:00Z"); // 01:30 Sofia

const sofia = { tz: "Europe/Sofia", from: 8, to: 23, offInterval: 180 };

describe("hourInZone", () => {
  it("converts to the zone's local hour and tolerates unknown zones", () => {
    expect(hourInZone(MORNING_UTC, "Europe/Sofia")).toBe(8);
    expect(hourInZone(MORNING_UTC, "America/Los_Angeles")).toBe(22);
    expect(hourInZone(new Date("2026-09-09T00:10:00Z"), "UTC")).toBe(0);
    expect(hourInZone(MORNING_UTC, "Not/AZone")).toBeNull();
  });
});

describe("isWithinActiveHours", () => {
  it("uses [from, to) in the zone and supports windows that wrap midnight", () => {
    expect(isWithinActiveHours(sofia, MORNING_UTC)).toBe(true);
    expect(isWithinActiveHours(sofia, NIGHT_UTC)).toBe(false);
    expect(isWithinActiveHours({ ...sofia, from: 9 }, MORNING_UTC)).toBe(false);
    // 22:00–06:00 night shift
    expect(isWithinActiveHours({ ...sofia, from: 22, to: 6 }, NIGHT_UTC)).toBe(true);
    expect(isWithinActiveHours({ ...sofia, from: 22, to: 6 }, MORNING_UTC)).toBe(false);
    // Unknown zone: treated as active so a typo never slows a source down.
    expect(isWithinActiveHours({ ...sofia, tz: "Nope/Nope" }, NIGHT_UTC)).toBe(true);
  });
});

describe("isSourceDue", () => {
  const base = { enabled: true, pollIntervalMin: 30, activeHours: sofia };

  it("polls on the normal interval by day and the off interval by night", () => {
    expect(effectivePollIntervalMin(base, MORNING_UTC)).toBe(30);
    expect(effectivePollIntervalMin(base, NIGHT_UTC)).toBe(180);

    const ranAnHourAgo = (now: Date) => new Date(now.getTime() - 60 * 60_000);
    expect(isSourceDue({ ...base, lastRunAt: ranAnHourAgo(MORNING_UTC) }, MORNING_UTC)).toBe(true);
    expect(isSourceDue({ ...base, lastRunAt: ranAnHourAgo(NIGHT_UTC) }, NIGHT_UTC)).toBe(false);
    expect(isSourceDue({ ...base, lastRunAt: new Date(NIGHT_UTC.getTime() - 181 * 60_000) }, NIGHT_UTC)).toBe(
      true,
    );
  });

  it("never-run sources are due, disabled ones never, and a minimum interval floors the rule", () => {
    expect(isSourceDue({ ...base, lastRunAt: null }, NIGHT_UTC)).toBe(true);
    expect(isSourceDue({ ...base, enabled: false, lastRunAt: null }, MORNING_UTC)).toBe(false);
    const ranAnHourAgo = new Date(MORNING_UTC.getTime() - 60 * 60_000);
    expect(isSourceDue({ ...base, lastRunAt: ranAnHourAgo }, MORNING_UTC, { minIntervalMin: 120 })).toBe(
      false,
    );
    expect(isSourceDue({ ...base, activeHours: null, lastRunAt: ranAnHourAgo }, NIGHT_UTC)).toBe(true);
  });
});
