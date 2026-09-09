---
name: postgres-drizzle
description: How LeadSight uses PostgreSQL through Drizzle ORM — schema changes, migrations, queries, indexes, transactions, jsonb columns, cursor pagination, and testing against a real database. Load this for ANY task that touches the database: adding or changing a table or column, writing a query, adding an index, running or generating migrations, seeding data, fixing a slow query, or anything mentioning postgres, SQL, drizzle, migration, schema, table, or DATABASE_URL.
---

# Postgres + Drizzle

Schema lives in `packages/core/src/schema/`. Migrations in `packages/core/drizzle/`.
The DB client is created once in `apps/api/src/plugins/db.ts` and passed down.

## Schema changes — the only workflow

1. Edit `packages/core/src/schema/tables.ts` (business tables) or `auth.ts` (Better Auth
   tables). `relations.ts` holds `relations()`; `index.ts` is only the barrel — relations
   must import tables from their own module or the ESM cycle throws at load.
2. `pnpm db:generate` → creates `drizzle/NNNN_<name>.sql` + snapshot. Name it:
   `pnpm --filter @leadsight/core exec drizzle-kit generate --name add_lead_confidence`.
3. Open the generated SQL. Fix anything the diff got wrong (renames become drop+add —
   rewrite as `ALTER TABLE ... RENAME COLUMN`). Add data backfills as extra statements.
4. `pnpm db:migrate` locally, run tests, commit schema + migration together.
5. Never edit a migration that has been applied anywhere. Add a new one.
6. `drizzle-kit push` is for throwaway local experiments only. Never against shared DBs.

Custom SQL migration with no schema diff (backfill, extension, trigger):
`drizzle-kit generate --custom --name enable_pg_trgm`.

## Schema conventions

- `uuid` PKs with `defaultRandom()` for our tables; Better Auth tables use `text` ids (its choice, don't change).
- `organization_id text not null` on every business table. Always filter by it. There is
  no RLS; the API layer is the tenant boundary, so a query without `organizationId` in the
  `where` is a bug.
- Enums as `pgEnum` backed by the `as const` arrays in `types.ts`, so TS and DB agree.
  Adding an enum value = schema change + migration (`ALTER TYPE ... ADD VALUE`).
- `timestamp(..., { withTimezone: true })` always. Never naive timestamps.
- `jsonb` columns get a `$type<T>()` from `types.ts` and are validated with Zod on write.
  Never trust a jsonb value on read either when it came from an LLM: parse with the schema.
- `text[]` for simple string lists (`keywords`, `disqualifiers`). Use jsonb only for
  structured objects.
- Column and index names snake_case. Index name pattern: `<table>_<cols>_idx`, unique: `_uq`.
- Every FK has an explicit `onDelete`. Cascade for owned children (sources, leads, notes),
  `set null` for references (assignee).

## Indexes

Add an index when a query filters or sorts on it in a hot path. Current hot paths:

- Inbox: `(campaign_id, verdict, score desc)` — exists (`leads_inbox_idx`).
- Status board: `(campaign_id, status)` — exists.
- Dedupe on insert: `(organization_id, platform, external_id)` unique — exists.
- Few-shot fetch: `(campaign_id, created_at)` on labels — exists.
- Poller: `sources` where `enabled` and `last_run_at < now() - interval` — covered by
  `sources_campaign_idx`; add `(enabled, last_run_at)` if the sources table grows past ~1k.

Check a plan before adding more: `EXPLAIN (ANALYZE, BUFFERS) <query>`.

## Query patterns

```ts
// Read: relational query API for nested shapes
const lead = await db.query.leads.findFirst({
  where: and(eq(leads.id, id), eq(leads.organizationId, orgId)),
  with: { post: true, notes: { orderBy: asc(leadNotes.createdAt) } },
});

// Write with returning
const [row] = await db.insert(leads).values(values).returning();

// Upsert posts on the dedupe key
await db.insert(posts).values(batch).onConflictDoNothing({
  target: [posts.organizationId, posts.platform, posts.externalId],
});

// Transaction for multi-table writes (lead status → label)
await db.transaction(async (tx) => {
  await tx.update(leads).set({ status, updatedAt: new Date() }).where(eq(leads.id, id));
  if (label) await tx.insert(labels).values({ ... });
});
```

- Define `relations()` for anything you read with `with:`. Keep them in
  `schema/relations.ts` and export from the schema barrel.
- Batch inserts: chunk at 500 rows.
- Cursor pagination for the inbox, not offset. `db/cursor.ts` has `encodeCursor`,
  `decodeCursor(cursor, zodSchema)` (throws `ValidationError`) and `keysetAfter(parts)`,
  which builds the `(k1 > v1) OR (k1 = v1 AND k2 > v2) …` predicate. Rank sort keys on
  `(verdict, score, scoredAt, id)`, newest on `(scoredAt, id)`, confidence on
  `(confidence, scoredAt, id)`. `scoredAt` travels in the cursor as Postgres' own text
  form (`::text`) and comes back with `::timestamptz` — a JS `Date` truncates to
  milliseconds and would skip or repeat rows on ties.
- Raw `sql` template parameters bypass Drizzle's column mapping: pass a `Date` as
  `${d.toISOString()}::timestamptz`, never the Date object (postgres.js rejects it).
- Never build SQL strings. Use `sql` template only for things Drizzle can't express, and
  keep those in `packages/core/src/db/raw.ts` with a comment why.
- `jsonb` filtering: `sql\`${leads.evidence}->'disqualifier_hits' <> '[]'::jsonb\``. Add a
  GIN index only if such filters become hot.

## Query module (`packages/core/src/db/`)

One file per noun: `campaigns.ts`, `sources.ts`, `posts.ts`, `leads.ts` (list/detail/triage/
notes), `labels.ts`, `events.ts`, plus `client.ts` (`Db`, `Tx`, `DbLike`, `createDb`) and
`cursor.ts`. Barrel in `index.ts`, re-exported from the package root.

- Every function takes `(db: DbLike, orgId: string, …)` and filters by `organization_id`.
  `DbLike` is `Db | Tx`, so callers can compose functions inside `db.transaction`.
- Tables without an `organization_id` (`labels`, `lead_notes`, `post_sources`) are scoped by
  joining their parent (`campaigns`, `leads`, `sources`) on the org. Never expose them unscoped.
- The single exception is `findDueSourcesAllOrgs`: the scheduler is a system actor, not a
  request. It is named so nobody mistakes it for a request-scoped query, and the pipeline
  carries each source's own `organizationId` forward from there.
- Missing rows throw `NotFoundError(entity, id)`; bad input throws `ValidationError` after a
  Zod parse (`criteriaSchema`, `thresholdsSchema`, `sourceConfigSchema` — all in core's
  `types.ts`). The API maps both in one place. Functions return rows or joined row shapes,
  never wire shapes; mapping to the contract happens in `apps/api`.
- Writes return the row (`.returning()`); a missing row after `returning()` is a bug, so it
  throws a plain `Error`.
- `upsertLead` overwrites scoring fields on `(campaign_id, post_id)` conflict and leaves
  triage state (`status`, `assignee_id`) alone. `updateLead`/`bulkUpdateLeads` write the
  `labels` feedback row (won → positive, lost/not_fit → negative) inside the same
  transaction, replacing any earlier label for that (campaign, post).

## Connection

- `createDb(url, { max })` in `packages/core/src/db/client.ts` owns the postgres.js pool and
  the Drizzle instance (`drizzle(client, { schema })` so the relational API works). It
  returns `{ db, close }`; `apps/api/src/plugins/db.ts` calls it once and closes on
  `app.close()`. Nothing else constructs a pool.
- Migrations run as a deploy step, not at app boot, so a bad migration doesn't take the API
  down mid-rollout. Locally `pnpm db:migrate` (drizzle-kit). In production the API image runs
  `node dist/migrate.js` → core's `runMigrations(url)` (`db/migrate.ts`, drizzle-orm's
  migrator over `packages/core/drizzle`, no drizzle-kit needed); the compose `migrate`
  service does this before the API starts. `MIGRATIONS_DIR` there is also what the test
  template builder uses.

