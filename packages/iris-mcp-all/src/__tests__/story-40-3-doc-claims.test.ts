/**
 * Story 40.3 -- the documents state the TestProduction guard, its refusal code, its default state at the point of use (project rules
 * #30 and #43) and its limits, the CHANGELOG and the changeset record the story, and no new text claims regulatory compliance (AD-26).
 *
 * The unit and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the Development README: the two tool rows, the guard section of the `iris_execute_tests` detail entry (the rule, the refusal
 *    and its fields, the recovery, the limits) and the guard paragraph of the `iris_test_coverage` detail entry;
 *  - the root README's refusal table and the shared package README: `PRODUCTION_BUSY`;
 *  - `tool_support.md`: rows 15 and 32, the ExecuteMCPv2-dependence qualification and the Story 40.3 note after the Story 40.2 note;
 *  - the CHANGELOG section above the Story 40.2 one: the counts (unchanged; 10 refusal codes), the bootstrap move as literals, the
 *    snapshot regeneration, the additive route and outcome, the residual risks and the IRIS version;
 *  - the changeset's bump map.
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

const devReadme = read("packages/iris-dev-mcp/README.md");
const toolSupport = read("tool_support.md");

const CHANGELOG_TITLE = new RegExp(`^## \\[Pre-release ${EM_DASH} 2026-10-18\\] ${EM_DASH} Story 40\\.3: TestProduction runs$`);

/**
 * The `BOOTSTRAP_VERSION` values of the Story 40.3 move, as history literals: `changelog-bootstrap-move.test.ts` ties the newest
 * documented move to the committed embed, so a later move leaves this file true.
 */
const BOOTSTRAP_FROM = "06b8b83fc319";
const BOOTSTRAP_TO = "845e95f6e726";

