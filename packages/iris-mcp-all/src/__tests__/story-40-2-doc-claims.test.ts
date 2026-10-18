/**
 * Story 40.2 -- the documents state the coverage reports and targets with the default state of the new key at the point of use
 * (project rules #30 and #43), the CHANGELOG and the changeset record the story, the DTD pin is the one the validator encodes, and
 * no new text claims regulatory compliance (AD-26).
 *
 * The unit and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the Development README: the two tool rows with their new arguments, the Governance defaults line (`iris_test_status:export`,
 *    DEFAULT-DISABLED, the enable recipe), the class-source, verdict, loaded-routines and Cobertura paragraphs of the coverage
 *    detail entry, and the `export` section of the `iris_test_status` detail entry;
 *  - `tool_support.md`: rows 29 and 32 and the Story 40.2 note after the Story 40.1 note;
 *  - the CHANGELOG section above the Story 40.1 one: the counts (unchanged), the new key and its default state, the bootstrap move
 *    as literals, the snapshot regeneration and the additive Status and Start routes;
 *  - the changeset's bump map;
 *  - the DTD pin: `scripts/lib/cobertura-dtd.mjs` records the pinned copy (commit and sha256), and no DTD file is vendored.
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
const toolSupport = read("tool_support.md");

const CHANGELOG_TITLE = /^## \[Pre-release \u2014 2026-10-18\] \u2014 Story 40\.2: Coverage reports and targets$/;

/**
 * The `BOOTSTRAP_VERSION` values of the Story 40.2 move, as history literals: `changelog-bootstrap-move.test.ts` ties the newest
 * documented move to the committed embed, so a later move leaves this file true.
 */
const BOOTSTRAP_FROM = "14a4cba6504a";
const BOOTSTRAP_TO = "06b8b83fc319";

const EXPORT_RECIPE = '{"global":{"iris_test_status:export":true}}';

