/**
 * Story 42.11 (DW-652; project rules #30 and #43) - the documents say what the Storage guard on every document write does.
 *
 * The unit suites pin the behavior of the three paths and `story-43-4-sanctioned-golden-changes.test.ts` pins the ledger; none of them reads
 * a document. This file reads them, one claim each:
 *  - the dev README rows of `iris_doc_load`, `iris_doc_xml_export` and `iris_env_promote` list `allowStorageRegeneration?` with its default
 *    **false** and its effect, and the built tool of each has that parameter, optional;
 *  - the dev README says `iris_doc_load` overwrites "without a version check", and its `Document-write paths` bullet names the five guarded
 *    tools;
 *  - the root README bullet names the three new paths, and its `STORAGE_DROPPED` row names the override on each of the four tools and keeps
 *    its three cells;
 *  - `tool_support.md` rows 7, 12 and 28 name the added GET reads and the refusal, and the Story 42.11 note says that no tool count moves;
 *  - the CHANGELOG entry of Story 42.11 names both sanction ids, DW-652, the superseded DW-544, DW-545 and DW-546, and the facts that bound the
 *    story;
 *  - the changeset is a minor bump of `@iris-mcp/shared` and `@iris-mcp/dev` and nothing else.
 * Needs no IRIS. The built dists are read for the parameter checks; a stale dist fails the gate tests that own it.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

function lineStarting(text: string, prefix: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
  expect(line, `a line starting ${prefix}`).toBeDefined();
  return line as string;
}

/** The three tools whose README rows change, and the dev server's four guarded tools that take the override. */
const NEW_PATHS = ["iris_doc_load", "iris_doc_xml_export", "iris_env_promote"];
const GUARDED_TOOLS = ["iris_doc_put", "iris_doc_edit", ...NEW_PATHS];

const rootReadme = read("README.md");
const devReadme = read("packages/iris-dev-mcp/README.md");
const toolSupport = read("tool_support.md");
const changelog = read("CHANGELOG.md");
const changesetPath = ".changeset/story-42-11-storage-guard-on-every-document-write.md";

describe("Story 42.11: the dev README", () => {
  it("each of the three rows lists allowStorageRegeneration? with its default false, its refusal and storageDrops", () => {
    for (const tool of NEW_PATHS) {
      const row = squash(lineStarting(devReadme, `| \`${tool}\` |`));
      expect(row, `${tool}: the parameter`).toContain("`allowStorageRegeneration?` (default: **false**");
      expect(row, `${tool}: the refusal code`).toContain("`STORAGE_DROPPED`");
      expect(row, `${tool}: the result field`).toContain("`storageDrops`");
    }
  });

  it("the three rows keep their Annotations cell, and the iris_doc_load row says its files overwrite without a version check", () => {
    for (const [tool, cell] of [
      ["iris_doc_load", "destructive, idempotent"],
      ["iris_doc_xml_export", "destructive (import), not idempotent"],
      ["iris_env_promote", "destructive"],
    ] as const) {
      expect(lineStarting(devReadme, `| \`${tool}\` |`).trimEnd().endsWith(`| ${cell} |`), `${tool}: the Annotations cell`).toBe(true);
    }
    const load = squash(lineStarting(devReadme, "| `iris_doc_load` |"));
    expect(load).toContain("each file overwrites its server copy without a version check");
    expect(load).not.toContain("unconditionally");
  });

  it("the Document-write paths bullet names the five guarded tools, and the Storage guard bullet names every path and its parameter", () => {
    const details = /<summary><strong>iris_doc_put<\/strong>[\s\S]*?<\/details>/.exec(devReadme)?.[0] ?? "";
    expect(details, "the iris_doc_put details block").not.toBe("");
    const paths = squash(/- \*\*Document-write paths\.\*\*[\s\S]*?(?=\n\n)/.exec(details)?.[0] ?? "");
    expect(paths, "the Document-write paths bullet").not.toBe("");
    for (const tool of GUARDED_TOOLS) expect(paths, tool).toContain(tool);
    expect(details, "the bullet that replaced Unguarded paths").not.toContain("Unguarded paths");
    const guard = squash(/- \*\*Storage guard\.\*\*[\s\S]*?(?=\n- \*\*Document-write paths)/.exec(details)?.[0] ?? "");
    expect(guard, "the Storage guard bullet").not.toBe("");
    for (const tool of ["iris_doc_put", ...NEW_PATHS]) expect(guard, tool).toContain(tool);
    expect(guard).toContain("`allowStorageRegeneration: true` (default **false**)");
    expect(guard).toContain("`storageDrops`");
  });

  it("the iris_env_promote note says the preflight comes before the confirmation dialog and that the text checked is the text written", () => {
    const note = squash(lineStarting(devReadme, "> **Storage guard (Story 42.11):**"));
    expect(note).toContain("before the confirmation dialog");
    expect(note).toContain("the text checked is the text written");
    expect(note).toContain("`{code, source, target, storageDrops}`");
  });
});

