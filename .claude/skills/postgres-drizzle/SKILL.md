---
name: postgres-drizzle
description: How LeadSight uses PostgreSQL through Drizzle ORM — schema changes, migrations, queries, indexes, transactions, jsonb columns, cursor pagination, and testing against a real database. Load this for ANY task that touches the database: adding or changing a table or column, writing a query, adding an index, running or generating migrations, seeding data, fixing a slow query, or anything mentioning postgres, SQL, drizzle, migration, schema, table, or DATABASE_URL.
---

# Postgres + Drizzle

Schema lives in `packages/core/src/schema/`. Migrations in `packages/core/drizzle/`.
The DB client is created once in `apps/api/src/plugins/db.ts` and passed down.

## Schema changes — the only workflow

1. Edit `packages/core/src/schema/index.ts` (or `auth.ts` for Better Auth tables).
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
- Cursor pagination for the inbox, not offset. Cursor = base64 of `(score, scoredAt, id)`
  for rank sort; `(scoredAt, id)` for newest. Encode/decode in one helper in core.
- Never build SQL strings. Use `sql` template only for things Drizzle can't express, and
  keep those in `packages/core/src/db/raw.ts` with a comment why.
- `jsonb` filtering: `sql\`${leads.evidence}->'disqualifier_hits' <> '[]'::jsonb\``. Add a
  GIN index only if such filters become hot.

## Connection

- `postgres` (postgres.js) driver, single pool created in `plugins/db.ts`:
  `postgres(env.DATABASE_URL, { max: 10, idle_timeout: 20 })`.
- `drizzle(client, { schema })` so the relational API works.
- Close on `app.close()`.
- Migrations run via `drizzle-kit migrate` in the deploy step, not at app boot, so a bad
  migration doesn't take the API down mid-rollout.

## Testing with a real database

- Integration tests use a real Postgres, never mocks. Locally: `docker compose up db`
  (see `docker-compose.yml`). CI: a Postgres service container.
- `packages/core/src/test/db.ts` exports `withTestDb(fn)`: creates a schema-per-test
  (`CREATE SCHEMA test_<uuid>`), sets `search_path`, runs migrations into it, runs `fn`,
  drops the schema. Tests are parallel-safe and leave nothing behind.
- Option for CI speed later: PGlite (in-process Postgres) behind the same `withTestDb`
  helper. Not the default — real Postgres catches extension/plan differences PGlite hides.
- Seed helpers in `packages/core/src/test/seed.ts`: `seedCampaign(db, overrides)`,
  `seedPost`, `seedLead`. Use them instead of hand-written inserts in tests.

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
