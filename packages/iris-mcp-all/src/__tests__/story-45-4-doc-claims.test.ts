/**
 * Story 45.4 -- the documents state what `IRIS_DATA_POLICY=block` turns off and how to turn one back on, where each reader will
 * look (project rules #30 and #43; AC 45.4.7; decision #170).
 *
 * The unit, wire and back-compat suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the root README: the `IRIS_DATA_POLICY` row, the `block` table row, the "What `block` turns off" paragraph, the one line
 *    about `IRIS_TOOLS_ENABLE` that decision #170 pins word for word, the re-enable example, the `dataPolicy` configSource
 *    value, the warning and the combination advice, and that the warning text never offers `allow`;
 *  - the three server READMEs that carry a covered tool (dev, interop, data) and the shared README's cascade;
 *  - `tool_support.md`: the dated Story 45.4 note;
 *  - the CHANGELOG section above the Story 45.3 one, and the changeset's bump map and sanction id.
 *
 * Needs no IRIS and no built dist: it reads documents. The README list against the declaration is checked in
 * `data-policy-scope.test.ts`. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
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

/** The first line of `text` that starts with `prefix`, whitespace squashed ("" when there is none). */
function lineStarting(text: string, prefix: string): string {
  return squash(text.split("\n").find((line) => line.startsWith(prefix)) ?? "");
}

const SANCTION = "S-45.4-block-raw-tools";

/** Decision #170, item 1: the one line the README carries about `IRIS_TOOLS_ENABLE`, word for word. */
const TOOLS_ENABLE_LINE =
  "`IRIS_TOOLS_ENABLE` only shows a tool; under `block` a covered tool stays off until `IRIS_GOVERNANCE` or the governance file sets it `true`.";

// `changeset version` consumes (deletes) the file, so its checks run only while it exists.
const CHANGESET_FILE = ".changeset/story-45-4-block-turns-off-raw-read-and-code-execution-tools.md";
const CHANGESET_PRESENT = existsSync(path.join(REPO_ROOT, CHANGESET_FILE));

const readme = read("README.md");

describe("Story 45.4: the root README (AC 45.4.7)", () => {
  it("the IRIS_DATA_POLICY row says block turns off the raw tools, an explicit key re-enables one, and the server warns", () => {
    const row = lineStarting(readme, "| `IRIS_DATA_POLICY` |");
    expect(row).toContain("`block` also turns off the raw-read and code-execution tools");
    expect(row).toContain("an explicit governance key re-enables one");
    expect(row).toContain("Under `redact` or `block`, a server with such a tool enabled logs one startup `[WARN]` naming it.");
  });

  it("the block row of the policy table points at the new paragraph", () => {
    const row = lineStarting(readme, "| `block` | Every message body is withheld");
    expect(row).toContain("turns off the raw-read and code-execution tools");
    expect(row).toContain("an explicit governance key re-enables one");
  });

  const text = squash(readme);

  it("has the 'What block turns off' paragraph, the reporting, the re-enable example and the sanction id", () => {
    expect(text).toContain("**What `block` turns off.**");
    expect(text).toContain('`GOVERNANCE_DISABLED` and one extra field, `dataPolicyApplied: "block"`');
    expect(text).toContain("the text ends ` (data policy 'block')`");
    expect(text).toContain('`configSource: "dataPolicy"`');
    expect(text).toContain('{"profiles":{"prod":{"iris_sql_query":true}}}');
    expect(text).toContain(SANCTION);
  });

  it("carries decision #170's IRIS_TOOLS_ENABLE line word for word, and says a call's arguments never re-enable a tool", () => {
    expect(text).toContain(TOOLS_ENABLE_LINE);
    expect(text).toContain("A call's own arguments can never re-enable a tool.");
  });

  it("describes the startup warning, and says allow is not a way out", () => {
    expect(text).toContain("**The startup warning.**");
    expect(text).toContain("at most one `[WARN]` line at startup, from configuration alone and before any request to IRIS");
    expect(text).toContain("`allow` is not a way out, because it loosens message bodies.");
  });

  it("states what block does not cover, and the advice to pair it with the read-only preset", () => {
    expect(text).toContain("**What `block` does not cover.**");
    expect(text).toContain("set `IRIS_DATA_POLICY=block` and `IRIS_GOVERNANCE_PRESET=read-only` together");
  });

  it("lists dataPolicy among the configSource values and the 8-step cascade in the CLI row", () => {
    expect(text).toContain("(`env` | `file` | `parent` | `dataPolicy` | `preset` | `default`)");
    const effective = lineStarting(readme, "| `effective [--profile <name>] [--json]` |");
    expect(effective).toContain("`env.profile ?? env.global ?? file.profile ?? file.global ?? inheritedDisable ?? dataPolicySeed ?? presetSeed ?? defaultSeed`");
    expect(effective).toContain("`env`\\|`file`\\|`parent`\\|`dataPolicy`\\|`preset`\\|`default`");
  });
});