describe("Story 42.11: the built tools carry the documented parameter", () => {
  it("allowStorageRegeneration is an optional parameter of each of the three tools, and the Storage guard sentence ends each description", async () => {
    const all = (await loadAllTools(REPO_ROOT)) as Array<{
      pkg: string;
      tool: { name: string; description: string; inputSchema: { shape: Record<string, { isOptional: () => boolean }> } };
    }>;
    for (const name of NEW_PATHS) {
      const entry = all.find(({ tool }) => tool.name === name);
      expect(entry, `${name} is in the catalog`).toBeDefined();
      const parameter = entry?.tool.inputSchema.shape["allowStorageRegeneration"];
      expect(parameter, `${name} has the parameter`).toBeDefined();
      expect(parameter?.isOptional(), `${name}: optional`).toBe(true);
      expect(entry?.tool.description, `${name}: the description names the parameter`).toContain("allowStorageRegeneration (default false)");
    }
    // iris_doc_edit is overridden by its regenerateStorage action, not by the parameter (AD-4).
    expect(all.filter(({ tool }) => "allowStorageRegeneration" in tool.inputSchema.shape).map(({ tool }) => tool.name).sort()).toEqual(
      ["iris_doc_put", ...NEW_PATHS].sort(),
    );
  });
});

describe("Story 42.11: the root README", () => {
  it("the document bullet names the three new paths, the parameter and storageDrops", () => {
    const bullet = squash(lineStarting(rootReadme, "- **`iris_doc_put` on an existing document.**"));
    for (const tool of NEW_PATHS) expect(bullet, tool).toContain(tool);
    expect(bullet).toContain("`allowStorageRegeneration`");
    expect(bullet).toContain("`storageDrops`");
  });

  it("the STORAGE_DROPPED row keeps three cells and names the override on each tool that takes it", () => {
    const row = lineStarting(rootReadme, "| `STORAGE_DROPPED` |");
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    expect(cells).toHaveLength(3);
    for (const tool of ["iris_doc_put", "iris_doc_load", "iris_doc_xml_export", "iris_env_promote"]) expect(cells[2], tool).toContain(tool);
    expect(cells[2]).toContain("`allowStorageRegeneration: true`");
    expect(cells[2]).toContain("`regenerateStorage`");
  });

  it("the Story 43.4 sentence about descriptions is scoped, and names the Storage-guard paragraph of iris_env_promote", () => {
    const sentence = squash(lineStarting(rootReadme, "- **The descriptions name the dialog.**"));
    expect(sentence).toContain("Story 43.4 changed no other byte of any description");
    expect(sentence).toContain("Story 42.11 later appended a Storage-guard paragraph to the description of `iris_env_promote`");
  });
});

