/**
 * Story 39.2 (AC-6; AD-26 scope; Rule #56) - the PHI data policy's scope, held against the BUILT tools of all
 * five servers.
 *
 *  - Every tool name of the suite (the five packages' tools plus the framework's `iris_server_profiles`) has
 *    exactly one classification row in `data-policy-scope.ts`, as of `DATA_POLICY_SCOPE_DATE`, and no row
 *    names a tool that does not exist.
 *  - The governed rows are exactly the tools that declare `ToolDefinition.dataPolicy`, with the same actions.
 *  - The `tool_support.md` table lists exactly the governed and the residual rows, each with the scope the
 *    code gives it.
 *
 * Cross-package, so it lives here (Rule #45) and runs in the default suite (Rule #21). It enumerates the
 * built dists, so it fails on a stale build only through the tool list it reads: rebuild first.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllToolNames, loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";
import { DATA_POLICY_SCOPE, DATA_POLICY_SCOPE_DATE, DATA_POLICY_SCOPE_ROWS } from "./data-policy-scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../../..");

interface BuiltTool {
  name: string;
  dataPolicy?: { actions?: readonly string[]; phiInputs?: readonly string[] };
}

/** The section of `tool_support.md` headed "PHI data policy scope (as of <date>)", up to the next rule. */
function scopeSection(): string {
  const text = readFileSync(resolve(root, "tool_support.md"), "utf8");
  const start = text.indexOf(`## PHI data policy scope (as of ${DATA_POLICY_SCOPE_DATE})`);
  expect(start, "tool_support.md has the PHI data policy scope section").toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n---\n", start);
  return text.slice(start, end === -1 ? undefined : end);
}

/** The rows of the section's table: tool name -> scope word. */
function tableRows(section: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of section.split("\n")) {
    const match = /^\|\s*`(iris_[a-z0-9_]+)`\s*\|\s*([A-Za-z ]+?)\s*\|/.exec(line);
    if (match) rows.set(match[1] as string, (match[2] as string).trim().toLowerCase());
  }
  return rows;
}

describe("the PHI data policy scope (Story 39.2, AC-6)", () => {
  it("names 2026-10-16 as the date the classification is exhaustive as of", () => {
    expect(DATA_POLICY_SCOPE_DATE).toBe("2026-10-16");
  });

  it("gives every tool name of the suite exactly one row, and no row names a tool that does not exist", async () => {
    const names = [...(await loadAllToolNames(root))].sort();
    expect(names.length, "the scan reads every server's tools (an empty scan would pass everything below)").toBeGreaterThan(100);
    const rowNames = DATA_POLICY_SCOPE_ROWS.map(([name]) => name);
    expect(rowNames.filter((name, index) => rowNames.indexOf(name) !== index), "no tool name has a second row").toEqual([]);
    expect([...rowNames].sort()).toEqual(names);
    expect(Object.keys(DATA_POLICY_SCOPE).sort()).toEqual(names);
  });

  it("gives every row a valid scope and a reason", () => {
    for (const [name, row] of Object.entries(DATA_POLICY_SCOPE)) {
      expect(["governed", "residual", "notApplicable"], name).toContain(row.scope);
      expect(row.reason.trim(), name).not.toBe("");
      if (row.scope !== "governed") expect(row.governedActions, name).toBeUndefined();
    }
  });

  it("the governed rows equal the tools that declare dataPolicy, with the same actions", async () => {
    const declared = ((await loadAllTools(root)) as Array<{ tool: BuiltTool }>)
      .filter(({ tool }) => tool.dataPolicy !== undefined)
      .map(({ tool }) => [tool.name, tool.dataPolicy?.actions] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    const governed = Object.entries(DATA_POLICY_SCOPE)
      .filter(([, row]) => row.scope === "governed")
      .map(([name, row]) => [name, row.governedActions] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    expect(declared.length, "a tool declares dataPolicy today").toBeGreaterThan(0);
    expect(governed).toEqual(declared);
    expect(governed).toEqual([["iris_message_resend", ["preview"]]]);
  });

  it("the tool_support.md table lists exactly the governed and the residual rows, each with its scope", () => {
    const rows = tableRows(scopeSection());
    const expected = new Map(
      Object.entries(DATA_POLICY_SCOPE)
        .filter(([, row]) => row.scope !== "notApplicable")
        .map(([name, row]) => [name, row.scope.toLowerCase()] as const),
    );
    expect([...rows.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [name, scope] of expected) expect(rows.get(name), name).toBe(scope);
  });

  it("the tool_support.md section states the rule for every other tool", () => {
    const section = scopeSection();
    expect(section).toContain("Every other tool");
    expect(section).toContain("not applicable");
    expect(section).toContain("returns no body or body-derived text");
  });
});
