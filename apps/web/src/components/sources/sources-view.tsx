"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { useActiveCampaign } from "@/hooks/use-active-campaign";
import { canManage, useOrgRole } from "@/hooks/use-org-members";
import { orpc } from "@/lib/orpc";
import { BudgetWidget } from "./budget-widget";
import { RunTable } from "./run-table";
import { AddSourceDialog } from "./source-form";
import { SourceTable } from "./source-table";

export function SourcesView() {
  const { campaigns, active: campaign } = useActiveCampaign();
  const role = useOrgRole();
  const manage = canManage(role);
  const [adding, setAdding] = useState(false);

  const sources = useQuery({
    ...orpc.sources.list.queryOptions({ input: campaign ? { campaignId: campaign.id } : skipToken }),
    refetchInterval: 15_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold">Sources</h1>
            <p className="text-xs text-muted-foreground">
              {campaign ? `Polled for “${campaign.name}”. ` : ""}
              {campaign ? (
                <Link href={`/campaigns/${campaign.id}`} className="hover:underline">
                  Campaign settings
                </Link>
              ) : null}
            </p>
          </div>
          {campaign ? (
            <Button size="sm" disabled={!manage} onClick={() => setAdding(true)}>
              <Plus />
              Add source
            </Button>
          ) : null}
        </div>

        {campaigns.isSuccess && campaigns.data.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            description="Sources belong to a campaign."
            action={
              <Button asChild>
                <Link href="/campaigns/new">Create a campaign</Link>
              </Button>
            }
          />
        ) : !campaign || sources.isPending ? (
          <div className="flex flex-col gap-1.5">
            {["a", "b", "c"].map((k) => (
              <Skeleton key={k} className="h-8 w-full" />
            ))}
          </div>
        ) : sources.isError ? (
          <EmptyState
            title="Could not load sources"
            description={sources.error.message}
            action={
              <Button variant="outline" onClick={() => void sources.refetch()}>
                Retry
              </Button>
            }
          />
        ) : sources.data.length === 0 ? (
          <EmptyState
            title="No sources for this campaign"
            description="Add a subreddit, a Reddit search or a Google Alerts feed."
            action={
              <Button disabled={!manage} onClick={() => setAdding(true)}>
                <Plus />
                Add source
              </Button>
            }
          />
        ) : (
          <SourceTable sources={sources.data} canManage={manage} />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Recent runs</h2>
          <RunTable />
        </section>
        <BudgetWidget className="self-start" />
      </div>

      {campaign ? <AddSourceDialog campaignId={campaign.id} open={adding} onOpenChange={setAdding} /> : null}
    </div>
  );
}
