/**
 * Story 40.4 -- the documents state each default of the coverage surface where it is used (project rules #30 and #43), the
 * `iris_execute_tests` classification and annotations, the `minCoverage` default, the enabling setting and a CI recipe; the
 * `#dim` sentence names its exception; the CHANGELOG section and the changeset exist; and no new text claims regulatory
 * compliance.
 *
 * The unit, OS and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the Development README: the annotations cell and default state of `iris_execute_tests`, the rows of `iris_test_status` and
 *    `iris_test_coverage`, the defaults paragraph of each detail entry, the `minCoverage` default, the stale-class and `#dim`
 *    paragraphs, the CI recipe and the prompt row;
 *  - the root README: the Test coverage section (its key table with default states, the loop, the guards, the export path rules,
 *    the presets and the prompt), its place between the forensics section and the worked example, the prompt row, and that it adds
 *    no line to the refusal table;
 *  - `tool_support.md`: the row of `iris_execute_tests` and the Story 40.4 note;
 *  - the CHANGELOG section above the Story 40.3 one, and the changeset's bump map;
 *  - that no document still calls `iris_execute_tests` a read.
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
const ARROW = "\u{2192}";

/** The em dash the documents use in headings and notes, by code point. */
const EM_DASH = "\u{2014}";

/** The first line of `text` that starts with `prefix`, whitespace squashed ("" when there is none). */
function lineStarting(text: string, prefix: string): string {
  return squash(text.split("\n").find((line) => line.startsWith(prefix)) ?? "");
}

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

/** A detail entry of the Development README: from its `<summary>` to the next `</details>`, whitespace squashed. */
function detailEntry(readme: string, tool: string): string {
  const start = readme.indexOf(`<summary><strong>${tool}</strong>`);
  expect(start, `the ${tool} detail entry exists`).toBeGreaterThan(-1);
  return squash(readme.slice(start, readme.indexOf("</details>", start)));
}

const devReadme = read("packages/iris-dev-mcp/README.md");
const rootReadme = read("README.md");
const toolSupport = read("tool_support.md");

const CHANGELOG_TITLE = new RegExp(`^## \\[Pre-release ${EM_DASH} 2026-10-18\\] ${EM_DASH} Story 40\\.4: Test depth docs, prompt and capstone$`);

/**
 * The `BOOTSTRAP_VERSION` values of the Story 40.4 move, as history literals: `changelog-bootstrap-move.test.ts` ties the newest
 * documented move to the committed embed, so a later move leaves this file true.
 */
const BOOTSTRAP_FROM = "845e95f6e726";
const BOOTSTRAP_TO = "5024e4623f1d";

/** The enabling setting of the three disabled keys. */
const ENABLE_RECIPE = '{"global":{"iris_test_coverage":true,"iris_test_status:cancel":true,"iris_test_status:export":true}}';

