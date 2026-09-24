"use client";

import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveCampaign } from "@/hooks/use-active-campaign";

export function CampaignSelector() {
  const { campaigns, campaignId, setCampaignId } = useActiveCampaign();
  const list = campaigns.data ?? [];

  if (campaigns.isSuccess && list.length === 0) {
    return (
      <Link href="/campaigns/new" className="text-sm text-accent hover:underline">
        Create your first campaign
      </Link>
    );
  }

  return (
    <Select value={campaignId ?? ""} onValueChange={(v) => void setCampaignId(v)}>
      <SelectTrigger size="sm" className="w-64" aria-label="Campaign">
        <SelectValue placeholder={campaigns.isPending ? "Loading…" : "Campaign"} />
      </SelectTrigger>
      <SelectContent>
        {list.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
            {c.status !== "active" ? <span className="ml-1 text-muted-foreground">({c.status})</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
