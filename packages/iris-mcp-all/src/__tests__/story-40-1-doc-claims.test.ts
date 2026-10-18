/**
 * Story 40.1 -- the documents state `iris_test_coverage` with its default state at the point of use (project rules #30
 * and #43), the CHANGELOG and the changeset record it, and no new text claims regulatory compliance (AD-26).
 *
 * The unit and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the Development README: the tool row and its `> **Governance defaults:**` line (DEFAULT-DISABLED and the enable recipe),
 *    the `iris_test_status` row's new parameter, and the tool's detail entry;
 *  - `tool_support.md`: row 32 (the default state, the earliest IRIS version verified and the process scope), the Story 40.1 note
 *    after the Story 40.0 note, the suite totals and the PHI table row;
 *  - the root README's counts and pairs sentence;
 *  - `ExecuteMCPv2.REST.UnitTest`'s class comment: no tool calls `POST /tests`;
 *  - the CHANGELOG section above the Story 40.0 one, its counts, the snapshot regeneration and the bootstrap move, and the
 *    changeset's bump map.
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS } from "./doc-claims-patterns.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The right arrow the documents use between two versions, by code point. */
const ARROW = "\u2192";

/** The first line of `text` that starts with `prefix`, whitespace squashed ("" when there is none). */
function lineStarting(text: string, prefix: string): string {
  return squash(text.split("\n").find((line) => line.startsWith(prefix)) ?? "");
}

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

const devReadme = read("packages/iris-dev-mcp/README.md");
const rootReadme = read("README.md");
const toolSupport = read("tool_support.md");

const CHANGELOG_TITLE = /^## \[Pre-release \u2014 2026-10-17\] \u2014 Story 40\.1: Line coverage probe and engine$/;

/**
 * The `BOOTSTRAP_VERSION` values of the Story 40.1 move, as history literals: `changelog-bootstrap-move.test.ts` ties the
 * newest documented move to the committed embed, so a later move leaves this file true.
 */
const BOOTSTRAP_FROM = "08b8adeaadc6";
const BOOTSTRAP_TO = "4dd596fa2a0c";

const ENABLE_RECIPE = '{"global":{"iris_test_coverage":true}}';

describe("Story 40.1: the Development README", () => {
  it("has the iris_test_coverage row and a Governance defaults line that states DEFAULT-DISABLED and the enable recipe", () => {
    const row = lineStarting(devReadme, "| `iris_test_coverage`");
    expect(row, "the tool table has the iris_test_coverage row").not.toBe("");
    expect(row).toContain("`target`, `level`, `classes`, `timeout?`, `namespace?`");
    expect(row).toContain("| destructive |");

    const defaults = lineStarting(devReadme, "> **Governance defaults:** `iris_test_coverage`");
    expect(defaults, "the Governance defaults line follows the row").not.toBe("");
    expect(defaults).toContain("truthfully classified `write`");
    expect(defaults).toContain("**DEFAULT-DISABLED**");
    expect(defaults).toContain(`\`${ENABLE_RECIPE}\``);
    expect(defaults).toContain("outside the frozen governance baseline");
    expect(defaults).toContain("hidden under `IRIS_TOOLS_PRESET=core`");
    expect(devReadme.indexOf("| `iris_test_coverage`")).toBeLessThan(devReadme.indexOf("> **Governance defaults:** `iris_test_coverage`"));
  });

  it("adds coverageRunId to the iris_test_status row without changing its governance line", () => {
    const row = lineStarting(devReadme, "| `iris_test_status`");
    expect(row).toContain("`action`, `jobId?`, `runIndex?`, `coverageRunId?`, `namespace?`");
    const defaults = lineStarting(devReadme, "> **Governance defaults:** `iris_test_status:poll`");
    expect(defaults).toContain("`iris_test_status:cancel` is truthfully classified `write` and is **DEFAULT-DISABLED**");
    expect(defaults).toContain("The optional `coverageRunId` (Story 40.1) adds no action and changes neither key.");
  });

  it("has the detail entry: what is measured, the process scope, the one-run guard, the re-attach and the version", () => {
    const start = devReadme.indexOf("<summary><strong>iris_test_coverage</strong>");
    expect(start, "the detail entry exists").toBeGreaterThan(-1);
    const entry = squash(devReadme.slice(start, devReadme.indexOf("</details>", start)));
    expect(entry).toContain("**DEFAULT-DISABLED**");
    expect(entry).toContain("IRIS_TEST_TIMEOUT");
    expect(entry).toContain("**Only the process that runs the tests is measured**");
    expect(entry).toContain("`code: \"MONITOR_BUSY\"`");
    expect(entry).toContain("a session this suite did not start; it is never touched");
    expect(entry).toContain("do NOT re-submit");
    expect(entry).toContain("`coverageRunId`");
    expect(entry).toContain("200,000 measured INT lines");
    expect(entry).toContain("**Earliest IRIS version verified:** IRIS 2026.2 build 221U");
  });

  it("states 33 runtime tools under developer and the new pair", () => {
    const text = squash(devReadme);
    expect(text).toContain("**33 runtime tools** (32 + `iris_server_profiles`)");
    expect(text).toContain("so are `iris_test_coverage` and `iris_test_status` (both outside `core`)");
    expect(text).toContain("**All 32 tools in this package accept the `namespace` parameter**");
  });
});

