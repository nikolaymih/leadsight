# LeadSight

Internal name. `leadsight.ai` is an existing competitor, so rename before any public release.

Campaign-driven social lead finder. Sources (Reddit API, Google Alerts RSS) produce posts;
an LLM extracts evidence per campaign; a deterministic rules engine scores it; results land
in a ranked inbox. Nothing offer-specific in code — campaigns are data.

`docs/design.md` is the source of truth for the data model, adapter contracts and
pipeline. `docs/ui-brief.md` describes the dashboard screens. Read the relevant one before
changing anything; update it when a decision changes.

## Skills router — read this first, every task

Skills live in `.claude/skills/<name>/SKILL.md`. Before writing code, load every skill
whose area the task touches. Most tasks touch two or three. When in doubt, load it; the
cost of reading is small, the cost of drifting from conventions is a rewrite.

| Task touches…                                                                 | Load                        |
|-------------------------------------------------------------------------------|-----------------------------|
| Any TypeScript at all (new file, refactor, review, dependency, "clean up")     | `code-style`                |
| Tables, columns, migrations, queries, indexes, SQL, seeds, DB tests            | `postgres-drizzle`          |
| Endpoints, request/response shapes, API errors, the typed client               | `orpc-contract`             |
| Fastify app, plugins, scheduler, health, CORS, logging, shutdown, auth mount   | `fastify`                   |
| Login, sessions, users, orgs, members, invites, roles, cookies                  | `better-auth`               |
| Sources, Reddit, RSS/Alerts, hydrators, LLM calls, prompts, extraction, scoring, budget, notifiers, pipeline run | `pipeline` |
| Pages, components, forms, side panels, shortcuts, styling, shadcn, auth screens | `nextjs`                    |
| Data fetching in the web app, mutations, cache, optimistic updates, tables      | `tanstack`                  |

Typical combinations:
- New endpoint end-to-end → `code-style` + `orpc-contract` + `postgres-drizzle` + `fastify` (+ `nextjs` + `tanstack` if it has UI)
- New source adapter → `code-style` + `pipeline` + `postgres-drizzle`
- New dashboard screen → `code-style` + `nextjs` + `tanstack` + `orpc-contract`
- Schema change → `code-style` + `postgres-drizzle` + `orpc-contract` (wire shapes usually change too)

If a task needs conventions no skill covers yet, do the work, then add or extend a skill
in the same PR so the next task inherits it.

## Layout

```
packages/core       domain: types (Zod), Drizzle schema, db queries, rules, sources, extractor, draft, scoring, pipeline, notifier contract. No framework deps.
packages/contract   oRPC contract: Zod wire schemas + routes. Consumed by api and web.
apps/api            Fastify 5: Better Auth, oRPC handler, scheduler, DB client.        (complete)
apps/web            Next.js 15 App Router dashboard.                                  (not started)
docs/               design.md, ui-brief.md
.claude/skills/     conventions per area (see router above)
```

## Commands

```
pnpm install
pnpm lint            biome check (format + lint)   — must pass before commit
pnpm typecheck       build packages (emits dist types), then tsc --noEmit across workspaces — must pass before commit
pnpm test            vitest across workspaces      — must pass before commit
                     DB tests (core + api) need a reachable Postgres (`docker compose up db`); each test
                     gets its own database cloned from a migrated template, so no manual migrate is needed
pnpm db:generate     drizzle-kit generate (needs DATABASE_URL)
pnpm db:migrate      drizzle-kit migrate (needs DATABASE_URL)
pnpm dev:api         tsx watch apps/api            (reads the root .env — copy .env.example)
pnpm dev:web         next dev                      (once apps/web exists)
docker compose up db local Postgres 17
```

## Approved libraries

Decided 2026-09-08 after weighing alternatives (Biome over ESLint+Prettier, TanStack
Query over SWR/RSC-only, TanStack Table over AG Grid, react-hook-form over TanStack Form,
nuqs over hand-rolled search params, shadcn over Mantine/MUI, node-cron over BullMQ for
now, OpenAI SDK over Vercel AI SDK, real Postgres over PGlite for tests). Use these; don't
add alternatives for the same job without discussing it first. Deliberately excluded:
Zustand/Redux, tRPC, Prisma, NestJS.

