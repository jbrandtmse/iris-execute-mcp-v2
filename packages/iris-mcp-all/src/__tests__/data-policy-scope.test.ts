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
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAllToolNames, loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";
import { DATA_POLICY_SCOPE, DATA_POLICY_SCOPE_DATE, DATA_POLICY_SCOPE_ROWS } from "./data-policy-scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../../..");
const sharedDist = resolve(root, "packages/shared/dist");

interface BuiltTool {
  name: string;
  dataPolicy?: { actions?: readonly string[]; phiInputs?: readonly string[] };
}

/** The declaration `DATA_POLICY_BLOCK_KEYS`, from the BUILT shared package (the declaration site, not a copy). */
async function declaredBlockKeys(): Promise<string[]> {
  const shared = (await import(pathToFileURL(resolve(sharedDist, "index.js")).href)) as {
    DATA_POLICY_BLOCK_KEYS: readonly string[];
    DATA_POLICY_BLOCK_KEYS_AS_OF: string;
  };
  expect(shared.DATA_POLICY_BLOCK_KEYS_AS_OF, "the declaration and the scope table are as of the same date").toBe(DATA_POLICY_SCOPE_DATE);
  return [...shared.DATA_POLICY_BLOCK_KEYS];
}

/** The keys a scope row's `off` verdict covers: `name:action` for each named action, else the bare name. */
function offKeys(): string[] {
  return Object.entries(DATA_POLICY_SCOPE)
    .filter(([, row]) => row.scope === "residual" && row.block === "off")
    .flatMap(([name, row]) => (row.blockActions === undefined ? [name] : row.blockActions.map((action) => `${name}:${action}`)));
}

/** The README's "What `block` turns off" paragraph, up to its blank line. */
function readmeBlockParagraph(): string {
  const text = readFileSync(resolve(root, "README.md"), "utf8");
  const start = text.indexOf("**What `block` turns off.**");
  expect(start, "the README has the 'What `block` turns off' paragraph").toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n\n", start);
  return text.slice(start, end === -1 ? undefined : end);
}

/** The "Under `block`" cell of each row of the section's table: tool name -> `off`, `off (get)`, `on` or `—`. */
function blockColumn(section: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of section.split("\n")) {
    const match = /^\|\s*`(iris_[a-z0-9_]+)`\s*\|\s*[A-Za-z ]+?\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (match) rows.set(match[1] as string, match[2] as string);
  }
  return rows;
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
  it("names 2026-11-25 as the date the classification is exhaustive as of (Story 45.4 moved it from 2026-10-17)", () => {
    expect(DATA_POLICY_SCOPE_DATE).toBe("2026-11-25");
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
    expect(governed).toEqual([
      ["iris_message_body", undefined],
      ["iris_message_diagram", undefined],
      ["iris_message_resend", ["preview"]],
      ["iris_message_search", ["body", "searchTable"]],
      ["iris_production_logs", undefined],
    ]);
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

describe("what block turns off (Story 45.4, AC 45.4.1; decision #169; Rules #44 and #56)", () => {
  it("moved iris_global_list and iris_locks_list from not applicable to residual", () => {
    expect(DATA_POLICY_SCOPE["iris_global_list"]?.scope).toBe("residual");
    expect(DATA_POLICY_SCOPE["iris_locks_list"]?.scope).toBe("residual");
  });

  it("gives every residual row a block verdict, and no other row one", () => {
    for (const [name, row] of Object.entries(DATA_POLICY_SCOPE)) {
      if (row.scope === "residual") {
        expect(["off", "on"], `${name} has a block verdict`).toContain(row.block);
        if (row.block === "on") expect(row.blockActions, `${name}: an on row names no actions`).toBeUndefined();
      } else {
        expect(row.block, `${name} is not residual, so it has no verdict`).toBeUndefined();
        expect(row.blockActions, name).toBeUndefined();
      }
    }
  });

  it("the off rows, with their actions, are exactly DATA_POLICY_BLOCK_KEYS: the same 11 keys", async () => {
    const declared = await declaredBlockKeys();
    expect(declared).toHaveLength(11);
    expect(offKeys().sort()).toEqual([...declared].sort());
  });

  it("every covered key exists on exactly one built server, and belongs to no governed or not-applicable tool", async () => {
    const declared = await declaredBlockKeys();
    const { deriveKeysForTool } = await import(pathToFileURL(resolve(sharedDist, "governance-baseline-derivation.js")).href);
    const owners = new Map<string, string[]>();
    const toolOfKey = new Map<string, string>();
    for (const { pkg, tool } of (await loadAllTools(root)) as Array<{ pkg: string; tool: BuiltTool }>) {
      for (const key of deriveKeysForTool(tool, pkg) as string[]) {
        owners.set(key, [...(owners.get(key) ?? []), pkg]);
        toolOfKey.set(key, tool.name);
      }
    }
    for (const key of declared) {
      expect(owners.get(key), `${key} is a key of exactly one built server`).toHaveLength(1);
      const row = DATA_POLICY_SCOPE[toolOfKey.get(key) as string];
      expect(row?.scope, `${key}'s tool is a residual row`).toBe("residual");
    }
  });

  it("the tool_support.md 'Under block' column equals the verdicts (off, off (get), on, and a dash for governed rows)", () => {
    const column = blockColumn(scopeSection());
    const expected = new Map<string, string>();
    for (const [name, row] of Object.entries(DATA_POLICY_SCOPE)) {
      if (row.scope === "governed") expected.set(name, "—");
      else if (row.scope === "residual") expected.set(name, row.block === "off" && row.blockActions !== undefined ? `off (${row.blockActions.join(", ")})` : (row.block as string));
    }
    expect([...column.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [name, verdict] of expected) expect(column.get(name), name).toBe(verdict);
  });

  it("the README's 'What block turns off' paragraph lists exactly the declared keys, in the declaration's order", async () => {
    const declared = await declaredBlockKeys();
    const listed = [...readmeBlockParagraph().matchAll(/`(iris_[a-z0-9_]+(?::[A-Za-z]+)?)`/g)].map((match) => match[1] as string);
    expect(listed).toEqual(declared);
  });
});
