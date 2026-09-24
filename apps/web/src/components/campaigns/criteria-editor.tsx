"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { type Control, Controller, type UseFormReturn, useFieldArray, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Slider } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { type CampaignFormValues, type CriterionValues, keyFromQuestion, weightTotal } from "./schema";
import { TagInput } from "./tag-input";

// One card per criterion; weights must sum to 100 (the indicator turns red otherwise and the
// form's Zod schema blocks save). Criteria can be reordered, removed and added by hand.

export function CriteriaEditor({
  form,
  disabled,
}: {
  form: UseFormReturn<CampaignFormValues>;
  disabled?: boolean;
}) {
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: "criteria" });
  const criteria = useWatch({ control: form.control, name: "criteria" }) ?? [];
  const total = weightTotal(criteria);
  const listError = form.formState.errors.criteria;
  const listMessage = listError?.message ?? listError?.root?.message;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Criteria</h3>
        <span
          className={cn(
            "tabular text-xs",
            total === 100 ? "text-muted-foreground" : "font-medium text-destructive",
          )}
          aria-live="polite"
        >
          weights {total} / 100
        </span>
      </div>
      {listMessage ? <p className="text-xs text-destructive">{listMessage}</p> : null}

      {fields.map((field, index) => (
        <CriterionCard
          key={field.id}
          index={index}
          control={form.control}
          form={form}
          disabled={disabled}
          isFirst={index === 0}
          isLast={index === fields.length - 1}
          onMove={(delta) => move(index, index + delta)}
          onRemove={() => remove(index)}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={() => append({ key: "", question: "", type: "boolean", weight: Math.max(0, 100 - total) })}
      >
        <Plus />
        Add criterion
      </Button>
    </div>
  );
}

function CriterionCard({
  index,
  control,
  form,
  disabled,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  index: number;
  control: Control<CampaignFormValues>;
  form: UseFormReturn<CampaignFormValues>;
  disabled?: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const base = `criteria.${index}` as const;
  const type = useWatch({ control, name: `${base}.type` });
  const errors = form.formState.errors.criteria?.[index];
  const keyTouched = form.getFieldState(`${base}.key`).isDirty;

  function changeType(next: CriterionValues["type"]) {
    const current = form.getValues(base);
    const shared = { key: current.key, question: current.question, weight: current.weight };
    if (next === "boolean") form.setValue(base, { ...shared, type: "boolean" }, { shouldDirty: true });
    if (next === "enum")
      form.setValue(
        base,
        { ...shared, type: "enum", options: ["yes", "no"], points: { yes: current.weight, no: 0 } },
        { shouldDirty: true },
      );
    if (next === "number")
      form.setValue(base, { ...shared, type: "number", min: 0, max: 100 }, { shouldDirty: true });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <Field
          label="Question"
          htmlFor={`${base}.question`}
          error={errors?.question?.message}
          className="flex-1"
        >
          <Input
            id={`${base}.question`}
            disabled={disabled}
            placeholder="Is the poster hiring developers?"
            {...form.register(`${base}.question`, {
              onChange: (e) => {
                if (!keyTouched) form.setValue(`${base}.key`, keyFromQuestion(e.target.value));
              },
            })}
          />
        </Field>
        <div className="flex gap-0.5 pt-5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Move up"
            disabled={disabled || isFirst}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Move down"
            disabled={disabled || isLast}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove criterion"
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_140px_1fr]">
        <Field
          label="Key"
          htmlFor={`${base}.key`}
          error={errors?.key?.message}
          hint="snake_case; stable across edits"
        >
          <Input
            id={`${base}.key`}
            disabled={disabled}
            className="font-mono text-xs"
            {...form.register(`${base}.key`)}
          />
        </Field>
        <Field label="Type" htmlFor={`${base}.type`}>
          <Select
            value={type}
            onValueChange={(v) => changeType(v as CriterionValues["type"])}
            disabled={disabled}
          >
            <SelectTrigger id={`${base}.type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="boolean">Yes / no</SelectItem>
              <SelectItem value="enum">One of</SelectItem>
              <SelectItem value="number">Number</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Controller
          control={control}
          name={`${base}.weight`}
          render={({ field }) => (
            <Field
              label={`Weight · ${field.value}`}
              htmlFor={`${base}.weight`}
              error={errors?.weight?.message}
            >
              <div className="flex h-8 items-center gap-2">
                <Slider
                  id={`${base}.weight`}
                  min={0}
                  max={100}
                  step={1}
                  disabled={disabled}
                  value={[field.value ?? 0]}
                  onValueChange={([v]) => field.onChange(v ?? 0)}
                  aria-label="Weight"
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  disabled={disabled}
                  className="w-16 text-xs"
                  value={field.value ?? 0}
                  onChange={(e) => field.onChange(clampInt(e.target.value, 0, 100))}
                  aria-label="Weight value"
                />
              </div>
            </Field>
          )}
        />
      </div>

      {type === "enum" ? <EnumOptions base={base} form={form} disabled={disabled} /> : null}
      {type === "number" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Min" htmlFor={`${base}.min`} error={numberError(errors, "min")}>
            <Input
              id={`${base}.min`}
              type="number"
              disabled={disabled}
              {...form.register(`${base}.min`, { valueAsNumber: true })}
            />
          </Field>
          <Field
            label="Max"
            htmlFor={`${base}.max`}
            error={numberError(errors, "max")}
            hint="Points scale linearly from min to max"
          >
            <Input
              id={`${base}.max`}
              type="number"
              disabled={disabled}
              {...form.register(`${base}.max`, { valueAsNumber: true })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function EnumOptions({
  base,
  form,
  disabled,
}: {
  base: `criteria.${number}`;
  form: UseFormReturn<CampaignFormValues>;
  disabled?: boolean;
}) {
  const options = (useWatch({ control: form.control, name: `${base}.options` }) ?? []) as string[];
  const points = (useWatch({ control: form.control, name: `${base}.points` }) ?? {}) as Record<
    string,
    number
  >;
  const weight = useWatch({ control: form.control, name: `${base}.weight` }) ?? 0;
  const errors = form.formState.errors.criteria?.[typeof base === "string" ? Number(base.split(".")[1]) : 0];
  const pointsError = (errors as { points?: { message?: string } } | undefined)?.points?.message;

  function setOptions(next: string[]) {
    form.setValue(`${base}.options`, next, { shouldDirty: true, shouldValidate: true });
    const nextPoints: Record<string, number> = {};
    for (const o of next) nextPoints[o] = Math.min(points[o] ?? 0, weight);
    form.setValue(`${base}.points`, nextPoints, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label="Options" hint="Points per option, none above the weight" error={pointsError}>
        <TagInput value={options} onChange={setOptions} placeholder="Add an option…" disabled={disabled} />
      </Field>
      {options.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <div key={o} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{o}</span>
              <Input
                type="number"
                min={0}
                max={weight}
                disabled={disabled}
                className="w-16 text-xs"
                aria-label={`Points for ${o}`}
                value={points[o] ?? 0}
                onChange={(e) =>
                  form.setValue(
                    `${base}.points`,
                    { ...points, [o]: clampInt(e.target.value, 0, weight) },
                    { shouldDirty: true, shouldValidate: true },
                  )
                }
              />
              <span className="text-muted-foreground">/ {weight}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function numberError(errors: unknown, key: "min" | "max"): string | undefined {
  return (errors as Record<string, { message?: string } | undefined> | undefined)?.[key]?.message;
}
