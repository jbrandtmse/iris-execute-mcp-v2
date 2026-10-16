import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/__tests__/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["src/**/*.integration.test.ts"],
    // Clears the operator's startup variables before each test file is imported.
    setupFiles: ["../shared/src/__tests__/startup-env.setup.ts"],
  },
});
