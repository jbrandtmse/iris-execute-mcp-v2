/**
 * Story 39.0 -- the documents state the Epic 38 deferred cleanup (project rules #30 and #43).
 *
 * The unit suites pin the engine, the command and the harness; none of them reads a document. This file
 * asserts, for each change that alters what a reader sees:
 *
 *  - the CHANGELOG's Story 39.0 section: its headings, the three ledger ids under Added, Fixed and Tests, and
 *    that it says no count moves and carries no roster-summary string (docs-visibility-roster-sync reads the
 *    first match in the file);
 *  - the changeset's exact bump map (AD-29);
 *  - the root README: the `check` row of the `iris-mcp-governance` table, the exit-code and `--json` sentences,
 *    and the paragraph that says a key naming nothing only warns (placed after the document-shape paragraph,
 *    which the Story 38.7 pins read and which stays as it is);
 *  - the shared package README: `check` in the bin bullet.
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in
 * `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

const CHECK_USAGE = "check [--file <path>] [--root <path>] [--json]";

describe("Story 39.0: the CHANGELOG section and the changeset", () => {
  const section =
    sectionsOf(read("CHANGELOG.md")).find((candidate) =>
      /^## \[Pre-release[^\]]*\] . Story 39\.0: Epic 38 deferred cleanup$/.test(candidate.split("\n")[0] ?? ""),
    ) ?? "";

  /** The text under one `### ` heading of the section, up to the next heading. */
  const under = (heading: string): string => {
    const start = section.indexOf(`\n### ${heading}\n`);
    expect(start, `the section has ### ${heading}`).toBeGreaterThanOrEqual(0);
    const rest = section.slice(start + 1);
    const next = rest.indexOf("\n### ", 1);
    return squash(next === -1 ? rest : rest.slice(0, next));
  };

  it("the CHANGELOG has the Story 39.0 section, with Added, Fixed and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 39.0 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Added", "### Fixed", "### Tests"]);
  });

  it("each ledger id sits under its heading: DW-565 Added, DW-567 Fixed, DW-543 Tests", () => {
    expect(under("Added")).toContain("(DW-565)");
    expect(under("Fixed")).toContain("(DW-567)");
    expect(under("Tests")).toContain("(DW-543)");
  });

  it("Added names the command and the startup warning", () => {
    const added = under("Added");
    expect(added).toContain(CHECK_USAGE.replace("check ", "`iris-mcp-governance check ") + "`");
    expect(added).toContain("one `[WARN]` per such key");
    expect(added).toContain("not an MCP tool");
  });

  it("states that no tool, key or count moves, and that BOOTSTRAP_VERSION and the baseline hash stay", () => {
    const text = squash(section);
    expect(text).toContain("no count moves");
    expect(text).toContain("`BOOTSTRAP_VERSION` stays `089f8f0a62b2`");
    expect(text).toContain("`1e62c5ad5bf7` (141 keys)");
  });

  it("the section carries no roster-summary string, which docs-visibility-roster-sync reads from the first match in the file", () => {
    expect(section).not.toMatch(/(?:full|core|developer)\s*`?\s*\d+\/\d+\/\d+\/\d+\/\d+/);
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-39-0-epic-38-deferred-cleanup.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!changesetPresent)("the changeset bumps exactly shared minor and dev patch (AD-29)", () => {
    const changeset = read(changesetPath);
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/shared": "minor", "@iris-mcp/dev": "patch" });
  });
});

describe("Story 39.0: the root README states the new command and the startup warning", () => {
  const readme = read("README.md");

  it("the iris-mcp-governance table has one `check` row, after `universe`, with the usage and the exit-1 contract", () => {
    const rows = readme.split("\n").filter((line) => line.startsWith(`| \`${CHECK_USAGE}\` |`));
    expect(rows).toHaveLength(1);
    const row = squash(rows[0] as string);
    expect(row).toContain("`IRIS_GOVERNANCE`");
    expect(row).toContain("`iris_doc_putt`");
    expect(row).toContain("exit 1 when any key matches nothing");
    const lines = readme.split("\n");
    const universeRow = lines.findIndex((line) => line.startsWith("| `universe [--profile <name>]"));
    expect(universeRow).toBeGreaterThanOrEqual(0);
    expect(lines[universeRow + 1]).toBe(rows[0]);
  });

  it("the exit-code and --json sentences name `check`", () => {
    const sentence = squash(readme.split("\n").find((line) => line.startsWith("**Default file resolution**")) ?? "");
    expect(sentence).toContain("a key that matches nothing for `check`");
    expect(sentence).toContain("(`validate`, `get`, `effective`, `diff`, `universe`, `check`)");
  });

  it("the paragraph after the document-shape paragraph says a key naming nothing only warns, and points at `check`", () => {
    const lines = readme.split("\n");
    const shape = lines.findIndex((line) => line.startsWith("**Only `global` and `profiles` carry policy.**"));
    expect(shape, "the document-shape paragraph").toBeGreaterThanOrEqual(0);
    expect(lines[shape + 1]).toBe("");
    const paragraph = lines[shape + 2] ?? "";
    expect(paragraph.startsWith("**A key that names nothing only warns.**")).toBe(true);
    expect(lines[shape + 3]).toBe("");
    expect(lines[shape + 4]?.startsWith("**Effective policy**")).toBe(true);

    const text = squash(paragraph);
    expect(text).toContain("logs one `[WARN]` per such key for the tools it registers");
    expect(text).toContain("never the value");
    expect(text).toContain("still starts, and the effective policy is the one it would report without the key");
    expect(text).toContain("`{\"global\": {\"iris_doc_edit\": false}}` leaves the default-enabled `iris_doc_edit:apply` enabled");
    expect(text).toContain("[`iris-mcp-governance check`](#iris-mcp-governance-cli), which exits 1 when a key matches nothing");
    expect(text).toContain("A valid document starts and reports exactly as before.");
  });

  it("the sentence that lists the CLI commands names `check`", () => {
    expect(squash(readme)).toContain("(`validate` / `get` / `set` / `unset` / `effective` / `diff` / `check`)");
  });
});

describe("Story 39.0: the shared package README names the command", () => {
  it("the bin bullet lists `check` with its exit-1 contract", () => {
    const text = squash(read("packages/shared/README.md"));
    expect(text).toContain("**`check [--file <path>] [--root <path>]`**");
    expect(text).toContain("a key that matches nothing for `check`");
  });
});
