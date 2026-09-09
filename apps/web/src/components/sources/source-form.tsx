"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sourceConfigSchema } from "@leadsight/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { TagInput } from "@/components/campaigns/tag-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toastError } from "@/lib/errors";
import { PLATFORM_LABEL } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import { SOURCE_KIND_LABEL, selectableKinds } from "@/lib/sources";
import { PLATFORMS } from "@/lib/types";

// "Add source" dialog. The form is flat (one field set for all kinds); on submit the
// kind-specific config is assembled and validated with the contract's sourceConfigSchema,
// so the API accepts anything that passes here. Google search is the primary kind; the
// Reddit API kinds only appear when the API reports them enabled.

const KINDS = ["google_search", "rss", "reddit_subreddit", "reddit_search"] as const;
const LOOKBACKS = ["d1", "d3", "d7"] as const;

const formSchema = z.object({
  kind: z.enum(KINDS),
  platform: z.enum(PLATFORMS),
  phrases: z.array(z.string()),
  siteScope: z.string().trim().optional(),
  lookback: z.enum(LOOKBACKS),
  subreddit: z.string().trim().optional(),
  listing: z.enum(["new", "hot"]),
  query: z.string().trim().optional(),
  sort: z.enum(["new", "relevance"]),
  url: z.string().trim().optional(),
  pollIntervalMin: z.number().int().min(5, "At least 5 minutes"),
});
type FormValues = z.infer<typeof formSchema>;

const DEFAULTS: FormValues = {
  kind: "google_search",
  platform: "reddit",
  phrases: [],
  siteScope: "",
  lookback: "d1",
  subreddit: "",
  listing: "new",
  query: "",
  sort: "new",
  url: "",
  pollIntervalMin: 60,
};

