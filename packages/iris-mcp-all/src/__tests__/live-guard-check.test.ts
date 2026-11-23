/**
 * Story 44.5 (AC 44.5.3, DW-684; Rules #19, #45, #59) -- pins `pnpm check:live-guards`, the source check that refuses a test in an
 * armed CI suite that can pass without testing: a `return` that ends a test without a skip (rule G), and an `if` on `.isError`
 * or `created.` whose then-branch does not throw or skip (rule C).
 *
 * What is pinned here:
 *   - the real armed files (every file `coveredTestFiles()` returns) have no finding, and the scan reads exactly those files;
 *   - the proof on the path the gate guards (Rule #59): the real interop test with the original guard put back, and with a create
 *     assertion put back to the tolerated shape, is a finding, and the CLI's `main()` exits 1 naming the file and line;
 *   - the grammar, by a table of synthetic tests: every allowed shape is silent, every forbidden shape is a finding;
 *   - the allowlists: every skip helper is defined (in an armed file or one it imports) to call a skip, and every entry has a reason.
 *
 * The scan and the CLI are `scripts/lib/live-guard-scan.mjs` and `scripts/check-live-guards.mjs`; this file calls them in process
 * and runs no docker and reaches no IRIS. Fixture text that names a live-gate call is joined at run time, so that this file is not
 * itself read as a live-capable test.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { coveredTestFiles } from "../../../../scripts/lib/ci-checks.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { SKIP_CALLS, SKIP_HELPERS, liveGuardFindings, scanSource } from "../../../../scripts/lib/live-guard-scan.mjs";
import { main } from "../../../../scripts/check-live-guards.mjs";

type Finding = { file: string; line: number; rule: "G" | "C"; text: string };

const INTEROP = "packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts";
const readRepoFile = (file: string): string => readFileSync(path.join(REPO_ROOT, file), "utf8");
const interopText = readRepoFile(INTEROP);

/** `text` with the one occurrence of `from` replaced; it fails when `from` is not in `text` exactly once, so a mutation cannot change nothing. */
function mutate(text: string, from: string, to: string): string {
  expect(text.split(from).length - 1, `the text to replace occurs once: ${from}`).toBe(1);
  return text.replace(from, to);
}

/** The interop test with the Story 44.5 conversion undone: the guard back as the first statement of "starts the test production". */
const withGuard = mutate(
  interopText,
  'it("starts the test production", async () => {\n',
  'it("starts the test production", async () => {\n      if (!created.production) return;\n',
);
const guardLine = withGuard.split("\n").findIndex((line) => line.includes("if (!created.production) return;")) + 1;

/** The interop test with the create's assertion undone: the tolerated create. */
const withToleratedCreate = mutate(
  interopText,
  "      expect(result.isError, result.content[0]?.text).toBeFalsy();\n      created.production = true;\n",
  "      if (!result.isError) {\n        created.production = true;\n      }\n",
);

const rulesOf = (source: string): string[] => scanSource("fixture.test.ts", source).map((finding: Finding) => finding.rule);

