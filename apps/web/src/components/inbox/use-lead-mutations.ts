"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/errors";
import { type LeadPatch, patchLeadDetail, patchLeadsInList } from "@/lib/lead-cache";
import { orpc } from "@/lib/orpc";

// Status and assignee changes are optimistic: patch every cached list/detail, roll back on error,
// then invalidate so the server's ordering wins. Anything score-related is never optimistic.

export function useLeadMutations() {
  const qc = useQueryClient();

  async function snapshot(ids: readonly string[], patch: LeadPatch) {
    await qc.cancelQueries({ queryKey: orpc.leads.key() });
    const prev = qc.getQueriesData({ queryKey: orpc.leads.key() });
    qc.setQueriesData({ queryKey: orpc.leads.list.key() }, patchLeadsInList(ids, patch));
    for (const id of ids) {
      qc.setQueriesData({ queryKey: orpc.leads.get.key({ input: { id } }) }, patchLeadDetail(patch));
    }
    return { prev };
  }

  function rollback(ctx: { prev: [readonly unknown[], unknown][] } | undefined) {
    for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
  }

  const update = useMutation(
    orpc.leads.update.mutationOptions({
      onMutate: (input) => snapshot([input.id], pick(input)),
      onError: (err, _input, ctx) => {
        rollback(ctx);
        toastError(err, "Could not update the lead");
      },
      onSettled: () => qc.invalidateQueries({ queryKey: orpc.leads.key() }),
    }),
  );

  const bulkUpdate = useMutation(
    orpc.leads.bulkUpdate.mutationOptions({
      onMutate: (input) => snapshot(input.ids, pick(input)),
      onError: (err, _input, ctx) => {
        rollback(ctx);
        toastError(err, "Could not update the leads");
      },
      onSuccess: (result) =>
        toast.success(`Updated ${result.updated} lead${result.updated === 1 ? "" : "s"}`),
      onSettled: () => qc.invalidateQueries({ queryKey: orpc.leads.key() }),
    }),
  );

  return { update, bulkUpdate };
}

function pick(input: { status?: LeadPatch["status"]; assigneeId?: LeadPatch["assigneeId"] }): LeadPatch {
  const patch: LeadPatch = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
  return patch;
}
