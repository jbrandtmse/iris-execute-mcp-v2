/**
 * Story 45.6 QA (DW-778; Rules #35, #59) -- the CI roster that runs the two `Setup` unit classes, held in the default suite.
 *
 * `custom-rest.integration.test.ts` runs each IRIS-side unit class through `iris_execute_tests` and compares the returned `total`
 * with a literal, so a class that lost a `Test*` method fails the armed `integration-dev` suite (Rule #35). That check needs a live
 * IRIS, and it cannot see a roster row that was deleted: a missing row runs nothing and the suite stays green. This test closes both
 * from the sources alone:
 *
 *   - every row of the roster names a class that exists, and its literal equals the number of `Method Test*` lines of that class
 *     (`grep -c "^Method Test"`, the command the roster's comment gives);
 *   - the roster holds `SetupTest` and `SetupUninstallTest`;
 *   - the suite that runs the roster is declared: `ci-checks.mjs` lists the roster file among the files `integration-dev` expects (a
 *     skipped file fails the armed run), and `ci.yml` runs `ci-live-suite.mjs integration-dev`.
 *
 * The check is a pure function over the three texts, and the test also feeds it a mutation of each: a dropped row, a literal that
 * is one too high and one too low, a class that lost a method, a missing class and a roster that is not there.
 *
 * Reads files and calls pure functions: no docker, no IRIS.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as ciChecks from "../../../../scripts/lib/ci-checks.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";

const { LIVE_SUITES } = ciChecks as unknown as { LIVE_SUITES: Record<string, { expectedFiles: () => string[] }> };

const ROSTER_FILE = "packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts";
const CLASS_DIR = "src/ExecuteMCPv2/Tests";
const CLASS_PREFIX = "ExecuteMCPv2.Tests.";
const REQUIRED = ["ExecuteMCPv2.Tests.SetupTest", "ExecuteMCPv2.Tests.SetupUninstallTest"];

interface RosterRow {
  target: string;
  total: number;
}

/** The rows of the `it.each([...] as const)` block that runs the IRIS-side unit classes, or `undefined` when there is none. */
function rosterRows(rosterText: string): RosterRow[] | undefined {
  const start = rosterText.indexOf("it.each([");
  const end = start < 0 ? -1 : rosterText.indexOf("] as const)", start);
  if (end < 0) return undefined;
  const block = rosterText.slice(start, end);
  return [...block.matchAll(/\[\s*"(ExecuteMCPv2\.Tests\.[A-Za-z0-9]+)",\s*(\d+)\s*\]/g)].map((match) => ({ target: match[1] as string, total: Number(match[2]) }));
}

/** The number of `Test*` methods of a class source: the lines `grep -c "^Method Test"` counts. */
function testMethodCount(classSource: string): number {
  return (classSource.match(/^Method Test/gm) ?? []).length;
}

/** Everything wrong with the roster, one sentence each; empty when it is right. */
function rosterProblems(rosterText: string, readClass: (target: string) => string | undefined): string[] {
  const rows = rosterRows(rosterText);
  if (rows === undefined) return ["the roster block (it.each([ ... ] as const)) is not in the file"];
  const problems: string[] = [];
  for (const required of REQUIRED) {
    if (!rows.some((row) => row.target === required)) problems.push(`${required} is not in the roster`);
  }
  for (const row of rows) {
    const source = readClass(row.target);
    if (source === undefined) {
      problems.push(`${row.target} has no class source`);
    } else if (testMethodCount(source) !== row.total) {
      problems.push(`${row.target}: the roster says ${row.total}, the class has ${testMethodCount(source)} Test methods`);
    }
  }
  return problems;
}

const classPath = (target: string): string => path.join(REPO_ROOT, CLASS_DIR, `${target.slice(CLASS_PREFIX.length)}.cls`);
const readRealClass = (target: string): string | undefined => (existsSync(classPath(target)) ? readFileSync(classPath(target), "utf8") : undefined);
const rosterText = readFileSync(path.join(REPO_ROOT, ROSTER_FILE), "utf8");