describe("the real armed files (AC 44.5.1)", () => {
  // mutation: put `if (!created.production) return;` back in interop's "starts the test production" -> this goes red (see the next describe).
  it("have no finding, and the scan reads exactly the files the armed suites cover", () => {
    const read: string[] = [];
    const findings = liveGuardFindings({
      read: (file: string) => {
        read.push(file);
        return readRepoFile(file);
      },
    });

    expect(findings.map((finding: Finding) => `${finding.file}:${finding.line} ${finding.rule} ${finding.text}`)).toEqual([]);
    expect([...read].sort()).toEqual(coveredTestFiles());
    expect(read.length).toBeGreaterThan(60);
  });

  // mutation: drop a file from `coveredTestFiles()` (a suite's `expectedFiles`) -> the read list differs; the summary line below names the count.
  it("`main()` prints the summary line `<n> armed files, 0 findings` and returns 0 on the real tree", () => {
    const lines: string[] = [];

    expect(main([], { out: (line: string) => lines.push(line) })).toBe(0);
    expect(lines).toEqual([`${coveredTestFiles().length} armed files, 0 findings`]);
  });

  // mutation: disable the `isEntryPoint` branch of check-live-guards.mjs, or point the root script `check:live-guards` at another file -> this goes
  // red (the in-process `main()` tests above stay green: they never run the entry point).
  it("the root script `check:live-guards` runs the CLI as a real process: exit 0 and the summary line on stdout", () => {
    const rootScripts = (JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(rootScripts["check:live-guards"]).toBe("node scripts/check-live-guards.mjs");

    const run = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check-live-guards.mjs")], { cwd: REPO_ROOT, encoding: "utf8" });

    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(`${coveredTestFiles().length} armed files, 0 findings`);
  });
});

describe("the gate is red on the path it guards: the guard put back in the real interop test (AC 44.5.3, Rule #59)", () => {
  // mutation: delete rule G (the ReturnStatement branch of scanSource) -> the G finding is missing; delete rule C -> the C finding is missing.
  it("a data guard re-added to \"starts the test production\" is a G and a C finding at that line", () => {
    const findings: Finding[] = scanSource(INTEROP, withGuard);

    expect(findings.map((finding) => `${finding.line}:${finding.rule}`)).toEqual([`${guardLine}:C`, `${guardLine}:G`]);
    expect(findings[0]?.text).toBe("if (!created.production) return;");
  });

  // mutation: make `endsLoudly` return true for any then-branch -> the tolerated create is not found.
  it("a create whose assertion is replaced by `if (!result.isError) { created.production = true; }` is a C finding", () => {
    const findings: Finding[] = scanSource(INTEROP, withToleratedCreate);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: "C", text: "if (!result.isError) {" });
  });

  // mutation: make `main()` return 0 whatever the findings are, or drop the `file:line` of the output -> this goes red.
  it("`main()` over a reader that serves the mutated interop text returns 1 and prints the file and the line; the real tree returns 0", () => {
    const serve = (mutated: string) => (file: string) => (file === INTEROP ? mutated : readRepoFile(file));

    const red: string[] = [];
    expect(main([], { read: serve(withGuard), out: (line: string) => red.push(line) })).toBe(1);
    expect(red).toContain(`${INTEROP}:${guardLine} G if (!created.production) return;`);
    expect(red).toContain(`${INTEROP}:${guardLine} C if (!created.production) return;`);
    expect(red.some((line) => line === `${coveredTestFiles().length} armed files, 2 findings`)).toBe(true);

    const tolerated: string[] = [];
    expect(main([], { read: serve(withToleratedCreate), out: (line: string) => tolerated.push(line) })).toBe(1);
    expect(tolerated.some((line) => line.startsWith(`${INTEROP}:`) && line.includes(" C "))).toBe(true);

    expect(main([], { read: serve(interopText), out: () => {} })).toBe(0);
  });
});

