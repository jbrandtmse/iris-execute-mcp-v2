/**
 * Story 44.5 QA (AC 44.5.1, AC 44.5.3, DW-684; Rules #19, #56, #59) -- the shapes of test source that `scripts/lib/live-guard-scan.mjs`
 * must read, and the edges of the CLI `scripts/check-live-guards.mjs`, that `live-guard-check.test.ts` leaves open.
 *
 * What is pinned here:
 *   - test-callback forms: every `it`/`test` modifier chain, `describe.each` nesting, an arrow and a function expression, an
 *     options object and a timeout argument, a generator;
 *   - the scope rules: a `return` is in rule G's scope when the nearest function around it is a test callback, so a `return` in a
 *     callback nested in a test is out of scope; an outcome `if` is in rule C's scope inside a test callback, directly or through
 *     inline callbacks (`forEach`, `Promise.all(rows.map(...))`), but not inside a hook or a helper bound to a name; a statement
 *     inside `try`/`finally`, a `switch` case or an `else` branch is in scope;
 *   - rule C's exception: the then-branch must END with a throw, a skip return or a skip call, with or without braces, and the
 *     `else` branch never makes a non-loud then-branch loud;
 *   - the condition grammar of rule C (`isError` and a member of `created` anywhere in the condition: compound, optional-chained,
 *     element access or a destructured binding), a tagged-template `it.each` and an `it`/`test` imported from vitest under an alias;
 *   - robustness of the position report (CRLF, BOM, a leading comment, a multi-line condition) and of the parse (a syntax error);
 *   - the blind spots of the scan, pinned as they are today (BLIND_SPOTS) and proven latent: no armed file holds one of those
 *     shapes, found by a typed-AST walk of every armed file that is independent of the scan's own regex;
 *   - the CLI's edges: a file the reader cannot read never returns 0, the output order and the failure hint, an empty list fails.
 *
 * A row of BLIND_SPOTS is a scan limit, not a wish: when the scan learns to see one, move the row to a forbidden table.
 * Reads source text and calls pure functions: no docker, no IRIS.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { coveredTestFiles } from "../../../../scripts/lib/ci-checks.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { liveGuardFindings, scanSource } from "../../../../scripts/lib/live-guard-scan.mjs";
import { main } from "../../../../scripts/check-live-guards.mjs";

type Finding = { file: string; line: number; rule: "G" | "C"; text: string };

const rulesOf = (source: string): string[] => scanSource("fixture.test.ts", source).map((finding: Finding) => finding.rule).sort();

describe("test-callback forms: a data guard is a finding in every form of a test callback", () => {
  const GUARD = "if (!id) return;";
  const FORMS: Array<[string, string]> = [
    ["it.concurrent.each(rows)", `it.concurrent.each([1])("x", async (n) => { ${GUARD} });`],
    ["it.only", `it.only("x", async () => { ${GUARD} });`],
    ["it.skip (a skipped test still reports its body's outcome shape)", `it.skip("x", async () => { ${GUARD} });`],
    ["it.runIf(cond)", `it.runIf(FLAG)("x", async () => { ${GUARD} });`],
    ["it.for(rows)", `it.for([1])("x", async (n) => { ${GUARD} });`],
    ["it.fails", `it.fails("x", async () => { ${GUARD} });`],
    ["it.sequential", `it.sequential("x", async () => { ${GUARD} });`],
    ["test.each(rows)", `test.each([1])("x", async (n) => { ${GUARD} });`],
    ["a function expression", `it("x", async function () { ${GUARD} });`],
    ["a named function expression", `it("x", async function named() { ${GUARD} });`],
    ["a generator function expression", `it("x", function* () { ${GUARD} });`],
    ["an options object as the second argument", `it("x", { timeout: 5 }, async () => { ${GUARD} });`],
    ["a timeout as the third argument", `it("x", async () => { ${GUARD} }, 30000);`],
    ["describe.each nesting", `describe.each([1])("d %i", (n) => { it("x", async () => { ${GUARD} }); });`],
    ["describe in describe", `describe("a", () => { describe("b", () => { it("x", async () => { ${GUARD} }); }); });`],
    ["a test nested in a test", `it("outer", () => { it("inner", () => { ${GUARD} }); });`],
  ];

  // mutation: make `isTestCallback` accept only arrow functions (drop `ts.isFunctionExpression`) -> the three function-expression rows are silent.
  it.each(FORMS)("refuses a guard inside %s", (_label, source) => {
    expect(rulesOf(source)).toEqual(["G"]);
  });

  // mutation: make `isAllowedReturn` return true when the callback is a function expression -> the function-expression row is silent here.
  it.each([
    ["a function expression", 'it("x", async function (ctx) { if (reason) return ctx.skip(); expect(1).toBe(1); });'],
    ["it.concurrent.each(rows)", 'it.concurrent.each([1])("x", async (n, ctx) => { if (skipIfReason(r, ctx)) return; expect(n).toBe(1); });'],
    ["describe.each nesting", 'describe.each([1])("d", (n) => { it("x", async (ctx) => { ctx.skip(); return; }); });'],
    ["an options object as the second argument", 'it("x", { timeout: 5 }, async (ctx) => { if (reason) return ctx.skip(); });'],
  ])("allows a skip inside %s", (_label, source) => {
    expect(scanSource("fixture.test.ts", source)).toEqual([]);
  });
});

describe("scope: rule G reads the nearest function, rule C reads the test body through inline callbacks", () => {
  const SILENT: Array<[string, string]> = [
    ["a bare return in a forEach callback nested in a test", 'it("x", () => { rows.forEach((r) => { return; }); expect(1).toBe(1); });'],
    ["a value return in a map callback nested in a test", 'it("x", () => { const a = rows.map((r) => { return r; }); expect(a).toBeDefined(); });'],
    ["a guard return in a function declaration nested in a test", 'it("x", () => { function pick(r) { if (!r) return; return r; } expect(pick(1)).toBe(1); });'],
    ["a return in a method of a class declared in a test", 'it("x", () => { class A { m() { return 1; } } expect(new A().m()).toBe(1); });'],
    ["a guard return at the top level of a describe", 'describe("d", () => { if (!x) return; it("y", () => { expect(1).toBe(1); }); });'],
    ["an if on isError in a hook's nested callback", 'beforeAll(async () => { await Promise.all(rs.map(async (r) => { if (r.isError) { log(r); } })); });'],
    ["an if on isError in a helper bound to a name inside a test", 'it("x", () => { const check = (r) => { if (r.isError) { log(r); } }; check(1); expect(1).toBe(1); });'],
    ["an if on isError in a callback nested in a describe, outside any test", 'describe("d", () => { rows.forEach((r) => { if (r.isError) { log(r); } }); it("y", () => { expect(1).toBe(1); }); });'],
    ["a skip, then a bare return, in a switch case", 'it("x", async (ctx) => { switch (k) { case 1: ctx.skip(); return; default: break; } });'],
    ["a skip, then a bare return, inside try", 'it("x", async (ctx) => { try { ctx.skip(); return; } finally { cleanup(); } });'],
  ];

  const FORBIDDEN: Array<[string, string, string[]]> = [
    ["a guard return inside try, with a finally", 'it("x", async () => { try { if (!id) return; } finally { cleanup(); } });', ["G"]],
    ["a bare return in a catch clause", 'it("x", async () => { try { await go(); } catch (e) { return; } });', ["G"]],
    ["a bare return in a switch case", 'it("x", async () => { switch (k) { case 1: return; default: break; } });', ["G"]],
    ["a bare return in a labeled block", 'it("x", async () => { out: { if (!id) return; } });', ["G"]],
    ["a return in the else branch of a skip", 'it("x", async (ctx) => { if (r) { ctx.skip(); } else { return; } });', ["G"]],
    ["a return in the else branch of a data guard", 'it("x", async () => { if (a) { expect(1).toBe(1); } else { return; } });', ["G"]],
    ["a skip in one branch, then a return after the if", 'it("x", async (ctx) => { if (a) { ctx.skip(); } return; });', ["G"]],
    ["a skip that is not the statement just before the return", 'it("x", async (ctx) => { ctx.skip(); log(); return; });', ["G"]],
    ["a skip helper guard followed by a data guard", 'it("x", async (ctx) => { if (skipIfReason(r, ctx)) return; if (!id) return; });', ["G"]],
    ["a skip helper called as a method", 'it("x", async (ctx) => { if (h.skipIfReason(r, ctx)) return; });', ["G"]],
    ["an awaited skip is not a skip call", 'it("x", async (ctx) => { if (r) { await ctx.skip(); return; } });', ["G"]],
    ["two guards on one line are two findings", 'it("x", () => { if (!a) return; if (!b) return; });', ["G", "G"]],
    ["an if on isError in a forEach callback nested in a test", 'it("x", async () => { rows.forEach((r) => { if (r.isError) { log(r); } }); expect(1).toBe(1); });', ["C"]],
    ["an if on isError in a Promise.all(map) callback nested in a test", 'it("x", async () => { await Promise.all(rs.map(async (r) => { if (!r.isError) { expect(1).toBe(1); } })); });', ["C"]],
    ["an outcome if two inline callbacks deep", 'it("x", () => { a.forEach((x) => { x.rows.forEach(function (r) { if (!created.y) { expect(r).toBe(1); } }); }); });', ["C"]],
    ["an outcome if in a nested callback that returns early (C only: the return ends the callback)", 'it("x", () => { rows.forEach((r) => { if (r.isError) return; expect(r).toBe(1); }); });', ["C"]],
  ];

  // mutation: make `enclosingFunction` climb past a callback that is not a test callback (return the test callback around it) -> the SILENT nested-return rows are findings.
  // mutation: make `inTestBody` climb through a function that is not an inline callback -> the SILENT helper-bound-to-a-name row is a finding.
  it.each(SILENT)("is silent for %s", (_label, source) => {
    expect(scanSource("fixture.test.ts", source)).toEqual([]);
  });

  // mutation: make `isAllowedReturn` accept any return whose block holds a skip call anywhere -> the "skip that is not just before" row is silent.
  // mutation: make `inTestBody` read only the nearest function (the pre-review scope) -> the four nested-callback rows are silent.
  it.each(FORBIDDEN)("refuses %s", (_label, source, rules) => {
    expect(rulesOf(source)).toEqual(rules);
  });
});

describe("rule C: the then-branch must end loudly, whatever surrounds it", () => {
  const SILENT: Array<[string, string]> = [
    ["a log, then a throw", 'it("x", async () => { if (result.isError) { log(result); throw new Error(text); } expect(1).toBe(1); });'],
    ["a throw without braces", 'it("x", async () => { if (result.isError) throw new Error(text); expect(1).toBe(1); });'],
    ["a skip call as the last statement", 'it("x", async (ctx) => { if (result.isError) { log(); ctx.skip(); } });'],
    ["a skipTest call as the last statement", 'it("x", async (ctx) => { if (result.isError) { skipTest(TAG, "r", ctx); } });'],
    ["a throw, with the assertions in the else branch", 'it("x", async () => { if (result.isError) { throw new Error(text); } else { expect(1).toBe(1); } });'],
    ["a throw on a compound condition", 'it("x", async () => { if (result.isError || created.x === undefined) { throw new Error(text); } });'],
    ["a throw on an element access of the result", 'it("x", async () => { if ((result as { isError?: boolean }).isError) { throw new Error(text); } });'],
    ["text that only looks like a condition (a comment, a string)", 'it("x", () => { // if (created.x) { return; }\n  const s = "if (result.isError) { return }"; expect(s).toBeDefined(); });'],
    ["a comment inside the condition", 'it("x", () => { if (a /* .isError */) { expect(1).toBe(1); } });'],
    ["a name that only ends in created", 'it("x", () => { if (notcreated.x) { expect(1).toBe(1); } });'],
  ];

  const FORBIDDEN: Array<[string, string, string[]]> = [
    ["an isError branch without braces that holds the assertion", 'it("x", async () => { if (!result.isError) expect(1).toBe(1); });', ["C"]],
    ["a non-loud then-branch, with the assertion in the else", 'it("x", async () => { if (result.isError) { log(); } else { expect(1).toBe(1); } });', ["C"]],
    ["a throw that is not the last statement", 'it("x", async () => { if (result.isError) { throw new Error(text); log(); } });', ["C"]],
    ["a throw that is conditional (the then-branch ends in an if)", 'it("x", async () => { if (result.isError) { if (verbose) throw new Error(text); } });', ["C"]],
    ["a then-branch that only logs", 'it("x", async () => { if (result.isError) { console.log(text); } });', ["C"]],
    ["an else-if on isError that does not throw", 'it("x", async () => { if (a) { throw new Error(); } else if (result.isError) { log(); } });', ["C"]],
    ["created. in a compound condition", 'it("x", async () => { if (a || created.x) { expect(1).toBe(1); } });', ["C"]],
    ["created. read on the right of an and", 'it("x", async () => { if (!result.isError && created.user) { expect(1).toBe(1); } });', ["C"]],
    ["a property chain ending in created.", 'it("x", async () => { if (state.created.x) { expect(1).toBe(1); } });', ["C"]],
    ["an isError read through a cast", 'it("x", async () => { if ((result as any).isError) { expect(1).toBe(1); } });', ["C"]],
    ["an isError branch inside a for loop body", 'it("x", async () => { for (const r of rs) { if (r.isError) { continue; } } });', ["C"]],
    ["an isError branch inside try", 'it("x", async () => { try { if (!result.isError) { expect(1).toBe(1); } } finally { cleanup(); } });', ["C"]],
    ["an isError branch inside a switch case", 'it("x", async () => { switch (k) { case 1: if (!result.isError) { expect(1).toBe(1); } break; } });', ["C"]],
    ["an isError branch that returns a skip-less value", 'it("x", async () => { if (result.isError) { return 1; } });', ["C", "G"]],
    ["a skip-helper guard OR-ed with created.", 'it("x", async (ctx) => { if (skipIfReason(r, ctx) || created.x) { return; } });', ["C", "G"]],
  ];

  // mutation: make `endsLoudly` read the first statement of the then-branch instead of the last -> "a log, then a throw" is a finding.
  it.each(SILENT)("is silent for %s", (_label, source) => {
    expect(scanSource("fixture.test.ts", source)).toEqual([]);
  });

  // mutation: make `endsLoudly` return true whenever the if has an else branch -> the "non-loud then-branch, with the assertion in the else" row is silent.
  it.each(FORBIDDEN)("refuses %s", (_label, source, rules) => {
    expect(rulesOf(source)).toEqual(rules);
  });
});

