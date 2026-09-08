import { defineConfig } from "vitest/config";

// Component tests for pure UI (badges, breakdowns, formatters). Screens are covered by the
// Playwright smoke test in e2e/.
export default defineConfig({
  test: { include: ["src/**/*.test.{ts,tsx}"], environment: "jsdom", globals: true },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  esbuild: { jsx: "automatic" },
});
