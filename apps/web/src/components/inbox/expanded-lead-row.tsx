"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { orpc } from "@/lib/orpc";
import type { Campaign } from "@/lib/types";
import { ScoreBreakdown } from "./score-breakdown";

// The list row carries no evidence; expanding fetches the detail (shared with the panel's cache).
export function ExpandedLeadRow({
  leadId,
  campaign,
  onOpenDetails,
}: {
  leadId: string;
  campaign: Campaign;
  onOpenDetails: () => void;
}) {
  const detail = useQuery(orpc.leads.get.queryOptions({ input: { id: leadId } }));

  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <p className="text-xs text-destructive">
        Could not load the breakdown.{" "}
        <button type="button" className="underline" onClick={() => void detail.refetch()}>
          Retry
        </button>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ScoreBreakdown
        criteria={campaign.criteria}
        breakdown={detail.data.scoreBreakdown}
        evidence={detail.data.evidence}
        compact
      />
      <div>
        <Button variant="link" size="sm" className="h-auto px-0" onClick={onOpenDetails}>
          Open details
        </Button>
      </div>
    </div>
  );
}
