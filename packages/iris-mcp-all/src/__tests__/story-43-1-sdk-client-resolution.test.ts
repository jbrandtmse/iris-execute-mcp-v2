/**
 * Story 43.1 (AC 43.1.4; Rule #59) - the MCP client that every SDK-client gate in this package loads.
 *
 * The gates reach `@modelcontextprotocol/client` through the pnpm store (`resolveSdkEsmDir`), because this package declares it as a
 * devDependency only and the gates import its ESM files by path. A gate that cannot find the client skips with a reason; this file
 * is the check that the client IS found, so a missing or moved client is red here instead of silently skipping every gate.
 * Nothing in it skips.
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./pack-fixture";
import { resolveSdkEsmDir } from "./process-gate-helpers.js";

describe("the MCP client the SDK-client gates load (Story 43.1)", () => {
  it("resolveSdkEsmDir finds the ESM build of @modelcontextprotocol/client in the pnpm store", () => {
    const esmDir = resolveSdkEsmDir(REPO_ROOT);
    expect(esmDir, "a pnpm store directory of @modelcontextprotocol/client holding index.mjs and stdio.mjs").toBeDefined();
    expect(path.relative(path.join(REPO_ROOT, "node_modules", ".pnpm"), esmDir as string).startsWith(`@modelcontextprotocol+client@`)).toBe(true);
    expect(existsSync(path.join(esmDir as string, "index.mjs"))).toBe(true);
    expect(existsSync(path.join(esmDir as string, "stdio.mjs"))).toBe(true);
  });

  it("index.mjs exports Client and InMemoryTransport, and stdio.mjs exports StdioClientTransport", async () => {
    const esmDir = resolveSdkEsmDir(REPO_ROOT);
    expect(esmDir, "the client resolves").toBeDefined();
    const index = (await import(pathToFileURL(path.join(esmDir as string, "index.mjs")).href)) as Record<string, unknown>;
    const stdio = (await import(pathToFileURL(path.join(esmDir as string, "stdio.mjs")).href)) as Record<string, unknown>;
    expect(typeof index.Client).toBe("function");
    expect(typeof (index.InMemoryTransport as { createLinkedPair?: unknown } | undefined)?.createLinkedPair).toBe("function");
    expect(typeof stdio.StdioClientTransport).toBe("function");
  });
});