describe("Story 40.4: the Development README states each default where it is used", () => {
  it("the iris_execute_tests row has no annotations and says write, enabled by default", () => {
    const row = lineStarting(devReadme, "| `iris_execute_tests`");
    expect(row).toContain("Classified `write` because it runs test code, and **enabled by default** (a key of the frozen baseline)");
    expect(row).toContain("since Story 40.4 its annotations say so (not read-only, not idempotent)");
    expect(row).toContain("`target`, `level`, `timeout?`, `namespace?` | -- |");
  });

  it("the iris_test_status and iris_test_coverage rows state their default states", () => {
    const status = lineStarting(devReadme, "| `iris_test_status`");
    expect(status).toContain("`poll` is a read, **enabled by default**; `cancel` and `export` are writes, **DEFAULT-DISABLED** (enable them through `IRIS_GOVERNANCE`)");
    const coverage = lineStarting(devReadme, "| `iris_test_coverage`");
    expect(coverage).toContain('**A write, DEFAULT-DISABLED** (it starts an instance-wide Line-by-Line session and runs test code; enable it with `IRIS_GOVERNANCE={"global":{"iris_test_coverage":true}}`)');
    expect(coverage).toContain("`minCoverage` omitted means no verdict");
  });

  it("the iris_test_status entry has a defaults paragraph with the three keys and the enabling setting", () => {
    const entry = detailEntry(devReadme, "iris_test_status");
    expect(entry).toContain("Re-attach, read, cancel or export a test or coverage run (Stories 36.2, 40.1, 40.2)");
    expect(entry).toContain("**Defaults at a glance (Story 40.4).**");
    expect(entry).toContain("`iris_test_status:poll` is a read and **enabled by default**; `iris_test_status:cancel` and `iris_test_status:export` are writes and **DEFAULT-DISABLED**");
    expect(entry).toContain('IRIS_GOVERNANCE={"global":{"iris_test_status:cancel":true,"iris_test_status:export":true}}');
  });

  it("the iris_test_coverage entry has the defaults table, the preset line, the enabling setting and the prompt", () => {
    const entry = detailEntry(devReadme, "iris_test_coverage");
    expect(entry).toContain("Line coverage of a test run, with a target and a Cobertura file (Stories 40.1, 40.2, 40.4)");
    expect(entry).toContain("**Defaults at a glance (Story 40.4).**");
    expect(entry).toContain("| `iris_test_coverage` | write | **DEFAULT-DISABLED** (it starts an instance-wide monitor and runs test code) |");
    expect(entry).toContain("| `iris_test_status:poll` | read | enabled |");
    expect(entry).toContain("| `iris_test_status:cancel` | write | **DEFAULT-DISABLED** |");
    expect(entry).toContain("| `iris_test_status:export` | write | **DEFAULT-DISABLED** (it writes a local file) |");
    expect(entry).toContain("`iris_execute_tests` is classified `write` and enabled by default (a key of the frozen baseline).");
    expect(entry).toContain("The `developer` preset shows `iris_test_coverage` and `iris_test_status`; the `core` preset hides both, and a hidden tool cannot be called.");
    expect(entry).toContain(`IRIS_GOVERNANCE=${ENABLE_RECIPE}`);
    expect(entry).toContain("The `deploy-and-test-class` prompt offers a coverage step and copes with a hidden or disabled tool.");
  });

  it("the minCoverage default sentence is where the verdict is described", () => {
    const entry = detailEntry(devReadme, "iris_test_coverage");
    expect(entry).toContain(
      "**`minCoverage` omitted means no verdict:** the result has no `coverage.verdict` and no `Coverage target` line, and no run is judged on its percentage.",
    );
  });

  it("the #dim sentence names the initializing exception, and the stale-class paragraph states the rule and the residual", () => {
    const entry = detailEntry(devReadme, "iris_test_coverage");
    expect(entry).toContain("a preprocessor line (`#dim` that initializes nothing, `#define`, `#sqlcompile` and the like) is never a class line");
    expect(entry).toContain(
      "A `#dim` that initializes its variable (it holds an `=` outside parentheses, string literals and comments, as in `#dim tSC As %Status = $$$OK`) is the exception: it compiles to a `Set` at its own INT line, so it is an executable class line (Story 40.4). An `=` in a trailing `//`, `;` or `/* */` comment initializes nothing.",
    );
    expect(entry).toContain("**Stale classes and label lines (Story 40.4).**");
    expect(entry).toContain("`lineMap` in the run's Status record: 10, or 0 once a documentation-only save removed it");
    expect(entry).toContain("so it is exact when two method names share their first 31 characters");
    expect(entry).toContain("A class is `not-up-to-date` exactly when its `lineMap` is 0 while some method that compiled to INT code has a label line");
    expect(entry).toContain("A record stored without `lineMap` (by an older service build) is judged by its shape as before.");
    expect(entry).toContain("would read `not-up-to-date`: a false FAIL, never a false PASS");
    expect(entry).toContain("one probe of a newly created class found no line map right after its compile, once, and about 30 later runs did not repeat it");
    expect(entry).toContain(
      "A method whose name begins with a percent sign (`%OnNew`, for example) has an empty `RtnLabel` when its label is its name cut to 31 characters, and that label is its label line, so a stale class of such methods is `not-up-to-date` too.",
    );
    expect(entry, "the fixed limits are no longer stated as limits").not.toMatch(/has no compiled label, so it has no label line|is read as initializing/);
    expect(entry).toContain("Earliest IRIS version verified: 2026.2 build 221U.");
  });

  it("the iris_test_coverage entry has the CI recipe: enable, call with a target, poll, read the verdict, export", () => {
    const entry = detailEntry(devReadme, "iris_test_coverage");
    expect(entry).toContain("**A CI recipe (Story 40.4).**");
    expect(entry).toContain("1. The operator enables the keys");
    expect(entry).toContain("2. Call `iris_test_coverage` with `target`, `level`, `classes` (the classes under test, not the test classes) and `minCoverage` set to the pipeline's gate.");
    expect(entry).toContain('3. A `status: "running"` result is polled with `iris_test_status` (`action: "poll"`, the `coverageRunId`) until it completes; never re-submit.');
    expect(entry).toContain("`fail` (a result, not a tool error: `isError` stays `false`)");
    expect(entry).toContain(
      "or `notApplicable` (no class has an executable class line, so there is nothing to export). Fail the pipeline on `fail`, and on `notApplicable` too: it means nothing was measured, so check `classes`. Step 5 works for a failing verdict too, so export first when the CI tool should read the file of a failing run.",
    );
    expect(entry).toContain('5. Call `iris_test_status` with `action: "export"`, the `coverageRunId`, an absolute `outputPath` ending `.xml`');
  });

  it("the Prompts row for deploy-and-test-class names the coverage step and its cases", () => {
    const row = lineStarting(devReadme, "| `deploy-and-test-class`");
    expect(row).toContain("It tells the model what a `PRODUCTION_BUSY` refusal means");
    expect(row).toContain("only when the user asks for coverage, adds an optional last step that runs `iris_test_coverage`");
    expect(row).toContain("a hidden tool (outside `core`), a `GOVERNANCE_DISABLED` or `MONITOR_BUSY` refusal and a `running` result (Story 40.4)");
  });

  it("the intro names line coverage", () => {
    expect(squash(devReadme.slice(0, 700))).toContain("unit testing with line coverage (a verdict against a target, and a Cobertura file for CI)");
  });
});

