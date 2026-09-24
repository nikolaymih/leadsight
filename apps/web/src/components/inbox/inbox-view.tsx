"use client";

import { skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExpandedState, Row, RowSelectionState } from "@tanstack/react-table";
import { Loader2, Play } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Kbd, Skeleton } from "@/components/ui/misc";
import { useActiveCampaign } from "@/hooks/use-active-campaign";
import { useInboxFilters } from "@/hooks/use-inbox-filters";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { useOrgMembers } from "@/hooks/use-org-members";
import { toastError } from "@/lib/errors";
import { hasActiveFilters, toLeadListInput } from "@/lib/inbox-params";
import { orpc } from "@/lib/orpc";
import type { LeadStatus, LeadSummary, Source } from "@/lib/types";
import { createColumns } from "./columns";
import { ExpandedLeadRow } from "./expanded-lead-row";
import { FilterBar } from "./filter-bar";
import { AssigneeSelect, StatusSelect } from "./lead-controls";
import { LeadPanel } from "./lead-panel";
import { LeadTable, rowDomId } from "./lead-table";
import { useLeadMutations } from "./use-lead-mutations";

export function InboxView() {
  const qc = useQueryClient();
  const { campaigns, active: campaign } = useActiveCampaign();
  const [params, setParams] = useInboxFilters();
  const { members } = useOrgMembers();
  const { update, bulkUpdate } = useLeadMutations();

  const listInput = campaign ? toLeadListInput(params, campaign.id) : null;
  const leads = useInfiniteQuery(
    orpc.leads.list.infiniteOptions({
      input: listInput ? (cursor: string | undefined) => ({ ...listInput, cursor }) : skipToken,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  const items = useMemo(() => leads.data?.pages.flatMap((p) => p.items) ?? [], [leads.data]);

  // Row state. Expansion is single unless shift-clicked; selection feeds the bulk bar.
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  // Reset transient state when the list identity changes (state adjusted during render, no effect).
  const listKey = JSON.stringify(listInput);
  const [seenKey, setSeenKey] = useState(listKey);
  if (seenKey !== listKey) {
    setSeenKey(listKey);
    setExpanded({});
    setRowSelection({});
    setActiveId(null);
  }

  const setStatus = useCallback(
    (lead: { id: string }, status: LeadStatus) => update.mutate({ id: lead.id, status }),
    [update],
  );
  const setAssignee = useCallback(
    (lead: { id: string }, assigneeId: string | null) => update.mutate({ id: lead.id, assigneeId }),
    [update],
  );
  const columns = useMemo(
    () => createColumns({ members, onStatus: setStatus, onAssignee: setAssignee }),
    [members, setStatus, setAssignee],
  );

  const toggleExpanded = useCallback((id: string, additive = false) => {
    setExpanded((prev) => {
      const map = prev === true ? {} : prev;
      const isOpen = Boolean(map[id]);
      if (additive) return { ...map, [id]: !isOpen };
      return isOpen ? {} : { [id]: true };
    });
  }, []);

  const onRowClick = useCallback(
    (row: Row<LeadSummary>, event: React.MouseEvent) => {
      setActiveId(row.id);
      toggleExpanded(row.id, event.shiftKey);
    },
    [toggleExpanded],
  );

  // Keyboard: j/k move, e expand, s focus status, o open post, Enter opens the panel.
  const move = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const index = items.findIndex((l) => l.id === activeId);
      const next = items[Math.max(0, Math.min(items.length - 1, index < 0 ? 0 : index + delta))];
      if (!next) return;
      setActiveId(next.id);
      document.getElementById(rowDomId(next.id))?.scrollIntoView({ block: "nearest" });
      if (index >= items.length - 3 && leads.hasNextPage && !leads.isFetchingNextPage)
        void leads.fetchNextPage();
    },
    [items, activeId, leads],
  );
  const active = items.find((l) => l.id === activeId) ?? null;
  const shortcuts = useMemo(
    () => ({
      j: () => move(1),
      k: () => move(-1),
      e: () => active && toggleExpanded(active.id),
      s: () => {
        if (!active) return;
        document
          .getElementById(rowDomId(active.id))
          ?.querySelector<HTMLElement>("[data-status-trigger]")
          ?.focus();
      },
      o: () => active && window.open(active.post.url, "_blank", "noopener,noreferrer"),
      Enter: () => active && void setParams({ lead: active.id }),
    }),
    [move, active, toggleExpanded, setParams],
  );
  useKeyboardNav(shortcuts, params.lead === null);

  // Empty-state "Run now": sources are needed only when there is nothing to show.
  const showEmpty = leads.isSuccess && items.length === 0;
  const sources = useQuery({
    ...orpc.sources.list.queryOptions({ input: campaign ? { campaignId: campaign.id } : skipToken }),
    enabled: showEmpty && campaign !== null,
  });
  const runNow = useMutation({
    mutationFn: async (list: Source[]) => {
      let posts = 0;
      const warnings: string[] = [];
      for (const s of list.filter((s) => s.enabled)) {
        const r = await orpc.sources.run.call({ id: s.id });
        posts += r.posts;
        warnings.push(...r.warnings);
      }
      return { posts, warnings };
    },
    onSuccess: ({ posts, warnings }) => {
      toast.success(
        `Fetched ${posts} new post${posts === 1 ? "" : "s"}${warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}`,
      );
      return Promise.all([
        qc.invalidateQueries({ queryKey: orpc.leads.key() }),
        qc.invalidateQueries({ queryKey: orpc.sources.key() }),
        qc.invalidateQueries({ queryKey: orpc.runs.key() }),
      ]);
    },
    onError: (err) => toastError(err, "Run failed"),
  });

  if (campaigns.isSuccess && campaigns.data.length === 0) {
    return (
      <EmptyState
        title="No campaigns yet"
        description="A campaign describes what you're looking for. Sources and leads hang off it."
        action={
          <Button asChild>
            <Link href="/campaigns/new">Create a campaign</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        params={params}
        onChange={(patch) => void setParams(patch)}
        members={members}
        total={
          leads.isSuccess
            ? `${items.length}${leads.hasNextPage ? "+" : ""} lead${items.length === 1 ? "" : "s"}`
            : ""
        }
      />

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-muted/60 px-3 py-1.5 text-xs">
          <span className="font-medium">{selectedIds.length} selected</span>
          <StatusSelect
            value={null}
            placeholder="Set status…"
            onChange={(status) => bulkUpdate.mutate({ ids: selectedIds, status })}
            disabled={bulkUpdate.isPending}
          />
          <AssigneeSelect
            value={null}
            placeholder="Assign to…"
            members={members}
            onChange={(assigneeId) => bulkUpdate.mutate({ ids: selectedIds, assigneeId })}
            disabled={bulkUpdate.isPending}
          />
          <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>
            Clear selection
          </Button>
        </div>
      ) : null}

      {leads.isPending || !campaign ? (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 8 }, (_, i) => `sk-${i}`).map((k) => (
            <Skeleton key={k} className="h-8 w-full" />
          ))}
        </div>
      ) : leads.isError ? (
        <EmptyState
          title="Could not load leads"
          description={leads.error.message}
          action={
            <Button variant="outline" onClick={() => void leads.refetch()}>
              Retry
            </Button>
          }
        />
      ) : showEmpty ? (
        hasActiveFilters(params) ? (
          <EmptyState
            title="No leads match these filters"
            action={
              <Button
                variant="outline"
                onClick={() =>
                  void setParams({ verdict: [], status: [], platform: [], assignee: null, minScore: null })
                }
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No leads yet"
            description={describeNextRun(sources.data)}
            action={
              sources.data && sources.data.length > 0 ? (
                <Button onClick={() => runNow.mutate(sources.data)} disabled={runNow.isPending}>
                  {runNow.isPending ? <Loader2 className="animate-spin" /> : <Play />}
                  Run now
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link href={`/sources?campaign=${campaign.id}`}>Add a source</Link>
                </Button>
              )
            }
          />
        )
      ) : (
        <>
          <LeadTable
            data={items}
            columns={columns}
            expanded={expanded}
            onExpandedChange={setExpanded}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            activeId={activeId}
            onRowClick={onRowClick}
            renderExpanded={(row) => (
              <ExpandedLeadRow
                leadId={row.id}
                campaign={campaign}
                onOpenDetails={() => void setParams({ lead: row.id })}
              />
            )}
          />
          <div className="flex items-center justify-between py-1">
            <p className="hidden items-center gap-2 text-[11px] text-muted-foreground md:flex">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd> move · <Kbd>e</Kbd> expand · <Kbd>s</Kbd> status · <Kbd>o</Kbd> open post ·{" "}
              <Kbd>↵</Kbd> details
            </p>
            {leads.hasNextPage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void leads.fetchNextPage()}
                disabled={leads.isFetchingNextPage}
              >
                {leads.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null}
                Load more
              </Button>
            ) : null}
          </div>
        </>
      )}

      <LeadPanel
        leadId={params.lead}
        campaign={campaign}
        members={members}
        onClose={() => void setParams({ lead: null })}
        onStatus={setStatus}
        onAssignee={setAssignee}
      />
    </div>
  );
}

/** "Sources run hourly; next run in 23 min" from the enabled sources' schedules. */
export function describeNextRun(sources: Source[] | undefined, now = Date.now()): string {
  const enabled = (sources ?? []).filter((s) => s.enabled);
  if (enabled.length === 0) return "Add a source to this campaign to start collecting posts.";
  const interval = Math.min(...enabled.map((s) => s.pollIntervalMin));
  const cadence =
    interval === 60
      ? "hourly"
      : interval % 60 === 0
        ? `every ${interval / 60} hours`
        : `every ${interval} min`;
  const nextAt = Math.min(
    ...enabled.map((s) => (s.lastRunAt ? new Date(s.lastRunAt).getTime() + s.pollIntervalMin * 60_000 : now)),
  );
  const minutes = Math.max(0, Math.round((nextAt - now) / 60_000));
  return `Sources run ${cadence}; next run ${minutes === 0 ? "is due now" : `in ${minutes} min`}.`;
}
