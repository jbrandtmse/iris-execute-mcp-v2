/**
 * Story 38.7 -- the documents state the Epic 38 burn-down changes (project rules #30 and #43).
 *
 * The unit suites pin the tools and the live gates pin IRIS; neither reads a document. This file asserts, for
 * each change that alters what a reader sees:
 *
 *  - the CHANGELOG's Story 38.7 section: its headings, the eight ledger ids under Changed and Fixed, and that
 *    it carries no roster-summary string (docs-visibility-roster-sync reads the first match in the file);
 *  - the changeset's exact bump map (AD-29);
 *  - the root README: the governance document shape, the governance-file fail-fast bullet, the fail-fast list
 *    (whose first parenthesis other pins read, so the added clause holds no `)`), and the IRISTEMP sentence;
 *  - the dev README rows of `modifiedSince`, `ignoreConflict` and the IRISTEMP sentence, and `tool_support.md`;
 *  - the interop README rows for the production delete;
 *  - the launcher README and CHANGELOG lines for `MCP_TRANSPORT`.
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

/** The first line of `text` that starts with `prefix`; fails the test when there is none. */
function lineStarting(text: string, prefix: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
  expect(line, `a line starting ${prefix}`).toBeDefined();
  return line as string;
}

const rootReadme = read("README.md");
const devReadme = read("packages/iris-dev-mcp/README.md");
const interopReadme = read("packages/iris-interop-mcp/README.md");
const launcherReadme = read("extensions/iris-mcp-launcher/README.md");
const toolSupport = read("tool_support.md");

const GOVERNANCE_CLAUSE = "a governance key or layer outside `global` and `profiles`";
const IRISTEMP_SENTENCE =
  "A capped INSERT, UPDATE or DELETE on a table stored in IRISTEMP (not journaled) keeps its row changes even when the cap rolls it back.";

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

describe("Story 38.7: the CHANGELOG section and the changeset", () => {
  const section =
    sectionsOf(read("CHANGELOG.md")).find((candidate) =>
      /^## \[Pre-release[^\]]*\] . Story 38\.7: Epic 38 burn-down$/.test(candidate.split("\n")[0] ?? ""),
    ) ?? "";

  /** The text under one `### ` heading of the section, up to the next heading. */
  const under = (heading: string): string => {
    const start = section.indexOf(`\n### ${heading}\n`);
    expect(start, `the section has ### ${heading}`).toBeGreaterThanOrEqual(0);
    const rest = section.slice(start + 1);
    const next = rest.indexOf("\n### ", 1);
    return squash(next === -1 ? rest : rest.slice(0, next));
  };

  it("the CHANGELOG has the Story 38.7 section, with Changed and Fixed headings", () => {
    expect(section, "the CHANGELOG has the Story 38.7 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Changed", "### Fixed"]);
  });

  it("Changed names the five sanctioned behavior changes by ledger id", () => {
    const changed = under("Changed");
    for (const id of ["DW-554", "DW-533", "DW-542", "DW-528", "DW-539"]) {
      expect(changed, id).toContain(`(${id}`);
    }
    expect(changed).toContain("orchestrator decision #19");
  });

  it("Fixed names the three fixes by ledger id, DW-549 with the Story 38.3 precedent", () => {
    const fixed = under("Fixed");
    for (const id of ["DW-549", "DW-530", "DW-558"]) {
      expect(fixed, id).toContain(`(${id}`);
    }
    expect(fixed).toContain("the Story 38.3 `iris_doc_put` precedent, orchestrator decision #7");
  });

  it("the section carries no roster-summary string, which docs-visibility-roster-sync reads from the first match in the file", () => {
    expect(section).not.toMatch(/(?:full|core|developer)\s*`?\s*\d+\/\d+\/\d+\/\d+\/\d+/);
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-38-7-epic-38-burn-down.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!changesetPresent)("the changeset bumps exactly shared minor, dev minor and interop patch (AD-29)", () => {
    const changeset = read(changesetPath);
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/shared": "minor", "@iris-mcp/dev": "minor", "@iris-mcp/interop": "patch" });
  });
});

describe("Story 38.7: the root README states the governance document shape and the IRISTEMP caveat", () => {
  it("the governance section says only global and profiles carry policy, what fails, what is ignored, and what only warns", () => {
    const flat = squash(rootReadme);
    expect(flat).toContain("**Only `global` and `profiles` carry policy.**");
    expect(flat).toContain("fails startup, naming the variable, the key and the documented shape, and never echoing the value");
    expect(flat).toContain("a name that starts with `iris_` (in any letter case), or a key with a boolean or object value");
    expect(flat).toContain(
      "Plain metadata keys with a string, number, null or array value, such as `comment` and `version`, are ignored.",
    );
    expect(flat).toContain(
      "A profile name under `profiles` that is not a configured profile does not fail startup: it logs one `[WARN]`",
    );
    expect(flat).toContain("its overrides apply to no connection");
  });

  it("the governance file bullet names the clause", () => {
    const bullet = squash(lineStarting(rootReadme, "- **Fail-fast, never silently permissive.**"));
    expect(bullet).toContain(GOVERNANCE_CLAUSE);
    expect(bullet).toContain("aborts startup with an error naming `IRIS_GOVERNANCE_FILE`");
  });

  it("the fail-fast list names the clause inside its first parenthesis, which holds no extra `)`", () => {
    const list = /Invalid configuration still fails startup fast\*\* \(([^)]*)\)/.exec(rootReadme)?.[1] ?? "";
    expect(list, "the fail-fast parenthesis").not.toBe("");
    expect(list).toContain(GOVERNANCE_CLAUSE);
    expect(list).toContain("an unsupported `MCP_TRANSPORT`/`--transport` value");
  });

  it("the SQL section states that a capped statement on an IRISTEMP table keeps its changes", () => {
    expect(squash(rootReadme)).toContain(IRISTEMP_SENTENCE);
  });
});

describe("Story 38.7: the dev README and tool_support.md state the refusal, the version check and the cap caveat", () => {
  it("the three tools that took modifiedSince say it is refused", () => {
    for (const tool of ["iris_doc_list", "iris_doc_export", "iris_package_list"]) {
      const row = squash(lineStarting(devReadme, `| \`${tool}\` |`));
      expect(row, tool).toMatch(/`modifiedSince\?` \(\*\*refused\*\*/);
    }
    expect(squash(lineStarting(devReadme, "| `iris_doc_list` |"))).toContain(
      "IRIS cannot filter documents by modification time",
    );
  });

  it("iris_doc_load says what ignoreConflict true and false do", () => {
    const row = squash(lineStarting(devReadme, "| `iris_doc_load` |"));
    expect(row).toContain("each file overwrites its server copy unconditionally");
    expect(row).toContain("**false**: a file whose document already exists is saved under a version check");
    expect(row).toContain("`DOCUMENT_CONFLICT`");
  });

  it("the SQL write safety note states the IRISTEMP caveat", () => {
    expect(squash(lineStarting(devReadme, "> **SQL write safety (optional, opt-in"))).toContain(IRISTEMP_SENTENCE);
  });

  it("tool_support.md says iris_doc_list refuses modifiedSince and iris_doc_load version-checks under ignoreConflict false", () => {
    const list = squash(lineStarting(toolSupport, "| 6 | `iris_doc_list` |"));
    expect(list).toContain("a non-empty `modifiedSince` is **refused** before any request");
    expect(list).not.toContain("/modified");
    const load = squash(lineStarting(toolSupport, "| 7 | `iris_doc_load` |"));
    expect(load).toContain("with `ignoreConflict` **false** an existing document is saved with a version-checked save");
    expect(load).toContain("`DOCUMENT_CONFLICT`");
  });
});