describe("Story 40.2: the Development README", () => {
  it("has the new arguments on both tool rows", () => {
    const coverage = lineStarting(devReadme, "| `iris_test_coverage`");
    expect(coverage).toContain("`target`, `level`, `classes`, `timeout?`, `namespace?`, `minCoverage?`");
    expect(coverage).toContain("per class and per method over the class's own source lines");
    const status = lineStarting(devReadme, "| `iris_test_status`");
    expect(status).toContain("`action`, `jobId?`, `runIndex?`, `coverageRunId?`, `namespace?`, `outputPath?`, `sourceRoot?`");
    expect(status).toContain('`action: "export"` writes a completed coverage run\'s Cobertura XML file to an absolute `outputPath`');
  });

  it("states the export key at the point of use: write, DEFAULT-DISABLED, the recipe, outside the baseline, no defaultEnabled, the annotations", () => {
    const defaults = lineStarting(devReadme, "> **Governance defaults:** `iris_test_status:poll`");
    expect(defaults).toContain("`iris_test_status:export` (Story 40.2) is a third key");
    expect(defaults).toContain("truthfully classified `write` (it writes a local file) and is **DEFAULT-DISABLED**");
    expect(defaults).toContain(`\`${EXPORT_RECIPE}\``);
    expect(defaults).toContain("outside the frozen governance baseline and carries no `defaultEnabled` marker");
    expect(defaults).toContain("`destructiveHint: true`");
    expect(defaults).toContain("`iris_test_coverage` itself never writes a file");
    // The 40.1 sentences of the line are still there.
    expect(defaults).toContain("`iris_test_status:cancel` is truthfully classified `write` and is **DEFAULT-DISABLED**");
  });

  it("has the coverage detail paragraphs: class-source coverage and the line-number note, minCoverage and the verdict, the loaded-routines check, and the Cobertura pointer", () => {
    const start = devReadme.indexOf("<summary><strong>iris_test_coverage</strong>");
    expect(start, "the detail entry exists").toBeGreaterThan(-1);
    const entry = squash(devReadme.slice(start, devReadme.indexOf("</details>", start)));
    expect(entry).toContain("**Coverage of the class source (Story 40.2).**");
    expect(entry).toContain("`coverage.classes[i].source`");
    expect(entry).toContain("a `#define` line, a continuation line of a multi-line statement, a lone `}` and a comment line are never executable");
    expect(entry).toContain("**Class line numbers are those of the class document `iris_doc_get` returns for `<class>.cls`**");
    expect(entry).toContain("which IRIS stores in its own layout");
    expect(entry).toContain("A class without a result has `source: {reason}`, and the reason is one of three:");
    for (const reason of ["not-up-to-date", "not-compiled", "unavailable"]) expect(entry, reason).toContain(`\`${reason}\` (`);
    // The mapping rules of the INT block, the one-line statement and the missing line map.
    expect(entry).toContain("a method that compiles to no INT code (a constant return, for example) has no lines either, and no `reason`");
    expect(entry).toContain("a preprocessor line (`#dim`, `#define`, `#sqlcompile` and the like) is never a class line: the compiler maps a leading one onto the code of the method before it or onto the method's own first statements");
    expect(entry).toContain("**A statement that spans several lines but compiles to one INT line is reported once, at the first line that maps to its code.**");
    expect(entry).toContain("For a multi-line embedded SQL statement that is the line after the `&sql(` line");
    expect(entry).toContain("or its compiled line map is gone");
    expect(entry).toContain("only a forced compile, flags `ck`, rebuilds the map");
    expect(entry).toContain("is counted per class in `generated` and never reported as source lines");
    expect(entry).toContain("**`minCoverage` and the verdict (Story 40.2).**");
    expect(entry).toContain("a rounded 79.995 never passes 80");
    expect(entry).toContain("A failing verdict is still `isError: false`");
    expect(entry).toContain("**A session that did not load every listed routine runs no test (Story 40.2).**");
    expect(entry).toContain("names the routines that were not loaded and says that no test was run");
    expect(entry).toContain("**Cobertura XML (Story 40.2).** `iris_test_coverage` writes no file.");
    expect(entry).toContain(`IRIS_GOVERNANCE=${EXPORT_RECIPE}`);
    expect(entry).toContain("**DEFAULT-DISABLED**");
  });

  it("has the export section of the iris_test_status detail entry: the arguments, the path rules, overwrite, completed runs only", () => {
    const start = devReadme.indexOf("<summary><strong>iris_test_status</strong>");
    expect(start, "the detail entry exists").toBeGreaterThan(-1);
    const entry = squash(devReadme.slice(start, devReadme.indexOf("</details>", start)));
    expect(entry).toContain('**`action: "export"` (write, DEFAULT-DISABLED');
    expect(entry).toContain(EXPORT_RECIPE);
    expect(entry).toContain("`coverageRunId` and `outputPath` are required");
    expect(entry).toContain("must be absolute, contain no `..` segment and end in `.xml` (any letter case)");
    expect(entry).toContain("nothing is sent to IRIS and nothing is written");
    expect(entry).toContain("an existing file is overwritten");
    expect(entry).toContain("**Only a completed run with complete coverage, at least one test run and a class-source map can be exported:**");
    expect(entry).toContain("`cobertura: {outputPath, bytes, classes, lines}`");
    expect(entry).toContain("It validates against the published `coverage-04.dtd`.");
    // A run with no class-source result is refused, and the line numbers need the stored layout in the repository's files.
    expect(entry).toContain("**no class has a class-source result**");
    expect(entry).toContain("the advice to recompile the classes (a forced compile when only comments changed) and run the tests again");
    expect(entry).toContain("would read to a CI tool as 100% covered");
    expect(entry).toContain("so is a completed run in which **no class has an executable class line**");
    expect(entry).toContain("**CI tools lay the reported line numbers over your repository's own `.cls` files**");
    expect(entry).toContain("in the layout IRIS stores (for example as `iris_doc_export` writes them), or the numbers can be offset");
  });

  it("lists iris_test_status in the root README's default-disabled table: cancel and export disabled, poll enabled", () => {
    const row = lineStarting(read("README.md"), "| dev | `iris_test_status` |");
    expect(row, "the root README has the iris_test_status row").not.toBe("");
    expect(row).toContain('`cancel` (Story 40.1: stops a running test or coverage run; enable it with `{"global":{"iris_test_status:cancel":true}}`)');
    expect(row).toContain(`\`export\` (Story 40.2: writes a completed coverage run's Cobertura XML to a local file; enable it with \`${EXPORT_RECIPE}\`)`);
    expect(row).toContain("`poll` (a read: re-attaches to a test or coverage run; Story 36.2)");
  });

  it("states the counts unchanged: 33 runtime tools under developer, 32 package tools", () => {
    const text = squash(devReadme);
    expect(text).toContain("**33 runtime tools** (32 + `iris_server_profiles`)");
    expect(text).toContain("**All 32 tools in this package accept the `namespace` parameter**");
  });
});

