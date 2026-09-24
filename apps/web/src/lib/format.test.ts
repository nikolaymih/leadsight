import { formatDuration, formatRelative, formatTokens, titleCase } from "./format";

describe("formatRelative", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");

  it("renders a dash for missing input", () => {
    expect(formatRelative(null, now)).toBe("—");
    expect(formatRelative(undefined, now)).toBe("—");
  });

  it("picks the coarsest unit that fits", () => {
    expect(formatRelative("2026-09-08T11:59:30Z", now)).toBe("30 seconds ago");
    expect(formatRelative("2026-09-08T11:15:00Z", now)).toBe("45 minutes ago");
    expect(formatRelative("2026-09-08T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelative("2026-09-06T12:00:00Z", now)).toBe("2 days ago");
  });

  it("falls back to an absolute date after a month", () => {
    expect(formatRelative("2026-07-01T12:00:00Z", now)).toMatch(/Jul 1, 2026/);
  });
});

describe("formatDuration", () => {
  it("scales from ms to minutes", () => {
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(150_000)).toBe("3 min");
  });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_400)).toBe("12k");
    expect(formatTokens(2_300_000)).toBe("2.3M");
  });
});

describe("titleCase", () => {
  it("turns enum values into labels", () => {
    expect(titleCase("in_progress")).toBe("In progress");
    expect(titleCase("hot")).toBe("Hot");
  });
});