describe("Story 38.7: the interop README states that delete accepts only a production class", () => {
  it("the tool row says it, and the Common Errors table has the refusal text", () => {
    const row = squash(lineStarting(interopReadme, "| `iris_production_manage` |"));
    expect(row).toContain("accepts only a production class (one that extends `Ens.Production`; any other class is refused and nothing is deleted)");

    const error = squash(lineStarting(interopReadme, "| `Class 'X' is not a production class"));
    expect(error).toContain(
      "`Class 'X' is not a production class (it does not extend Ens.Production), so nothing was deleted. Name a production class.`",
    );
    expect(error).toContain("`iris_production_manage` `delete`");
    expect(error).toContain("any same-named `Ens.Config.Production` row, are left as they are");
  });
});

describe("Story 38.7: the launcher documents that it clears MCP_TRANSPORT", () => {
  it("the README says the launcher clears it, and why", () => {
    const flat = squash(launcherReadme);
    expect(flat).toContain("`MCP_TRANSPORT` is cleared the same way: the launcher spawns only stdio servers");
    expect(flat).toContain("an ambient `MCP_TRANSPORT` that names another transport would otherwise stop every spawned server");
  });

  it("the launcher CHANGELOG records the change under Changed", () => {
    const unreleased =
      sectionsOf(read("extensions/iris-mcp-launcher/CHANGELOG.md")).find((candidate) => candidate.startsWith("## [0.1.0]")) ?? "";
    expect(unreleased, "the launcher CHANGELOG has a 0.1.0 section").not.toBe("");
    const changed = squash(/### Changed[\s\S]*?(?=\n### )/.exec(unreleased)?.[0] ?? "");
    expect(changed).toContain("**The launcher clears `MCP_TRANSPORT` in every server it starts** (Story 38.7, DW-539)");
    expect(changed).toContain("`MCP_TRANSPORT: null`");
  });
});