describe("Story 40.2: tool_support.md", () => {
  it("row 29 names the export action, its default state and its key; row 32 the class-source summary", () => {
    const row29 = lineStarting(toolSupport, "| 29 | `iris_test_status`");
    expect(row29).toContain("Since Story 40.2 a third action, `export`, writes a completed coverage run's Cobertura XML to an absolute `outputPath`");
    expect(row29).toContain("`write` and **DEFAULT-DISABLED** (`iris_test_status:export`, outside the frozen baseline, no `defaultEnabled` marker)");
    const row32 = lineStarting(toolSupport, "| 32 | `iris_test_coverage`");
    expect(row32).toContain("since Story 40.2 also per class and per method over the class's own source lines");
    expect(row32).toContain("the Status route returning the class-source map as `sources`");
    expect(row32).toContain("`write` and **DEFAULT-DISABLED**");
  });

  it("has the Story 40.2 note after the Story 40.1 note: the key, the default state, the unchanged counts, the bootstrap move, DW-598 and the IRIS version", () => {
    const note = lineStarting(toolSupport, "> **Story 40.2");
    expect(note, "tool_support.md has the Story 40.2 note").not.toBe("");
    expect(note).toContain("> **Story 40.2 (2026-10-18) \u2014 governance defaults, coverage reports and targets:**");
    expect(note).toContain("no tool is added, so no tool count moves (110 package tools, 115 advertised; dev stays at 32 package tools");
    expect(note).toContain("the frozen baseline stays `1e62c5ad5bf7`, 141 keys");
    expect(note).toContain("a third governance key, `iris_test_status:export`");
    expect(note).toContain("truthfully classified `write` and therefore **DEFAULT-DISABLED**");
    expect(note).toContain(`IRIS_GOVERNANCE=${EXPORT_RECIPE}`);
    expect(note).toContain("outside the frozen baseline and carries no `defaultEnabled` marker");
    expect(note).toContain("`iris_test_coverage` writes no file");
    expect(note).toContain("an optional `minCoverage` (0 to 100)");
    expect(note).toContain("a failing verdict is not a tool error");
    expect(note).toContain("(`minCoverage`, `sources`)");
    expect(note).toContain("ends `failed` before any test runs, naming the routines (DW-598)");
    expect(note).toContain(`\`BOOTSTRAP_VERSION\` moves \`${BOOTSTRAP_FROM}\` ${ARROW} \`${BOOTSTRAP_TO}\``);
    expect(note).toContain("35 bootstrapped classes, unchanged");
    expect(note).toContain("Earliest IRIS version verified: 2026.2 build 221U");
    expect(toolSupport.indexOf("> **Story 40.1"), "after the Story 40.1 note").toBeLessThan(toolSupport.indexOf("> **Story 40.2"));
  });

  it("keeps the suite at 110 package tools and 115 advertised", () => {
    expect(toolSupport).toContain("| `@iris-mcp/dev` | 20 | 12 | 0 | **32** | **33** |");
    expect(toolSupport).toContain("| **Total** | **20** | **85** | **5** | **110** | **115** |");
  });
});

