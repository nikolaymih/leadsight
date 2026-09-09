"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/misc";
import { formatTokens } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// Tokens used today vs. the daily cap, per LLM provider. Polls each minute while visible.
// Extraction stops at 90% of the cap (design.md §4), so the bar turns amber there.

export function BudgetWidget({ className }: { className?: string }) {
  const budget = useQuery({ ...orpc.runs.budget.queryOptions(), refetchInterval: 60_000 });

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2", className)}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">LLM budget today</h3>
      {budget.isPending ? (
        <Skeleton className="h-4 w-40" />
      ) : budget.isError ? (
        <p className="text-xs text-destructive">{budget.error.message}</p>
      ) : budget.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No LLM provider configured.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {budget.data.map((b) => {
            const ratio = b.dailyCap ? Math.min(1, b.tokensUsedToday / b.dailyCap) : null;
            return (
              <li key={b.provider} className="flex flex-col gap-0.5 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{b.provider}</span>
                  <span className="tabular text-muted-foreground">
                    {formatTokens(b.tokensUsedToday)}
                    {b.dailyCap ? ` / ${formatTokens(b.dailyCap)}` : " · no cap"}
                  </span>
                </div>
                {ratio !== null ? (
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={Math.round(ratio * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${b.provider} budget used`}
                  >
                    <div
                      className={cn("h-full rounded-full", ratio >= 0.9 ? "bg-verdict-warm" : "bg-accent")}
                      style={{ width: `${Math.max(2, ratio * 100)}%` }}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
