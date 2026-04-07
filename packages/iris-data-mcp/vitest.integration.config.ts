import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["src/__tests__/integration-setup.ts"],
    testTimeout: 30_000,
  },
});
