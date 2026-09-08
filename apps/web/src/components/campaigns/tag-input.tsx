"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// Chips + a text field. Enter or comma adds, Backspace on an empty field removes the last.

export function TagInput({
  value,
  onChange,
  placeholder,
  id,
  disabled,
  className,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const parts = draft
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !value.includes(p));
    if (parts.length > 0) onChange([...value, ...parts]);
    setDraft("");
  }

  return (
    <div
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-1 rounded-[var(--radius)] border border-input bg-card px-1.5 py-1 shadow-xs focus-within:ring-2 focus-within:ring-ring",
        disabled && "opacity-50",
        className,
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-sm bg-muted px-1.5 py-0.5 text-xs"
        >
          {tag}
          {disabled ? null : (
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              className="rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}
