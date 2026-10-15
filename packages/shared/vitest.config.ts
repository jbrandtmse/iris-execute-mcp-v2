import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    // The logger reads LOG_LEVEL once at import. Pin its documented default so
    // tests that assert on log lines do not depend on the runner's environment.
    env: { LOG_LEVEL: "DEBUG" },
  },
});
