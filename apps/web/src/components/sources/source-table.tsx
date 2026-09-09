"use client";

import { activeHoursSchema } from "@leadsight/contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";
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

type ActiveHours = z.infer<typeof activeHoursSchema>;

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

      <ScheduleDialog
        source={editing}
        onClose={() => setEditing(null)}
        pending={update.isPending}
        onSave={(patch) =>
          editing && update.mutate({ id: editing.id, ...patch }, { onSuccess: () => setEditing(null) })
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

type SchedulePatch = { pollIntervalMin: number; activeHours: ActiveHours | null };

/** Poll interval plus the optional active-hours window (overnight slowdown). */
function ScheduleDialog({
  source,
  onClose,
  onSave,
  pending,
}: {
  source: Source | null;
  onClose: () => void;
  onSave: (patch: SchedulePatch) => void;
  pending: boolean;
}) {
  const [minutes, setMinutes] = useState("");
  const [useHours, setUseHours] = useState(false);
  const [tz, setTz] = useState("");
  const [from, setFrom] = useState("8");
  const [to, setTo] = useState("23");
  const [offInterval, setOffInterval] = useState("180");

  const pollIntervalMin = Number.parseInt(minutes, 10);
  const hours: ActiveHours = {
    tz: tz.trim(),
    from: Number.parseInt(from, 10),
    to: Number.parseInt(to, 10),
    offInterval: Number.parseInt(offInterval, 10),
  };
  const intervalValid = Number.isInteger(pollIntervalMin) && pollIntervalMin >= 5;
  const hoursResult = useHours ? activeHoursSchema.safeParse(hours) : null;
  const valid = intervalValid && (hoursResult === null || hoursResult.success);

  function load() {
    setMinutes(String(source?.pollIntervalMin ?? 60));
    const ah = source?.activeHours ?? null;
    setUseHours(ah !== null);
    setTz(ah?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
    setFrom(String(ah?.from ?? 8));
    setTo(String(ah?.to ?? 23));
    setOffInterval(String(ah?.offInterval ?? 180));
  }

  return (
    <Dialog
      open={source !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent onOpenAutoFocus={load}>
        <DialogTitle className="text-base font-semibold">Schedule</DialogTitle>
        <DialogDescription className="mb-3 text-xs text-muted-foreground">
          {source ? describeSourceConfig(source) : ""} — how often the scheduler polls this source.
        </DialogDescription>
        <div className="flex flex-col gap-3">
          <Field
            label="Poll every (minutes)"
            htmlFor="interval"
            error={minutes !== "" && !intervalValid ? "At least 5 minutes" : undefined}
          >
            <Input
              id="interval"
              type="number"
              min={5}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-32"
            />
          </Field>
          <div className="flex items-center gap-2 text-sm">
            <Switch
              checked={useHours}
              onCheckedChange={setUseHours}
              aria-label="Slow down outside active hours"
            />
            <span>Slow down outside active hours</span>
          </div>
          {useHours ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_80px_80px_110px]">
              <Field label="Time zone" htmlFor="tz" hint="IANA name">
                <Input
                  id="tz"
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  placeholder="Europe/Sofia"
                />
              </Field>
              <Field label="From" htmlFor="from">
                <Input
                  id="from"
                  type="number"
                  min={0}
                  max={23}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="To" htmlFor="to">
                <Input
                  id="to"
                  type="number"
                  min={0}
                  max={24}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
              <Field label="Off-hours (min)" htmlFor="offInterval">
                <Input
                  id="offInterval"
                  type="number"
                  min={5}
                  value={offInterval}
                  onChange={(e) => setOffInterval(e.target.value)}
                />
              </Field>
              {hoursResult && !hoursResult.success ? (
                <p className="text-xs text-destructive sm:col-span-4">
                  {hoursResult.error.issues
                    .map((i) => `${i.path.join(".") || "hours"}: ${i.message}`)
                    .join("; ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onSave({
                pollIntervalMin,
                activeHours: useHours && hoursResult?.success ? hoursResult.data : null,
              })
            }
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