describe("Story 40.1: tool_support.md", () => {
  it("row 32 names the default state, the earliest IRIS version verified and the process scope", () => {
    const row = lineStarting(toolSupport, "| 32 | `iris_test_coverage`");
    expect(row, "tool_support.md has row 32").not.toBe("");
    expect(row).toContain("`write` and **DEFAULT-DISABLED**");
    expect(row).toContain("**Only the process that runs the tests is measured**");
    expect(row).toContain("Earliest IRIS version verified: 2026.2 build 221U");
    expect(row).toContain("`MONITOR_BUSY`");
    expect(toolSupport).toContain("## `@iris-mcp/dev` \u2014 Development Tools (32)");
    expect(toolSupport).toContain("**Mix:** 20 Atelier \u00b7 12 ExecuteMCPv2 \u00b7 0 other");
  });

  it("has the Story 40.1 note after the Story 40.0 note: the key, the default state, the counts, the bootstrap move and the pair", () => {
    const note = lineStarting(toolSupport, "> **Story 40.1");
    expect(note, "tool_support.md has the Story 40.1 note").not.toBe("");
    expect(note).toContain("> **Story 40.1 (2026-10-17) \u2014 governance defaults, line coverage:**");
    expect(note).toContain("added `iris_test_coverage` (dev 31 " + ARROW + " 32; the suite goes from 109 to 110 package tools, 114 to 115 advertised)");
    expect(note).toContain("truthfully classified `write` and therefore **DEFAULT-DISABLED**");
    expect(note).toContain(`IRIS_GOVERNANCE=${ENABLE_RECIPE}`);
    expect(note).toContain("`1e62c5ad5bf7`, 141 keys, unchanged");
    expect(note).toContain("excluded from the `core` preset (which stays at 14 package tools, 15 runtime tools)");
    expect(note).toContain("`TOOL_PAIRS` pair with `iris_test_status`");
    expect(note).toContain("optional `coverageRunId`");
    expect(note).toContain(`\`BOOTSTRAP_VERSION\` moves \`${BOOTSTRAP_FROM}\` ${ARROW} \`${BOOTSTRAP_TO}\`; 32 ${ARROW} 35 bootstrapped classes`);
    expect(note).toContain("`POST /tests` has no tool caller");
    expect(note).toContain("refusal code `MONITOR_BUSY`");
    expect(note).toContain("**Only the process that runs the tests is measured**");
    expect(note).toContain("Earliest IRIS version verified: 2026.2 build 221U");
    expect(toolSupport.indexOf("> **Story 40.0"), "after the Story 40.0 note").toBeLessThan(toolSupport.indexOf("> **Story 40.1"));
  });

  it("counts the suite at 110 package tools and 115 advertised, with 85 on the custom handlers", () => {
    expect(toolSupport).toContain("| `@iris-mcp/dev` | 20 | 12 | 0 | **32** | **33** |");
    expect(toolSupport).toContain("| **Total** | **20** | **85** | **5** | **110** | **115** |");
    expect(squash(toolSupport)).toContain("85 of the 110 tools (77% of the suite) stop working");
  });

  it("classifies iris_test_coverage in the PHI scope table as residual, with the table dated 2026-10-17", () => {
    expect(toolSupport).toContain("## PHI data policy scope (as of 2026-10-17)");
    expect(lineStarting(toolSupport, "| `iris_test_coverage` | residual")).toBe(
      "| `iris_test_coverage` | residual | Returns the text of unit-test results, which can quote data. |",
    );
  });
});

