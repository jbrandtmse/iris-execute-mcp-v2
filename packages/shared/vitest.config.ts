import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    // Clears the operator's startup variables (LOG_LEVEL among them) before each
    // test file is imported, so the logger, which reads LOG_LEVEL once at import,
    // runs at its default level.
    setupFiles: ["src/__tests__/startup-env.setup.ts"],
  },
});
