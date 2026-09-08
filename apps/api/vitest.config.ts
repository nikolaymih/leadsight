import { defineConfig } from "vitest/config";

// Tests share one real Postgres (see the postgres-drizzle skill), so run files serially.
export default defineConfig({ test: { include: ["src/**/*.test.ts"], fileParallelism: false } });