describe("Story 45.4: the server READMEs and the shared README", () => {
  it("dev: the IRIS_DATA_POLICY row names its eight keys, the re-enable example and the warning", () => {
    const row = lineStarting(read("packages/iris-dev-mcp/README.md"), "| `IRIS_DATA_POLICY` |");
    for (const key of [
      "iris_sql_query",
      "iris_sql_execute",
      "iris_global_get",
      "iris_global_list",
      "iris_execute_command",
      "iris_execute_classmethod",
      "iris_execute_tests",
      "iris_test_coverage",
    ]) {
      expect(row, key).toContain(`\`${key}\``);
    }
    expect(row).toContain('{"profiles":{"prod":{"iris_sql_query":true}}}');
    expect(row).toContain("`IRIS_TOOLS_ENABLE` only shows a tool and does not.");
    expect(row).toContain("one startup `[WARN]` line");
  });

  it("interop: the row and the section name iris_transform_test, its re-enable and the warning", () => {
    const interop = read("packages/iris-interop-mcp/README.md");
    const row = lineStarting(interop, "| `IRIS_DATA_POLICY` |");
    expect(row).toContain("`block` also turns off the raw-read and code-execution tool of this server, `iris_transform_test`");
    expect(row).toContain("an explicit governance key re-enables it");
    const text = squash(interop);
    expect(text).toContain("**What `block` turns off.** Under `block`, `iris_transform_test`");
    expect(text).toContain(SANCTION);
    expect(text).toContain("`IRIS_TOOLS_ENABLE` only shows a tool and does not.");
  });

  it("data: the row names both docdb keys, the actions that stay on and the warning", () => {
    const row = lineStarting(read("packages/iris-data-mcp/README.md"), "| `IRIS_DATA_POLICY` |");
    expect(row).toContain("`iris_docdb_document:get`");
    expect(row).toContain("`iris_docdb_find`");
    expect(row).toContain("the `insert`, `update` and `delete` actions stay on");
    expect(row).toContain("one startup `[WARN]` line");
  });

  it("the shared README describes the 8-step cascade with the block seed", () => {
    const shared = squash(read("packages/shared/README.md"));
    expect(shared).toContain("the 8-step cascade including the parent-key inherited disable of Story 38.4 and the `block` data-policy seed of Story 45.4");
    expect(shared).not.toContain("7-step cascade");
  });
});

describe("Story 45.4: tool_support.md", () => {
  const toolSupport = read("tool_support.md");

  it("has the dated note: no key, tool or default moves under redact or allow; block seeds the 11 keys off and an explicit key re-enables", () => {
    const note = lineStarting(toolSupport, "> **Story 45.4 (2026-11-25)");
    expect(note, "tool_support.md has the Story 45.4 note").not.toBe("");
    expect(note).toContain("governance defaults under block:");
    expect(note).toContain("no tool, action or governance key is added, so no default state and no tool count moves");
    expect(note).toContain("Under `redact` and `allow` and with no policy set, no key's enabled state and no `configSource` changes on any server.");
    expect(note).toContain('`GOVERNANCE_DISABLED` plus `dataPolicyApplied: "block"`');
    expect(note).toContain("an explicit `true` for the key in `IRIS_GOVERNANCE` or the governance file re-enables it");
    expect(note).toContain(SANCTION);
    expect(toolSupport.indexOf("> **Story 42.11"), "after the Story 42.11 note").toBeLessThan(toolSupport.indexOf("> **Story 45.4"));
  });

  it("the scope section says block also seeds the off-marked residual tools and does not cover the code-running writes", () => {
    const text = squash(toolSupport);
    expect(text).toContain("since Story 45.4 `IRIS_DATA_POLICY=block` also seeds the residual tools marked `off` in the **Under `block`** column disabled");
    expect(text).toContain("`block` does not cover the write tools that run code");
    expect(text).toContain("`block` plus `IRIS_GOVERNANCE_PRESET=read-only`");
  });
});

describe("Story 45.4: the CHANGELOG section and the changeset", () => {
  const changelog = read("CHANGELOG.md");

  it("has the section above the Story 45.3 one, naming the sanction, the cascade and what stays on", () => {
    const heading = "## [Unreleased] - Story 45.4: Block Turns Off Raw-Read and Code-Execution Tools";
    expect(changelog).toContain(heading);
    expect(changelog.indexOf(heading), "above the Story 45.3 section").toBeLessThan(changelog.indexOf("## [Unreleased] - Story 45.3"));
    const section = squash(changelog.slice(changelog.indexOf(heading), changelog.indexOf("## [Unreleased] - Story 45.3")));
    expect(section).toContain(SANCTION);
    expect(section).toContain("`env.profile ?? env.global ?? file.profile ?? file.global ?? inheritedDisable ?? dataPolicySeed ?? presetSeed ?? defaultSeed`");
    expect(section).toContain('`dataPolicyApplied: "block"`');
    expect(section).toContain("`configSource` has a new value, `dataPolicy`");
    expect(section).toContain("never offers `allow`");
    expect(section).toContain("`BOOTSTRAP_VERSION` does not move");
    expect(section).toContain("`iris_locks_list` stays on under `block`");
  });

  it.runIf(CHANGESET_PRESENT)("the changeset bumps all six @iris-mcp packages by minor and names the sanction", () => {
    const changeset = read(CHANGESET_FILE);
    for (const name of ["shared", "admin", "data", "dev", "interop", "ops"]) {
      expect(changeset, name).toContain(`"@iris-mcp/${name}": minor`);
    }
    expect(changeset).not.toMatch(/: (patch|major)/);
    expect(changeset).toContain(SANCTION);
    expect(changeset).toContain("never offers `IRIS_DATA_POLICY=allow` as a way out");
  });
});
