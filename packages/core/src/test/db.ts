import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb, type Db } from "../db/client.js";
import { MIGRATIONS_DIR } from "../db/migrate.js";

// One real Postgres database per test, cloned from a template that has the committed
// migrations applied. Schema-per-test is not an option: drizzle-kit qualifies enum types
// and FK targets with "public", so two schemas would collide on CREATE TYPE.
//
// The template is named after a hash of the migration journal, so a new migration
// produces a new template automatically; stale ones are dropped on the way.

export const DEFAULT_DATABASE_URL = "postgres://leadsight:leadsight@localhost:5432/leadsight";

const TEMPLATE_PREFIX = "leadsight_tpl_";
const TEST_PREFIX = "leadsight_test_";
/** Arbitrary constant; serialises template creation across vitest workers. */
const TEMPLATE_LOCK = 7_412_931;

export interface TestDb {
  db: Db;
  /** Connection string for this database — hand it to code that builds its own pool. */
  url: string;
  name: string;
  /** Closes the pool and drops the database. Always call it (afterEach/afterAll). */
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const template = await ensureTemplate();
  const name = `${TEST_PREFIX}${randomUUID().replaceAll("-", "")}`;

  await withAdmin(async (admin) => {
    await admin.unsafe(`create database "${name}" template "${template}"`);
  });

  const url = withDatabaseName(adminUrl(), name);
  const client = createDb(url, { max: 4 });

  return {
    db: client.db,
    url,
    name,
    close: async () => {
      await client.close();
      await withAdmin((admin) => admin.unsafe(`drop database if exists "${name}" with (force)`));
    },
  };
}

export async function withTestDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const test = await createTestDb();
  try {
    return await fn(test.db);
  } finally {
    await test.close();
  }
}

// ---------------------------------------------------------------------------

let templatePromise: Promise<string> | undefined;

function ensureTemplate(): Promise<string> {
  templatePromise ??= buildTemplate();
  return templatePromise;
}

async function buildTemplate(): Promise<string> {
  const journal = await readFile(join(MIGRATIONS_DIR, "meta", "_journal.json"));
  const name = `${TEMPLATE_PREFIX}${createHash("sha1").update(journal).digest("hex").slice(0, 12)}`;

  await withAdmin(async (admin) => {
    await admin`select pg_advisory_lock(${TEMPLATE_LOCK})`;
    try {
      const existing = await admin<{ datname: string }[]>`
        select datname from pg_database where datname like ${`${TEMPLATE_PREFIX}%`}
      `;
      if (existing.some((r) => r.datname === name)) return;

      // Migrations changed since the last template: drop the stale ones.
      for (const { datname } of existing) {
        await admin.unsafe(`drop database if exists "${datname}" with (force)`);
      }

      await admin.unsafe(`create database "${name}"`);
      const tpl = createDb(withDatabaseName(adminUrl(), name), { max: 1 });
      try {
        await migrate(tpl.db, { migrationsFolder: MIGRATIONS_DIR });
      } finally {
        await tpl.close(); // CREATE DATABASE … TEMPLATE requires no other connections
      }
    } finally {
      await admin`select pg_advisory_unlock(${TEMPLATE_LOCK})`;
    }
  });

  return name;
}

function adminUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

function withDatabaseName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function withAdmin<T>(fn: (admin: postgres.Sql) => Promise<T>): Promise<T> {
  const admin = postgres(adminUrl(), { max: 1 });
  try {
    return await fn(admin);
  } finally {
    await admin.end({ timeout: 5 });
  }
}