describe("Story 40.4: the root README has the Test coverage section", () => {
  const start = rootReadme.indexOf("### Test coverage (Epic 40)");
  const end = rootReadme.indexOf("### Worked example", start);
  const section = squash(rootReadme.slice(start, end));

  it("sits between the Message forensics section and the worked example", () => {
    expect(start, "the section exists").toBeGreaterThan(-1);
    expect(rootReadme.indexOf("### Message forensics (Epic 39)")).toBeLessThan(start);
    expect(end).toBeGreaterThan(start);
    expect(rootReadme.slice(start, end).split("\n").filter((line) => line.startsWith("## ") || line.startsWith("### "))).toEqual([
      "### Test coverage (Epic 40)",
    ]);
  });

  it("has the key table with each default state, the enabling setting and the loop", () => {
    expect(section).toContain("| Key | What it does | Default state |");
    expect(section).toMatch(/\| `iris_test_coverage` \| Runs the tests of a `target` [^|]* \| a write, \*\*DEFAULT-DISABLED\*\* \|/);
    expect(section).toMatch(/\| `iris_test_status:poll` \| [^|]* \| a read, enabled by default \|/);
    expect(section).toMatch(/\| `iris_test_status:cancel` \| [^|]* \| a write, \*\*DEFAULT-DISABLED\*\* \|/);
    expect(section).toMatch(/\| `iris_test_status:export` \| [^|]* \| a write, \*\*DEFAULT-DISABLED\*\* \|/);
    expect(section).toContain("`iris_execute_tests` is classified a write and is enabled by default (a key of the frozen baseline).");
    expect(section).toContain(`IRIS_GOVERNANCE=${ENABLE_RECIPE}`);
    expect(section).toContain('A result with `status: "running"` is not final: call `iris_test_status` with `action: "poll"` and the `coverageRunId` until it completes, and never re-submit.');
    expect(section).toContain("A failing verdict is a result (`isError: false`), not a tool error.");
  });

  it("states the minCoverage default, the export path rules, the guards, the presets and the prompt", () => {
    expect(section).toContain("Omitted, there is no verdict: the result carries no `coverage.verdict` and no run is judged on its percentage.");
    expect(section).toContain("`outputPath` must be absolute, contain no `..` segment and end in `.xml`; the parent directories are created and an existing file is overwritten.");
    expect(section).toContain("Only a completed run in which at least one class has an executable class line can be exported");
    expect(section).toContain("a class that is `not-up-to-date` is left out of the file rather than written as a class with no lines");
    expect(section).toContain("A failing verdict can still be exported.");
    expect(section).toContain("a call is refused with `MONITOR_BUSY` (see the refusal table above) while any Line-by-Line or PERFMON session is active, and a foreign session is never touched.");
    expect(section).toContain("A run that includes `%UnitTest.TestProduction` tests is refused with `PRODUCTION_BUSY` while a different production runs in the namespace");
    expect(section).toContain("The `developer` preset shows `iris_test_coverage` and `iris_test_status`; the `core` preset hides both, and a hidden tool cannot be called.");
    expect(section).toContain("`deploy-and-test-class` runs the coverage step only when the user asks how much of the code the tests cover or gives a target.");
  });

  it("adds no line to the refusal table and no claim about a preset window: each refusal code starts one line", () => {
    for (const code of ["MONITOR_BUSY", "PRODUCTION_BUSY"]) {
      const starting = rootReadme.split("\n").filter((line) => line.startsWith(`| \`${code}\``));
      expect(starting, `one README line starts with | \`${code}\``).toHaveLength(1);
    }
    expect(section, "the section makes no claim about the size of a preset window").not.toMatch(/8- to 15-tool|8 to 15/);
  });

  it("the prompts row names the coverage step, and the payload table is re-measured at this story", () => {
    const row = lineStarting(rootReadme, "| `@iris-mcp/dev` | `deploy-and-test-class`");
    expect(row).toContain("and, only when the user asks, measures their line coverage (`iris_test_coverage`; see [Test coverage](#test-coverage-epic-40))");
    expect(squash(rootReadme)).toContain("Last re-measured at Story 40.4 (`pnpm measure:tools-payload` on freshly built dists");
    expect(lineStarting(rootReadme, "| @iris-mcp/dev | 33 /")).toBe("| @iris-mcp/dev | 33 / 94,932 / ~23,733 | 15 / 44,355 / ~11,089 | 33 / 94,932 / ~23,733 |");
  });
});