describe("Story 40.3: the Development README", () => {
  it("names the guard and the code on both tool rows, and keeps the arguments", () => {
    const tests = lineStarting(devReadme, "| `iris_execute_tests`");
    expect(tests).toContain("Since Story 40.3 a run that includes `%UnitTest.TestProduction` tests is refused with `PRODUCTION_BUSY` while a different production runs in the namespace");
    expect(tests).toContain("the tool stays enabled; no new key");
    expect(tests).toContain("`target`, `level`, `timeout?`, `namespace?` | -- |");
    const coverage = lineStarting(devReadme, "| `iris_test_coverage`");
    expect(coverage).toContain("since Story 40.3 it asks the same TestProduction guard as `iris_execute_tests` and refuses a run with `PRODUCTION_BUSY`");
    expect(coverage).toContain("`target`, `level`, `classes`, `timeout?`, `namespace?`, `minCoverage?` | destructive |");
  });

  it("has the guard section of the iris_execute_tests detail entry: the rule, the refusal and its fields, the recovery and the limits", () => {
    const start = devReadme.indexOf("<summary><strong>iris_execute_tests</strong>");
    expect(start, "the detail entry exists").toBeGreaterThan(-1);
    const entry = squash(devReadme.slice(start, devReadme.indexOf("</details>", start)));
    expect(entry).toContain("### TestProduction guard (Story 40.3)");
    expect(entry).toContain("it **stops any production in the namespace that is not stopped**");
    expect(entry).toContain("a method-level run of such a class is guarded whatever the method");
    expect(entry).toContain("the run **goes ahead** when the namespace's production is stopped, or is one of the productions the run's TestProduction tests declare as their own (their `PRODUCTION` parameter)");
    expect(entry).toContain('it is **refused** with `isError: true`, `code: "PRODUCTION_BUSY"`');
    expect(entry).toContain("Ens's production lifecycle lock could not be taken within 5 seconds");
    expect(entry).toContain("Nothing is queued, no test runs, and that production is left untouched.");
    expect(entry).toContain('"code": "PRODUCTION_BUSY"');
    expect(entry).toContain('when it could not be read, `state` is `"Unknown"` and `error` says why instead');
    expect(entry).toContain("A run with no TestProduction test is unaffected: it never reads Ens state and its result is byte-identical to before.");
    expect(entry).toContain("The tool stays **enabled by default** and no governance key is added; the guard has no switch.");
    expect(entry).toContain("stop it with `iris_production_control` and run the tests again");
    expect(entry).toContain("The suite **never stops a production itself**");
    expect(entry).toContain("against a server whose service lacks it (the guard route answers 404) the run goes ahead unguarded, as before");
    expect(entry).toContain("so a production started by another process in between would still be stopped");
    expect(entry).toContain("So does a run in a namespace that cannot see the `ExecuteMCPv2` package (no `%ALL` package mapping, as after a manual setup): the guard cannot run there.");
    expect(entry).toContain("A production that is already running under a name one of the run's tests declares is treated as that run's own and is stopped by the run, whoever started it: by its own test, which restarts it for the test, or by another TestProduction test of the same run.");
    expect(entry).toContain("is force-stopped and cleaned with `CleanProduction(1)`, which also deletes its persistent application data, and the run leaves it Stopped");
    expect(entry).toContain("A guard read that fails for any reason other than a 404 ends the call before anything is queued (an HTTP 5xx or 403 with the usual `Error executing tests` result, a connection error with the server's own tool error)");
    expect(entry).toContain("even for a run with no TestProduction test");
    expect(entry).toContain("Privileges were verified under `_SYSTEM` only");
    expect(entry).toContain("Earliest IRIS version verified: 2026.2 build 221U.");
  });

  it("has the guard paragraph of the iris_test_coverage detail entry: compiled classes only, no run id, no monitor session", () => {
    const start = devReadme.indexOf("<summary><strong>iris_test_coverage</strong>");
    expect(start, "the detail entry exists").toBeGreaterThan(-1);
    const entry = squash(devReadme.slice(start, devReadme.indexOf("</details>", start)));
    expect(entry).toContain("**TestProduction guard (Story 40.3).**");
    expect(entry).toContain("asks the same IRIS-side guard as `iris_execute_tests`, before it allocates a run id");
    expect(entry).toContain("only the compiled test classes are asked, because the runner never compiles");
    expect(entry).toContain("the target itself when a package-level target holds no test class, because the runner then runs it as a class");
    expect(entry).toContain('refused with `isError: true` and `code: "PRODUCTION_BUSY"`');
    expect(entry).toContain("No run id is allocated, nothing is written and no monitor session is started");
    expect(entry).toContain("With no other production running the run completes as before and leaves its own production stopped.");
    expect(entry).toContain(
      "A `target` whose package or class part (before the first `:`) is empty or blank, such as `:` or `:TestSomething`, is rejected before anything starts, by the tool's schema and by the service",
    );
    expect(entry).toContain("the runner would read it as every compiled test class under `^UnitTestRoot`, which the guard cannot check");
    expect(entry).toContain(
      "In a namespace where the guard cannot run (the `ExecuteMCPv2` classes are not visible there, or it holds its own copy of an earlier build) `iris_test_coverage` is refused with an error and nothing is started, where `iris_execute_tests` goes ahead unguarded.",
    );
  });

  it("the iris_execute_tests limits name the namespace that holds its own copy of an earlier build, without ProductionGuard", () => {
    const start = devReadme.indexOf("<summary><strong>iris_execute_tests</strong>");
    const entry = squash(devReadme.slice(start, devReadme.indexOf("</details>", start)));
    expect(entry).toContain(
      "So does a run in a namespace that holds its own copy of an earlier build of the package, one without `ExecuteMCPv2.REST.UnitTest:ProductionGuard`.",
    );
  });

  it("the iris_execute_tests method-level validation names the method segment that holds ';', ',' or '^'", () => {
    const start = devReadme.indexOf("<summary><strong>iris_execute_tests</strong>");
    const entry = squash(devReadme.slice(start, devReadme.indexOf("</details>", start)));
    expect(entry).toContain("So does a method segment that holds `;`, `,` or `^` (Story 40.3)");
    expect(entry).toContain(
      "the run would include classes the TestProduction guard never inspected, or code that is not a test. Nothing is asked or queued.",
    );
  });
});

