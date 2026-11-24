/**
 * Story 44.1 (DW-688; project rules #30 and #43) - the documents say what `iris_docdb_manage create` now does.
 *
 * `story-43-4-qa-sanctioned-wire.test.ts` and `story-43-4-sanctioned-golden-changes.test.ts` pin the description sentence and the ledger
 * entry; `docdb-register.test.ts` pins the behavior. None of them reads a document. This file reads them, one claim each (AC 44.1.5):
 *  - the data README's prerequisites name the `Security.DocDBs` record, the missing Resource, the ExecuteMCPv2 dependency and the repair of
 *    a `1.1.0` database; its tool row, the `create` Output block, the multi-API note and the `#822` troubleshooting row say the same;
 *  - `tool_support.md` row 1 names the `/security/docdb` route, and its notes give the default state, which is derived here from the frozen
 *    baseline (`iris_docdb_manage:create` is a write key and a member of the frozen set), and the claim that no new tool or action key
 *    exists, which is derived here from the built tool (its `action` enum and its input fields are unchanged);
 *  - the CHANGELOG's top section is `[Unreleased]`, names the sanction id, DW-688 and the result fields;
 *  - the changeset is a patch bump of `@iris-mcp/data` and `@iris-mcp/shared` and nothing else.
 * Needs no IRIS. The built dist is read for the tool-shape check; a stale dist fails the gate tests that own it.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";
import { pathToFileURL } from "node:url";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

function lineStarting(text: string, prefix: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
  expect(line, `a line starting ${prefix}`).toBeDefined();
  return line as string;
}

const dataReadme = read("packages/iris-data-mcp/README.md");
const toolSupport = read("tool_support.md");
const changelog = read("CHANGELOG.md");
const changesetPath = ".changeset/story-44-1-docdb-create-registers-the-database.md";

describe("Story 44.1: the data README", () => {
  it("the prerequisites name the record, the missing Resource, the ExecuteMCPv2 dependency, the privilege and the 1.1.0 repair", () => {
    const paragraph = squash(lineStarting(dataReadme, "Every DocDB database also needs a `Security.DocDBs` record"));
    for (const needle of [
      "`ERROR #822: Access Denied` even with the service enabled",
      "`POST /api/executemcp/v2/security/docdb`",
      "`$$Create^%SYS.DOCDB`",
      "The record has no Resource",
      "`%DocDB_Admin` (or `%Admin_Secure`)",
      "needs the ExecuteMCPv2 REST service deployed",
      "A database made by `1.1.0` or earlier has no record",
      "`drop` fails too",
      "run `create` with the same name",
      'returns the usual "already defined" error, unchanged',
    ]) {
      expect(paragraph, needle).toContain(needle);
    }
  });

  it("the tool row keeps its columns, and says that create registers the record and repairs a database without one", () => {
    const row = squash(lineStarting(dataReadme, "| `iris_docdb_manage` |"));
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    expect(cells).toHaveLength(4);
    expect(cells[0]).toBe("`iris_docdb_manage`");
    expect(cells[1]).toContain("`create` also registers the database's `Security.DocDBs` record");
    expect(cells[1]).toContain("repairs a database that has none");
    expect(cells[2]).toBe("`action`, `database?`, `namespace?`");
    expect(cells[3]).toBe("destructive");
  });

  it("the create example shows registered:true, and the repair and failure results are described with their field names", () => {
    const section = /<summary><strong>iris_docdb_manage<\/strong> -- Create a document database<\/summary>[\s\S]*?<\/details>/.exec(dataReadme)?.[0] ?? "";
    expect(section, "the create details block").not.toBe("");
    const text = squash(section);
    expect(text).toContain('"registered": true');
    expect(text).toContain('{"database": "Customers", "namespace": "USER", "created": false, "registered": true}');
    expect(text).toContain("whether the database was created");
    expect(text).toContain("the two fixes");
  });

  it("the multi-API note names create as the one DocDB action that calls the ExecuteMCPv2 service, and the 822 row sits beside the service-disabled row", () => {
    const note = squash(lineStarting(dataReadme, "`iris_docdb_manage` `create` is the one DocDB action that also calls"));
    expect(note).toContain("`POST /api/executemcp/v2/security/docdb`");
    expect(note).toContain("`GET /api/executemcp/v2/security/docdb`");

    const rows = dataReadme.split("\n").filter((line) => line.startsWith("| `ERROR #822: Access Denied`"));
    expect(rows).toHaveLength(2);
    expect(rows[0], "the service-disabled row stays first").toContain("`%Service_DocDB` not enabled");
    const record = squash(rows[1] as string);
    expect(record.split("|").slice(1, -1)).toHaveLength(3);
    expect(record).toContain("with `%Service_DocDB` enabled");
    expect(record).toContain("no `Security.DocDBs` record");
    expect(record).toContain("or the caller lacks `%DocDB_Admin`");
    expect(record).toContain("Run `iris_docdb_manage` `create` with the same database name");
    expect(record).toContain("Doc DB Applications");
  });
});

describe("Story 44.1: tool_support.md", () => {
  it("row 1 names the DocDB API and the ExecuteMCPv2 route, and keeps the other three DocDB rows unchanged", () => {
    const row = squash(lineStarting(toolSupport, "| 1 | `iris_docdb_manage` |"));
    expect(row).toContain("🟩 **DocDB** + 🟥 ExecuteMCPv2");
    expect(row).toContain("`/api/docdb/v1/{ns}` + `/db/{db}`");
    expect(row).toContain("`/security/docdb` (`create` registers the database's `Security.DocDBs` record)");
    for (const [prefix, cell] of [
      ["| 2 | `iris_docdb_document` |", "🟩 **DocDB** | `/api/docdb/v1/{ns}/doc/{db}` |"],
      ["| 3 | `iris_docdb_find` |", "🟩 **DocDB** | `/api/docdb/v1/{ns}/find/{db}` |"],
      ["| 4 | `iris_docdb_property` |", "🟩 **DocDB** | `/api/docdb/v1/{ns}/prop/{db}/{prop}` |"],
    ] as const) {
      expect(squash(lineStarting(toolSupport, prefix)), prefix).toContain(cell);
    }
  });

  it("the note says create is enabled by default; the baseline says iris_docdb_manage:create is a frozen write key", async () => {
    const note = squash(lineStarting(toolSupport, "> The four DocDB tools require the `%Service_DocDB` service"));
    expect(note).toContain("`iris_docdb_manage` `create` registers it (no Resource) through the ExecuteMCPv2 service");
    expect(note).toContain("also repairs a database made by `1.1.0` or earlier");
    expect(note).toContain("a write in the frozen governance baseline");
    expect(note).toContain("**enabled by default**, as before");
    expect(note).toContain("blocked when that key is disabled");
    expect(note).toContain("No new tool or action key exists.");
    // The oracle for "a write in the frozen governance baseline" and "enabled by default" is the frozen set itself (Rule #30: mechanical).
    const sharedDist = path.join(REPO_ROOT, "packages", "shared", "dist");
    const { GOVERNANCE_BASELINE } = await import(pathToFileURL(path.join(sharedDist, "governance-baseline.js")).href);
    const { BASELINE_ACTION_CLASSIFICATIONS } = await import(pathToFileURL(path.join(sharedDist, "baseline-classifications.js")).href);
    expect(BASELINE_ACTION_CLASSIFICATIONS["iris_docdb_manage:create"]).toBe("write");
    expect(GOVERNANCE_BASELINE.has("iris_docdb_manage:create")).toBe(true);
  });

  it("the multi-API paragraph carves create out of 'independently of your custom REST deployment'", () => {
    const paragraph = squash(lineStarting(toolSupport, "If DocDB or the Management API aren't enabled"));
    expect(paragraph).toContain("**independently of your custom REST deployment**, except that `iris_docdb_manage` `create` also needs the ExecuteMCPv2 service");
    expect(paragraph).toContain("to register the database's `Security.DocDBs` record");
  });
});

describe("Story 44.1: the built tool matches the documented 'no new action, no new field'", () => {
  it("iris_docdb_manage keeps the actions list, create and drop, and the three input fields", async () => {
    const all = (await loadAllTools(REPO_ROOT)) as Array<{
      tool: { name: string; inputSchema: { shape: Record<string, { options?: string[] }> } };
    }>;
    const entry = all.find(({ tool }) => tool.name === "iris_docdb_manage");
    expect(entry, "iris_docdb_manage is in the catalog").toBeDefined();
    const shape = entry?.tool.inputSchema.shape ?? {};
    expect(Object.keys(shape).sort()).toEqual(["action", "database", "namespace"]);
    expect([...(shape["action"]?.options ?? [])].sort()).toEqual(["create", "drop", "list"]);
  });
});

describe("Story 44.1: the CHANGELOG entry", () => {
  // Found by its title, not its position: a later story's [Unreleased] section may sit above it, and the release relabels it.
  const firstSection = /^## \[[^\]\n]*\] — Story 44\.1: DocDB Create Registers the Database\n[\s\S]*?(?=\n## \[)/m.exec(changelog)?.[0] ?? "";

  it("is a section above the 1.1.0 release's, headed [Unreleased] until a release relabels it, with a Fixed block", () => {
    expect(firstSection, "the Story 44.1 section").not.toBe("");
    expect(changelog.indexOf(firstSection)).toBeLessThan(changelog.indexOf("\n## [1.1.0] — "));
    expect(firstSection).toContain("### Fixed");
  });

  it("names DW-688, the sanction id, the route pair, the result fields, the repair and the two items it does not fix", () => {
    const text = squash(firstSection);
    for (const needle of [
      "DW-688",
      "`S-44.1-docdb-manage-text`",
      "`POST /api/executemcp/v2/security/docdb`",
      "`GET /api/executemcp/v2/security/docdb`",
      "`registered: true`",
      "`{database, namespace, created: false, registered: true}`",
      "(one made by `1.1.0` or earlier, which also could not be dropped)",
      "no Resource",
      "the disabled-service message is unchanged",
      "append-only",
      "`list`, `drop` and every other DocDB request are byte-identical",
      "Not fixed here",
      "`iris_docdb_property` `index`",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });
});

describe("Story 44.1: the changeset", () => {
  // `changeset version` consumes (deletes) the file and moves its text into the generated package changelogs, so it is checked while it exists.
  const present = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!present)("bumps @iris-mcp/data and @iris-mcp/shared patch, and nothing else", () => {
    const text = read(changesetPath);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
    expect(front.split("\n").map((line) => line.trim()).sort()).toEqual(['"@iris-mcp/data": patch', '"@iris-mcp/shared": patch']);
    const body = squash(text);
    for (const needle of ["DW-688", "`S-44.1-docdb-manage-text`", "`registered: true`", "`{database, namespace, created: false, registered: true}`", "byte-identical"]) {
      expect(body, needle).toContain(needle);
    }
  });
});