describe("the position report and the parse", () => {
  // mutation: compute the line from `node.getFullStart()` instead of `getStart()` -> the leading-comment and multi-line rows move.
  it("reports the line of the `if` itself: a leading comment, a multi-line condition, CRLF line ends and a BOM do not move it", () => {
    const leading = scanSource("f.test.ts", 'it("x", () => {\n  /* c */ if (!id) return;\n});');
    expect(leading.map((finding: Finding) => finding.line)).toEqual([2]);
    expect(leading[0]?.text).toBe("/* c */ if (!id) return;");

    const multiline = scanSource("f.test.ts", 'it("x", () => {\n  if (\n    !result.isError\n  ) {\n    expect(1).toBe(1);\n  }\n});');
    expect(multiline).toEqual([{ file: "f.test.ts", line: 2, rule: "C", text: "if (" }]);

    const crlf = scanSource("f.test.ts", 'it("x", async () => {\r\n  await go();\r\n  if (!id) return;\r\n});\r\n');
    expect(crlf).toEqual([{ file: "f.test.ts", line: 3, rule: "G", text: "if (!id) return;" }]);

    const bom = scanSource("f.test.ts", "﻿it(\"x\", async () => { if (!id) return; });");
    expect(bom.map((finding: Finding) => finding.rule)).toEqual(["G"]);
  });

  // mutation: sort by rule before line in scanSource -> a C finding on a later line comes first.
  it("orders findings by line, then rule (C before G on the same line)", () => {
    const findings: Finding[] = scanSource("f.test.ts", 'it("x", () => {\n  if (!created.a) return;\n  if (!b) return;\n});');

    expect(findings.map((finding) => `${finding.line}${finding.rule}`)).toEqual(["2C", "2G", "3G"]);
  });

  // mutation: make scanSource return [] when the parse reports a diagnostic -> the unterminated row is silent (a broken file would pass the gate).
  it("still reports a guard in a source with a syntax error, and reports nothing for an empty source", () => {
    expect(rulesOf('it("x", async () => { if (!id) return; ')).toEqual(["G"]);
    expect(rulesOf('it("x", async () => { if (!id) return; @@@ ### });')).toEqual(["G"]);
    expect(rulesOf("")).toEqual([]);
  });

  it("is a pure function of its text: the file name is only reported", () => {
    const source = 'it("x", () => { if (!id) return; });';

    expect(scanSource("a.test.ts", source).map((finding: Finding) => finding.file)).toEqual(["a.test.ts"]);
    expect(scanSource("b/c.integration.test.ts", source).map((finding: Finding) => finding.file)).toEqual(["b/c.integration.test.ts"]);
  });
});