describe("Story 40.3: the refusal code is documented where the other codes are", () => {
  it("the root README's refusal table has PRODUCTION_BUSY with what happened and what to do", () => {
    const row = lineStarting(read("README.md"), "| `PRODUCTION_BUSY`");
    expect(row, "the root README has the PRODUCTION_BUSY row").not.toBe("");
    expect(row).toContain("A run that includes `%UnitTest.TestProduction` tests was not started");
    expect(row).toContain("Returned by `iris_execute_tests` and `iris_test_coverage` (Story 40.3)");
    expect(row).toContain("`state` `Unknown`, with `error`");
    expect(row).toContain("that production is left untouched");
    expect(row).toContain("a server without the guard route runs unguarded");
    expect(row).toContain("stop it with `iris_production_control` and run the tests again");
  });

  it("the shared package README lists REFUSAL_CODES.PRODUCTION_BUSY", () => {
    const line = lineStarting(read("packages/shared/README.md"), "- **`REFUSAL_CODES.PRODUCTION_BUSY`**");
    expect(line).toContain("a run that includes `%UnitTest.TestProduction` tests while a different production runs in the namespace");
    expect(line).toContain("(Story 40.3)");
  });
});

describe("Story 40.3: tool_support.md", () => {
  it("row 15 names the guard read, the unchanged key and default state, and the 404 rule; row 32 the coverage side", () => {
    const row15 = lineStarting(toolSupport, "| 15 | `iris_execute_tests`");
    expect(row15).toContain("no new governance key (bare `iris_execute_tests`, unchanged)");
    expect(row15).toContain("since Story 40.3 a `GET /dev/test/production` read (\u{1F7E5} ExecuteMCPv2) before anything is queued refuses a run that includes `%UnitTest.TestProduction` tests while a different production runs (`PRODUCTION_BUSY`)");
    expect(row15).toContain("still with no new key and the tool still enabled by default");
    expect(row15).toContain("a 404 from that route (the service is absent, or older than the guard) leaves the run unguarded, exactly as before");
    const row32 = lineStarting(toolSupport, "| 32 | `iris_test_coverage`");
    expect(row32).toContain("`write` and **DEFAULT-DISABLED**");
    expect(row32).toContain("Since Story 40.3 `Start` asks the TestProduction guard of `iris_execute_tests` (compiled classes only, after the routine checks and before it allocates a run id)");
    expect(row32).toContain("the `production-busy` outcome, which the tool turns into the same `PRODUCTION_BUSY` refusal");
  });

  it("qualifies the ExecuteMCPv2 dependence: without the service the tests still run, unguarded", () => {
    const text = squash(toolSupport);
    expect(text).toContain("One qualification for `iris_execute_tests` (Story 40.3): its TestProduction guard needs the service, so without it");
    expect(text).toContain("the tests still run, **unguarded**");
    expect(text).toContain("stops any other running production in the namespace, as before");
  });

  it("has the Story 40.3 note after the Story 40.2 note: the counts, the default states, the decision, the routes, the residuals, the bootstrap move and the IRIS version", () => {
    const note = lineStarting(toolSupport, "> **Story 40.3");
    expect(note, "tool_support.md has the Story 40.3 note").not.toBe("");
    expect(note).toContain(`> **Story 40.3 (2026-10-18) ${EM_DASH} governance defaults, TestProduction runs:**`);
    expect(note).toContain("no tool, action or governance key is added, so no default state and no tool count moves (110 package tools, 115 advertised; dev stays at 32 package tools");
    expect(note).toContain("the frozen baseline stays `1e62c5ad5bf7`, 141 keys; 13 prompts");
    expect(note).toContain("`iris_execute_tests` stays **enabled by default** (a baseline key, classified `write`), and `iris_test_coverage` stays `write` and **DEFAULT-DISABLED**");
    expect(note).toContain("`ExecuteMCPv2.REST.UnitTest:ProductionGuard`, taken under Ens's own production lifecycle lock (`^Ens.Runtime`, five seconds to take it)");
    expect(note).toContain("`GET /dev/test/production?target=&level=&namespace=`");
    expect(note).toContain("A refusal is the new code `PRODUCTION_BUSY` (the catalog goes from 9 to 10 codes)");
    expect(note).toContain("A run with no TestProduction test never reads Ens state, and a 404 from the route leaves the run unguarded, exactly as before");
    expect(note).toContain("`POST /tests` (`RunTests`, which no tool calls) is not guarded");
    expect(note).toContain("**The suite never stops a production**");
    expect(note).toContain("Residual risks: the window between the decision and the test's own start in another process");
    expect(note).toContain("so is a run in a namespace that cannot see the `ExecuteMCPv2` package (no `%ALL` package mapping) or holds its own copy of an earlier build without `ProductionGuard`");
    expect(note).toContain("(`iris_test_coverage` is refused there instead, with an error and nothing started)");
    expect(note).toContain("`iris_test_coverage` rejects a `target` whose package or class part (before the first `:`) is empty or blank, in its schema and in `ValidateStart`");
    expect(note).toContain("because the runner would read it as every compiled test class under `^UnitTestRoot`, which the guard cannot check");
    expect(note).toContain("a production already running under a name one of the run's tests declares is treated as the run's own and is stopped by the run, whoever started it (by its own test, which restarts it, or by another TestProduction test of the run;");
    expect(note).toContain("`CleanProduction(1)`, which also deletes its persistent application data), and is left Stopped");
    expect(note).toContain("a guard read that fails other than with a 404 ends the call before anything is queued, even for a run with no TestProduction test");
    expect(note).toContain("privileges were verified under `_SYSTEM` only");
    expect(note).toContain(`\`BOOTSTRAP_VERSION\` moves \`${BOOTSTRAP_FROM}\` ${ARROW} \`${BOOTSTRAP_TO}\``);
    expect(note).toContain("35 bootstrapped classes, unchanged");
    expect(note).toContain("`^%SYS(\"Ensemble\",\"InstalledNamespace\",<namespace>)` (orchestrator decision #59; `EnableNamespace` is never called)");
    expect(note).toContain("Earliest IRIS version verified: 2026.2 build 221U");
    expect(toolSupport.indexOf("> **Story 40.2"), "after the Story 40.2 note").toBeLessThan(toolSupport.indexOf("> **Story 40.3"));
  });

  it("keeps the suite at 110 package tools and 115 advertised", () => {
    expect(toolSupport).toContain("| `@iris-mcp/dev` | 20 | 12 | 0 | **32** | **33** |");
    expect(toolSupport).toContain("| **Total** | **20** | **85** | **5** | **110** | **115** |");
  });
});

