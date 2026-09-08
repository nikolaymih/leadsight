"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { describeSourceConfig } from "@/lib/sources";
import { platformForAlertQuery, type SourceConfig } from "./schema";

// Suggested Reddit sources as toggles, and the alert queries the user creates by hand in
// Google Alerts, pasting each resulting feed URL back. Both feed `campaigns.create`.

export interface SourceSelection {
  suggested: SourceConfig[];
  enabled: boolean[];
  alertQueries: string[];
  feedUrls: string[];
}

export function emptySelection(): SourceSelection {
  return { suggested: [], enabled: [], alertQueries: [], feedUrls: [] };
}

export function selectionFromDraft(draft: {
  suggestedSources: SourceConfig[];
  alertQueries: string[];
}): SourceSelection {
  return {
    suggested: draft.suggestedSources,
    enabled: draft.suggestedSources.map(() => true),
    alertQueries: draft.alertQueries,
    feedUrls: draft.alertQueries.map(() => ""),
  };
}

/** Sources to create: enabled suggestions plus one rss source per pasted feed URL. */
export function sourcesToCreate(sel: SourceSelection): SourceConfig[] {
  const picked = sel.suggested.filter((_, i) => sel.enabled[i]);
  const feeds = sel.alertQueries.flatMap((q, i) => {
    const url = sel.feedUrls[i]?.trim();
    if (!url) return [];
    return [{ kind: "rss" as const, config: { url, platform: platformForAlertQuery(q) } }];
  });
  return [...picked, ...feeds];
}

export function SourceSuggestions({
  value,
  onChange,
  disabled,
}: {
  value: SourceSelection;
  onChange: (next: SourceSelection) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Suggested sources</h3>
        {value.suggested.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            The assistant will suggest subreddits and Reddit searches; you can add more later under Sources.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {value.suggested.map((s, i) => (
              <li
                key={`${s.kind}-${describeSourceConfig(s)}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="mr-2 font-mono text-[10px] text-muted-foreground">{s.kind}</span>
                  {describeSourceConfig(s)}
                </span>
                <Switch
                  aria-label={`Include ${describeSourceConfig(s)}`}
                  checked={value.enabled[i] ?? false}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange({ ...value, enabled: value.enabled.map((e, j) => (j === i ? checked : e)) })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Google Alerts</h3>
        {value.alertQueries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Alert queries for LinkedIn, X and Facebook appear here once drafted.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Create each alert at google.com/alerts with delivery set to RSS feed, then paste the feed URL
              back here.
            </p>
            <ul className="flex flex-col gap-2">
              {value.alertQueries.map((q, i) => (
                <li
                  key={q}
                  className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-border p-2"
                >
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs">{q}</code>
                    <CopyButton text={q} />
                  </div>
                  <Input
                    placeholder="https://www.google.com/alerts/feeds/…"
                    aria-label={`Feed URL for ${q}`}
                    disabled={disabled}
                    value={value.feedUrls[i] ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        feedUrls: value.feedUrls.map((u, j) => (j === i ? e.target.value : u)),
                      })
                    }
                    className="h-7 text-xs"
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Copy query"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Clipboard is not available");
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