/** Shapes the QA pass found the scan blind to, which the review taught it: each is a finding now. */
const LEARNED: Array<[string, string, string[]]> = [
  ["created read through an optional chain", 'it("x", async () => { if (created?.x) { expect(1).toBe(1); } });', ["C"]],
  ["created read through an element access", 'it("x", async () => { if (created["x"]) { expect(1).toBe(1); } });', ["C"]],
  ["isError read through an element access", 'it("x", async () => { if (result["isError"]) { expect(1).toBe(1); } });', ["C"]],
  ["isError read through a destructured binding", 'it("x", async () => { const { isError } = result; if (isError) { expect(1).toBe(1); } });', ["C"]],
  ["it.each over a tagged template", 'it.each`\n a\n ${1}\n`("x", ({ a }) => { if (!a) return; });', ["G"]],
  ["a test function imported from vitest under an alias", 'import { it as vit } from "vitest";\nvit("x", () => { if (!id) return; });', ["G"]],
  ["test imported from vitest under an alias, with a modifier", 'import { test as check } from "vitest";\ncheck.each([1])("x", (n) => { if (!created.x) { expect(n).toBe(1); } });', ["C"]],
];

describe("shapes the scan learned in review: optional chains, element access, destructuring, tagged templates, vitest aliases", () => {
  // mutation: restore OUTCOME_CONDITION to `/\.isError\b|\bcreated\./` -> the four condition rows are silent; drop the tagged-template step of
  // `calleeRoot` -> the it.each row is silent; make `testRootsOf` return TEST_ROOTS only -> the two alias rows are silent.
  it.each(LEARNED)("refuses %s", (_label, source, rules) => {
    expect(rulesOf(source)).toEqual(rules);
  });

  // mutation: make `isSkipCall` accept `.skip(` on any receiver with any arguments (the pre-review rule) -> these rows are silent.
  it.each([
    ["a skip method on a receiver that is not a parameter", 'it("x", async () => { rows.skip(); return; });'],
    ["a skip method with an argument", 'it("x", async (ctx) => { ctx.skip(1); return; });'],
    ["a returned skip method on a local cursor", 'it("x", async () => { const cursor = open(); if (!id) return cursor.skip(); });'],
  ])("refuses %s as a skip: only the test context's skip() is one", (_label, source) => {
    expect(rulesOf(source)).toEqual(["G"]);
  });

  // mutation: make `testRootsOf` accept an import from any module -> the non-vitest alias row is a finding.
  it("an `it` alias imported from a module that is not vitest is not a test root, and a name that only contains isError is not an outcome", () => {
    expect(scanSource("fixture.test.ts", 'import { it as vit } from "./other";\nvit("x", () => { if (!id) return; });')).toEqual([]);
    expect(scanSource("fixture.test.ts", 'it("x", () => { if (expectIsErrorShape(r)) { expect(1).toBe(1); } });')).toEqual([]);
  });
});

