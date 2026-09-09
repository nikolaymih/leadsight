"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toastError } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import { describeSourceConfig, SOURCE_KIND_LABEL } from "@/lib/sources";
import type { Source } from "@/lib/types";
import { cn } from "@/lib/utils";

// Sources of the current campaign. Small list, so the table is plain markup (no TanStack
// Table needed). Errors are truncated and expand on click.

export function SourceTable({ sources, canManage }: { sources: Source[]; canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Source | null>(null);
  const [removing, setRemoving] = useState<Source | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  function invalidateSources() {
    return qc.invalidateQueries({ queryKey: orpc.sources.key() });
  }

  const update = useMutation(
    orpc.sources.update.mutationOptions({
      onSuccess: invalidateSources,
      onError: (err) => toastError(err, "Could not update the source"),
    }),
  );
  const remove = useMutation(
    orpc.sources.remove.mutationOptions({
      onSuccess: async () => {
        await invalidateSources();
        toast.success("Source deleted");
      },
      onError: (err) => toastError(err, "Could not delete the source"),
    }),
  );
  const run = useMutation(
    orpc.sources.run.mutationOptions({
      onMutate: ({ id }) => setRunningId(id),
      onSuccess: async ({ posts, warnings }) => {
        await Promise.all([
          invalidateSources(),
          qc.invalidateQueries({ queryKey: orpc.runs.key() }),
          qc.invalidateQueries({ queryKey: orpc.leads.key() }),
        ]);
        toast.success(`Fetched ${posts} new post${posts === 1 ? "" : "s"}`);
        for (const w of warnings) toast.warning(w);
      },
      onError: async (err) => {
        await invalidateSources();
        toastError(err, "Run failed");
      },
      onSettled: () => setRunningId(null),
    }),
  );

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Kind</TableHead>
            <TableHead>Config</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead>Last error</TableHead>
            <TableHead className="text-right">Posts 24h</TableHead>
            <TableHead className="text-right">Every</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((s) => (
            <TableRow key={s.id} className={cn(!s.enabled && "text-muted-foreground")}>
              <TableCell className="text-xs">{SOURCE_KIND_LABEL[s.kind]}</TableCell>
              <TableCell className="max-w-xs truncate font-medium" title={describeSourceConfig(s)}>
                {describeSourceConfig(s)}
              </TableCell>
              <TableCell>
                <Switch
                  checked={s.enabled}
                  disabled={!canManage || update.isPending}
                  aria-label={`Enable ${describeSourceConfig(s)}`}
                  onCheckedChange={(enabled) => update.mutate({ id: s.id, enabled })}
                />
              </TableCell>
              <TableCell className="text-muted-foreground" title={s.lastRunAt ?? undefined}>
                {formatRelative(s.lastRunAt)}
              </TableCell>
              <TableCell className="max-w-56">
                <ErrorCell error={s.lastError} />
              </TableCell>
              <TableCell className="tabular text-right">{s.postsLast24h}</TableCell>
              <TableCell className="tabular text-right text-muted-foreground">
                {s.pollIntervalMin} min
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Run now"
                    title="Run now"
                    disabled={!canManage || run.isPending}
                    onClick={() => run.mutate({ id: s.id })}
                  >
                    {runningId === s.id ? <Loader2 className="animate-spin" /> : <Play />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit interval"
                    title="Edit interval"
                    disabled={!canManage}
                    onClick={() => setEditing(s)}
                  >
                    <Timer />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete source"
                    title="Delete"
                    disabled={!canManage}
                    onClick={() => setRemoving(s)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <IntervalDialog
        source={editing}
        onClose={() => setEditing(null)}
        pending={update.isPending}
        onSave={(pollIntervalMin) =>
          editing && update.mutate({ id: editing.id, pollIntervalMin }, { onSuccess: () => setEditing(null) })
        }
      />

      <Dialog open={removing !== null} onOpenChange={(open) => (open ? undefined : setRemoving(null))}>
        <DialogContent>
          <DialogTitle className="text-base font-semibold">Delete this source?</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {removing ? describeSourceConfig(removing) : ""} stops polling. Posts and leads already collected
            stay.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                removing && remove.mutate({ id: removing.id }, { onSuccess: () => setRemoving(null) })
              }
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ErrorCell({ error }: { error: string | null }) {
  const [open, setOpen] = useState(false);
  if (!error) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      className={cn(
        "text-left text-xs text-destructive",
        open ? "whitespace-pre-wrap break-words" : "block max-w-56 truncate",
      )}
      title={open ? undefined : error}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
    >
      {error}
    </button>
  );
}

function IntervalDialog({
  source,
  onClose,
  onSave,
  pending,
}: {
  source: Source | null;
  onClose: () => void;
  onSave: (minutes: number) => void;
  pending: boolean;
}) {
  const [value, setValue] = useState<string>("");
  const minutes = Number.parseInt(value, 10);
  const valid = Number.isInteger(minutes) && minutes >= 5;
  return (
    <Dialog
      open={source !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent onOpenAutoFocus={() => setValue(String(source?.pollIntervalMin ?? 60))}>
        <DialogTitle className="text-base font-semibold">Poll interval</DialogTitle>
        <DialogDescription className="mb-3 text-xs text-muted-foreground">
          {source ? describeSourceConfig(source) : ""} — how often the scheduler polls this source.
        </DialogDescription>
        <Field
          label="Minutes"
          htmlFor="interval"
          error={value !== "" && !valid ? "At least 5 minutes" : undefined}
        >
          <Input
            id="interval"
            type="number"
            min={5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-32"
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || pending} onClick={() => onSave(minutes)}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
