"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { formatTokens } from "@/lib/format";
import { orpc } from "@/lib/orpc";

// Read-only: transports and provider keys live in the API's environment. What the API can
// deliver comes from integrations.status; fallback order and caps from runs.budget.
// Recipients are chosen per campaign (campaign settings → Email digest).

export function Integrations() {
  const status = useQuery(orpc.integrations.status.queryOptions());
  const budget = useQuery(orpc.runs.budget.queryOptions());
  const webSearch = useQuery(orpc.integrations.webSearch.queryOptions());

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              A daily email digest per campaign with the new leads at or above its alert score.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {status.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : status.isError ? (
            <p className="text-xs text-destructive">{status.error.message}</p>
          ) : (
            <>
              <Row
                label="Email delivery"
                value={
                  status.data.email.configured ? (
                    <Badge>Configured</Badge>
                  ) : (
                    <Badge variant="muted">Log only</Badge>
                  )
                }
                hint={
                  status.data.email.configured
                    ? `Sent from ${status.data.email.from}`
                    : "SMTP_URL is not set on the API; digests, invitations and password resets are written to its log."
                }
              />
              <Row
                label="Digest recipients"
                value={
                  <span className="tabular text-xs text-muted-foreground">
                    {status.data.digestCampaigns} campaign{status.data.digestCampaigns === 1 ? "" : "s"}
                  </span>
                }
                hint="Set per campaign under its settings."
              />
              <Row
                label="Chat alerts (Slack or similar)"
                value={<Badge variant="muted">Not planned yet</Badge>}
                hint="Deferred; email is the primary channel."
              />
            </>
          )}
          <p className="text-xs text-muted-foreground">
            <Link href="/campaigns" className="hover:underline">
              Campaigns
            </Link>{" "}
            → settings → “Email digest recipients” to choose who gets each digest.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Web search</CardTitle>
            <CardDescription>
              Discovery for Reddit, LinkedIn and X. Providers rotate; each has a monthly cap with back-off at
              90% and a hard stop at 100%. Keys are set in the API environment and never shown here.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {webSearch.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : webSearch.isError ? (
            <p className="text-xs text-destructive">{webSearch.error.message}</p>
          ) : (
            <>
              {webSearch.data.providers.map((p) => (
                <Row
                  key={p.name}
                  label={p.name === "exa" ? "Exa" : "Tavily"}
                  value={
                    p.state === "not_configured" ? (
                      <Badge variant="muted">Not configured</Badge>
                    ) : p.state === "exhausted" ? (
                      <Badge variant="muted">Stopped for the month</Badge>
                    ) : p.state === "backoff" ? (
                      <Badge variant="secondary">Backing off</Badge>
                    ) : (
                      <Badge>Active</Badge>
                    )
                  }
                  hint={
                    p.configured
                      ? `${Math.round(p.usedThisMonth)}${p.monthlyCap ? ` of ${p.monthlyCap}` : ""} ${p.name === "exa" ? "searches" : "credits"} used this month`
                      : `Set ${p.name === "exa" ? "EXA_API_KEY" : "TAVILY_API_KEY"} on the API to enable it.`
                  }
                />
              ))}
              {!webSearch.data.configured ? (
                <p className="text-xs text-destructive">
                  No web search provider is configured, so web search sources cannot run. Google Alerts feeds
                  still work.
                </p>
              ) : null}
            </>
          )}
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