describe("Story 42.11: tool_support.md", () => {
  it("rows 7, 12 and 28 name the added reads, the refusal and the parameter", () => {
    for (const [prefix, read] of [
      ["| 7 | `iris_doc_load` |", "`GET /doc/{name}`"],
      ["| 12 | `iris_doc_xml_export` |", "`GET /doc/{name}`"],
      ["| 28 | `iris_env_promote` |", "`GET /doc/{name}`"],
    ] as const) {
      const row = squash(lineStarting(toolSupport, prefix));
      expect(row, prefix).toContain(read);
      expect(row, prefix).toContain("`STORAGE_DROPPED`");
      expect(row, prefix).toContain("`allowStorageRegeneration` (default **false**");
      expect(row, prefix).toContain("Story 42.11");
    }
    expect(squash(lineStarting(toolSupport, "| 28 | `iris_env_promote` |"))).toContain("before the confirmation dialog");
  });

  it("the Story 42.11 note says that no tool count moves, that three paths are guarded and that each takes one parameter", () => {
    const note = squash(lineStarting(toolSupport, "> **Story 42.11 (2026-10-21)"));
    expect(note).toContain("no tool, action or governance key is added");
    expect(note).toContain("110 package tools, 115 advertised");
    expect(note).toContain("`1e62c5ad5bf7`, 141 keys");
    expect(note).toContain("`BOOTSTRAP_VERSION` is unchanged");
    for (const tool of NEW_PATHS) expect(note, tool).toContain(tool);
    expect(note).toContain("`allowStorageRegeneration` (default **false**)");
    expect(note).toContain("`S-42.11-storage-guard-schema`");
    expect(note).toContain("`S-42.11-storage-guard-text`");
  });
});

describe("Story 42.11: the CHANGELOG entry", () => {
  const entry = /## \[Pre-release[^\]]*\] . Story 42\.11:[\s\S]*?(?=\n## \[)/.exec(changelog)?.[0] ?? "";

  it("has the sanctioned-change heading, and names both sanctions, DW-652, the superseded exclusions and the two behavior decisions", () => {
    expect(entry, "CHANGELOG.md has a Story 42.11 section").not.toBe("");
    expect(entry).toContain("### Changed (AD-15 sanctioned)");
    for (const needle of ["`S-42.11-storage-guard-schema`", "`S-42.11-storage-guard-text`", "DW-652", "DW-544", "DW-545", "DW-546", "decisions #30 and #38"]) {
      expect(entry, needle).toContain(needle);
    }
  });

  it("names the three paths, the parameter, the refusal and the facts that bound the story", () => {
    const text = squash(entry);
    for (const needle of [
      "`iris_doc_load`",
      "`iris_doc_xml_export` import",
      "`iris_env_promote` `execute`",
      "`allowStorageRegeneration`",
      "`storageDrops`",
      "`STORAGE_DROPPED`",
      "8 new entries",
      "byte-unchanged",
      "pnpm gen:tools-list-snapshot --force",
      "`1e62c5ad5bf7` (141 keys)",
      "`BOOTSTRAP_VERSION` is unchanged",
      "110 package tools, 115 advertised",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });
});

describe("Story 42.11: the changeset", () => {
  // `changeset version` consumes (deletes) the file and moves its text into the generated package changelogs, so the bumps are
  // checked while the file exists.
  const present = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!present)("bumps @iris-mcp/shared and @iris-mcp/dev minor, and nothing else", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(read(changesetPath))?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontmatter
        .split("\n")
        .map((line) => /^"([^"]+)": (\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1] ?? "", match[2] ?? ""]),
    );

    expect(bumps).toEqual({ "@iris-mcp/shared": "minor", "@iris-mcp/dev": "minor" });
  });

  it.skipIf(!present)("names the refusal code, the parameter, the result field and both sanctions", () => {
    const text = read(changesetPath);
    for (const needle of ["STORAGE_DROPPED", "allowStorageRegeneration", "storageDrops", "S-42.11-storage-guard-schema", "S-42.11-storage-guard-text", "DW-652"]) {
      expect(text, needle).toContain(needle);
    }
  });
});
