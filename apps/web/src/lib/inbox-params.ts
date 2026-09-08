import {
  createLoader,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server";
import { LEAD_STATUSES, type LeadListInput, PLATFORMS, VERDICTS } from "@/lib/types";

// Inbox URL state. `nuqs/server` parsers are isomorphic: the page uses `loadInboxParams`
// to prefetch, the client hook uses the same parsers with `useQueryStates`, so both sides
// build an identical `leads.list` input and share one cache entry.

export const SORTS = ["rank", "newest", "confidence"] as const;
export type Sort = (typeof SORTS)[number];

export const inboxParsers = {
  campaign: parseAsString,
  verdict: parseAsArrayOf(parseAsStringLiteral(VERDICTS)).withDefault([]),
  status: parseAsArrayOf(parseAsStringLiteral(LEAD_STATUSES)).withDefault([]),
  platform: parseAsArrayOf(parseAsStringLiteral(PLATFORMS)).withDefault([]),
  assignee: parseAsString,
  minScore: parseAsInteger,
  sort: parseAsStringLiteral(SORTS).withDefault("rank"),
  lead: parseAsString,
};

export type InboxParams = {
  campaign: string | null;
  verdict: (typeof VERDICTS)[number][];
  status: (typeof LEAD_STATUSES)[number][];
  platform: (typeof PLATFORMS)[number][];
  assignee: string | null;
  minScore: number | null;
  sort: Sort;
  lead: string | null;
};

export const loadInboxParams = createLoader(inboxParsers);

export const PAGE_SIZE = 50;

/** The `leads.list` input for a set of URL params. Empty filters are omitted, not sent as []. */
export function toLeadListInput(params: InboxParams, campaignId: string): Omit<LeadListInput, "cursor"> {
  return {
    campaignId,
    ...(params.verdict.length > 0 ? { verdict: params.verdict } : {}),
    ...(params.status.length > 0 ? { status: params.status } : {}),
    ...(params.platform.length > 0 ? { platform: params.platform } : {}),
    ...(params.assignee ? { assigneeId: params.assignee } : {}),
    ...(params.minScore != null ? { minScore: params.minScore } : {}),
    sort: params.sort,
    limit: PAGE_SIZE,
  };
}

export function hasActiveFilters(params: InboxParams): boolean {
  return (
    params.verdict.length > 0 ||
    params.status.length > 0 ||
    params.platform.length > 0 ||
    params.assignee != null ||
    params.minScore != null
  );
}
