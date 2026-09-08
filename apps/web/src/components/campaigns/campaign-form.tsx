"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useEffect } from "react";
import { Controller, type UseFormReturn, useForm } from "react-hook-form";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Slider } from "@/components/ui/misc";
import { CriteriaEditor } from "./criteria-editor";
import { type CampaignFormValues, campaignFormSchema } from "./schema";
import { TagInput } from "./tag-input";

// The draft pane and the settings screen share this form. It owns the fields the campaign
// draft schema defines; the caller renders sources / tuning / actions through `children`
// and `footer`, and submits the validated values.

export interface CampaignFormProps {
  form: UseFormReturn<CampaignFormValues>;
  onSubmit: (values: CampaignFormValues) => void | Promise<void>;
  disabled?: boolean;
  /** Rendered between the core fields and the criteria (e.g. tuning fields). */
  children?: ReactNode;
  /** Rendered after the criteria (sources, actions). */
  footer?: ReactNode;
  id?: string;
}

export function useCampaignForm(defaultValues: CampaignFormValues): UseFormReturn<CampaignFormValues> {
  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues,
    mode: "onBlur",
  });
  // A new draft from the chat replaces the whole form; the caller changes `defaultValues` identity.
  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);
  return form;
}

export function CampaignForm({ form, onSubmit, disabled, children, footer, id }: CampaignFormProps) {
  const { register, formState, control } = form;
  const e = formState.errors;

  return (
    <form id={id} onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <Field label="Name" htmlFor="name" error={e.name?.message}>
        <Input
          id="name"
          disabled={disabled}
          placeholder="Fractional CTO for seed-stage startups"
          {...register("name")}
        />
      </Field>
      <Field label="Offer description" htmlFor="offerDescription" error={e.offerDescription?.message}>
        <Textarea id="offerDescription" disabled={disabled} {...register("offerDescription")} />
      </Field>
      <Field
        label="Ideal poster"
        htmlFor="icp"
        error={e.icp?.message}
        hint="Who writes the posts you want to find"
      >
        <Textarea id="icp" disabled={disabled} {...register("icp")} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Controller
          control={control}
          name="disqualifiers"
          render={({ field }) => (
            <Field
              label="Disqualifiers"
              htmlFor="disqualifiers"
              hint="Explicit non-fits, e.g. “equity only”"
              error={e.disqualifiers?.message}
            >
              <TagInput
                id="disqualifiers"
                value={field.value}
                onChange={field.onChange}
                disabled={disabled}
                placeholder="Add and press Enter"
              />
            </Field>
          )}
        />
        <Controller
          control={control}
          name="keywords"
          render={({ field }) => (
            <Field
              label="Keywords"
              htmlFor="keywords"
              hint="Phrases people actually write; used to pre-filter posts"
              error={e.keywords?.message}
            >
              <TagInput
                id="keywords"
                value={field.value}
                onChange={field.onChange}
                disabled={disabled}
                placeholder="Add and press Enter"
              />
            </Field>
          )}
        />
      </div>

      {children}

      <CriteriaEditor form={form} disabled={disabled} />

      <Controller
        control={control}
        name="thresholds"
        render={({ field }) => (
          <Field
            label={`Thresholds · warm ≥ ${field.value.warm} · hot ≥ ${field.value.hot}`}
            error={
              e.thresholds?.message ??
              e.thresholds?.root?.message ??
              e.thresholds?.hot?.message ??
              e.thresholds?.warm?.message
            }
            hint="Scores below warm are cold"
          >
            <div className="px-1 py-2">
              <Slider
                min={0}
                max={100}
                step={1}
                minStepsBetweenThumbs={1}
                disabled={disabled}
                value={[field.value.warm, field.value.hot]}
                onValueChange={([warm, hot]) => field.onChange({ warm: warm ?? 0, hot: hot ?? 100 })}
                aria-label="Verdict thresholds"
              />
            </div>
          </Field>
        )}
      />

      {footer}
    </form>
  );
}
