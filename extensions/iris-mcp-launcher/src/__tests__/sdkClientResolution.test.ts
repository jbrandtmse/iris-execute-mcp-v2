/**
 * Story 43.1 (AC 43.1.4; Rule #59) - the MCP client that this extension's two SDK-client tests load.
 *
 * `localSpawnIntegration.test.ts` and `governanceUiRoundTrip.test.ts` reach `@modelcontextprotocol/client` through the monorepo's pnpm
 * store, because the extension declares no dependency on it, and each SKIPS with a logged reason when the client is missing. A skip reads
 * the same as "IRIS is not running", so this file is the check that the client IS found: it does not skip, and a missing or moved
 * client is red here. The extension is outside the workspace and cannot import the iris-mcp-all test helper that does the same, so the
 * lookup is written out here as it is in those two tests.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// src/__tests__ -> repo root is four levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The `dist/` of the `@modelcontextprotocol/client` package in the monorepo's pnpm store, iterated to exhaustion, or `undefined`. */
function resolveSdkEsmDir(): string | undefined {
  const pnpmDir = path.join(REPO_ROOT, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return undefined;
  const candidates = readdirSync(pnpmDir)
    .filter((name) => name.startsWith("@modelcontextprotocol+client@"))
    .sort();
  for (const candidate of candidates) {
    const esmDir = path.join(pnpmDir, candidate, "node_modules", "@modelcontextprotocol", "client", "dist");
    if (existsSync(path.join(esmDir, "index.mjs")) && existsSync(path.join(esmDir, "stdio.mjs"))) return esmDir;
  }
  return undefined;
}

describe("the MCP client the launcher's SDK-client tests load (Story 43.1)", () => {
  it("the monorepo's pnpm store holds the ESM build of @modelcontextprotocol/client", () => {
    const esmDir = resolveSdkEsmDir();
    expect(esmDir, "a pnpm store directory of @modelcontextprotocol/client holding index.mjs and stdio.mjs").toBeDefined();
    expect(path.relative(path.join(REPO_ROOT, "node_modules", ".pnpm"), esmDir as string).startsWith("@modelcontextprotocol+client@")).toBe(true);
  });

  it("index.mjs exports Client and InMemoryTransport, and stdio.mjs exports StdioClientTransport", async () => {
    const esmDir = resolveSdkEsmDir();
    expect(esmDir, "the client resolves").toBeDefined();
    const index = (await import(pathToFileURL(path.join(esmDir as string, "index.mjs")).href)) as Record<string, unknown>;
    const stdio = (await import(pathToFileURL(path.join(esmDir as string, "stdio.mjs")).href)) as Record<string, unknown>;
    expect(typeof index.Client).toBe("function");
    expect(typeof (index.InMemoryTransport as { createLinkedPair?: unknown } | undefined)?.createLinkedPair).toBe("function");
    expect(typeof stdio.StdioClientTransport).toBe("function");
  });
});
