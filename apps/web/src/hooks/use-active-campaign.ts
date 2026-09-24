"use client";

import { useQuery } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { orpc } from "@/lib/orpc";

// The campaign selector in the top bar scopes Inbox and Sources. It lives in the URL
// (`?campaign=<id>`) so links and refreshes keep it; when absent, the first campaign wins.

export function useActiveCampaign() {
  const [campaignId, setCampaignId] = useQueryState("campaign", parseAsString);
  const campaigns = useQuery(orpc.campaigns.list.queryOptions());
  const active = campaigns.data?.find((c) => c.id === campaignId) ?? campaigns.data?.[0] ?? null;
  return { campaigns, active, campaignId: active?.id ?? null, setCampaignId };
}
