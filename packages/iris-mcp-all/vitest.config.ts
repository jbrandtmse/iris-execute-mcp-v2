import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    // This package's tests dynamically `import()` built dist output across
    // ALL FIVE server packages (tool-catalog.mjs / prompt-catalog.mjs) —
    // disk-I/O-bound work that is measurably marginal against vitest's
    // default 5000ms testTimeout under `pnpm turbo run test`'s concurrent
    // multi-package load (observed 4.2s-5.2s for the same assertion across
    // runs). Mirrors the testTimeout bump already used by every package's
    // `vitest.integration.config.ts` for comparable I/O-bound tests.
    testTimeout: 20_000,
  },
});
