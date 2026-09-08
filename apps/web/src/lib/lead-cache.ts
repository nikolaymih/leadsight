import type { LeadDetail, LeadListPage, LeadSummary } from "@/lib/types";

// Pure cache patchers for optimistic status/assignee changes. They accept whatever TanStack
// hands back (`unknown`) because one invalidation key covers both the infinite list
// (`{ pages }`) and plain pages (`{ items }`).

export type LeadPatch = Partial<Pick<LeadSummary, "status" | "assigneeId">>;

type InfiniteLeads = { pages: LeadListPage[]; pageParams: unknown[] };

function isPage(data: unknown): data is LeadListPage {
  return typeof data === "object" && data !== null && Array.isArray((data as LeadListPage).items);
}

function isInfinite(data: unknown): data is InfiniteLeads {
  return typeof data === "object" && data !== null && Array.isArray((data as InfiniteLeads).pages);
}

function patchPage(page: LeadListPage, ids: ReadonlySet<string>, patch: LeadPatch): LeadListPage {
  return { ...page, items: page.items.map((lead) => (ids.has(lead.id) ? { ...lead, ...patch } : lead)) };
}

/** Returns an updater that applies `patch` to every listed lead in a list query's data. */
export function patchLeadsInList(ids: readonly string[], patch: LeadPatch) {
  const set = new Set(ids);
  return (data: unknown): unknown => {
    if (isInfinite(data)) return { ...data, pages: data.pages.map((p) => patchPage(p, set, patch)) };
    if (isPage(data)) return patchPage(data, set, patch);
    return data;
  };
}

/** Returns an updater for a `leads.get` entry. */
export function patchLeadDetail(patch: LeadPatch) {
  return (data: unknown): unknown => {
    if (typeof data !== "object" || data === null || !("evidence" in data)) return data;
    return { ...(data as LeadDetail), ...patch };
  };
}
