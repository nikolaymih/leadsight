import { runMigrations } from "@leadsight/core";

// Deploy step: `node dist/migrate.js`. Reads DATABASE_URL only; exits non-zero on failure so
// an orchestrator (compose `migrate` service, CI) stops before starting the new API.

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

try {
  const { total } = await runMigrations(url);
  console.error(`migrations up to date (${total} applied)`);
} catch (err) {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
