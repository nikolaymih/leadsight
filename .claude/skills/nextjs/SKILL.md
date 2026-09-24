---
name: nextjs
description: How to build the LeadSight dashboard in apps/web with Next.js 15 App Router, React Server Components, Better Auth client, shadcn/ui, and the oRPC client. Load this whenever working on any UI, page, layout, component, form, route, auth screen, the inbox, campaign setup, side panels, keyboard shortcuts, or anything the user calls "the frontend", "the dashboard", "the web app", "the UI", or "a screen". Read docs/ui-brief.md alongside it for what each screen shows.
---

# Next.js (apps/web)

## Layout

```
apps/web/src/
  app/
    (auth)/login, signup, forgot-password, reset-password, invite/[id]   public routes
    (app)/                                 authenticated shell: sidebar + topbar
      layout.tsx                           server component: session check, Providers, Shell
      onboarding/page.tsx                  create the first organization
      inbox/page.tsx                       server prefetch + HydrationBoundary → InboxView
      campaigns/page.tsx, campaigns/new/page.tsx, campaigns/[id]/page.tsx
      sources/page.tsx
      settings/page.tsx                    tabs: organization, integrations & providers, personal
  components/
    ui/                                    hand-written shadcn-style primitives on the `radix-ui` monopackage
    auth/                                  AuthCard, LoginForm, SignupForm, ForgotPasswordForm, ResetPasswordForm, AcceptInvitation
    shell/                                 Shell, CampaignSelector, OrgSwitcher, UserMenu, Onboarding, Providers
    inbox/                                 InboxView, FilterBar, LeadTable, columns, ExpandedLeadRow, LeadPanel,
                                           ScoreBreakdown, VerdictBadge, PlatformIcon, lead-controls, use-lead-mutations
    campaigns/                             CampaignList, NewCampaign, CampaignSettings, CampaignForm, CriteriaEditor,
                                           DraftChat, SourceSuggestions, TagInput, schema.ts (form Zod)
    sources/                               SourcesView, SourceTable, AddSourceDialog, RunTable, BudgetWidget
    settings/                              SettingsView, OrgSettings, Integrations, Personal
  lib/
    orpc.ts / orpc-server.ts               browser client + per-request server client (forwards the cookie)
    auth-client.ts / auth-server.ts        Better Auth client + getServerSession()
    query-client.ts                        QueryClient factory
    types.ts                               wire types + enums inferred from the contract (never from core)
    inbox-params.ts                        nuqs parsers (from `nuqs/server`), loader, toLeadListInput
    lead-cache.ts                          pure optimistic cache patchers
    format.ts, sources.ts, errors.ts, utils.ts
  hooks/                                   useActiveCampaign, useInboxFilters, useKeyboardNav, useOrgMembers/useOrgRole
```

The shadcn registry was unreachable when the app was scaffolded, so `components/ui/*` are
hand-written equivalents built on the `radix-ui` monopackage (one import, `Dialog as
DialogPrimitive` etc.). Edit them freely; they are ours. `SheetContent` in `dialog.tsx` is the
side panel.

## Rules

- **Server components by default.** Add `"use client"` only for interactivity (event
  handlers, hooks, TanStack Query). Keep client components small and leaf-level; pass data
  down from server components where possible.
- **Data fetching goes through TanStack Query + oRPC**, not `fetch` in components, not
  server actions. Server components may call the oRPC client directly for initial data
  and pass it as `initialData` / hydrate the query cache. See the `tanstack` skill.
- **Auth**: `(app)/layout.tsx` calls `authClient.getSession()` server-side (forward the
  cookie header) and redirects to `/login` if absent. Client components use
  `authClient.useSession()` for the user menu only. Never gate UI on client state alone;
  the API enforces auth anyway.
- **Org scoping** is implicit: the API uses the session's active organization. The UI only
  shows the org switcher (Better Auth `organization` client plugin).
- **URL is state** for filters and selection: `/inbox?campaign=…&verdict=hot,warm&status=new`.
  Use `nuqs` for typed search params. Don't keep filter state in React state that is lost
  on refresh.
- **Side panel, not modal**, for lead detail (`?lead=<id>`). Modals only for destructive
  confirmations.
- **Forms**: `react-hook-form` + `zodResolver` with schemas imported from
  `@leadsight/contract`. One schema, validated identically on both sides.
