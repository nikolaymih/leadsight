// Dates and numbers, one way everywhere.

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absolute = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return relative.format(diffSec, "second");
  if (abs < 3600) return relative.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(diffSec / 3600), "hour");
  if (abs < 30 * 86_400) return relative.format(Math.round(diffSec / 86_400), "day");
  return absolute.format(then);
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? absolute.format(new Date(iso)) : "—";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export function formatTokens(n: number): string {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n);
}

/** `r/startups`-style label for a platform enum value. */
export const PLATFORM_LABEL: Record<string, string> = {
  reddit: "Reddit",
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  web: "Web",
};

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
