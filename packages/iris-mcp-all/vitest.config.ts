import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    // Clears the operator's startup variables before each test file is imported.
    setupFiles: ["../shared/src/__tests__/startup-env.setup.ts"],
    // This package's tests dynamically `import()` built dist output across
    // ALL FIVE server packages (tool-catalog.mjs / prompt-catalog.mjs) —
    // disk-I/O-bound work that is measurably marginal against vitest's
    // default 5000ms testTimeout under `pnpm turbo run test`'s concurrent
    // multi-package load (observed 4.2s-5.2s for the same assertion across
    // runs). Mirrors the testTimeout bump already used by every package's
    // `vitest.integration.config.ts` for comparable I/O-bound tests.
    testTimeout: 20_000,
    // The live gates bootstrap, write and remove fixtures on ONE shared IRIS instance, so no two test
    // files may run at the same time; epic38-gate-guards.test.ts proves this on a child run.
    fileParallelism: false,
    // Some tests run a child vitest and read its output as plain text. Under CI=true (GitHub Actions sets it) vitest colors that
    // output unless NO_COLOR is set; the tests, and the children they start from this environment, inherit the variable.
    env: { NO_COLOR: "1" },
  },
});
