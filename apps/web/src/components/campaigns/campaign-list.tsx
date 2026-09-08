"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelative } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import type { CampaignStatus } from "@/lib/types";

const STATUS_VARIANT: Record<CampaignStatus, "default" | "secondary" | "muted"> = {
  active: "default",
  paused: "secondary",
  archived: "muted",
};

export function CampaignList() {
  const campaigns = useQuery(orpc.campaigns.list.queryOptions());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Campaigns</h1>
        <Button asChild size="sm">
          <Link href="/campaigns/new">
            <Plus />
            New campaign
          </Link>
        </Button>
      </div>

      {campaigns.isPending ? (
        <div className="flex flex-col gap-1.5">
          {["a", "b", "c"].map((k) => (
            <Skeleton key={k} className="h-8 w-full" />
          ))}
        </div>
      ) : campaigns.isError ? (
        <EmptyState
          title="Could not load campaigns"
          description={campaigns.error.message}
          action={
            <Button variant="outline" onClick={() => void campaigns.refetch()}>
              Retry
            </Button>
          }
        />
      ) : campaigns.data.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Describe what you're looking for and the assistant drafts the criteria."
          action={
            <Button asChild>
              <Link href="/campaigns/new">Create a campaign</Link>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Criteria</TableHead>
              <TableHead className="text-right">Rules</TableHead>
              <TableHead>Thresholds</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.data.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link href={`/campaigns/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[c.status]} className="capitalize">
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="tabular text-right">{c.criteria.length}</TableCell>
                <TableCell className="tabular text-right text-muted-foreground">v{c.rulesVersion}</TableCell>
                <TableCell className="tabular text-muted-foreground">
                  warm {c.thresholds.warm} · hot {c.thresholds.hot}
                </TableCell>
                <TableCell className="text-muted-foreground" title={c.updatedAt}>
                  {formatRelative(c.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/inbox?campaign=${c.id}`}>Inbox</Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/sources?campaign=${c.id}`}>Sources</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