describe("the grammar: every allowed shape is silent, every forbidden shape is a finding", () => {
  const ALLOWED: Array<[string, string]> = [
    ["a return of the context's skip()", 'it("x", async (ctx) => { if (reason) return ctx.skip(); expect(1).toBe(1); });'],
    ["a return of skipTest(", 'it("x", async (ctx) => { if (reason) return skipTest(TAG, reason, ctx); expect(1).toBe(1); });'],
    ["a return of skipLeg(", 'it("x", async (ctx) => { if (reason) return skipLeg(ctx, "leg", reason); expect(1).toBe(1); });'],
    ["a skipIfReason guard", 'it("x", async (ctx) => { if (skipIfReason(reason, ctx)) return; expect(1).toBe(1); });'],
    ["a skipIfReason guard in braces", 'it("x", async (ctx) => { if (skipIfReason(reason, ctx)) { return; } expect(1).toBe(1); });'],
    ["a skipIf guard", 'it("x", async (ctx) => { if (skipIf(ctx, reason, "l")) return; expect(1).toBe(1); });'],
    ["a coverageBlocked guard", 'it("x", async (ctx) => { if (coverageBlocked(ctx)) return; expect(1).toBe(1); });'],
    ["a skip call, then a bare return, in a block", 'it("x", async (ctx) => { if (reason) { ctx.skip(); return; } expect(1).toBe(1); });'],
    ["a skip call, then a bare return, as siblings", 'it("x", async (ctx) => { ctx.skip(); return; });'],
    ["a skip guard inside it.each", 'it.each([1, 2])("x %i", async (n, ctx) => { if (skipIfReason(reason, ctx)) return; expect(n).toBeGreaterThan(0); });'],
    ["a skip guard inside it.skipIf(...)", 'it.skipIf(FLAG)("x", async (ctx) => { if (reason) return ctx.skip(); });'],
    ["a skip guard inside test.concurrent", 'test.concurrent("x", async (ctx) => { if (reason) return ctx.skip(); });'],
    ["a hook's early return (it reports no test outcome)", 'beforeAll(() => { if (skipReason) return; setup(); });'],
    ["a helper function's value return", 'function make() { return 1; }\nit("x", () => { expect(make()).toBe(1); });'],
    ["a return inside a callback nested in a test", 'it("x", () => { [1, 2].forEach((n) => { if (!n) return; }); });'],
    ["an isError branch that throws", 'it("x", async () => { if (result.isError) { throw new Error(text); } expect(1).toBe(1); });'],
    ["an isError branch that ends in a skip return", 'it("x", async (ctx) => { if (result.isError) { log(); return ctx.skip(); } });'],
    ["a branch on something else that holds an assertion", 'it("x", () => { if (rows.length > 0) { expect(rows[0]).toBe(1); } });'],
    ["an unconditional assertion of the create", 'it("x", async () => { expect(result.isError).toBeFalsy(); created.x = true; });'],
  ];

  const FORBIDDEN: Array<[string, string, string[]]> = [
    ["a bare data guard", 'it("x", async () => { if (!id) return; expect(id).toBe(1); });', ["G"]],
    ["a data guard on undefined", 'it("x", async () => { if (taskId === undefined) return; expect(1).toBe(1); });', ["G"]],
    ["a return with no condition", 'it("x", async () => { await go(); return; });', ["G"]],
    ["a value return", 'it("x", async () => { return expect(1).toBe(1); });', ["G"]],
    ["a return inside a loop", 'it("x", async () => { for (const row of rows) { if (row.bad) return; } });', ["G"]],
    ["a guard on a variable that is not a skip helper", 'it("x", async () => { if (skipReason) return; expect(1).toBe(1); });', ["G"]],
    ["a guard on a call that is not a skip helper", 'it("x", async (ctx) => { if (somethingElse(ctx)) return; });', ["G"]],
    ["a data guard OR-ed with a skip helper", 'it("x", async (ctx) => { if (skipIfReason(r, ctx) || !id) return; expect(id).toBe(1); });', ["G"]],
    ["a negated skip helper guard", 'it("x", async (ctx) => { if (!skipIfReason(r, ctx)) return; expect(1).toBe(1); });', ["G"]],
    ["a skip helper guard that holds more than the return", 'it("x", async (ctx) => { if (skipIfReason(r, ctx)) { log(); return; } });', ["G"]],
    ["a guard inside it.each", 'it.each([1, 2])("x %i", async (n) => { if (!n) return; });', ["G"]],
    ["a guard inside it.skipIf(...)", 'it.skipIf(FLAG)("x", async () => { if (!id) return; });', ["G"]],
    ["a guard inside test()", 'test("x", async () => { if (!id) return; });', ["G"]],
    ["an isError branch that holds the assertion", 'it("x", async () => { if (!result.isError) { expect(1).toBe(1); } });', ["C"]],
    ["an isError branch on an optional chain", 'it("x", async () => { if (!result?.isError) { expect(1).toBe(1); } });', ["C"]],
    ["a created. branch that holds the assertion", 'it("x", async () => { if (created.x) { expect(1).toBe(1); } });', ["C"]],
    ["a created. and isError branch", 'it("x", async () => { if (!result.isError && created.user) { expect(1).toBe(1); } });', ["C"]],
    ["a tolerated create", 'it("x", async () => { if (!result.isError) { created.x = true; } });', ["C"]],
    ["an isError branch nested in another branch", 'it("x", async () => { if (a) { if (!result.isError) { expect(1).toBe(1); } } });', ["C"]],
    ["an isError branch that returns", 'it("x", async () => { if (result.isError) return; expect(1).toBe(1); });', ["C", "G"]],
    ["a created. guard return", 'it("x", async () => { if (!created.production) return; });', ["C", "G"]],
  ];

  // mutation: make `isAllowedReturn` return true for every return -> every FORBIDDEN G row is silent and the test goes red.
  it.each(ALLOWED)("allows %s", (_label, source) => {
    expect(scanSource("fixture.test.ts", source)).toEqual([]);
  });

  // mutation: drop the TEST_ROOTS check in isTestCallback, or the OUTCOME_CONDITION test in rule C -> the matching rows are silent.
  it.each(FORBIDDEN)("refuses %s", (_label, source, rules) => {
    expect(rulesOf(source).sort()).toEqual(rules);
  });

  // mutation: make the scan read a hook or a helper as a test callback -> the two ALLOWED rows for them are findings.
  it("reports the line of the finding and the trimmed source line", () => {
    const findings: Finding[] = scanSource("fixture.test.ts", 'describe("d", () => {\n  it("x", async () => {\n    await go();\n    if (!id) return;\n  });\n});\n');

    expect(findings).toEqual([{ file: "fixture.test.ts", line: 4, rule: "G", text: "if (!id) return;" }]);
  });
});