describe("Story 40.1: the root README and the class comment", () => {
  it("states 110 tools, the dev row at 32, the roster rows and the four pairs", () => {
    const text = squash(rootReadme);
    expect(text).toContain("> **110 tools** across 5 servers");
    expect(text).toContain("| Development | 32 |");
    expect(text).toContain("| **full** (default) | 32 | 26 | 24 | 21 | 7 | 110 | 115 |");
    expect(text).toContain("| **developer** | 32 | 10 | 24 | 9 | 7 | 82 | 87 |");
    expect(text).toContain("| **core** | 14 | 12 | 11 | 9 | 7 | 53 | 58 |");
    expect(text).toContain("`iris_test_coverage` / `iris_test_status` (Story 40.1: start a coverage run, then re-attach to it or cancel it)");
    expect(text).toContain("the pair moves no `core` row");
  });

  it("ExecuteMCPv2.REST.UnitTest documents that no MCP tool calls POST /tests, and names the paths the tools use (AC 40.1.2, DW-453)", () => {
    const source = squash(read("src/ExecuteMCPv2/REST/UnitTest.cls").replace(/^\/\/\/ ?/gm, ""));
    expect(source).toContain("No MCP tool calls <code>POST /tests</code>.");
    expect(source).toContain("<code>iris_execute_tests</code> runs tests through the Atelier work queue");
    expect(source).toContain("<code>iris_test_coverage</code> runs them in its own job through the coverage routes");
    expect(source).toContain("The route stays for direct REST callers.");
  });
});

describe("Story 40.1: the CHANGELOG section and the changeset", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("has the Story 40.1 section above the Story 40.0 one, with Added and Changed headings", () => {
    expect(section, "the CHANGELOG has the Story 40.1 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Added", "### Changed"]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 40.0:"));
    expect(previous, "the CHANGELOG still has the Story 40.0 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states the counts, the default state, the bootstrap move as literals, the snapshot regeneration and the additive coverageRunId", () => {
    const text = squash(section);
    expect(text).toContain("(the Development server goes from 31 to 32 package tools, 32 to 33 advertised; the suite from 109 to 110 package tools, 114 to 115 advertised)");
    expect(text).toContain("The prompt pack stays at 13 prompts");
    expect(text).toContain("hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
    expect(text).toContain("**Default state: DEFAULT-DISABLED.**");
    expect(text).toContain(`IRIS_GOVERNANCE=${ENABLE_RECIPE}`);
    expect(text).toContain("Earliest IRIS version verified: 2026.2 build 221U");
    expect(text).toContain("**Only the process that runs the tests is measured**");
    expect(text).toContain("`MONITOR_BUSY`");
    expect(text).toContain("`pnpm gen:tools-list-snapshot --force`");
    expect(text).toContain("only in the new `iris_test_coverage` entry and in `iris_test_status`'s new property and description");
    expect(text).toContain("**`iris_test_status` takes an optional `coverageRunId`.**");
    expect(text).toContain("`POST /tests` has no tool caller");
  });

  it("the roster line of the Epic 30 section moved to Story 40.1: full 33/27/25/22/8, core 15/13/12/10/8, developer 33/11/25/10/8, four pairs", () => {
    const changelog = squash(read("CHANGELOG.md"));
    expect(changelog).toContain("Roster summary (runtime tool counts, as of Story 40.1): `full` 33/27/25/22/8 (dev/admin/interop/ops/data), `core` 15/13/12/10/8, `developer` 33/11/25/10/8");
    expect(changelog).toContain("as of Story 40.1 `iris_test_coverage` / `iris_test_status` are a fourth");
  });

  it("the changeset bumps @iris-mcp/dev by a minor and @iris-mcp/shared by a patch, and records the default state", () => {
    const dir = path.join(REPO_ROOT, ".changeset");
    expect(existsSync(dir)).toBe(true);
    const file = readdirSync(dir).find((name) => name === "test-coverage-tool.md");
    expect(file, "the changeset exists").toBeDefined();
    const text = readFileSync(path.join(dir, file as string), "utf8");
    expect(text.startsWith('---\n"@iris-mcp/dev": minor\n"@iris-mcp/shared": patch\n---\n')).toBe(true);
    expect(text).toContain("**DEFAULT-DISABLED**");
    expect(text).toContain(`IRIS_GOVERNANCE=${ENABLE_RECIPE}`);
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
  });

  it("no Story 40.1 text claims regulatory compliance (AD-26)", () => {
    const texts = [
      section,
      lineStarting(toolSupport, "> **Story 40.1"),
      lineStarting(toolSupport, "| 32 | `iris_test_coverage`"),
      read(".changeset/test-coverage-tool.md"),
    ];
    for (const text of texts) {
      for (const claim of CLAIMS) expect(text, String(claim)).not.toMatch(claim);
    }
  });
});
