"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Separator, Skeleton } from "@/components/ui/misc";
import type { OrgMember } from "@/hooks/use-org-members";
import { toastError } from "@/lib/errors";
import { formatDateTime, formatRelative, PLATFORM_LABEL } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import type { Campaign, LeadDetail, LeadStatus } from "@/lib/types";
import { AssigneeSelect, StatusSelect } from "./lead-controls";
import { PlatformIcon } from "./platform-icon";
import { ScoreBreakdown } from "./score-breakdown";
import { VerdictBadge } from "./verdict-badge";

// Right-side panel for one lead (`?lead=<id>`), keeping the inbox behind it.

export interface LeadPanelProps {
  leadId: string | null;
  campaign: Campaign | null;
  members: OrgMember[];
  onClose: () => void;
  onStatus: (lead: LeadDetail, status: LeadStatus) => void;
  onAssignee: (lead: LeadDetail, userId: string | null) => void;
}

export function LeadPanel({ leadId, campaign, members, onClose, onStatus, onAssignee }: LeadPanelProps) {
  return (
    <Dialog open={leadId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {leadId ? (
        <SheetContent aria-describedby={undefined}>
          <LeadPanelBody
            leadId={leadId}
            campaign={campaign}
            members={members}
            onStatus={onStatus}
            onAssignee={onAssignee}
          />
        </SheetContent>
      ) : null}
    </Dialog>
  );
}

function LeadPanelBody({
  leadId,
  campaign,
  members,
  onStatus,
  onAssignee,
}: Omit<LeadPanelProps, "leadId" | "onClose"> & { leadId: string }) {
  const detail = useQuery(orpc.leads.get.queryOptions({ input: { id: leadId } }));

  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <DialogTitle className="sr-only">Loading lead</DialogTitle>
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <DialogTitle>Could not load this lead</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          {String(detail.error.message)}
        </DialogDescription>
        <DialogClose asChild>
          <Button variant="outline" size="sm" className="self-start">
            Close
          </Button>
        </DialogClose>
      </div>
    );
  }

  const lead = detail.data;
  const { post } = lead;

  return (
    <>
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <VerdictBadge verdict={lead.verdict} />
            <span className="tabular">
              <span className="font-medium">{lead.score}</span>
              <span className="text-muted-foreground"> score · {lead.confidence}% confidence</span>
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <PlatformIcon platform={post.platform} />
              {PLATFORM_LABEL[post.platform] ?? post.platform}
            </span>
          </div>
          <DialogTitle className="truncate text-base font-semibold leading-6">
            {post.title?.trim() || lead.summary}
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {post.authorHandle ? (
              post.authorUrl ? (
                <a
                  href={post.authorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  @{post.authorHandle}
                </a>
              ) : (
                <span>@{post.authorHandle}</span>
              )
            ) : null}
            <span title={post.postedAt ?? undefined}>{formatRelative(post.postedAt)}</span>
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              Open original <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
        <DialogClose asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Close panel">
            <X />
          </Button>
        </DialogClose>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <section className="flex flex-col gap-1.5">
          <SectionTitle>Post</SectionTitle>
          {post.bodyIsSnippet ? (
            <p className="text-xs text-verdict-warm">Snippet only — the full post could not be fetched.</p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm leading-6">
            {post.body || <span className="text-muted-foreground">(empty)</span>}
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <SectionTitle>Summary</SectionTitle>
          <p className="text-sm text-muted-foreground">{lead.summary}</p>
        </section>

        <section className="flex flex-col gap-1.5">
          <SectionTitle>Evidence</SectionTitle>
          {campaign ? (
            <ScoreBreakdown
              criteria={campaign.criteria}
              breakdown={lead.scoreBreakdown}
              evidence={lead.evidence}
            />
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </section>

        <section className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <SectionTitle>Status</SectionTitle>
            <StatusSelect size="default" value={lead.status} onChange={(s) => onStatus(lead, s)} />
          </div>
          <div className="flex flex-col gap-1">
            <SectionTitle>Assignee</SectionTitle>
            <AssigneeSelect
              size="default"
              value={lead.assigneeId}
              members={members}
              onChange={(u) => onAssignee(lead, u)}
            />
          </div>
        </section>

        <Separator />

        <Notes lead={lead} />
      </div>

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
        <span>extractor {lead.extractorProvider}</span>
        <span>prompt {lead.promptVersion}</span>
        <span>rules v{lead.rulesVersion}</span>
        <span>scored {formatDateTime(lead.scoredAt)}</span>
      </footer>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

function Notes({ lead }: { lead: LeadDetail }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const addNote = useMutation(
    orpc.leads.addNote.mutationOptions({
      onSuccess: () => {
        setBody("");
        return qc.invalidateQueries({ queryKey: orpc.leads.get.key({ input: { id: lead.id } }) });
      },
      onError: (err) => toastError(err, "Could not add the note"),
    }),
  );

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0 || addNote.isPending) return;
    addNote.mutate({ id: lead.id, body: trimmed });
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>Notes</SectionTitle>
      {lead.notes.length === 0 ? <p className="text-xs text-muted-foreground">No notes yet.</p> : null}
      <ol className="flex flex-col gap-2">
        {lead.notes.map((n) => (
          <li key={n.id} className="rounded-[var(--radius)] bg-muted px-3 py-2 text-sm">
            <div className="mb-0.5 flex gap-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">{n.userName}</span>
              <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
                {formatRelative(n.createdAt)}
              </time>
            </div>
            <p className="whitespace-pre-wrap">{n.body}</p>
          </li>
        ))}
      </ol>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note… (⌘/Ctrl+Enter to save)"
          aria-label="New note"
          className="min-h-16"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          type="submit"
          size="sm"
          className="self-end"
          disabled={body.trim().length === 0 || addNote.isPending}
        >
          Add note
        </Button>
      </form>
    </section>
  );
}
