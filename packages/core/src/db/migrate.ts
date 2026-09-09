import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Applies the committed migrations in packages/core/drizzle with drizzle-orm's migrator, so
// production needs neither drizzle-kit nor the TypeScript sources. The API exposes this as
// `node dist/migrate.js`, run as a deploy step before the API starts (never at boot, so a
// bad migration cannot take a running API down mid-rollout). Idempotent: drizzle records
// applied migrations in `drizzle.__drizzle_migrations`.

/** Absolute path of the migrations folder, valid from both src/ and dist/. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface MigrateResult {
  /** Migrations present in the folder (applied now or earlier). */
  total: number;
}

export async function runMigrations(databaseUrl: string): Promise<MigrateResult> {
  // The migrator's CREATE IF NOT EXISTS statements raise NOTICEs on every re-run; keep the deploy log to the summary line.
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR });
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from drizzle.__drizzle_migrations`;
    return { total: row?.count ?? 0 };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