describe("Story 40.4: tool_support.md", () => {
  it("the iris_execute_tests row says write and enabled by default, with the corrected hints", () => {
    const row = lineStarting(toolSupport, "| 15 | `iris_execute_tests`");
    expect(row).toContain("classified `write` and **enabled by default** (a baseline key), and since Story 40.4 it declares `readOnlyHint: false` and `idempotentHint: false`");
  });

  it("has the Story 40.4 note after the Story 40.3 one: the counts, every default state, the five changes and the bootstrap move", () => {
    const note = lineStarting(toolSupport, "> **Story 40.4");
    expect(note, "tool_support.md has the Story 40.4 note").not.toBe("");
    expect(note).toContain(`> **Story 40.4 (2026-10-18) ${EM_DASH} governance defaults, the Epic 40 rollup:**`);
    expect(note).toContain("no tool, action or governance key is added, so no default state and no tool count moves (110 package tools, 115 advertised; dev stays at 32 package tools and the `core` preset at 14 package tools, 15 runtime tools; the frozen baseline stays `1e62c5ad5bf7`, 141 keys; 13 prompts; 10 refusal codes)");
    expect(note).toContain("`iris_test_coverage` is a `write` and **DEFAULT-DISABLED**; `iris_test_status:poll` is a `read`, **enabled**; `iris_test_status:cancel` and `iris_test_status:export` are `write` and **DEFAULT-DISABLED**; `iris_execute_tests` is classified `write` and is **enabled by default** (a key of the frozen baseline)");
    expect(note).toContain(`IRIS_GOVERNANCE=${ENABLE_RECIPE}`);
    expect(note).toContain("`minCoverage` omitted means no verdict.");
    expect(note).toContain("The `developer` preset shows both coverage tools and `core` hides them.");
    expect(note).toContain("(1) DW-498, a sanctioned AD-15 annotation correction (orchestrator decision #63): `iris_execute_tests` now declares `readOnlyHint: false` and `idempotentHint: false`");
    expect(note).toContain("`destructiveHint` and `openWorldHint` stay `false`, and its key, classification, description and the frozen baseline do not change.");
    expect(note).toContain("(2) The `deploy-and-test-class` prompt gains an optional coverage step and a `PRODUCTION_BUSY` note");
    expect(note).toContain("(orchestrator decision #62)");
    expect(note).toContain("(3) DW-601:");
    expect(note).toContain("(4) DW-602:");
    expect(note).toContain("(5) `iris_test_status` returns an error result with `structuredContent` for the three reads of `%UnitTest_Result` that could still throw.");
    expect(note).toContain(`\`BOOTSTRAP_VERSION\` moves \`${BOOTSTRAP_FROM}\` ${ARROW} \`${BOOTSTRAP_TO}\``);
    expect(note).toContain("(35 bootstrapped classes, unchanged)");
    expect(note).toContain("Earliest IRIS version verified: 2026.2 build 221U");
    expect(toolSupport.indexOf("> **Story 40.3"), "after the Story 40.3 note").toBeLessThan(toolSupport.indexOf("> **Story 40.4"));
  });

  it("keeps the suite at 110 package tools and 115 advertised", () => {
    expect(toolSupport).toContain("| `@iris-mcp/dev` | 20 | 12 | 0 | **32** | **33** |");
    expect(toolSupport).toContain("| **Total** | **20** | **85** | **5** | **110** | **115** |");
  });
});

