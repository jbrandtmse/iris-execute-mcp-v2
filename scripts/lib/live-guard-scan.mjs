// The scan behind `pnpm check:live-guards` (Story 44.5, DW-684): it refuses a test, in a file that CI runs armed, that can end
// without asserting. An armed CI suite reports a test as "passed" when its body returns early or when its only assertion sits
// inside an `if` that a failed create skips, so the suite is green over a test that tested nothing. `ci-live-suite.mjs` sees
// only skips, never an early return, so this source check is what holds the line.
//
// CONTRACT
//   - SCOPE. Every file `coveredTestFiles()` returns (`ci-checks.mjs`): the test files of the armed suites. A file that is in no
//     armed suite is out of scope. A TEST CALLBACK is the function argument of `it`/`test` (or a name the file imports them
//     under from `vitest`) and their `.each` (a tagged template included), `.skipIf`, `.runIf`, `.concurrent`, `.only` and
//     `.skip` forms. A `return` is in rule G's scope when the nearest function around it is a test callback: a `return` in a
//     callback nested in a test (`rows.map((r) => { return r; })`) ends that callback, not the test. An `if` is in rule C's
//     scope when it is inside a test callback, directly or through inline callbacks only (a function or arrow passed as a call
//     argument: `rows.forEach(...)`, `Promise.all(rows.map(...))`), since an assertion there still runs only when the branch
//     does. A hook (`beforeAll`), a helper function declared or bound to a name, and a class method report no test outcome and
//     are out of both scopes.
//   - RULE G (guard return). A `return` in scope is a finding unless one of these holds (each entry of SKIP_CALLS and
//     SKIP_HELPERS names its reason):
//       (a) it returns a skip call (`<ctx>.skip()`, `skipTest(`, `skipLeg(`);
//       (b) it is the only statement of an `if` whose condition IS a call of a SKIP_HELPERS function (`skipIfReason`,
//           `skipIf`, `coverageBlocked`), not negated and not combined with another term by `||` or `&&`;
//       (c) the statement just before it in the same block is a skip call.
//     A skip is loud in CI (`ci-live-suite.mjs` fails a skip that is not allowlisted); a data guard is silent.
//   - RULE C (conditional outcome). An `if` in scope whose condition reads `isError` (`.isError`, `?.isError`, `["isError"]`
//     or a bare `isError` binding) or `created` (`created.`, `created?.`, `created[`) is a finding unless its then-branch ends
//     with a `throw`, a skip return or a skip call. A create that is "tolerated" (`if (!result.isError) { created.x = true; }`)
//     and an assertion that only runs when a call succeeded both have this shape.
//   - The scan is syntactic (the TypeScript parser, one file at a time). It does not follow a helper that returns early, and it
//     does not see a conditional assertion whose condition reads neither `isError` nor `created`. Known limits, each pinned as a
//     blind spot by a test that also proves no armed file holds one: an assertion gated by `&&`, `||` or a ternary instead of an
//     `if`; a `switch` on an outcome; a test callback passed by name instead of inline; `it`/`test` bound to another name by a
//     variable (`const check = it`). The rules are the grammar of the defect class Epic 44 closed, not a proof that every test
//     asserts.
//   - `scanSource` reads nothing, `liveGuardFindings` reads each file through `read`. Nothing is written.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { coveredTestFiles } from './ci-checks.mjs';
import { REPO_ROOT } from './live-gate-scan.mjs';

/**
 * The calls that mark a running test skipped. `method` matches `<ctx>.<name>()` with no argument, where `<ctx>` is a parameter
 * of a function around the call (the test context a test callback, or a helper it calls, receives); `function` matches `<name>(`.
 *
 * @type {ReadonlyArray<{ name: string, kind: 'method' | 'function', reason: string }>}
 */
