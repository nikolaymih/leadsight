import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Criterion, Evidence } from "@/lib/types";
import { cn } from "@/lib/utils";

// Why a lead scored what it did: one row per criterion with points / possible, the extracted
// value, the supporting quote and the extractor's confidence. Campaign criteria drive the
// order and the "possible" column; keys that were scored but no longer exist in the campaign
// (criteria edited since) still show, labelled by key.

export interface ScoreBreakdownProps {
  criteria: Criterion[];
  breakdown: Record<string, number>;
  evidence: Evidence;
  /** Truncate quotes; used in the expanded inbox row. */
  compact?: boolean;
  className?: string;
}

export function formatEvidenceValue(value: boolean | string | number | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function ScoreBreakdown({
  criteria,
  breakdown,
  evidence,
  compact = false,
  className,
}: ScoreBreakdownProps) {
  const known = new Set(criteria.map((c) => c.key));
  const rows = [
    ...criteria.map((c) => ({ key: c.key, label: c.question, possible: c.weight })),
    ...Object.keys(breakdown)
      .filter((k) => !known.has(k))
      .map((k) => ({ key: k, label: k, possible: null as number | null })),
  ];
  const hits = evidence.disqualifier_hits;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Criterion</TableHead>
            <TableHead>Value</TableHead>
            <TableHead className="text-right">Points</TableHead>
            <TableHead>Quote</TableHead>
            <TableHead className="text-right">Conf.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const field = evidence.criteria[row.key];
            const points = breakdown[row.key] ?? 0;
            return (
              <TableRow key={row.key} className="hover:bg-transparent">
                <TableCell className="max-w-64 whitespace-normal align-top">
                  <div>{row.label}</div>
                  {row.label !== row.key ? (
                    <div className="font-mono text-[10px] text-muted-foreground">{row.key}</div>
                  ) : null}
                </TableCell>
                <TableCell className="align-top">{formatEvidenceValue(field?.value ?? null)}</TableCell>
                <TableCell className="tabular text-right align-top">
                  <span className={cn(points > 0 ? "font-medium" : "text-muted-foreground")}>{points}</span>
                  {row.possible != null ? (
                    <span className="text-muted-foreground"> / {row.possible}</span>
                  ) : null}
                </TableCell>
                <TableCell
                  className={cn(
                    "max-w-md whitespace-normal align-top text-muted-foreground italic",
                    compact && "truncate whitespace-nowrap",
                  )}
                  title={compact && field?.quote ? field.quote : undefined}
                >
                  {field?.quote ? `“${field.quote}”` : "—"}
                </TableCell>
                <TableCell className="tabular text-right align-top text-muted-foreground">
                  {field ? `${field.confidence}%` : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {hits.length > 0 ? (
        <div className="rounded-[var(--radius)] border border-verdict-disqualified/40 bg-verdict-disqualified/10 px-3 py-2 text-xs">
          <span className="font-medium text-verdict-disqualified">Disqualified:</span>{" "}
          <span className="text-foreground">{hits.join(" · ")}</span>
        </div>
      ) : null}
    </div>
  );
}