describe("Story 40.2: the CHANGELOG section and the changeset", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("has the Story 40.2 section first, above the Story 40.1 one, with Added and Changed headings", () => {
    expect(section, "the CHANGELOG has the Story 40.2 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Added", "### Changed"]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 40.1:"));
    expect(previous, "the CHANGELOG still has the Story 40.1 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states the unchanged counts, the new key and its default state, the bootstrap move as literals, the snapshot regeneration and the additive routes", () => {
    const text = squash(section);
    expect(text).toContain("No tool is added, so no tool count moves (the Development server stays at 32 package tools, 33 advertised; the suite at 110 package tools, 115 advertised)");
    expect(text).toContain("The prompt pack stays at 13 prompts");
    expect(text).toContain("hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
    expect(text).toContain("(the bootstrapped service stays at 35 classes)");
    expect(text).toContain("**Default state: DEFAULT-DISABLED.**");
    expect(text).toContain(`IRIS_GOVERNANCE=${EXPORT_RECIPE}`);
    expect(text).toContain("`iris_test_status:export`, truthfully classified `write`");
    expect(text).toContain("outside the frozen baseline, with no `defaultEnabled` marker");
    expect(text).toContain("`iris_test_coverage` writes no file, and the annotations of both tools are unchanged");
    expect(text).toContain("a failing verdict is `isError: false`");
    expect(text).toContain("**Class line numbers are those of the document `iris_doc_get` returns for the class**");
    for (const reason of ["not-up-to-date", "not-compiled", "unavailable"]) expect(text, reason).toContain(`\`${reason}\` (`);
    expect(text).toContain("a method that compiles to no INT code (a constant return) has no lines and no `reason`");
    expect(text).toContain("a preprocessor line (`#dim`, `#define`, `#sqlcompile` and the like) is never a class line");
    expect(text).toContain("**A statement that spans several lines but compiles to one INT line is reported once, at the first line that maps to its code: for a multi-line embedded SQL statement, the line after the `&sql(` line.**");
    expect(text).toContain("or its compiled line map is gone");
    expect(text).toContain("a forced compile, flags `ck`, rebuilds the map");
    expect(text).toContain("a completed run in which no class has a class-source result or no class has an executable class line");
    expect(text).toContain("CI tools lay the reported line numbers over the repository's own `.cls` files");
    expect(text).toContain("Earliest IRIS version verified: 2026.2 build 221U");
    expect(text).toContain("(DW-598)");
    expect(text).toContain("`pnpm gen:tools-list-snapshot --force`");
    expect(text).toContain("it differs only in the `iris_test_coverage` entry (the `minCoverage` property and the description) and the `iris_test_status` entry");
    expect(text).toContain("`Start` accepts every 40.1 request unchanged");
    expect(text).toContain("A Status record without `sources` gives exactly the 40.1 result and text.");
    expect(text).toContain("DW-596 is closed with evidence");
  });

  it("the changeset bumps @iris-mcp/dev by a minor and @iris-mcp/shared by a patch, and records the default state and the bootstrap move", () => {
    const dir = path.join(REPO_ROOT, ".changeset");
    expect(existsSync(dir)).toBe(true);
    const file = readdirSync(dir).find((name) => name === "story-40-2-coverage-reports-and-targets.md");
    expect(file, "the changeset exists").toBeDefined();
    const text = readFileSync(path.join(dir, file as string), "utf8");
    expect(text.startsWith('---\n"@iris-mcp/dev": minor\n"@iris-mcp/shared": patch\n---\n')).toBe(true);
    expect(text).toContain("**DEFAULT-DISABLED**");
    expect(text).toContain(`IRIS_GOVERNANCE=${EXPORT_RECIPE}`);
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
    expect(text).toContain("No tool is added and no tool count moves.");
  });

  it("no Story 40.2 text claims regulatory compliance (AD-26)", () => {
    const texts = [
      section,
      lineStarting(toolSupport, "> **Story 40.2"),
      read(".changeset/story-40-2-coverage-reports-and-targets.md"),
      read("scripts/lib/cobertura-dtd.mjs"),
    ];
    for (const text of texts) {
      for (const claim of CLAIMS) expect(text, String(claim)).not.toMatch(claim);
    }
  });
});

describe("Story 40.2: the DTD pin (decision #52)", () => {
  const validator = read("scripts/lib/cobertura-dtd.mjs");

  it("the validator records the pinned copy of coverage-04.dtd: repository, path, commit and sha256", () => {
    expect(validator).toContain("repository `cobertura/web`, file `htdocs/xml/coverage-04.dtd`");
    expect(validator).toContain("commit `f0366e5e2cf18f111cbd61fc34ef720a6584ba02` (2013-05-22), 2,030 bytes");
    expect(validator).toContain("sha256 `61fbbc0a260337fe9ad59bd671b52e5f2677978a41e1e5bb7ae594fa01252d06`");
    expect(validator).toContain("It copies no text, comment or notice from the DTD, and\n * no DTD file is vendored.");
  });

  it("no DTD file is vendored anywhere a package could publish or a test could read it from", () => {
    const found: string[] = [];
    const walk = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
        const full = path.join(directory, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.toLowerCase().endsWith(".dtd")) found.push(path.relative(REPO_ROOT, full));
      }
    };
    for (const root of ["scripts", "packages", "src", "docs"]) {
      if (existsSync(path.join(REPO_ROOT, root))) walk(path.join(REPO_ROOT, root));
    }
    expect(found).toEqual([]);
  });

  it("the written document names the published DTD, and the dev package writes it through the validator's system id", () => {
    const cobertura = read("packages/iris-dev-mcp/src/tools/cobertura.ts");
    expect(cobertura).toContain(
      '<!DOCTYPE coverage SYSTEM "https://raw.githubusercontent.com/cobertura/web/master/htdocs/xml/coverage-04.dtd">',
    );
    expect(validator).toContain('export const COBERTURA_SYSTEM_ID = "https://raw.githubusercontent.com/cobertura/web/master/htdocs/xml/coverage-04.dtd";');
  });
});
