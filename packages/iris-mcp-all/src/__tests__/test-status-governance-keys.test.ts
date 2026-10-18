/**
 * Story 36.2 code review — AC 36.2.1's governance key-derivation check (E-1/E-2).
 *
 * Drives the SAME `deriveKeysForTool` derivation the enforcement gate and the
 * frozen-baseline generator use (`packages/shared/src/governance-baseline-
 * derivation.ts`, CR 16.0-1) over the BUILT dev tool surface, so it checks
 * what actually ships:
 *  - `iris_test_status` derives exactly `iris_test_status:poll` and
 *    `iris_test_status:cancel`, classified `read` / `write` by `mutates`, and
 *    NEITHER key is in the frozen Epic-14 baseline (new keys are governed by
 *    `mutates`, never absorbed into the baseline — Rule #23);
 *  - `iris_execute_tests` still derives its bare, frozen key (no `action` enum
 *    was added to it — constraint E-1; architecture decision L1) and that key
 *    is still a baseline member (E-2).
 *
 * Cross-package by construction (shared's derivation + dev's built tools), so
 * it lives in `@iris-mcp/all` (Rule #45), enumerating via `loadAllTools` like
 * `readonly-hint-crosscheck.test.ts`. Default suite (Rule #21).
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../../..");
const sharedDist = resolve(root, "packages/shared/dist");

describe("Story 36.2 AC 36.2.1 — iris_test_status / iris_execute_tests governance keys (E-1/E-2)", () => {
  it("derives iris_test_status:poll (read) + :cancel (write), both post-foundation, and leaves iris_execute_tests' frozen bare key untouched", async () => {
    const { deriveKeysForTool } = await import(
      pathToFileURL(resolve(sharedDist, "governance-baseline-derivation.js")).href
    );
    const { GOVERNANCE_BASELINE } = await import(pathToFileURL(resolve(sharedDist, "governance-baseline.js")).href);

    const allTools = await loadAllTools(root);
    const devTool = (name: string) => {
      const entry = allTools.find(({ pkg, tool }) => pkg === "iris-dev-mcp" && tool.name === name);
      expect(entry, `${name} is not registered in the built @iris-mcp/dev tool array`).toBeDefined();
      return entry!.tool as { name: string; inputSchema: unknown; mutates?: unknown; defaultEnabled?: unknown };
    };

    const testStatus = devTool("iris_test_status");
    expect(deriveKeysForTool(testStatus, "iris-dev-mcp")).toEqual(["iris_test_status:poll", "iris_test_status:cancel"]);
    expect(testStatus.mutates).toEqual({ poll: "read", cancel: "write" });
    expect(testStatus.defaultEnabled).toBeUndefined();
    expect(GOVERNANCE_BASELINE.has("iris_test_status:poll")).toBe(false);
    expect(GOVERNANCE_BASELINE.has("iris_test_status:cancel")).toBe(false);

    const executeTests = devTool("iris_execute_tests");
    expect(deriveKeysForTool(executeTests, "iris-dev-mcp")).toEqual(["iris_execute_tests"]);
    expect(GOVERNANCE_BASELINE.has("iris_execute_tests")).toBe(true);
  });
});

describe("Story 40.1 AC-6 - iris_test_coverage governance key and annotations", () => {
  it("derives the one key iris_test_coverage, classified write, with no defaultEnabled marker, outside the frozen baseline", async () => {
    const { deriveKeysForTool } = await import(
      pathToFileURL(resolve(sharedDist, "governance-baseline-derivation.js")).href
    );
    const { GOVERNANCE_BASELINE } = await import(pathToFileURL(resolve(sharedDist, "governance-baseline.js")).href);

    const allTools = await loadAllTools(root);
    const entry = allTools.find(({ pkg, tool }) => pkg === "iris-dev-mcp" && tool.name === "iris_test_coverage");
    expect(entry, "iris_test_coverage is not registered in the built @iris-mcp/dev tool array").toBeDefined();
    const coverage = entry!.tool as {
      name: string;
      inputSchema: unknown;
      mutates?: unknown;
      defaultEnabled?: unknown;
      parent?: unknown;
      annotations?: unknown;
    };

    expect(deriveKeysForTool(coverage, "iris-dev-mcp")).toEqual(["iris_test_coverage"]);
    expect(coverage.mutates).toBe("write");
    expect(coverage.defaultEnabled).toBeUndefined();
    expect(coverage.parent).toBeUndefined();
    expect(GOVERNANCE_BASELINE.has("iris_test_coverage")).toBe(false);
    expect(coverage.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("leaves the keys of iris_test_status and the frozen iris_execute_tests unchanged by the coverageRunId parameter", async () => {
    const { deriveKeysForTool } = await import(
      pathToFileURL(resolve(sharedDist, "governance-baseline-derivation.js")).href
    );
    const allTools = await loadAllTools(root);
    const status = allTools.find(({ pkg, tool }) => pkg === "iris-dev-mcp" && tool.name === "iris_test_status")!.tool as {
      name: string;
      inputSchema: unknown;
      mutates?: unknown;
    };
    expect(deriveKeysForTool(status, "iris-dev-mcp")).toEqual(["iris_test_status:poll", "iris_test_status:cancel"]);
    expect(status.mutates).toEqual({ poll: "read", cancel: "write" });
    const tests = allTools.find(({ pkg, tool }) => pkg === "iris-dev-mcp" && tool.name === "iris_execute_tests")!.tool as {
      name: string;
      inputSchema: unknown;
      annotations?: unknown;
    };
    expect(deriveKeysForTool(tests, "iris-dev-mcp")).toEqual(["iris_execute_tests"]);
    expect(tests.annotations, "iris_execute_tests keeps its annotations (DW-498 is Story 40.4's)").toMatchObject({ readOnlyHint: true });
  });
});
