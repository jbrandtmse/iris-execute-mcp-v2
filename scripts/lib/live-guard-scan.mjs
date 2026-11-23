// The scan behind `pnpm check:live-guards` (Story 44.5, DW-684): it refuses a test, in a file that CI runs armed, that can end
// without asserting. An armed CI suite reports a test as "passed" when its body returns early or when its only assertion sits
// inside an `if` that a failed create skips, so the suite is green over a test that tested nothing. `ci-live-suite.mjs` sees
// only skips, never an early return, so this source check is what holds the line.
//
// CONTRACT
//   - SCOPE. Every file `coveredTestFiles()` returns (`ci-checks.mjs`): the test files of the armed suites. A file that is in no
//     armed suite is out of scope. A TEST CALLBACK is the function argument of `it`/`test` and their `.each`, `.skipIf`,
//     `.runIf`, `.concurrent`, `.only` and `.skip` forms. A `return` or an `if` is in scope when the nearest function around it
//     is a test callback: a hook (`beforeAll`), a helper function and a callback nested in a test report no test outcome.
//   - RULE G (guard return). A `return` in scope is a finding unless one of these holds (each entry of SKIP_CALLS and
//     SKIP_HELPERS names its reason):
//       (a) it returns a skip call (`<ctx>.skip()`, `skipTest(`, `skipLeg(`);
//       (b) it is the only statement of an `if` whose condition IS a call of a SKIP_HELPERS function (`skipIfReason`,
//           `skipIf`, `coverageBlocked`), not negated and not combined with another term by `||` or `&&`;
//       (c) the statement just before it in the same block is a skip call.
//     A skip is loud in CI (`ci-live-suite.mjs` fails a skip that is not allowlisted); a data guard is silent.
//   - RULE C (conditional outcome). An `if` in scope whose condition reads `.isError` or `created.` is a finding unless its
//     then-branch ends with a `throw`, a skip return or a skip call. A create that is "tolerated" (`if (!result.isError) {
//     created.x = true; }`) and an assertion that only runs when a call succeeded both have this shape.
//   - The scan is syntactic (the TypeScript parser, one file at a time). It does not follow a helper that returns early, and it
//     does not see a conditional assertion whose condition reads neither `.isError` nor `created.`; the rules are the grammar of
//     the defect class Epic 44 closed, not a proof that every test asserts.
//   - `scanSource` reads nothing, `liveGuardFindings` reads each file through `read`. Nothing is written.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { coveredTestFiles } from './ci-checks.mjs';
import { REPO_ROOT } from './live-gate-scan.mjs';

/**
 * The calls that mark a running test skipped. `method` matches `<anything>.<name>(`, `function` matches `<name>(`.
 *
 * @type {ReadonlyArray<{ name: string, kind: 'method' | 'function', reason: string }>}
 */
export const SKIP_CALLS = Object.freeze(
  [
    { name: 'skip', kind: 'method', reason: "vitest's test context `skip()`: the test is reported as skipped, which CI lists and fails when it is not allowlisted" },
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

/** What a condition must read to be rule C's concern. */
const OUTCOME_CONDITION = /\.isError\b|\bcreated\./;

/** The roots of a test callback's callee: `it`, `test` and their modifier chains. */
const TEST_ROOTS = new Set(['it', 'test']);

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
    else break;
  }
  return ts.isIdentifier(node) ? node.text : undefined;
}

/** Whether `fn` is the callback of a test call (`it('x', async () => {...})`, `it.each(rows)('x', (row) => {...})`). */
function isTestCallback(fn) {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false;
  const call = fn.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(fn)) return false;
  const root = calleeRoot(call.expression);
  return root !== undefined && TEST_ROOTS.has(root);
}

/** The nearest function around `node`, or undefined at the top level. */
function enclosingFunction(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isFunctionNode(parent)) return parent;
  }
  return undefined;
}

/** Whether `expression` is a call of one of SKIP_CALLS. */
function isSkipCall(expression) {
  if (!expression || !ts.isCallExpression(expression)) return false;
  const callee = expression.expression;
  if (ts.isIdentifier(callee)) return SKIP_CALLS.some((entry) => entry.kind === 'function' && entry.name === callee.text);
  if (ts.isPropertyAccessExpression(callee)) return SKIP_CALLS.some((entry) => entry.kind === 'method' && entry.name === callee.name.text);
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

  const visit = (node) => {
    if (ts.isReturnStatement(node)) {
      const fn = enclosingFunction(node);
      if (fn && isTestCallback(fn) && !isAllowedReturn(node)) add(node, 'G');
    } else if (ts.isIfStatement(node)) {
      const fn = enclosingFunction(node);
      if (fn && isTestCallback(fn) && OUTCOME_CONDITION.test(node.expression.getText(source)) && !endsLoudly(node)) add(node, 'C');
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