describe("Story 45.6 QA: the Setup unit classes run in CI with their real totals (DW-778)", () => {
  it("every roster row names a class whose Test method count equals the row's total, and the two Setup classes are rows", () => {
    expect(rosterProblems(rosterText, readRealClass)).toEqual([]);
    const rows = rosterRows(rosterText) ?? [];
    expect(rows.find((row) => row.target === "ExecuteMCPv2.Tests.SetupTest")?.total, "SetupTest total").toBeGreaterThan(0);
    expect(rows.find((row) => row.target === "ExecuteMCPv2.Tests.SetupUninstallTest")?.total, "SetupUninstallTest total").toBeGreaterThan(0);
  });

  it("the check reports each way the roster can go wrong (mutations of the real texts)", () => {
    const setupRow = /\[\s*"ExecuteMCPv2\.Tests\.SetupTest",\s*(\d+)\s*\],?/;
    const uninstallRow = /\[\s*"ExecuteMCPv2\.Tests\.SetupUninstallTest",\s*(\d+)\s*\],?/;
    const total = (pattern: RegExp): number => Number(pattern.exec(rosterText)?.[1]);
    const bump = (pattern: RegExp, name: string, by: number): string => rosterText.replace(pattern, `["ExecuteMCPv2.Tests.${name}", ${total(pattern) + by}],`);

    // mutation: the SetupTest row deleted -> the roster no longer holds it.
    expect(rosterProblems(rosterText.replace(setupRow, ""), readRealClass)).toEqual(["ExecuteMCPv2.Tests.SetupTest is not in the roster"]);
    // mutation: the SetupUninstallTest total one too high / one too low -> the count differs.
    expect(rosterProblems(bump(uninstallRow, "SetupUninstallTest", 1), readRealClass)).toEqual([
      `ExecuteMCPv2.Tests.SetupUninstallTest: the roster says ${total(uninstallRow) + 1}, the class has ${total(uninstallRow)} Test methods`,
    ]);
    expect(rosterProblems(bump(setupRow, "SetupTest", -1), readRealClass)).toEqual([
      `ExecuteMCPv2.Tests.SetupTest: the roster says ${total(setupRow) - 1}, the class has ${total(setupRow)} Test methods`,
    ]);
    // mutation: SetupUninstallTest loses one Test method -> its total drops below the roster's.
    const shrunk = (target: string): string | undefined => {
      const source = readRealClass(target);
      return target === "ExecuteMCPv2.Tests.SetupUninstallTest" && source !== undefined ? source.replace(/^Method Test/m, "Method Check") : source;
    };
    expect(rosterProblems(rosterText, shrunk)).toEqual([
      `ExecuteMCPv2.Tests.SetupUninstallTest: the roster says ${total(uninstallRow)}, the class has ${total(uninstallRow) - 1} Test methods`,
    ]);
    // mutation: a class that is not there, and a file with no roster block.
    expect(rosterProblems(rosterText, (target) => (target === "ExecuteMCPv2.Tests.SetupTest" ? undefined : readRealClass(target)))).toEqual([
      "ExecuteMCPv2.Tests.SetupTest has no class source",
    ]);
    expect(rosterProblems("describe('no roster here', () => {});", readRealClass)).toEqual(["the roster block (it.each([ ... ] as const)) is not in the file"]);
  });

  it("the suite that runs the roster is declared: integration-dev expects the roster file, and ci.yml runs it", () => {
    const expected = LIVE_SUITES["integration-dev"]?.expectedFiles() ?? [];
    expect(expected, "the files integration-dev expects (a skipped one fails the armed run)").toContain(ROSTER_FILE);
    const workflow = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow, "ci.yml runs the integration-dev suite on the seeded throwaway").toMatch(/run: node scripts\/throwaway-iris\.mjs exec --state .+ -- node scripts\/ci-live-suite\.mjs integration-dev\n/);
  });
});
