"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { canManage, useOrgRole } from "@/hooks/use-org-members";
import { toastError } from "@/lib/errors";
import { orpc } from "@/lib/orpc";
import { CampaignForm, useCampaignForm } from "./campaign-form";
import { DraftChat } from "./draft-chat";
import { type CampaignFormValues, EMPTY_FORM } from "./schema";
import {
  emptySelection,
  type SourceSelection,
  SourceSuggestions,
  selectionFromDraft,
  sourcesToCreate,
} from "./source-suggestions";

// Two panes: chat on the left, the draft on the right updating as the chat progresses.
// The form stays editable throughout; "Create campaign" submits form + selected sources.

export function NewCampaign() {
  const router = useRouter();
  const qc = useQueryClient();
  const role = useOrgRole();
  const readOnly = role !== null && !canManage(role);

  const [defaults, setDefaults] = useState<CampaignFormValues>(EMPTY_FORM);
  const [sources, setSources] = useState<SourceSelection>(emptySelection);
  const form = useCampaignForm(defaults);

  const onDraft = useCallback(
    (draft: Parameters<typeof selectionFromDraft>[0] & CampaignFormValues, mode: "replace" | "criteria") => {
      if (mode === "criteria") {
        form.setValue("criteria", draft.criteria, { shouldDirty: true, shouldValidate: true });
        form.setValue("thresholds", draft.thresholds, { shouldDirty: true });
        return;
      }
      const { suggestedSources: _s, alertQueries: _a, ...fields } = draft;
      setDefaults(fields);
      setSources(selectionFromDraft(draft));
    },
    [form],
  );

  const create = useMutation(
    orpc.campaigns.create.mutationOptions({
      onSuccess: async (campaign) => {
        await qc.invalidateQueries({ queryKey: orpc.campaigns.key() });
        toast.success(`Campaign “${campaign.name}” created`);
        router.push(`/inbox?campaign=${campaign.id}`);
      },
      onError: (err) => toastError(err, "Could not create the campaign"),
    }),
  );

  function submit(values: CampaignFormValues) {
    // Tuning and notification fields are edited on the saved campaign; create takes the draft shape.
    const { minConfidence: _c, minScoreAlert: _m, fewshotLimit: _f, notifications: _n, ...draft } = values;
    create.mutate({ ...draft, suggestedSources: sourcesToCreate(sources) });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
      <DraftChat onDraft={onDraft} className="lg:sticky lg:top-16 lg:h-[calc(100vh-6rem)]" />
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold">New campaign</h1>
          {readOnly ? (
            <span className="text-xs text-muted-foreground">Only admins can create campaigns</span>
          ) : null}
        </div>
        <CampaignForm
          id="new-campaign"
          form={form}
          onSubmit={submit}
          disabled={readOnly || create.isPending}
          footer={
            <>
              <SourceSuggestions
                value={sources}
                onChange={setSources}
                disabled={readOnly || create.isPending}
              />
              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <Button type="submit" disabled={readOnly || create.isPending}>
                  {create.isPending ? <Loader2 className="animate-spin" /> : null}
                  Create campaign
                </Button>
              </div>
            </>
          }
        />
      </div>
    </div>
  );
}