| Concern                     | Library                                            |
|-----------------------------|----------------------------------------------------|
| Validation / schemas        | zod                                                |
| DB                          | drizzle-orm + drizzle-kit, postgres (postgres.js)  |
| API framework               | fastify 5, fastify-plugin, @fastify/cors           |
| API contract                | @orpc/contract, @orpc/server, @orpc/client, @orpc/tanstack-query (@orpc/openapi later) |
| Auth                        | better-auth (+ organization, admin plugins), @daveyplate/better-auth-ui |
| Scheduling                  | node-cron (BullMQ + Redis only if a second worker is needed) |
| HTTP out                    | native fetch                                       |
| RSS                         | rss-parser                                         |
| LLM                         | openai SDK pointed at Groq/Gemini OpenAI-compatible endpoints |
| Email                       | nodemailer                                         |
| Logging                     | pino (via Fastify)                                 |
| Web framework               | next 15 (App Router), react 19                     |
| Server state                | @tanstack/react-query                              |
| Tables                      | @tanstack/react-table (+ @tanstack/react-virtual if needed) |
| URL state                   | nuqs                                               |
| Forms                       | react-hook-form + @hookform/resolvers (zod)        |
| UI                          | tailwindcss, shadcn/ui (radix), lucide-react, sonner |
| Lint / format               | @biomejs/biome (react + next rule domains enabled)  |
| Tests                       | vitest, @testing-library/react, playwright (smoke) |
| Runtime tooling             | tsx, typescript 5                                  |

## Rules that override everything

- Nothing offer-specific in code. Campaign content is data.
- `packages/core` never imports a framework. `apps/web` never imports `core` or `api`.
- Every business query filters by `organization_id`. Org comes from the session, never from input.
- `applyRules` stays pure; any change comes with tests.
- Generated Drizzle migrations committed to git; `push` only for local throwaway work.
- All three of `pnpm lint`, `pnpm typecheck`, `pnpm test` pass before every commit.

## Next steps (in order — update this list as you complete items)

1. ~~`apps/api` skeleton: env.ts, app.ts, server.ts, db plugin, Better Auth plugin, oRPC plugin with a stub router, health route. `docker-compose.yml`. First migration generated and applied.~~ Done — `apps/api/src`, `packages/core/drizzle/0000_init.sql`.
2. ~~`packages/core/src/errors.ts`, `db/` query module, `test/db.ts` (`withTestDb`) and seed helpers.~~ Done — `packages/core/src/{errors.ts,db/,test/}`, `@leadsight/core/test`.
3. ~~Sources: interface, registry, `RedditSubredditSource`, `RedditSearchSource`, `RssSource`, hydrators. Fixture-based tests.~~ Done — `packages/core/src/sources/`, `src/test/fake-fetch.ts`, hand-authored fixtures (replace with recordings once Reddit credentials exist).
4. ~~Extractor: providers, budget, few-shot, `LlmExtractor` with fake-provider tests. Prompt v1.~~ Done — `packages/core/src/extractor/`, `PROMPT_VERSION = "2026-09-08.1"`.
5. ~~Pipeline run + scheduler plugin. Integration test end-to-end with fake adapters.~~ Done — `packages/core/src/pipeline/`, `apps/api/src/plugins/{pipeline,scheduler}.ts`.
6. ~~oRPC procedures for campaigns, sources, leads, runs (real implementations).~~ Done — `apps/api/src/orpc/{context,error-map,mappers}.ts`, `procedures/*`; only `campaigns.draft` is still a stub.
7. ~~Campaign draft endpoint (LLM-generated draft from chat + URLs).~~ Done — `packages/core/src/draft/`, `extractor/chain.ts` shared with the extractor, `campaigns.draft`.
8. `apps/web`: shell, auth screens, inbox, lead panel, campaign setup chat, sources & runs, settings — per `docs/ui-brief.md`.
9. Notifiers (Slack, email digest).
10. Deploy: Dockerfiles for api and web, compose for the hosting machine, migration step.
