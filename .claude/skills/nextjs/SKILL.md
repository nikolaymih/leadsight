---
name: nextjs
description: How to build the LeadSight dashboard in apps/web with Next.js 15 App Router, React Server Components, Better Auth client, shadcn/ui, and the oRPC client. Load this whenever working on any UI, page, layout, component, form, route, auth screen, the inbox, campaign setup, side panels, keyboard shortcuts, or anything the user calls "the frontend", "the dashboard", "the web app", "the UI", or "a screen". Read docs/ui-brief.md alongside it for what each screen shows.
---

# Next.js (apps/web)

## Layout

```
apps/web/src/
  app/
    (auth)/login, signup, invite/[id]     public routes
    (app)/                                 authenticated shell: sidebar + topbar
      layout.tsx                           server component: session check, org, providers
      inbox/page.tsx
      campaigns/page.tsx, campaigns/new/page.tsx, campaigns/[id]/page.tsx
      sources/page.tsx
      settings/…
  components/
    ui/                                    shadcn/ui primitives (generated, don't hand-edit)
    inbox/                                 LeadTable, LeadRow, LeadPanel, ScoreBreakdown, VerdictBadge
    campaigns/                             CampaignForm, CriteriaEditor, WeightSlider, DraftChat
    sources/                               SourceTable, RunTable
    shell/                                 Sidebar, Topbar, OrgSwitcher
  lib/
    orpc.ts                                typed client + TanStack utils
    auth-client.ts                         Better Auth client
    query-client.ts                        QueryClient factory
    format.ts                              dates, numbers
  hooks/                                   useKeyboardNav, useInboxFilters
```

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
- **Loading/empty/error** states for every data view. Empty states carry an action
  ("Run now", "Create campaign"), per `docs/ui-brief.md`.
- **Accessibility**: shadcn primitives are accessible; keep them. Every icon-only button
  has `aria-label`. Focus is managed when the side panel opens/closes.

## Adding a shadcn component

`pnpm --filter @leadsight/web dlx shadcn@latest add table badge sheet` → lands in
`components/ui/`. Commit the generated file; don't edit it beyond theme tokens.

## Page skeleton

```tsx
// app/(app)/inbox/page.tsx  (server component)
export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = inboxParams.parse(await searchParams);
  const initial = await serverClient.leads.list(params);   // cookie-forwarding client
  return <InboxView params={params} initial={initial} />;  // client component
}
```

## Testing

- Component tests with Vitest + Testing Library for pure UI (`ScoreBreakdown`, `VerdictBadge`).
- One Playwright smoke test per screen once the API exists: login → inbox renders →
  open lead → change status.

## Dev

- `pnpm dev:web` → `next dev` on :3000, API on :3001, CORS configured in the API.
- Turbopack is fine for dev.