function toConfig(v: FormValues): z.infer<typeof sourceConfigSchema> | { error: string } {
  const raw =
    v.kind === "google_search"
      ? {
          kind: v.kind,
          config: {
            platform: v.platform,
            phrases: v.phrases,
            ...(v.siteScope ? { siteScope: v.siteScope } : {}),
            lookback: v.lookback,
          },
        }
      : v.kind === "reddit_subreddit"
        ? {
            kind: v.kind,
            config: { subreddit: (v.subreddit ?? "").replace(/^r\//i, ""), listing: v.listing },
          }
        : v.kind === "reddit_search"
          ? {
              kind: v.kind,
              config: {
                query: v.query,
                subreddit: v.subreddit ? v.subreddit.replace(/^r\//i, "") : null,
                sort: v.sort,
              },
            }
          : { kind: v.kind, config: { url: v.url, platform: v.platform } };
  const parsed = sourceConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.slice(1).join(".")}: ${i.message}`).join("; ") };
  }
  return parsed.data;
}

export function AddSourceDialog({
  campaignId,
  open,
  onOpenChange,
}: {
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [configError, setConfigError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: DEFAULTS });
  const kind = form.watch("kind");
  const searchBudget = useQuery({ ...orpc.integrations.searchBudget.queryOptions(), enabled: open });
  const kinds = selectableKinds(searchBudget.data?.enabledSourceKinds ?? ["google_search"]);
  const searchDisabled = searchBudget.data ? !searchBudget.data.configured : false;

  const create = useMutation(
    orpc.sources.create.mutationOptions({
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: orpc.sources.key() });
        toast.success("Source added");
        form.reset(DEFAULTS);
        onOpenChange(false);
      },
      onError: (err) => toastError(err, "Could not add the source"),
    }),
  );

  const submit = form.handleSubmit((values) => {
    setConfigError(null);
    const config = toConfig(values);
    if ("error" in config) return setConfigError(config.error);
    create.mutate({ campaignId, pollIntervalMin: values.pollIntervalMin, ...config });
  });

  const platformSelect = (id: string, hint?: string) => (
    <Field label="Platform" htmlFor={id} hint={hint}>
      <Select
        value={form.watch("platform")}
        onValueChange={(v) => form.setValue("platform", v as FormValues["platform"])}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PLATFORMS.map((p) => (
            <SelectItem key={p} value={p}>
              {PLATFORM_LABEL[p] ?? p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-base font-semibold">Add source</DialogTitle>
        <DialogDescription className="mb-4 text-xs text-muted-foreground">
          Sources are polled on their interval; new posts are pre-filtered by the campaign's keywords before
          extraction.
        </DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Kind" htmlFor="kind">
            <Select value={kind} onValueChange={(v) => form.setValue("kind", v as FormValues["kind"])}>
              <SelectTrigger id="kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {SOURCE_KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {kind === "google_search" ? (
            <>
              {searchDisabled ? (
                <p className="text-xs text-destructive">
                  Google Programmable Search is not configured on the API (GOOGLE_CSE_KEY / GOOGLE_CSE_CX).
                  The source can be saved but will not run until it is.
                </p>
              ) : null}
              {platformSelect(
                "platform",
                "Public pages of this platform are searched; results are tagged with it",
              )}
              <Controller
                control={form.control}
                name="phrases"
                render={({ field }) => (
                  <Field
                    label="Phrases"
                    htmlFor="phrases"
                    hint="Exact things a poster would write, OR-ed into one query. Up to 10."
                  >
                    <TagInput
                      id="phrases"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="looking for a cto, Enter to add"
                    />
                  </Field>
                )}
              />
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <Field label="Site scope" htmlFor="siteScope" hint="Optional, e.g. reddit.com/r/startups">
                  <Input id="siteScope" placeholder="reddit.com/r/startups" {...form.register("siteScope")} />
                </Field>
                <Field label="Lookback" htmlFor="lookback">
                  <Select
                    value={form.watch("lookback")}
                    onValueChange={(v) => form.setValue("lookback", v as FormValues["lookback"])}
                  >
                    <SelectTrigger id="lookback">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="d1">1 day</SelectItem>
                      <SelectItem value="d3">3 days</SelectItem>
                      <SelectItem value="d7">7 days</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </>
          ) : null}

          {kind === "reddit_subreddit" ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <Field label="Subreddit" htmlFor="subreddit" hint="Without r/">
                <Input id="subreddit" placeholder="startups" {...form.register("subreddit")} />
              </Field>
              <Field label="Listing" htmlFor="listing">
                <Select
                  value={form.watch("listing")}
                  onValueChange={(v) => form.setValue("listing", v as FormValues["listing"])}
                >
                  <SelectTrigger id="listing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="hot">Hot</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}

          {kind === "reddit_search" ? (
            <>
              <Field label="Query" htmlFor="query">
                <Input id="query" placeholder='"looking for a cto"' {...form.register("query")} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <Field label="Limit to subreddit" htmlFor="search-subreddit" hint="Optional">
                  <Input id="search-subreddit" placeholder="startups" {...form.register("subreddit")} />
                </Field>
                <Field label="Sort" htmlFor="sort">
                  <Select
                    value={form.watch("sort")}
                    onValueChange={(v) => form.setValue("sort", v as FormValues["sort"])}
                  >
                    <SelectTrigger id="sort">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="relevance">Relevance</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </>
          ) : null}

          {kind === "rss" ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <Field label="Feed URL" htmlFor="url" hint="Google Alerts feed or any RSS/Atom">
                <Input
                  id="url"
                  placeholder="https://www.google.com/alerts/feeds/…"
                  {...form.register("url")}
                />
              </Field>
              {platformSelect("rss-platform", "Where the linked posts live")}
            </div>
          ) : null}

          <Field
            label="Poll every (minutes)"
            htmlFor="pollIntervalMin"
            error={form.formState.errors.pollIntervalMin?.message}
            hint={kind === "google_search" ? "Each poll costs 1–2 of the daily search queries" : undefined}
          >
            <Input
              id="pollIntervalMin"
              type="number"
              min={5}
              className="w-32"
              {...form.register("pollIntervalMin", { valueAsNumber: true })}
            />
          </Field>

          {configError ? <p className="text-xs text-destructive">{configError}</p> : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Add source
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