export const SKIP_CALLS = Object.freeze(
  [
    {
      name: 'skip',
      kind: 'method',
      reason:
        "vitest's test context `skip()` (a parameter, called with no argument): it throws, so the test stops and is reported as skipped, which CI lists and fails when it is not allowlisted",
    },
    { name: 'skipTest', kind: 'function', reason: "process-gate-helpers' skipTest logs the reason and calls the context's skip()" },
    { name: 'skipLeg', kind: 'function', reason: "the Epic 35 defect gate's per-leg skip: it calls skipTest under the gate's tag" },
  ].map((entry) => Object.freeze(entry)),
);

/**
 * The helpers whose call in an `if` condition makes `if (helper(...)) return;` a skip: each is defined (in an armed file or a
 * helper that one imports) to call a skip when it returns true, and a test pins that.
 *
 * @type {ReadonlyArray<{ name: string, reason: string }>}
 */
export const SKIP_HELPERS = Object.freeze(
  [
    { name: 'skipIfReason', reason: "process-gate-helpers' skipIfReason calls the context's skip() when the reason is set and returns true" },
    { name: 'skipIf', reason: "the governance-file process gate's skipIf logs the reason and calls the context's skip() before it returns true" },
    { name: 'coverageBlocked', reason: "story-40-5's coverageBlocked calls skipTest when the coverage rows are blocked (and throws when armed) before it returns true" },
  ].map((entry) => Object.freeze(entry)),
);

/** What a condition must read to be rule C's concern: `isError` in any form, or a member of `created`. */
const OUTCOME_CONDITION = /\bisError\b|\bcreated\s*(?:\?\.|\.|\[)/;

/** The roots of a test callback's callee: `it`, `test` and their modifier chains. */
const TEST_ROOTS = new Set(['it', 'test']);

/** TEST_ROOTS plus every local name the file imports `it` or `test` under from `vitest` (`import { it as check } from 'vitest'`). */
function testRootsOf(source) {
  const roots = new Set(TEST_ROOTS);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'vitest') continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (TEST_ROOTS.has((element.propertyName ?? element.name).text)) roots.add(element.name.text);
    }
  }
  return roots;
}

const isFunctionNode = (node) =>
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

/** The identifier that roots a callee such as `it`, `it.skipIf(x)`, `it.each(rows)` or `test.concurrent.each(rows)`; else undefined. */
function calleeRoot(expression) {
  let node = expression;
  for (;;) {
    if (ts.isCallExpression(node)) node = node.expression;
    else if (ts.isPropertyAccessExpression(node)) node = node.expression;
    else if (ts.isParenthesizedExpression(node)) node = node.expression;
    else if (ts.isTaggedTemplateExpression(node)) node = node.tag;
    else break;
  }
  return ts.isIdentifier(node) ? node.text : undefined;
}

/** Whether `fn` is an inline callback: an arrow or function expression passed as an argument of a call. */
function isInlineCallback(fn) {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false;
  const call = fn.parent;
  return Boolean(call && ts.isCallExpression(call) && call.arguments.includes(fn));
}

/** Whether `fn` is the callback of a test call (`it('x', async () => {...})`, `it.each(rows)('x', (row) => {...})`). */
function isTestCallback(fn, roots) {
  if (!isInlineCallback(fn)) return false;
  const root = calleeRoot(fn.parent.expression);
  return root !== undefined && roots.has(root);
}

/** The nearest function around `node`, or undefined at the top level. */
function enclosingFunction(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isFunctionNode(parent)) return parent;
  }
  return undefined;
}

/** Rule C's scope: `node` is inside a test callback, directly or through inline callbacks only. */
function inTestBody(node, roots) {
  for (let fn = enclosingFunction(node); fn; fn = enclosingFunction(fn)) {
    if (isTestCallback(fn, roots)) return true;
    if (!isInlineCallback(fn)) return false;
  }
  return false;
}

/** Whether `expression` is a call of one of SKIP_CALLS. */
function isSkipCall(expression) {
  if (!expression || !ts.isCallExpression(expression)) return false;
  const callee = expression.expression;
  if (ts.isIdentifier(callee)) return SKIP_CALLS.some((entry) => entry.kind === 'function' && entry.name === callee.text);
  if (ts.isPropertyAccessExpression(callee) && expression.arguments.length === 0 && ts.isIdentifier(callee.expression) && isParameterInScope(callee.expression)) {
    return SKIP_CALLS.some((entry) => entry.kind === 'method' && entry.name === callee.name.text);
  }
  return false;
}

