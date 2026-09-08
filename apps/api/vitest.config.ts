import { defineConfig } from "vitest/config";

// Every test file builds its app on its own database (see src/test/helpers.ts),
// so files run in parallel safely.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