/**
 * The blind spots of the scan, pinned as they are today and documented in the module header of `live-guard-scan.mjs`. Each is a
 * shape in which a test can still end without asserting, or a test form the scan does not recognise.
 */
const BLIND_SPOTS: Array<[string, string]> = [
  ["a ternary statement that asserts only on success", 'it("x", async () => { result.isError ? undefined : expect(1).toBe(1); });'],
  ["an && statement that asserts only when created", 'it("x", async () => { created.x && expect(1).toBe(1); });'],
  ["an && statement that asserts only on success", 'it("x", async () => { !result.isError && expect(1).toBe(1); });'],
  ["a callback that is a named function, not inline", 'async function body() { if (!id) return; }\nit("x", body);'],
  ["a switch on isError", 'it("x", async () => { switch (result.isError) { case false: expect(1).toBe(1); break; } });'],
  ["a test function bound to a variable", 'const check = it;\ncheck("x", () => { if (!id) return; });'],
];

describe("blind spots: pinned as they are, and proven latent in the armed files", () => {
  // mutation: teach the scan one of these shapes (e.g. test `ts.isTaggedTemplateExpression` in `calleeRoot`) -> that row finds something and this goes red, which is the signal to move it.
  it.each(BLIND_SPOTS)("the scan does not see %s (a limit, not a wish)", (_label, source) => {
    expect(scanSource("fixture.test.ts", source)).toEqual([]);
  });

  /** The test callback `fn` is the function argument of a call rooted at `it`/`test`. */
  const isTestFunction = (fn: ts.Node): boolean => {
    if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || !fn.parent || !ts.isCallExpression(fn.parent)) return false;
    let callee: ts.Node = fn.parent.expression;
    while (ts.isCallExpression(callee) || ts.isPropertyAccessExpression(callee) || ts.isParenthesizedExpression(callee)) callee = callee.expression;
    return ts.isIdentifier(callee) && (callee.text === "it" || callee.text === "test");
  };
  const isFunctionLike = (node: ts.Node): boolean => ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);
  const insideTest = (node: ts.Node): boolean => {
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) if (isTestFunction(parent)) return true;
    return false;
  };
  const OUTCOME = /\.isError\b|\bcreated\./;
  const LOOSE = /isError|\bcreated\b/;

  /** The shapes of BLIND_SPOTS that occur in `text`, found by walking the typed syntax tree, not by the scan's own regex. */
  function blindShapesIn(file: string, text: string): string[] {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const found: string[] = [];
    const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const visit = (node: ts.Node): void => {
      if (ts.isTaggedTemplateExpression(node) && /^(it|test)\b/.test(node.tag.getText(source))) found.push(`${file}:${lineOf(node)} tagged-template test`);
      if (ts.isIfStatement(node)) {
        const condition = node.expression.getText(source);
        if (LOOSE.test(condition) && !OUTCOME.test(condition)) found.push(`${file}:${lineOf(node)} outcome condition the scan's pattern misses: ${condition}`);
        if (OUTCOME.test(condition) && insideTest(node)) {
          let nearest: ts.Node | undefined = node.parent;
          while (nearest && !isFunctionLike(nearest)) nearest = nearest.parent;
          if (nearest && !isTestFunction(nearest)) found.push(`${file}:${lineOf(node)} outcome if in a nested callback`);
        }
      }
      if (ts.isExpressionStatement(node) && insideTest(node)) {
        const expression = node.expression;
        const gated =
          ts.isConditionalExpression(expression) ||
          (ts.isBinaryExpression(expression) &&
            [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind));
        if (gated && LOOSE.test(expression.getText(source))) found.push(`${file}:${lineOf(node)} gated expression statement`);
      }
      if (ts.isSwitchStatement(node) && insideTest(node) && LOOSE.test(node.expression.getText(source))) found.push(`${file}:${lineOf(node)} switch on an outcome`);
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ["it", "test"].includes(node.expression.text) &&
        node.arguments.length >= 2 &&
        ts.isStringLiteralLike(node.arguments[0] as ts.Node) &&
        ts.isIdentifier(node.arguments[1] as ts.Node)
      ) {
        found.push(`${file}:${lineOf(node)} test with a non-inline callback`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (/import\s*\{[^}]*\b(?:it|test)\s+as\s+\w+/.test(text) || /\b(?:const|let|var)\s+\w+\s*=\s*(?:it|test)\b/.test(text) || /\?\s*(?:it|test)\s*:/.test(text)) found.push(`${file} aliases it/test`);
    return found;
  }

  // mutation: add `if (r.isError) { log(r); }` inside a `rows.forEach(...)` in a test body of an armed file (or a tagged-template it.each) -> this lists it.
  it("none of those shapes occurs in an armed file, so the blind spots are latent today", () => {
    const files = coveredTestFiles() as string[];
    const found = files.flatMap((file) => blindShapesIn(file, readFileSync(path.join(REPO_ROOT, file), "utf8")));

    expect(files.length).toBeGreaterThan(60);
    expect(found).toEqual([]);
  });

  // mutation: make `blindShapesIn` skip the tagged-template check -> this goes red (the detector is not dead).
  it("the detector finds each shape it looks for in a synthetic file", () => {
    const synthetic = [
      'it.each`\n a\n ${1}\n`("x", ({ a }) => { expect(a).toBe(1); });',
      'it("x", async () => { await Promise.all(rs.map(async (r) => { if (!r.isError) { expect(1).toBe(1); } })); });',
      'it("x", async () => { if (created?.x) { expect(1).toBe(1); } });',
      'it("x", async () => { created.x && expect(1).toBe(1); });',
      'it("x", async () => { switch (result.isError) { case false: break; } });',
      'it("x", body);',
      'import { it as vit } from "vitest";',
    ].join("\n");

    const found = blindShapesIn("synthetic.test.ts", synthetic).map((entry) => entry.replace(/^synthetic\.test\.ts(:\d+)?\s*/, ""));

    expect(found).toEqual([
      "tagged-template test",
      "outcome if in a nested callback",
      "outcome condition the scan's pattern misses: created?.x",
      "gated expression statement",
      "switch on an outcome",
      "test with a non-inline callback",
      "aliases it/test",
    ]);
  });
});

