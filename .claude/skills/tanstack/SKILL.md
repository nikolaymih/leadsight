---
name: tanstack
description: How LeadSight uses TanStack Query (server state, caching, mutations, invalidation, optimistic updates) and TanStack Table (inbox and sources tables) together with the oRPC client. Load this whenever writing data fetching in apps/web, a mutation, cache invalidation, infinite scroll/pagination, optimistic status changes, a table with sorting/selection/expansion, or when the user mentions "query", "cache", "refetch", "stale", "mutation", "table", "pagination", or "loading state".
---

# TanStack Query + Table

## Query setup

```ts
// lib/query-client.ts
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  });
}
```

Provider in `(app)/layout.tsx` via a client `Providers` component. One QueryClient per
browser session; on the server, one per request (`cache(makeQueryClient)`).

## Reading

Always through the oRPC utils, never hand-written query keys:

```ts
const { data } = useQuery(orpc.leads.list.queryOptions({ input: params }));
const { data } = useInfiniteQuery(
  orpc.leads.list.infiniteOptions({
    input: (cursor) => ({ ...params, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  }),
);
```

- Keys are derived from the procedure path and input, so `orpc.leads.key()` invalidates
  every leads query and `orpc.leads.list.key({ input })` a specific one.
- Inbox uses `infiniteOptions` with the cursor from the contract. Sources, campaigns, runs
  use `queryOptions`.
- Server-side initial data: in the page server component, prefetch into a per-request
  QueryClient and wrap the tree in `HydrationBoundary`. Client components then read from
  cache without a loading flash. The infinite key is derived from `input(initialPageParam)`,
  so build the input with the same helper on both sides (`toLeadListInput`).
- No campaign yet (or any missing prerequisite): pass `skipToken` as `input` instead of
  `enabled: false`, so the input type stays honest.
- Better Auth data (organization detail, invitations) is also read through `useQuery`, keyed
  under `["auth", …]` in the component that owns it, so mutations can invalidate. The
  Better Auth hooks (`useSession`, `useActiveOrganization`) are fine for read-only shell state.

## Mutations

```ts
const update = useMutation(
  orpc.leads.update.mutationOptions({
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: orpc.leads.key() });
      const prev = qc.getQueriesData({ queryKey: orpc.leads.list.key() });
      qc.setQueriesData({ queryKey: orpc.leads.list.key() }, patchLeadInPages(input));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d)),
    onSettled: () => qc.invalidateQueries({ queryKey: orpc.leads.key() }),
  }),
);
```

- **Optimistic** for status and assignee changes (the user does these dozens of times a
  day; a round-trip per click feels slow). The patchers live in `lib/lead-cache.ts`
  (`patchLeadsInList`, `patchLeadDetail`), accept `unknown` because one key covers infinite
  and plain pages, and are tested. `components/inbox/use-lead-mutations.ts` wires them.
- **Not optimistic** for anything that changes scores (rescore, campaign criteria save):
  show a pending state and invalidate on success.
- After `campaigns.update` or `campaigns.rescore`: invalidate `orpc.leads.key()` and
  `orpc.campaigns.key()`. After `sources.run`: invalidate `orpc.sources.key()` and
  `orpc.runs.key()`.
- Surface errors with a toast (`sonner`), including the oRPC error `code`.
  Don't swallow them.

## Polling

- Sources & Runs page: `refetchInterval: 15_000` (sources and runs) so a manual "Run now"
  shows progress. TanStack's default `refetchIntervalInBackground: false` already pauses
  polling when the tab is hidden. Nowhere else polls.
- Budget widget: `refetchInterval: 60_000`.
- Preview rescoring: the campaign form's watched values are debounced 400 ms and only sent
  when `criteriaSchema`/`thresholdsSchema` accept them; `staleTime: 0`.

## Table

TanStack Table (`@tanstack/react-table`) for inbox and sources. Rules:

- Column definitions in a separate file (`components/inbox/columns.tsx`), typed with
  `ColumnDef<LeadSummary>` where `LeadSummary` is inferred from the contract:
  `type LeadSummary = InferContractRouterOutputs<Contract>["leads"]["list"]["items"][number]`.
- Sorting is **server-side** for the inbox (it's paginated): the sort control changes the
  `sort` search param; do not enable client sorting on an infinite list. Sources and runs
  are small; client sorting is fine there.
- Row selection for bulk actions via `enableRowSelection`; selected ids feed
  `leads.bulkUpdate`.
- Expanded row (score breakdown) via `getExpandedRowModel`; only one expanded at a time
  unless the user shift-clicks. The list row carries no evidence, so the expanded row
  runs `leads.get` for that id; the panel shares the same cache entry.
- Sources and runs are small lists rendered with the plain table primitives, not TanStack
  Table.
- Keep the table component dumb: it receives `data`, `columns`, callbacks. Data fetching
  happens in the page/view component above it.
- Column visibility persisted server-side later; for now it's in URL or default.

## Don't

- Don't create `useEffect` + `useState` fetchers. Everything is a query or a mutation.
- Don't invalidate `"all"`; invalidate the narrowest key that is actually stale.
- Don't store server data in Zustand/Context. TanStack Query is the store.
- Don't call `client.*` directly in components; go through `orpc.*` utils so cache keys stay consistent.