/** Whether `identifier` names a parameter of a function around it (`async (ctx) => { ... ctx.skip() ... }`). */
function isParameterInScope(identifier) {
  for (let fn = enclosingFunction(identifier); fn; fn = enclosingFunction(fn)) {
    if (fn.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === identifier.text)) return true;
  }
  return false;
}

/** Whether `statement` is an expression statement that is a skip call. */
const isSkipStatement = (statement) => ts.isExpressionStatement(statement) && isSkipCall(statement.expression);

/** Whether `expression` IS a call of one of SKIP_HELPERS (not negated, not combined with another term by `||` or `&&`). */
function isSkipHelperCall(expression) {
  let node = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && SKIP_HELPERS.some((entry) => entry.name === node.expression.text);
}

/** The statements of the block `statement` sits in, and its index there; undefined when it is not in a statement list. */
function siblingsOf(statement) {
  const parent = statement.parent;
  if (parent && (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent))) {
    return { list: parent.statements, index: parent.statements.indexOf(statement) };
  }
  return undefined;
}

/** The statements of an `if`'s then-branch. */
const thenStatements = (ifStatement) => (ts.isBlock(ifStatement.thenStatement) ? [...ifStatement.thenStatement.statements] : [ifStatement.thenStatement]);

/** Rule G's exceptions (a), (b) and (c) for one `return`. */
function isAllowedReturn(returnStatement) {
  if (isSkipCall(returnStatement.expression)) return true;

  // (b) the only statement of an `if` whose condition calls a skip helper
  let container = returnStatement.parent;
  if (container && ts.isBlock(container) && container.statements.length === 1) container = container.parent;
  if (container && ts.isIfStatement(container) && thenStatements(container).length === 1 && thenStatements(container)[0] === returnStatement) {
    if (isSkipHelperCall(container.expression)) return true;
  }

  // (c) the statement just before it in the same block is a skip call
  const sibling = siblingsOf(returnStatement);
  if (sibling && sibling.index > 0 && isSkipStatement(sibling.list[sibling.index - 1])) return true;
  return false;
}

/** Rule C's exception: the then-branch ends with a throw, a skip return or a skip call. */
function endsLoudly(ifStatement) {
  const last = thenStatements(ifStatement).at(-1);
  if (!last) return false;
  if (ts.isThrowStatement(last)) return true;
  if (ts.isReturnStatement(last)) return isAllowedReturn(last);
  return isSkipStatement(last);
}

/**
 * The findings of one test source.
 *
 * @param {string} file the path to report
 * @param {string} text the source text
 * @returns {Array<{ file: string, line: number, rule: 'G' | 'C', text: string }>}
 */
export function scanSource(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = text.split(/\r?\n/);
  const findings = [];
  const add = (node, rule) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    findings.push({ file, line, rule, text: (lines[line - 1] ?? '').trim() });
  };

  const roots = testRootsOf(source);

  const visit = (node) => {
    if (ts.isReturnStatement(node)) {
      const fn = enclosingFunction(node);
      if (fn && isTestCallback(fn, roots) && !isAllowedReturn(node)) add(node, 'G');
    } else if (ts.isIfStatement(node)) {
      if (inTestBody(node, roots) && OUTCOME_CONDITION.test(node.expression.getText(source)) && !endsLoudly(node)) add(node, 'C');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings.sort((left, right) => left.line - right.line || left.rule.localeCompare(right.rule));
}

/**
 * The findings of every armed test file.
 *
 * @param {{ files?: readonly string[], read?: (file: string) => string }} [options] `files` are relative to the repository root
 * @returns {Array<{ file: string, line: number, rule: 'G' | 'C', text: string }>}
 */
export function liveGuardFindings({ files = coveredTestFiles(), read = (file) => readFileSync(path.join(REPO_ROOT, file), 'utf8') } = {}) {
  return files.flatMap((file) => scanSource(file, read(file)));
}
