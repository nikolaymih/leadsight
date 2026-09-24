import type { ActiveHours } from "../types.js";

// When is a source due? Pure functions over the source row and a clock, so the rule is
// testable without a database. `findDueSourcesAllOrgs` pre-selects with the shorter of the
// two intervals in SQL; `isSourceDue` applies the exact, time-zone-aware rule.

export interface SchedulableSource {
  enabled: boolean;
  lastRunAt: Date | null;
  pollIntervalMin: number;
  activeHours: ActiveHours | null;
}

/** Local hour (0–23) in an IANA zone; null when the zone is unknown to this runtime. */
export function hourInZone(now: Date, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    return Number.isInteger(hour) ? hour % 24 : null;
  } catch {
    return null;
  }
}

/** True inside `[from, to)` local hours; a window that wraps midnight (from > to) is supported. */
export function isWithinActiveHours(hours: ActiveHours, now: Date): boolean {
  const hour = hourInZone(now, hours.tz);
  if (hour === null) return true; // unknown zone: never slow a source down by accident
  const { from, to } = hours;
  if (from < to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}

export function effectivePollIntervalMin(
  source: Pick<SchedulableSource, "pollIntervalMin" | "activeHours">,
  now: Date,
): number {
  if (!source.activeHours || isWithinActiveHours(source.activeHours, now)) return source.pollIntervalMin;
  return source.activeHours.offInterval;
}

export interface DueOptions {
  /** Floor on the interval, e.g. the search budget back-off. */
  minIntervalMin?: number;
}

export function isSourceDue(source: SchedulableSource, now: Date, opts: DueOptions = {}): boolean {
  if (!source.enabled) return false;
  if (!source.lastRunAt) return true;
  const interval = Math.max(effectivePollIntervalMin(source, now), opts.minIntervalMin ?? 0);
  return source.lastRunAt.getTime() + interval * 60_000 <= now.getTime();
}
