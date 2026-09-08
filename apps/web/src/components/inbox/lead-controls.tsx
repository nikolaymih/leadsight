"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OrgMember } from "@/hooks/use-org-members";
import { titleCase } from "@/lib/format";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

// Inline status and assignee controls, shared by the inbox row, the bulk bar and the panel.

const UNASSIGNED = "__unassigned";

export function StatusSelect({
  value,
  onChange,
  size = "sm",
  className,
  placeholder,
  disabled,
}: {
  value: LeadStatus | null;
  onChange: (status: LeadStatus) => void;
  size?: "sm" | "default";
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v as LeadStatus)} disabled={disabled}>
      <SelectTrigger size={size} className={cn("w-32", className)} aria-label="Status" data-status-trigger>
        <SelectValue placeholder={placeholder ?? "Status"} />
      </SelectTrigger>
      <SelectContent>
        {LEAD_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {titleCase(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AssigneeSelect({
  value,
  members,
  onChange,
  size = "sm",
  className,
  placeholder,
  disabled,
}: {
  value: string | null;
  members: OrgMember[];
  onChange: (userId: string | null) => void;
  size?: "sm" | "default";
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? (placeholder ? "" : UNASSIGNED)}
      onValueChange={(v) => onChange(v === UNASSIGNED ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={cn("w-36", className)} aria-label="Assignee">
        <SelectValue placeholder={placeholder ?? "Unassigned"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.userId} value={m.userId}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
