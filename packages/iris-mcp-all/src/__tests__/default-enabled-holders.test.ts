/**
 * Story 38.4 (AC-6, AD-4) - the closed lists of governance exceptions, held against every built tool.
 *
 * Two governance levers let a new key leave its default seed, and AD-4 names the only holders of each:
 *
 *  - `defaultEnabled`: a truthful write that ships ENABLED. The holder list is closed:
 *    `iris_production_control:clean` (F2) and `iris_doc_edit:apply` (S-3, Story 38.4). Adding a holder takes
 *    a recorded Project Lead decision, so a new holder turns this test red.
 *  - `parent`: a new key that re-exposes an existing key's capability inherits an explicit disable of it.
 *    Story 38.4 declares `iris_doc_edit` with the parent `iris_doc_put`; Story 38.5 will add `iris_sql_query`
 *    with the parent `iris_sql_execute` and update the expected map here.
 *
 * The check enumerates the BUILT dist of every `SERVER_PACKAGES` server through the same loader the other
 * cross-package tests use, and derives keys with the one `deriveKeysForTool` the gate and the baseline
 * generator use (Rule #45: a check that spans packages lives in `@iris-mcp/all`). Default suite (Rule #21).
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../../..");
const sharedDist = resolve(root, "packages/shared/dist");

interface BuiltTool {
  name: string;
  inputSchema: unknown;
  mutates?: "read" | "write" | Record<string, "read" | "write">;
  defaultEnabled?: string[];
  parent?: string;
}

async function loadSurface(): Promise<Array<{ pkg: string; tool: BuiltTool }>> {
  const allTools = (await loadAllTools(root)) as Array<{ pkg: string; tool: BuiltTool }>;
  expect(allTools.length, "the scan reads every server's tools (an empty scan would pass everything below)").toBeGreaterThan(100);
  return allTools;
}

describe("the closed lists of governance exceptions (Story 38.4, AD-4)", () => {
  it("the defaultEnabled holders are exactly iris_doc_edit:apply and iris_production_control:clean", async () => {
    const holders = (await loadSurface())
      .flatMap(({ tool }) => (tool.defaultEnabled ?? []).map((action) => `${tool.name}:${action}`))
      .sort();

    expect(holders).toEqual(["iris_doc_edit:apply", "iris_production_control:clean"]);
  });

  it("every defaultEnabled holder is a truthful write", async () => {
    for (const { tool } of await loadSurface()) {
      for (const action of tool.defaultEnabled ?? []) {
        const classification = typeof tool.mutates === "object" ? tool.mutates[action] : undefined;
        expect(classification, `${tool.name}:${action} must be declared a write`).toBe("write");
      }
    }
  });

  it("the parent declarations are exactly iris_doc_edit -> iris_doc_put and iris_sql_query -> iris_sql_execute (Story 38.5)", async () => {
    const declared = Object.fromEntries(
      (await loadSurface()).flatMap(({ tool }) => (tool.parent === undefined ? [] : [[tool.name, tool.parent]])),
    );

    expect(declared).toEqual({ iris_doc_edit: "iris_doc_put", iris_sql_query: "iris_sql_execute" });
  });

  it("every parent is a key of the frozen baseline, and no child key is", async () => {
    const { deriveKeysForTool } = await import(pathToFileURL(resolve(sharedDist, "governance-baseline-derivation.js")).href);
    const { GOVERNANCE_BASELINE } = await import(pathToFileURL(resolve(sharedDist, "governance-baseline.js")).href);

    for (const { pkg, tool } of await loadSurface()) {
      if (tool.parent === undefined) continue;
      expect(GOVERNANCE_BASELINE.has(tool.parent), `${tool.name}'s parent ${tool.parent} is a frozen-baseline key`).toBe(true);
      for (const key of deriveKeysForTool(tool, pkg) as string[]) {
        expect(GOVERNANCE_BASELINE.has(key), `${key} is not a frozen-baseline key`).toBe(false);
      }
    }
  });

  it("iris_doc_edit derives exactly iris_doc_edit:apply and iris_doc_edit:regenerateStorage, a read-free action enum", async () => {
    const { deriveKeysForTool } = await import(pathToFileURL(resolve(sharedDist, "governance-baseline-derivation.js")).href);
    const entry = (await loadSurface()).find(({ pkg, tool }) => pkg === "iris-dev-mcp" && tool.name === "iris_doc_edit");
    expect(entry, "iris_doc_edit is registered in the built @iris-mcp/dev tool array").toBeDefined();
    const docEdit = (entry as { pkg: string; tool: BuiltTool }).tool;

    expect(deriveKeysForTool(docEdit, "iris-dev-mcp")).toEqual(["iris_doc_edit:apply", "iris_doc_edit:regenerateStorage"]);
    expect(docEdit.mutates).toEqual({ apply: "write", regenerateStorage: "write" });
    expect(docEdit.defaultEnabled).toEqual(["apply"]);
  });

  it("iris_doc_put keeps its frozen bare key and declares no action enum or parent", async () => {
    const { deriveKeysForTool } = await import(pathToFileURL(resolve(sharedDist, "governance-baseline-derivation.js")).href);
    const { GOVERNANCE_BASELINE } = await import(pathToFileURL(resolve(sharedDist, "governance-baseline.js")).href);
    const entry = (await loadSurface()).find(({ pkg, tool }) => pkg === "iris-dev-mcp" && tool.name === "iris_doc_put");
    const docPut = (entry as { pkg: string; tool: BuiltTool }).tool;

    expect(deriveKeysForTool(docPut, "iris-dev-mcp")).toEqual(["iris_doc_put"]);
    expect(GOVERNANCE_BASELINE.has("iris_doc_put")).toBe(true);
    expect(docPut.parent).toBeUndefined();
    expect(docPut.mutates).toBeUndefined();
  });
});