describe("Story 40.4: the CHANGELOG section and the changeset", () => {
  const changelog = read("CHANGELOG.md");
  const sections = sectionsOf(changelog);
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("has the Story 40.4 section first, above the Story 40.3 one, with Changed, Fixed, Documentation, Tests and Known limits headings", () => {
    expect(section, "the CHANGELOG has the Story 40.4 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual([
      "### Changed",
      "### Fixed",
      "### Documentation",
      "### Tests",
      "### Known limits",
    ]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 40.3:"));
    expect(previous, "the CHANGELOG still has the Story 40.3 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states the unchanged counts and the bootstrap move as literals", () => {
    const text = squash(section);
    expect(text).toContain("No tool, action or governance key is added, so no tool count moves (the Development server stays at 32 package tools, 33 advertised; the suite at 110 package tools, 115 advertised)");
    expect(text).toContain("The prompt pack stays at 13 prompts (5 on the Development server), the `core` preset at 14 package tools (15 runtime tools), the `developer` preset at 32 package tools (33 advertised), the refusal-code catalog at 10 codes");
    expect(text).toContain("hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
    expect(text).toContain("(the bootstrapped service stays at 35 classes)");
  });

  it("Changed records the annotation correction and the prompt change with their decisions, and the snapshot regeneration", () => {
    const text = squash(section);
    expect(text).toContain("`iris_execute_tests` declares the hints of a write (DW-498; a sanctioned AD-15 change, orchestrator decision #63).");
    expect(text).toContain("`destructiveHint` and `openWorldHint` stay `false`");
    expect(text).toContain("nothing in this suite reads the hints");
    expect(text).toContain("An MCP client that does read them now treats the tool as a write");
    expect(text).toContain("`iris_execute_tests` stays classified `write` and **enabled by default**");
    expect(text).toContain("`pnpm gen:tools-list-snapshot --force`");
    expect(text).toContain("(orchestrator decision #29)");
    expect(text).toContain("it differs only in the annotations of `iris_execute_tests`");
    expect(text).toContain("The `deploy-and-test-class` prompt gains an optional coverage step and a `PRODUCTION_BUSY` note (orchestrator decision #62, AD-15).");
    expect(text).toContain("its name, title and argument (`classOrPackage`) are unchanged");
  });

  it("Fixed records DW-601, DW-602 and the status paths, and the additive Status route", () => {
    const text = squash(section);
    expect(text).toContain("(DW-601)");
    expect(text).toContain("`lineMap`, `$Data(^rMAP(<class>))`: 10 fresh, 0 after a documentation-only save");
    expect(text).toContain("(`RtnLabel`, `label^routine`), which is exact");
    expect(text).toContain(
      "A method whose name begins with a percent sign (`%OnNew`, for example) has an empty `RtnLabel` when its label is its name cut to 31 characters (the second of two such names that share them is given a `RtnLabel` of its own), so that label is used: a stale class whose only methods are named so is `not-up-to-date` too, not a class with no executable lines.",
    );
    expect(text).toContain("An initializing `#dim` is an executable class line (DW-602).");
    expect(text).toContain("A `#dim` line that holds an `=` outside parentheses, string literals and comments compiles to a `Set` at its own INT line");
    expect(text).toContain("that includes a `#dim` whose only `=` is in a trailing `//`, `;` or `/* */` comment");
    expect(text).toContain("`iris_test_status` returns an error result when a read of `%UnitTest_Result` fails (AC 40.4.3).");
    expect(text).toContain(
      "text that says what to do next: the two polls say to poll again by `runIndex` and not to re-submit, and the cancel says to poll by `runIndex` to observe the run.",
    );
    expect(text).toContain("The Status route of the coverage service returns a superset (AD-33): every earlier field, and `lineMap` on every class that has a map.");
  });

  it("Known limits records the residuals and the IRIS version", () => {
    const text = squash(section);
    expect(text).toContain("would read `not-up-to-date`: a false FAIL in the direction of caution, never a false PASS.");
    expect(text).toContain("One probe of a newly created class found no line map right after its compile, once; about 30 later runs did not repeat it, and its cause is not known.");
    expect(text, "the two limits Story 40.4's review fixed are not listed").not.toMatch(/has no compiled label \(its `RtnLabel` is empty\)|is read as initializing/);
    expect(text).toContain("Earliest IRIS version verified: 2026.2 build 221U.");
  });

  it("holds no roster-summary string and quotes no other section's title", () => {
    const text = squash(section);
    expect(text).not.toMatch(/`(?:full|core|developer)` \d+\/\d+\/\d+\/\d+\/\d+/);
    for (const other of sections) {
      const title = (other.split("\n")[0] ?? "").trim();
      if (CHANGELOG_TITLE.test(title)) continue;
      expect(text, `the section quotes the title "${title}"`).not.toContain(title);
    }
  });

  it("the corrected sentences are in place in the earlier sections", () => {
    const flat = squash(changelog);
    expect(flat).toContain("a preprocessor line (`#dim` that initializes nothing, `#define`, `#sqlcompile` and the like) is never a class line (a `#dim` that holds an `=` outside parentheses, string literals and comments compiles to a `Set` and is one, since Story 40.4)");
    expect(flat).toContain("`iris_execute_tests` stays enabled by default (a baseline key, classified `write`), and `iris_test_coverage` stays a write, DEFAULT-DISABLED; the guard has no switch and adds no key");
  });

  it("the changeset bumps @iris-mcp/dev and @iris-mcp/shared by a patch and records the default states and the bootstrap move", () => {
    const dir = path.join(REPO_ROOT, ".changeset");
    expect(existsSync(dir)).toBe(true);
    const file = readdirSync(dir).find((name) => name === "story-40-4-test-depth-docs-prompt-and-capstone.md");
    expect(file, "the changeset exists").toBeDefined();
    const text = readFileSync(path.join(dir, file as string), "utf8");
    expect(text.startsWith('---\n"@iris-mcp/dev": patch\n"@iris-mcp/shared": patch\n---\n')).toBe(true);
    expect(text).toContain("`iris_execute_tests` now declares `readOnlyHint: false` and `idempotentHint: false` (DW-498)");
    expect(text).toContain("the tool stays classified `write` and enabled by default");
    expect(text).toContain("`iris_test_coverage` stays a write and DEFAULT-DISABLED");
    expect(text).toContain("`minCoverage` omitted means no verdict");
    expect(text).toContain("No tool is added and no tool count moves.");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
  });
});

describe("Story 40.4: no document still calls iris_execute_tests a read, and no new text claims regulatory compliance", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";
  const changeset = read(".changeset/story-40-4-test-depth-docs-prompt-and-capstone.md");

  it("none of the documents says iris_execute_tests stays a read", () => {
    const documents: Array<[string, string]> = [
      ["README.md", rootReadme],
      ["tool_support.md", toolSupport],
      ["CHANGELOG.md", read("CHANGELOG.md")],
      ["packages/iris-dev-mcp/README.md", devReadme],
      ...readdirSync(path.join(REPO_ROOT, "packages"))
        .filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "README.md")))
        .map((dir): [string, string] => [`packages/${dir}/README.md`, read(`packages/${dir}/README.md`)]),
    ];
    expect(documents.length).toBeGreaterThanOrEqual(8);
    for (const [name, text] of documents) {
      expect(squash(text).match(/`iris_execute_tests` stays a \*{0,2}read/)?.[0], `${name} calls iris_execute_tests a read`).toBeUndefined();
    }
  });

  for (const [name, text] of [
    ["the CHANGELOG section", section],
    ["the Story 40.4 note of tool_support.md", lineStarting(toolSupport, "> **Story 40.4")],
    ["the root README section", rootReadme.slice(rootReadme.indexOf("### Test coverage (Epic 40)"), rootReadme.indexOf("### Worked example"))],
    ["the changeset", changeset],
    ["skills/deploy-and-test-class/SKILL.md", read("skills/deploy-and-test-class/SKILL.md")],
  ] as const) {
    it(`${name} makes no compliance claim`, () => {
      expect(text.length, `${name} is not empty`).toBeGreaterThan(0);
      for (const claim of CLAIMS) expect(text.match(claim)?.[0], `${name} matches ${String(claim)}`).toBeUndefined();
    });
  }
});
