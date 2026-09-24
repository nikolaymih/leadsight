"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import type { PipelineRun } from "@/lib/types";
import { cn } from "@/lib/utils";

// Pipeline runs for the organization, newest first, PAGE_SIZE per page. Pages are cursor
// pages of one infinite query; Previous/Next move through the pages already loaded and
// fetch the next one on demand. The first page polls every 15 s while visible so a manual
// "Run now" shows up. A row expands to that run's per-source breakdown.

const STEPS = ["polled", "prefiltered", "hydrated", "extracted", "scored", "notified"] as const;
const PAGE_SIZE = 20;

export function RunTable() {
  const [pageIndex, setPageIndex] = useState(0);
  const runs = useInfiniteQuery({
    ...orpc.runs.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ limit: PAGE_SIZE, cursor }),
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
    refetchInterval: pageIndex === 0 ? 15_000 : false,
  });
  const [open, setOpen] = useState<string | null>(null);

  if (runs.isPending) {
    return (
      <div className="flex flex-col gap-1.5">
        {["a", "b", "c"].map((k) => (
          <Skeleton key={k} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (runs.isError) return <EmptyState title="Could not load runs" description={runs.error.message} />;
  const pages = runs.data.pages;
  const current = pages[Math.min(pageIndex, pages.length - 1)]?.items ?? [];
  const hasNext = pageIndex < pages.length - 1 || runs.hasNextPage;

  async function next() {
    if (pageIndex >= pages.length - 1) {
      const result = await runs.fetchNextPage();
      if (result.isError) return;
    }
    setPageIndex((i) => i + 1);
    setOpen(null);
  }

  if (pageIndex === 0 && current.length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        description="The scheduler records a run each time it polls; “Run now” on a source records one too."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-6" />
            <TableHead>Started</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            {STEPS.map((s) => (
              <TableHead key={s} className="text-right capitalize">
                {s}
              </TableHead>
            ))}
            <TableHead>Errors</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {current.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              open={open === run.id}
              onToggle={() => setOpen(open === run.id ? null : run.id)}
            />
          ))}
        </TableBody>
      </Table>
      <nav
        className="flex items-center justify-end gap-2 text-xs text-muted-foreground"
        aria-label="Runs pages"
      >
        <span className="tabular">
          Page {pageIndex + 1}
          {!hasNext ? ` of ${pageIndex + 1}` : ""}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onClick={() => {
            setPageIndex((i) => Math.max(0, i - 1));
            setOpen(null);
          }}
        >
          <ChevronLeft className="size-3.5" />
          Newer
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext || runs.isFetchingNextPage}
          onClick={() => void next()}
        >
          Older
          {runs.isFetchingNextPage ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </Button>
      </nav>
    </div>
  );
}

function RunRow({ run, open, onToggle }: { run: PipelineRun; open: boolean; onToggle: () => void }) {
  const failed = run.errors.length;
  return (
    <Fragment>
      <TableRow className="cursor-pointer" onClick={onToggle} aria-expanded={open}>
        <TableCell className="text-muted-foreground">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </TableCell>
        <TableCell title={formatDateTime(run.startedAt)}>{formatRelative(run.startedAt)}</TableCell>
        <TableCell className="tabular text-right text-muted-foreground">
          {formatDuration(run.durationMs)}
        </TableCell>
        {STEPS.map((s) => (
          <TableCell
            key={s}
            className={cn("tabular text-right", run.counts[s] === 0 && "text-muted-foreground")}
          >
            {run.counts[s]}
          </TableCell>
        ))}
        <TableCell className={cn("text-xs", failed > 0 ? "text-destructive" : "text-muted-foreground")}>
          {failed > 0 ? `${failed} error${failed === 1 ? "" : "s"}` : "—"}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableCell colSpan={3 + STEPS.length + 1} className="h-auto whitespace-normal px-6 py-3">
            <div className="flex flex-col gap-3 text-xs">
              {run.perSource.length > 0 ? (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {run.perSource.map((s) => (
                    <li
                      key={s.sourceId}
                      className="flex flex-col gap-0.5 rounded-[var(--radius)] bg-card px-2 py-1"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate font-medium">{s.name}</span>
                        {s.error ? (
                          <span className="min-w-0 truncate text-destructive" title={s.error}>
                            {s.error}
                          </span>
                        ) : (
                          <span className="tabular shrink-0 text-muted-foreground">
                            {s.posts} new
                            {s.fetched > s.posts ? ` · ${s.fetched - s.posts} already stored` : ""}
                          </span>
                        )}
                      </div>
                      {s.warnings.map((w) => (
                        <p key={w} className="break-words text-muted-foreground">
                          {w}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No sources were due in this run.</p>
              )}
              {run.errors.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-destructive">
                  {run.errors.map((e) => (
                    <li key={e} className="break-words">
                      {e}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}
