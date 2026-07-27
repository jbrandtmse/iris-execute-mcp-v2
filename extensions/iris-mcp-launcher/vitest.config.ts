import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The "vscode" runtime module exists only inside the VS Code extension
      // host. Alias it to the pinned fake (src/__tests__/vscodeMock.ts —
      // shapes pinned to @types/vscode@1.125.0, Rule #54) so activation-flow
      // tests can drive the REAL extension.ts wiring headlessly. Compile-time
      // types still come from @types/vscode; this alias is vitest-runtime only.
      vscode: fileURLToPath(new URL("./src/__tests__/vscodeMock.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