describe("the allowlists: each helper is defined to skip, and each entry has a reason", () => {
  const skipPattern = new RegExp(
    SKIP_CALLS.map((entry: { name: string; kind: string }) => (entry.kind === "method" ? `\\.${entry.name}\\(` : `\\b${entry.name}\\(`)).join("|"),
  );

  /** The armed files and the helper modules they import by a relative path (one level), as repository-relative paths. */
  const searched = (): string[] => {
    const files = new Set<string>(coveredTestFiles());
    for (const file of coveredTestFiles() as string[]) {
      for (const match of readRepoFile(file).matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
        const base = path.join(path.dirname(file), (match[1] as string).replace(/\.js$/, ""));
        for (const candidate of [`${base}.ts`, `${base}.mts`]) if (existsSync(path.join(REPO_ROOT, candidate))) files.add(candidate);
      }
    }
    return [...files].sort();
  };

  /** The body of every definition of `name` in `source`: from its declaration line to the next line that closes at the same indent. */
  const bodiesOf = (source: string, name: string): string[] => {
    const lines = source.split("\n");
    const bodies: string[] = [];
    lines.forEach((line, index) => {
      const declaration = new RegExp(`^(\\s*)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b|^(\\s*)(?:export\\s+)?const\\s+${name}\\s*=`).exec(line);
      if (!declaration) return;
      const indent = declaration[1] ?? declaration[2] ?? "";
      const end = lines.findIndex((candidate, at) => at > index && candidate.startsWith(`${indent}}`));
      bodies.push(lines.slice(index, end === -1 ? lines.length : end + 1).join("\n"));
    });
    return bodies;
  };

  // mutation: change a helper's body to return true without a skip call -> this goes red; rename a helper -> "defined" goes red.
  it.each(SKIP_HELPERS.map((entry: { name: string }) => [entry.name]))("%s is defined in an armed file or an imported helper, and every definition calls a skip", (name) => {
    const bodies = searched().flatMap((file) => bodiesOf(readRepoFile(file), name as string).map((body) => ({ file, body })));

    expect(bodies.length, `${name} is defined`).toBeGreaterThan(0);
    for (const { file, body } of bodies) expect(skipPattern.test(body), `${file}: ${name} calls a skip`).toBe(true);
  });

  // mutation: shorten a reason to a few words -> this goes red.
  it("every skip call and skip helper carries a reason of more than 30 characters", () => {
    for (const entry of [...SKIP_CALLS, ...SKIP_HELPERS] as Array<{ name: string; reason: string }>) {
      expect(entry.reason.trim().length, `${entry.name} has a reason`).toBeGreaterThan(30);
    }
  });

  // mutation: use a skip helper in an armed file that is not in SKIP_HELPERS -> the real-tree test above reports its guard.
  it("every skip helper the armed files call as a guard is allowlisted", () => {
    const called = new Set<string>();
    for (const file of coveredTestFiles() as string[]) {
      for (const match of readRepoFile(file).matchAll(/if \((\w+)\([^)]*\)\) (?:\{\s*)?return;/g)) called.add(match[1] as string);
    }
    const allowed = new Set<string>(SKIP_HELPERS.map((entry: { name: string }) => entry.name));

    expect([...called].filter((name) => !allowed.has(name))).toEqual([]);
  });
});
