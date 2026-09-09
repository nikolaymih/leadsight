"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { formatTokens } from "@/lib/format";
import { orpc } from "@/lib/orpc";

// Read-only for now: notifiers (Slack, email digest) ship in step 9 and provider keys live in the
// API's environment. Fallback order and caps come from runs.budget.

export function Integrations() {
  const budget = useQuery(orpc.runs.budget.queryOptions());

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Where new leads above a campaign's alert score are announced.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Row
            label="Slack webhook"
            value={<Badge variant="muted">Not configured</Badge>}
            hint="Per-campaign webhooks arrive with the notifiers release."
          />
          <Row
            label="Email digest"
            value={<Badge variant="muted">Not configured</Badge>}
            hint="Daily digest to chosen recipients; same release."
          />
          <p className="text-xs text-muted-foreground">
            Until then, the minimum score to alert is set per campaign and recorded for when delivery is
            switched on.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>LLM providers</CardTitle>
            <CardDescription>
              Fallback order and daily token caps. Keys are set in the API environment and never shown here.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {budget.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : budget.isError ? (
            <p className="text-xs text-destructive">{budget.error.message}</p>
          ) : budget.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No provider configured. Set GROQ_API_KEY and/or GEMINI_API_KEY on the API.
            </p>
          ) : (
            <ol className="flex flex-col gap-1.5 text-sm">
              {budget.data.map((p, i) => (
                <li
                  key={p.provider}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-3 py-1.5"
                >
                  <span className="flex items-center gap-2">
                    <span className="tabular text-xs text-muted-foreground">{i + 1}.</span>
                    <span className="font-medium">{p.provider}</span>
                    <span className="font-mono text-xs text-muted-foreground">••••••••</span>
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {p.dailyCap ? `${formatTokens(p.dailyCap)} tokens/day` : "no daily cap"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <div>
        <div className="font-medium">{label}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {value}
    </div>
  );
}
