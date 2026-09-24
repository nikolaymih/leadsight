import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { SearchParams } from "nuqs/server";
import { InboxView } from "@/components/inbox/inbox-view";
import { loadInboxParams, toLeadListInput } from "@/lib/inbox-params";
import { serverOrpc } from "@/lib/orpc-server";
import { makeQueryClient } from "@/lib/query-client";

export const metadata = { title: "Inbox" };

// Prefetches the campaign list and the first page of leads with the request's cookie so the
// client renders without a loading flash. Any failure here (API down, expired session) is
// left to the client, which shows its own error state.
export default async function InboxPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await loadInboxParams(searchParams);
  const qc = makeQueryClient();

  try {
    const { orpc } = await serverOrpc();
    const campaigns = await qc.fetchQuery(orpc.campaigns.list.queryOptions());
    const campaign = campaigns.find((c) => c.id === params.campaign) ?? campaigns[0];
    if (campaign) {
      const listInput = toLeadListInput(params, campaign.id);
      await qc.prefetchInfiniteQuery(
        orpc.leads.list.infiniteOptions({
          input: (cursor: string | undefined) => ({ ...listInput, cursor }),
          initialPageParam: undefined as string | undefined,
          getNextPageParam: (last) => last.nextCursor ?? undefined,
        }),
      );
    }
  } catch (err) {
    console.error("inbox prefetch failed", err);
  }

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <InboxView />
    </HydrationBoundary>
  );
}