- **Tables**: TanStack Table for the inbox and sources (sorting, row selection, expanded
  rows). Virtualize (`@tanstack/react-virtual`) only if a campaign exceeds ~500 visible rows.
- **Keyboard**: inbox shortcuts (`j/k/e/s/o`) in `hooks/useKeyboardNav.ts`, registered once
  in the inbox page, disabled while an input is focused.
- **Styling**: Tailwind + shadcn/ui. Dense tables (`text-sm`, tight row padding). Verdict
  colors are CSS variables defined once in `globals.css` (`--verdict-hot` …) and used by
  `VerdictBadge`; never hardcode a verdict color elsewhere.
- **No browser storage** for app data. Filters in URL, preferences server-side.
- **Env**: `NEXT_PUBLIC_API_URL` only. Read via `apps/web/src/lib/env.ts` with Zod.
- **Imports**: `@/…` aliases, no `.js` suffix on relative imports (Next's bundler does not
  resolve `./x.js` to `x.ts`; core and api use the suffix, the web app must not).
- **Types and enums** come from `@/lib/types`, inferred from the contract
  (`InferContractRouterOutputs`) and its Zod schemas (`schema.shape.x.options`). Never
  import `@leadsight/core`; the contract imports only `@leadsight/core/types` so the
  browser bundle stays free of Node code.
- **Role gating** is cosmetic: `useOrgRole()` / `canManage()` disable admin-only controls;
  the API is the authority and a FORBIDDEN toast is the fallback.
- **Search params on the server**: parsers live in `lib/inbox-params.ts` built from
  `nuqs/server` (isomorphic); the page calls `loadInboxParams(searchParams)` and the client
  hook calls `useQueryStates(inboxParsers)`. One definition, one query key on both sides.
- **Keyboard**: `useKeyboardNav(handlers, enabled)` ignores keys typed into fields and
  comboboxes; the inbox disables it while the lead panel is open. `s` focuses the row's
  status trigger (`[data-status-trigger]`) rather than opening it.
- **Loading/empty/error** states for every data view. Empty states carry an action
  ("Run now", "Create campaign"), per `docs/ui-brief.md`.
- **Accessibility**: shadcn primitives are accessible; keep them. Every icon-only button
  has `aria-label`. Focus is managed when the side panel opens/closes.

## Adding a primitive

Write it in `components/ui/` in the shadcn style (`cn()`, `cva` variants, `ComponentProps`
of the radix part) and keep it theme-token only. If the shadcn registry is reachable,
`pnpm --filter @leadsight/web dlx shadcn@latest add …` output is fine too, but adapt its
imports to the `radix-ui` monopackage.

## Page skeleton

```tsx
// app/(app)/inbox/page.tsx  (server component)
export default async function InboxPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await loadInboxParams(searchParams);
  const qc = makeQueryClient();
  try {
    const { orpc } = await serverOrpc();                       // cookie-forwarding client
    await qc.prefetchInfiniteQuery(orpc.leads.list.infiniteOptions({ /* same input as the client */ }));
  } catch (err) {
    console.error("inbox prefetch failed", err);                // client shows its own error state
  }
  return <HydrationBoundary state={dehydrate(qc)}><InboxView /></HydrationBoundary>;
}
```

Forms: `useForm` + `zodResolver(schema)` where the schema is built from the contract's
(`campaignDraftSchema`, `sourceConfigSchema`, `criteriaSchema`, `thresholdsSchema`). For
discriminated unions (source config) keep the form flat and assemble + `safeParse` the
wire shape on submit.

## Testing

- Component tests with Vitest + Testing Library for pure UI (`ScoreBreakdown`,
  `VerdictBadge`) and pure helpers (`lead-cache`, `format`, campaign `schema`). `pnpm test`.
- Browser smoke: build the app, start the API against a migrated database and
  `next start`, then drive it with Playwright (`chromium.launch({ executablePath })` if the
  bundled browser is missing). Sign up → onboarding → each screen; assert no `pageerror`.
  Done by hand for step 8; turn it into `apps/web/e2e/` once the pipeline can produce
  leads without seeding.

## Dev

- `pnpm dev:web` → `next dev` on :3000, API on :3001, CORS configured in the API.
- Turbopack is fine for dev.
