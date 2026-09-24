"use client";

import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OrgMember } from "@/hooks/use-org-members";
import { PLATFORM_LABEL, titleCase } from "@/lib/format";
import { hasActiveFilters, type InboxParams, SORTS, type Sort } from "@/lib/inbox-params";
import { LEAD_STATUSES, PLATFORMS, VERDICTS } from "@/lib/types";

const SORT_LABEL: Record<Sort, string> = { rank: "Rank", newest: "Newest", confidence: "Confidence" };
const ANYONE = "__anyone";

export interface FilterBarProps {
  params: InboxParams;
  onChange: (patch: Partial<InboxParams>) => void;
  members: OrgMember[];
  total: string;
}

export function FilterBar({ params, onChange, members, total }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiFilter
        label="Verdict"
        options={VERDICTS.map((v) => ({ value: v, label: titleCase(v) }))}
        value={params.verdict}
        onChange={(verdict) => onChange({ verdict })}
      />
      <MultiFilter
        label="Status"
        options={LEAD_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
        value={params.status}
        onChange={(status) => onChange({ status })}
      />
      <MultiFilter
        label="Platform"
        options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] ?? p }))}
        value={params.platform}
        onChange={(platform) => onChange({ platform })}
      />
      <Select
        value={params.assignee ?? ANYONE}
        onValueChange={(v) => onChange({ assignee: v === ANYONE ? null : v })}
      >
        <SelectTrigger size="sm" className="w-36" aria-label="Assignee filter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANYONE}>Anyone</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span id="min-score-label">Min score</span>
        <Input
          type="number"
          min={0}
          max={100}
          inputMode="numeric"
          className="h-7 w-16 text-xs"
          aria-labelledby="min-score-label"
          key={params.minScore ?? "none"}
          defaultValue={params.minScore ?? ""}
          onBlur={(e) => commitMinScore(e.currentTarget.value, params.minScore, onChange)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitMinScore(e.currentTarget.value, params.minScore, onChange);
          }}
        />
      </div>
      {hasActiveFilters(params) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ verdict: [], status: [], platform: [], assignee: null, minScore: null })}
        >
          <X className="size-3.5" />
          Clear
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{total}</span>
        <Tabs value={params.sort} onValueChange={(v) => onChange({ sort: v as Sort })}>
          <TabsList aria-label="Sort">
            {SORTS.map((s) => (
              <TabsTrigger key={s} value={s}>
                {SORT_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}

function commitMinScore(raw: string, current: number | null, onChange: FilterBarProps["onChange"]) {
  const n = raw.trim() === "" ? null : Math.max(0, Math.min(100, Number.parseInt(raw, 10)));
  const next = n == null || Number.isNaN(n) ? null : n;
  if (next !== current) onChange({ minScore: next });
}

function MultiFilter<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
}) {
  const summary =
    value.length === 0
      ? label
      : `${label}: ${value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ")}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={value.length > 0 ? "secondary" : "outline"} size="sm" className="max-w-56">
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={value.includes(o.value)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) =>
              onChange(checked ? [...value, o.value] : value.filter((v) => v !== o.value))
            }
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