describe("the CLI's edges: `main()` over an injected file list", () => {
  const GUARD_SOURCE = 'it("x", () => { if (!id) return; });';
  const CLEAN_SOURCE = 'it("x", () => { expect(1).toBe(1); });';

  // mutation: wrap `liveGuardFindings` in main() in a try/catch that returns no findings -> an unreadable file passes the gate and this goes red.
  it("a file the reader cannot read is an error, never a clean exit: main() throws and prints no summary line", () => {
    const out: string[] = [];

    expect(() =>
      main([], {
        files: ["a.test.ts", "b.test.ts"],
        read: (file: string) => {
          if (file === "b.test.ts") throw new Error(`ENOENT: no such file or directory, open '${file}'`);
          return CLEAN_SOURCE;
        },
        out: (line: string) => out.push(line),
      }),
    ).toThrow(/b\.test\.ts/);
    expect(out).toEqual([]);
  });

  // mutation: make the default reader swallow a missing file (return "") -> a file that is in the roster but not on disk passes silently.
  it("the default reader fails on a covered file that is not on disk: the roster cannot name a missing file and pass", () => {
    expect(() => main([], { files: ["packages/no-such-package/src/__tests__/missing.integration.test.ts"], out: () => {} })).toThrow(/ENOENT|no such file/);
    expect(() => liveGuardFindings({ files: ["packages/no-such-package/src/__tests__/missing.integration.test.ts"] })).toThrow(/ENOENT|no such file/);
  });

  // mutation: print the summary before the findings, or drop the hint -> this goes red.
  it("prints the findings first (files in the given order, then line order), then the summary, then one hint that names both rules", () => {
    const out: string[] = [];
    const sources: Record<string, string> = {
      "a.test.ts": 'it("x", () => {\n  expect(1).toBe(1);\n  if (!id) return;\n});',
      "b.test.ts": 'it("x", () => { if (!created.y) return; });',
      "c.test.ts": CLEAN_SOURCE,
    };

    const code = main([], { files: ["a.test.ts", "b.test.ts", "c.test.ts"], read: (file: string) => sources[file] as string, out: (line: string) => out.push(line) });

    expect(code).toBe(1);
    expect(out.slice(0, 4)).toEqual([
      "a.test.ts:3 G if (!id) return;",
      'b.test.ts:1 C it("x", () => { if (!created.y) return; });',
      'b.test.ts:1 G it("x", () => { if (!created.y) return; });',
      "3 armed files, 3 findings",
    ]);
    expect(out).toHaveLength(5);
    expect(out[4]).toMatch(/^check-live-guards: /);
    expect(out[4]).toMatch(/Rule G/);
    expect(out[4]).toMatch(/rule C/);
  });

  // mutation: return `findings.length > 1` in main() -> a single finding exits 0 and this goes red.
  it("one finding in one file is enough for exit 1, and the count in the summary is the number of files given", () => {
    const out: string[] = [];

    expect(main([], { files: ["only.test.ts"], read: () => GUARD_SOURCE, out: (line: string) => out.push(line) })).toBe(1);
    expect(out).toContain("1 armed files, 1 findings");
  });

  it("the argument vector is ignored: a stray flag changes neither the result nor the output", () => {
    const run = (argv: string[]): [number, string[]] => {
      const out: string[] = [];
      return [main(argv, { files: ["a.test.ts"], read: () => CLEAN_SOURCE, out: (line: string) => out.push(line) }), out];
    };

    expect(run(["--bogus", "x"])).toEqual(run([]));
  });

  // mutation: drop the zero-file guard of main() -> an empty list exits 0 and this goes red (Rule #59: a gate that reads nothing passes nothing).
  it("an empty file list fails: `0 armed files, 0 findings`, a hint, and exit 1", () => {
    const out: string[] = [];

    expect(main([], { files: [], out: (line: string) => out.push(line) })).toBe(1);
    expect(out[0]).toBe("0 armed files, 0 findings");
    expect(out).toHaveLength(2);
    expect(out[1]).toMatch(/^check-live-guards: no armed test file/);
    expect(liveGuardFindings({ files: [] })).toEqual([]);
  });

  // mutation: make `liveGuardFindings` sort the files -> the order of the reported files changes.
  it("liveGuardFindings keeps the order of the files it is given", () => {
    const files = ["b.test.ts", "a.test.ts"];

    expect(liveGuardFindings({ files, read: () => GUARD_SOURCE }).map((finding: Finding) => finding.file)).toEqual(files);
  });
});
