/**
 * Story 44.7 QA (Rules #19, #30, #43, #45, #59) - the documents and the built tools say what the burn-down did, and the shapes
 * AC 44.7.2 says did not move have not moved.
 *
 * Nothing else reads a README against this story: the sanctioned goldens pin the three descriptions and `iris_docdb_property`'s
 * schema, the unit tests pin behavior. This file reads:
 *  - the dev README's compile-check paragraph: the limit (`.inc`, `.int`), "a check that cannot run fails the result", and the
 *    claim that async, a listed error and a status error send no check request;
 *  - the admin README's `delete` paragraph: dismount, `IRIS.DAT` kept, `#78`, the shared-directory exception;
 *  - the data README's `path` paragraph; the client-config README's by-hand advice;
 *  - the CHANGELOG section: the three sanction ids and the nine entries; the changeset: a patch of exactly five packages;
 *  - the BUILT tools: the inputs and actions of the tools the story touched are exactly those the README and the changeset
 *    describe (`path` is the only new input; no new action; the compiling tools keep their inputs).
 *
 * Needs no IRIS. The built dist is read for the tool-shape check; a stale dist fails the gate tests that own it.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const devReadme = squash(read("packages/iris-dev-mcp/README.md"));
const adminReadme = squash(read("packages/iris-admin-mcp/README.md"));
const dataReadme = squash(read("packages/iris-data-mcp/README.md"));
const clientReadme = squash(read("packages/client-config/README.md"));
const changelog = read("CHANGELOG.md");
// `changeset version` consumes (deletes) the file, so it is read only while it exists.
const changesetPath = ".changeset/story-44-7-epic-44-burn-down.md";
const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));
const changeset = changesetPresent ? read(changesetPath) : "";

const section = (/^## \[[^\]\n]*\] — Story 44\.7: Epic 44 Burn-down\n[\s\S]*?(?=\n## \[)/m.exec(changelog)?.[0] ?? "");

describe("Story 44.7: the READMEs", () => {
  it("dev: the compile check names its limit, its fail-closed rule and the paths that send no check request", () => {
    for (const needle of [
      "**The compile check (Story 44.7).**",
      "`iris_doc_compile`, `iris_doc_load` (`compile: true`) and `iris_env_promote` (`execute`)",
      "Limit: an include file (`.inc`) and an `.int` routine are not checked",
      "A check that cannot run fails the result; it is never a pass.",
      "A compile that listed an error, an `async` compile and a compile IRIS answered with a status error are reported exactly as before and send no check request.",
      "A wildcard with no literal prefix (`*.cls`) lists every class of the namespace first.",
    ]) {
      expect(devReadme, needle).toContain(needle);
    }
  });

  it("admin: delete dismounts, keeps IRIS.DAT, fails a create at the same directory with #78, and has the shared-directory exception", () => {
    for (const needle of [
      "dismounts the database",
      "Its `IRIS.DAT` and its directory stay on disk, by design",
      "fails (`#78`, file already exists) until the file is removed by hand",
      'the reply has `"dismounted": false` and a `dismountNote` that names it',
      "A database that a namespace uses, or a name that does not exist, is refused with IRIS's own error and nothing changes.",
    ]) {
      expect(adminReadme, needle).toContain(needle);
    }
  });

  it("data: the tool row lists path, and the paragraph says the default, the effect of no path and that older documents need a re-save", () => {
    for (const needle of [
      "`action`, `database`, `property`, `type?`, `path?`, `namespace?`",
      "default `$.<property>`, the top-level field of the same name",
      "A property created with no path is never filled in, and a `find` on it matches nothing.",
      "documents saved before the property exists are not found by it until they are saved again",
      "`index` reports an existing property without writing",
    ]) {
      expect(dataReadme, needle).toContain(needle);
    }
  });

  it("client-config: doctor names a by-hand delete for an entry Claude Code owns, and the others keep the apply advice", () => {
    for (const needle of [
      "a refused verb writes nothing, the old file included",
      "`doctor` names deleting the entry from the old file by hand instead of `apply`",
      "The other servers keep the `apply` advice.",
    ]) {
      expect(clientReadme, needle).toContain(needle);
    }
  });
});

describe("Story 44.7: the CHANGELOG section and the changeset", () => {
  it("the section exists, sits in the unreleased block, and names the three sanctions and the ledger entries it fixes", () => {
    // DW-725 (the manage text) is named by its sanction, `S-44.7-docdb-manage-text`, not by its ledger id.
    expect(section, "the Story 44.7 section").not.toBe("");
    expect(changelog.indexOf(section)).toBeLessThan(changelog.indexOf("\n## [1.1.0] — "));
    const text = squash(section);
    for (const needle of [
      "`S-44.7-docdb-property`",
      "`S-44.7-docdb-manage-text`",
      "`S-44.7-database-delete`",
      "DW-723",
      "DW-724",
      "DW-754",
      "DW-755",
      "DW-756",
      "DW-757",
      "DW-758",
      "DW-759",
      "DW-747",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });

  it.skipIf(!changesetPresent)("the changeset is a patch bump of exactly data, dev, admin, shared and client-config", () => {
    const front = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(front.split("\n").map((line) => /^"([^"]+)": (\w+)$/.exec(line)).filter((m): m is RegExpExecArray => m !== null).map((m) => [m[1], m[2]]));
    expect(bumps).toEqual({
      "@iris-mcp/data": "patch",
      "@iris-mcp/dev": "patch",
      "@iris-mcp/admin": "patch",
      "@iris-mcp/shared": "patch",
      "@iris-mcp/client-config": "patch",
    });
  });
});

describe("Story 44.7: the built tools keep the shapes the documents describe", () => {
  type Entry = { tool: { name: string; inputSchema: { shape: Record<string, { options?: string[] }> } } };
  const shapes = async (names: string[]): Promise<Map<string, Entry["tool"]["inputSchema"]["shape"]>> => {
    const all = (await loadAllTools(REPO_ROOT)) as Entry[];
    const found = new Map<string, Entry["tool"]["inputSchema"]["shape"]>();
    for (const name of names) {
      const entry = all.find(({ tool }) => tool.name === name);
      expect(entry, `${name} is in the catalog`).toBeDefined();
      found.set(name, entry?.tool.inputSchema.shape ?? {});
    }
    return found;
  };

  it("iris_docdb_property gains only path, and keeps its three actions", async () => {
    const shape = (await shapes(["iris_docdb_property"])).get("iris_docdb_property") ?? {};
    expect(Object.keys(shape).sort()).toEqual(["action", "database", "namespace", "path", "property", "type"]);
    expect([...(shape["action"]?.options ?? [])].sort()).toEqual(["create", "drop", "index"]);
  });

  it("iris_database_manage keeps its three actions and its inputs: delete gained a reply, not an input", async () => {
    const shape = (await shapes(["iris_database_manage"])).get("iris_database_manage") ?? {};
    expect([...(shape["action"]?.options ?? [])]).toEqual(["create", "modify", "delete"]);
    expect(Object.keys(shape)).not.toContain("path");
    expect(Object.keys(shape)).not.toContain("dismount");
  });

  it("the three compiling tools keep their inputs: the check has no switch to turn it off or on", async () => {
    const found = await shapes(["iris_doc_compile", "iris_doc_load", "iris_env_promote"]);
    expect(Object.keys(found.get("iris_doc_compile") ?? {}).sort()).toEqual(["async", "doc", "flags", "namespace"]);
    expect(Object.keys(found.get("iris_doc_load") ?? {}).sort()).toEqual(
      ["allowStorageRegeneration", "baseDir", "compile", "flags", "ignoreConflict", "namespace", "path"].sort(),
    );
    expect(Object.keys(found.get("iris_env_promote") ?? {}).sort()).toEqual(
      ["action", "allowStorageRegeneration", "confirm", "diff", "namespace", "plan", "source", "steps", "target"].sort(),
    );
    expect([...(found.get("iris_env_promote")?.["action"]?.options ?? [])].sort()).toEqual(["execute", "plan"]);
  });
});
