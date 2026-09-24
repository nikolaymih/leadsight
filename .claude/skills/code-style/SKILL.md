---
name: code-style
description: Architecture boundaries, naming, error handling, and cleanliness rules for the LeadSight monorepo. Load this before writing or refactoring ANY TypeScript in this repo — new files, new modules, moving code between packages, adding dependencies, or reviewing a diff. Also load it when the user says "clean", "refactor", "structure", "where should this go", or asks for a code review.
---

# Code style and architecture

## Package boundaries (hard rules)

```
packages/core      pure domain: types, schema, rules, sources, extractor, notifier, pipeline
packages/contract  oRPC contract (Zod schemas + routes). Depends only on core.
apps/api           Fastify: auth, oRPC handler, scheduler wiring, DB client. Depends on core + contract.
apps/web           Next.js: UI only. Depends on contract (types + client). NEVER imports core or api.
```

- `packages/core` has no framework imports. No Fastify, no Next, no React, no oRPC server.
  It may import `drizzle-orm` for schema and query helpers, `zod`, and small pure libs.
- Business logic goes in core, not in route handlers. A route handler is: auth check →
  call core function → map to contract shape. If it's longer than ~20 lines, extract.
- The web app talks to the API only through the oRPC client from `@leadsight/contract`.
  No hand-written `fetch` to our own API.
- Nothing offer-specific in code. "CTO", "MVP", "JavaScript" never appear outside tests
  and fixtures. Campaign content is data in the `campaigns` table.

## Files and naming

- One concept per file. `sources/reddit-subreddit.ts`, not `sources/reddit.ts` with three classes.
- kebab-case filenames, PascalCase types/classes, camelCase functions/variables,
  SCREAMING_SNAKE for const arrays that back enums (`PLATFORMS`).
- DB columns snake_case, TS properties camelCase. Drizzle does the mapping; never leak
  snake_case into TS or camelCase into SQL.
- Barrel `index.ts` only at package roots and per-folder where the folder is a unit
  (`rules/index.ts`). No deep barrels re-exporting everything.
- Use `import type` for type-only imports (Biome enforces it).
- Node built-ins with `node:` prefix.

## Errors

- Throw typed errors from core: define small classes in `packages/core/src/errors.ts`
  (`NotFoundError`, `ValidationError`, `ProviderError`) and map them to oRPC errors in
  one place in the API (`apps/api/src/orpc/error-map.ts`). Never map errors inline in handlers.
- Never swallow errors. Catch only where you can handle or add context; rethrow otherwise.
- Sources and extractors fail per item, never per run: one bad post or one 429 must not
  abort the batch. Record the failure as an `events` row and continue.
- No `any`. Use `unknown` and narrow with Zod. Biome errors on `any`.
- No `!` non-null assertions in new code (warn level); handle the null.

## Validation

- Every boundary validates with Zod: HTTP input (contract does it), LLM output
  (`evidenceSchema`), external API payloads (Reddit, RSS), env vars.
- Env vars are read once, in `apps/api/src/env.ts`, through a Zod schema. Nowhere else
  touches `process.env`.

## Async and side effects

- Pure functions where possible (`applyRules` is the model). Side effects live at the edges:
  DB, HTTP, LLM calls.
- Prefer explicit dependency passing over module-level singletons: `createPipeline({ db, extractor, notifier })`.
  This keeps everything testable without mocks of globals.
- No floating promises. `await` or explicitly `void` with a comment.

## Logging

- Fastify's pino logger, passed down as `logger` where needed. No `console.log` (Biome
  errors; `console.error` allowed only in scripts).
- Log structured objects, not string concatenation: `log.info({ sourceId, posts: n }, "source run done")`.
- Log at the edges (pipeline step boundaries, provider calls), not inside pure functions.

## Tests

- Vitest. Test files next to the code: `rules/index.ts` → `rules/rules.test.ts`.
- Pure functions get exhaustive unit tests. Adapters get tests with recorded fixtures
  (`src/test/fixtures/*.json`), never live network.
- DB code is tested against a real Postgres (see the `postgres-drizzle` skill), not mocks.

## Dependencies

- Adding a dependency requires a one-line justification in the PR/commit message.
- Prefer the platform: `fetch`, `URL`, `crypto.randomUUID()`, `AbortSignal.timeout()`
  over libraries.
- Check the "Approved libraries" list in `CLAUDE.md` first.

## Commit hygiene

- Run `pnpm lint && pnpm typecheck && pnpm test` before every commit. All three must pass.
- Small commits, one concern each. Conventional prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
