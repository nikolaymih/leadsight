"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/misc";
import type { OrgMember } from "@/hooks/use-org-members";
import { formatRelative } from "@/lib/format";
import type { LeadStatus, LeadSummary } from "@/lib/types";
import { AssigneeSelect, StatusSelect } from "./lead-controls";
import { PlatformIcon } from "./platform-icon";
import { VerdictBadge } from "./verdict-badge";

export interface ColumnHandlers {
  members: OrgMember[];
  onStatus: (lead: LeadSummary, status: LeadStatus) => void;
  onAssignee: (lead: LeadSummary, userId: string | null) => void;
}

/** Stops row click/expand when interacting with a control inside the row. */
const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation() };

export function createColumns({ members, onStatus, onAssignee }: ColumnHandlers): ColumnDef<LeadSummary>[] {
  return [
    {
      id: "select",
      size: 28,
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all loaded leads"
          checked={
            table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false
          }
          onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)}
        />
      ),
      cell: ({ row }) => (
        <div {...stop}>
          <Checkbox
            aria-label="Select lead"
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(v === true)}
          />
        </div>
      ),
    },
    {
      id: "verdict",
      accessorKey: "verdict",
      header: "Verdict",
      size: 96,
      cell: ({ row }) => <VerdictBadge verdict={row.original.verdict} />,
    },
    {
      id: "score",
      accessorKey: "score",
      header: () => <span className="block text-right">Score</span>,
      size: 64,
      cell: ({ row }) => (
        <div className="tabular text-right">
          <span className="font-medium">{row.original.score}</span>
          <span className="ml-1 text-[11px] text-muted-foreground">{row.original.confidence}%</span>
        </div>
      ),
    },
    {
      id: "platform",
      accessorFn: (l) => l.post.platform,
      header: "",
      size: 28,
      cell: ({ row }) => <PlatformIcon platform={row.original.post.platform} />,
    },
    {
      id: "post",
      accessorFn: (l) => l.post.title ?? l.summary,
      header: "Post",
      cell: ({ row }) => {
        const { post, summary } = row.original;
        const title = post.title?.trim() || summary.split(/(?<=[.!?])\s/)[0] || "(untitled)";
        return (
          <div className="min-w-0 max-w-[36rem]">
            <div className="truncate font-medium text-foreground">{title}</div>
            <div className="truncate text-xs text-muted-foreground">{summary}</div>
          </div>
        );
      },
    },
    {
      id: "author",
      accessorFn: (l) => l.post.authorHandle,
      header: "Author",
      size: 120,
      cell: ({ row }) => (
        <span className="block max-w-28 truncate text-muted-foreground">
          {row.original.post.authorHandle ? `@${row.original.post.authorHandle}` : "—"}
        </span>
      ),
    },
    {
      id: "posted",
      accessorFn: (l) => l.post.postedAt,
      header: "Posted",
      size: 96,
      cell: ({ row }) => (
        <span className="text-muted-foreground" title={row.original.post.postedAt ?? undefined}>
          {formatRelative(row.original.post.postedAt)}
        </span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      size: 136,
      cell: ({ row }) => (
        <div {...stop}>
          <StatusSelect value={row.original.status} onChange={(s) => onStatus(row.original, s)} />
        </div>
      ),
    },
    {
      id: "assignee",
      accessorKey: "assigneeId",
      header: "Assignee",
      size: 152,
      cell: ({ row }) => (
        <div {...stop}>
          <AssigneeSelect
            value={row.original.assigneeId}
            members={members}
            onChange={(u) => onAssignee(row.original, u)}
          />
        </div>
      ),
    },
    {
      id: "open",
      size: 32,
      header: "",
      cell: ({ row }) => (
        <div {...stop}>
          <Button asChild variant="ghost" size="icon-sm" aria-label="Open original post">
            <a href={row.original.post.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
            </a>
          </Button>
        </div>
      ),
    },
  ];
}