## Testing with a real database

- Integration tests use a real Postgres, never mocks. Locally: `docker compose up db`
  (see `docker-compose.yml`). CI: a Postgres service container. The connection role needs
  `CREATEDB` (the compose user is a superuser).
- **One database per test**, from `@leadsight/core/test` (`packages/core/src/test/db.ts`):
  `createTestDb()` returns `{ db, url, name, close }`; `withTestDb(fn)` wraps it. Each call
  runs `CREATE DATABASE … TEMPLATE leadsight_tpl_<hash>` where the template has the
  committed migrations applied. `close()` drops the database (`WITH (FORCE)`). Tests are
  parallel-safe across vitest workers and leave nothing behind except the template.
  - Why not schema-per-test: drizzle-kit qualifies enum types and FK targets with
    `"public"`, so a second schema collides on `CREATE TYPE`.
  - The template name hashes `drizzle/meta/_journal.json`; a new migration produces a new
    template automatically and stale ones are dropped. Creation is serialised with a
    Postgres advisory lock. Nothing ever needs a manual `db:migrate` before `pnpm test`.
  - Pattern: `beforeEach(async () => { t = await createTestDb() })` /
    `afterEach(() => t.close())`. For an app under test, pass `t.url` as `DATABASE_URL`
    and drop it in an `onClose` hook (see `apps/api/src/test/helpers.ts`).
- Option for CI speed later: PGlite (in-process Postgres) behind the same helpers. Not the
  default — real Postgres catches extension/plan differences PGlite hides.
- Seed helpers in `packages/core/src/test/seed.ts`: `seedUser`, `seedCampaign(db, overrides)`,
  `seedSource(db, campaign, overrides)`, `seedPost`, `seedLead(db, campaign, post, overrides)`
  (scored with the real rules). `TEST_ORG` / `TEST_USER` constants. Use them instead of
  hand-written inserts in tests. Fixtures (`fixtures.ts`) hold the two example campaigns'
  criteria and evidence — the only place offer-specific text is allowed.

## Local dev

```yaml
# docker-compose.yml (root)
services:
  db:
    image: postgres:17-alpine
    environment: { POSTGRES_USER: leadsight, POSTGRES_PASSWORD: leadsight, POSTGRES_DB: leadsight }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
volumes: { pgdata: {} }
```

`DATABASE_URL=postgres://leadsight:leadsight@localhost:5432/leadsight`

## Things to avoid

- `SELECT *` in hand-written SQL; select what the contract shape needs.
- N+1 via loops of `findFirst`. Use `with:` or `inArray`.
- Storing dates as strings. Storing money as float (not relevant yet, but still).
- Adding a column without a default to a table that has rows: migration fails.
- Long-running transactions around LLM calls. Extract first, then write.
