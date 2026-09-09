"use client";

import { criteriaSchema, thresholdsSchema } from "@leadsight/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Controller, type FieldErrors, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { VerdictBadge } from "@/components/inbox/verdict-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Skeleton, Switch } from "@/components/ui/misc";
import { canManage, useOrgRole } from "@/hooks/use-org-members";
import { toastError } from "@/lib/errors";
import { orpc } from "@/lib/orpc";
import { type Campaign, VERDICTS } from "@/lib/types";
import { CampaignForm, useCampaignForm } from "./campaign-form";
import type { CampaignFormValues } from "./schema";
import { TagInput } from "./tag-input";

/** Zod reports a bad address at `notifications.digestRecipients.<index>`; surface the first one. */
function digestError(errors: FieldErrors<CampaignFormValues>): string | undefined {
  const list = errors.notifications?.digestRecipients;
  if (!list) return undefined;
  if (!Array.isArray(list)) return list.message;
  const first = list.find((item) => item?.message);
  return first?.message ? `Invalid address: ${first.message}` : undefined;
}

// Same form as the draft pane, for a saved campaign. Adds rules version, rescoring preview,
// tuning fields, pause/archive and the alert threshold.

export function CampaignSettings({ id }: { id: string }) {
  const campaign = useQuery(orpc.campaigns.get.queryOptions({ input: { id } }));

  if (campaign.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (campaign.isError) {
    return (
      <EmptyState
        title="Could not load this campaign"
        description={campaign.error.message}
        action={
          <Button variant="outline" onClick={() => void campaign.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  return <SettingsForm campaign={campaign.data} />;
}

function toFormValues(c: Campaign): CampaignFormValues {
  return {
    name: c.name,
    offerDescription: c.offerDescription,
    icp: c.icp,
    disqualifiers: c.disqualifiers,
    keywords: c.keywords,
    criteria: c.criteria,
    thresholds: c.thresholds,
    minConfidence: c.minConfidence,
    minScoreAlert: c.minScoreAlert,
    fewshotLimit: c.fewshotLimit,
    notifications: c.notifications,
  };
}

function SettingsForm({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const qc = useQueryClient();
  const role = useOrgRole();
  const readOnly = role !== null && !canManage(role);

  const defaults = useMemo(() => toFormValues(campaign), [campaign]);
  const form = useCampaignForm(defaults);
  const [preview, setPreview] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function invalidateAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: orpc.campaigns.key() }),
      qc.invalidateQueries({ queryKey: orpc.leads.key() }),
    ]);
  }

  const update = useMutation(
    orpc.campaigns.update.mutationOptions({
      onSuccess: async (updated) => {
        await invalidateAll();
        toast.success(
          updated.rulesVersion !== campaign.rulesVersion
            ? `Saved. Rules are now v${updated.rulesVersion}; leads keep their scores until you rescore.`
            : "Saved",
        );
      },
      onError: (err) => toastError(err, "Could not save the campaign"),
    }),
  );
  const rescore = useMutation(
    orpc.campaigns.rescore.mutationOptions({
      onSuccess: async (result) => {
        await invalidateAll();
        const moved = Object.values(result.moved).reduce((s, n) => s + (n ?? 0), 0);
        toast.success(`Rescored ${result.rescored} leads; ${moved} changed verdict`);
      },
      onError: (err) => toastError(err, "Rescore failed"),
    }),
  );

  function submit(values: CampaignFormValues) {
    update.mutate({ id: campaign.id, ...values });
  }

  function setStatus(status: Campaign["status"]) {
    update.mutate(
      { id: campaign.id, status },
      {
        onSuccess: () => {
          if (status === "archived") router.push("/campaigns");
        },
      },
    );
  }

  const busy = update.isPending || rescore.isPending;
  const e = form.formState.errors;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold">{campaign.name}</h1>
          <p className="text-xs text-muted-foreground">
            <span className="capitalize">{campaign.status}</span> · rules v{campaign.rulesVersion} · criteria
            edits bump the version on save
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === "active" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={readOnly || busy}
              onClick={() => setStatus("paused")}
            >
              Pause
            </Button>
          ) : campaign.status === "paused" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={readOnly || busy}
              onClick={() => setStatus("active")}
            >
              Resume
            </Button>
          ) : null}
          {campaign.status !== "archived" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={readOnly || busy}
              onClick={() => setConfirmArchive(true)}
            >
              Archive
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={readOnly || busy}
              onClick={() => setStatus("active")}
            >
              Unarchive
            </Button>
          )}
        </div>
      </div>
      {readOnly ? <p className="text-xs text-muted-foreground">Only admins can edit campaigns.</p> : null}

      <CampaignForm
        id="campaign-settings"
        form={form}
        onSubmit={submit}
        disabled={readOnly || busy}
        footer={
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Field
                label="Min confidence"
                htmlFor="minConfidence"
                hint="Below this a lead is “insufficient”"
                error={e.minConfidence?.message}
              >
                <Input
                  id="minConfidence"
                  type="number"
                  min={0}
                  max={100}
                  disabled={readOnly || busy}
                  {...form.register("minConfidence", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="Min score to alert"
                htmlFor="minScoreAlert"
                hint="Notifications fire at or above this"
                error={e.minScoreAlert?.message}
              >
                <Input
                  id="minScoreAlert"
                  type="number"
                  min={0}
                  max={100}
                  disabled={readOnly || busy}
                  {...form.register("minScoreAlert", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="Few-shot examples"
                htmlFor="fewshotLimit"
                hint="Labelled leads shown to the extractor"
                error={e.fewshotLimit?.message}
              >
                <Input
                  id="fewshotLimit"
                  type="number"
                  min={0}
                  max={50}
                  disabled={readOnly || busy}
                  {...form.register("fewshotLimit", { valueAsNumber: true })}
                />
              </Field>
            </div>
            <Controller
              control={form.control}
              name="notifications.digestRecipients"
              render={({ field }) => (
                <Field
                  label="Email digest recipients"
                  htmlFor="digestRecipients"
                  hint="At most one email per day per campaign, listing new leads at or above the alert score. Leave empty to send nothing. Delivery status is under Settings → Integrations."
                  error={digestError(e)}
                >
                  <TagInput
                    id="digestRecipients"
                    value={field.value ?? []}
                    onChange={field.onChange}
                    disabled={readOnly || busy}
                    placeholder="name@company.com, Enter to add"
                  />
                </Field>
              )}
            />

            <RescorePreview campaign={campaign} form={form} enabled={preview} onToggle={setPreview} />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={readOnly || busy}
                onClick={() => rescore.mutate({ id: campaign.id })}
                title="Re-run the rules over stored evidence. No LLM call."
              >
                {rescore.isPending ? <Loader2 className="animate-spin" /> : null}
                Rescore leads now
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!form.formState.isDirty || busy}
                  onClick={() => form.reset(defaults)}
                >
                  Discard
                </Button>
                <Button type="submit" disabled={readOnly || busy || !form.formState.isDirty}>
                  {update.isPending ? <Loader2 className="animate-spin" /> : null}
                  Save
                </Button>
              </div>
            </div>
          </>
        }
      />

      <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <DialogContent>
          <DialogTitle className="text-base font-semibold">Archive “{campaign.name}”?</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Its sources stop polling and it leaves the campaign selector. Leads stay and the campaign can be
            unarchived.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmArchive(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmArchive(false);
                setStatus("archived");
              }}
            >
              Archive
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** How current leads would move between verdicts under the edited criteria (stored evidence only). */
function RescorePreview({
  campaign,
  form,
  enabled,
  onToggle,
}: {
  campaign: Campaign;
  form: ReturnType<typeof useCampaignForm>;
  enabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const criteria = useWatch({ control: form.control, name: "criteria" });
  const thresholds = useWatch({ control: form.control, name: "thresholds" });
  const minConfidence = useWatch({ control: form.control, name: "minConfidence" });

  // Debounce edits and only ask when the edited rules are valid.
  const candidate = useMemo(() => {
    const c = criteriaSchema.safeParse(criteria);
    const t = thresholdsSchema.safeParse(thresholds);
    if (!c.success || !t.success) return null;
    return {
      id: campaign.id,
      criteria: c.data,
      thresholds: t.data,
      minConfidence: minConfidence ?? campaign.minConfidence,
    };
  }, [criteria, thresholds, minConfidence, campaign.id, campaign.minConfidence]);
  const [debounced, setDebounced] = useState(candidate);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(candidate), 400);
    return () => clearTimeout(t);
  }, [candidate]);

  const preview = useQuery({
    ...orpc.campaigns.previewRescore.queryOptions({
      input: debounced ?? {
        id: campaign.id,
        criteria: campaign.criteria,
        thresholds: campaign.thresholds,
        minConfidence: campaign.minConfidence,
      },
    }),
    enabled: enabled && debounced !== null,
    staleTime: 0,
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Preview rescoring</h3>
          <p className="text-xs text-muted-foreground">
            Verdict counts under the rules as edited, computed from stored evidence. Nothing is saved.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label="Preview rescoring" />
      </div>
      {enabled ? (
        debounced === null ? (
          <p className="text-xs text-destructive">Fix the criteria and thresholds to preview.</p>
        ) : preview.isPending ? (
          <Skeleton className="h-6 w-2/3" />
        ) : preview.isError ? (
          <p className="text-xs text-destructive">{preview.error.message}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">{preview.data.total} leads →</span>
            {VERDICTS.map((v) => (
              <span key={v} className="flex items-center gap-1">
                <VerdictBadge verdict={v} />
                <span className="tabular font-medium">{preview.data.byVerdict[v] ?? 0}</span>
              </span>
            ))}
            {preview.isFetching ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
          </div>
        )
      ) : null}
    </div>
  );
}