describe("Story 40.3: the CHANGELOG section and the changeset", () => {
  // `changeset version` consumes (deletes) the file, so its checks run only while it exists.
  const changesetPresent = existsSync(path.join(REPO_ROOT, ".changeset/story-40-3-testproduction-runs.md"));
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("has the Story 40.3 section first, above the Story 40.2 one, with Added, Changed and Known limits headings", () => {
    expect(section, "the CHANGELOG has the Story 40.3 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Added", "### Changed", "### Known limits"]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 40.2:"));
    expect(previous, "the CHANGELOG still has the Story 40.2 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states the unchanged counts, the code count, the bootstrap move as literals, the snapshot regeneration, the additive route, the residuals and the IRIS version", () => {
    const text = squash(section);
    expect(text).toContain("No tool, action or governance key is added, so no tool count moves (the Development server stays at 32 package tools, 33 advertised; the suite at 110 package tools, 115 advertised)");
    expect(text).toContain("The prompt pack stays at 13 prompts");
    expect(text).toContain("hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain("The refusal-code catalog grows from 9 to 10 codes.");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
    expect(text).toContain("(the bootstrapped service stays at 35 classes)");
    expect(text).toContain("`ExecuteMCPv2.REST.UnitTest:ProductionGuard`");
    expect(text).toContain("`PRODUCTION_BUSY`");
    expect(text).toContain("`iris_execute_tests` stays enabled by default (a baseline key, classified `write`), and `iris_test_coverage` stays a write, DEFAULT-DISABLED; the guard has no switch and adds no key");
    expect(text).toContain("`GET /dev/test/production?target=&level=&namespace=`");
    expect(text).toContain("and is additive (AD-33)");
    expect(text).toContain("`production-busy`");
    expect(text).toContain("A 404 from the route");
    expect(text).toContain("**a run against a server without the guard is unguarded**");
    expect(text).toContain("`pnpm gen:tools-list-snapshot --force`");
    expect(text).toContain("(orchestrator decision #29)");
    expect(text).toContain("it differs only in those two descriptions");
    expect(text).toContain("`POST /tests` (`RunTests`, which no tool calls) is not guarded");
    expect(text).toContain("**The suite never stops a production (orchestrator decision #58).**");
    expect(text).toContain("So is a run in a namespace that cannot see the `ExecuteMCPv2` package (no `%ALL` package mapping, as after a manual setup) or holds its own copy of an earlier build, one without `ExecuteMCPv2.REST.UnitTest:ProductionGuard`");
    expect(text).toContain("`iris_test_coverage` is refused there instead, with an error and nothing started.");
    expect(text).toContain("**`iris_test_coverage` refuses a `target` with an empty package or class part.**");
    expect(text).toContain("A target such as `:` or `:TestSomething` is rejected by the tool's schema and by the service's request validation, before any namespace switch, run id, run record, monitor session or production action.");
    expect(text).toContain("**`iris_execute_tests` refuses a method-level target whose method segment holds `;`, `,` or `^`.**");
    expect(text).toContain("Such a target is now the usual `Malformed method-level target` result, before the guard is asked and before anything is queued");
    expect(text).toContain("A production already running under a name one of the run's tests declares is treated as that run's own and is stopped by the run, whoever started it: by its own test, which restarts it for the test, or by another TestProduction test of the same run.");
    expect(text).toContain("is force-stopped and cleaned with `CleanProduction(1)`, which also deletes its persistent application data, and the run leaves it Stopped");
    expect(text).toContain("On the coverage path those are the classes its runner runs, judged by their compiled classes");
    expect(text).toContain("A guard read that fails for any reason other than a 404 (an HTTP 5xx or 403, a connection error) ends the call before anything is queued, even for a run with no TestProduction test.");
    expect(text).toContain("A cancelled, killed or erroring TestProduction run leaves its production running.");
    expect(text).toContain("(orchestrator decision #57)");
    expect(text).toContain("(orchestrator decision #59; `EnableNamespace` is never called)");
    expect(text).toContain("Earliest IRIS version verified: 2026.2 build 221U");
  });

  it.skipIf(!changesetPresent)("the changeset bumps @iris-mcp/dev by a minor and @iris-mcp/shared by a patch, and records the default state, the code and the bootstrap move", () => {
    const dir = path.join(REPO_ROOT, ".changeset");
    expect(existsSync(dir)).toBe(true);
    const file = readdirSync(dir).find((name) => name === "story-40-3-testproduction-runs.md");
    expect(file, "the changeset exists").toBeDefined();
    const text = readFileSync(path.join(dir, file as string), "utf8");
    expect(text.startsWith('---\n"@iris-mcp/dev": minor\n"@iris-mcp/shared": patch\n---\n')).toBe(true);
    expect(text).toContain("`PRODUCTION_BUSY`");
    expect(text).toContain("`iris_execute_tests` stays enabled by default, `iris_test_coverage` stays DEFAULT-DISABLED, and no key is added");
    expect(text).toContain("a run against a server without it is unguarded, as before");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
    expect(text).toContain("`iris_test_coverage` also rejects a `target` whose package or class part is empty (such as `:` or `:TestSomething`), in its schema and in the service's validation");
    expect(text).toContain("No tool is added and no tool count moves.");
  });

  it("no Story 40.3 text claims regulatory compliance (AD-26)", () => {
    const texts = [
      section,
      lineStarting(toolSupport, "> **Story 40.3"),
      ...(changesetPresent ? [read(".changeset/story-40-3-testproduction-runs.md")] : []),
      lineStarting(read("README.md"), "| `PRODUCTION_BUSY`"),
    ];
    for (const text of texts) {
      for (const claim of CLAIMS) expect(text, String(claim)).not.toMatch(claim);
    }
  });
});
