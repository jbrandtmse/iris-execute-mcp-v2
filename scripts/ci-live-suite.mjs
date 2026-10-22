#!/usr/bin/env node
// Runs one armed CI suite and fails it when any test of it skipped without a reason on its allowlist (DW-676).
//
// USE
//   node scripts/ci-live-suite.mjs <suite-id>
//   The ids and what each runs are the `LIVE_SUITES` of `scripts/lib/ci-checks.mjs`. CI runs a suite as
//   `node scripts/throwaway-iris.mjs exec --state <file> -- node scripts/ci-live-suite.mjs <suite-id>`; the two
//   bootstrap-guard suites start their own throwaway container.
//
// CONTRACT
//   1. Refusal comes first, before anything is spawned (exit 2): an unknown suite id, and, for every suite that does not make
//      its own container, an environment that is not a throwaway target (`assertThrowawayEnv`: IRIS_REQUIRE_LIVE=1, a
//      harness-shaped IRIS_THROWAWAY, IRIS_HOST=127.0.0.1, and a port that is not 52773 or 1972).
//   2. The suite's command runs in its directory. For a vitest or harness suite the JSON reporter is appended
//      (`--reporter=default --reporter=json --outputFile.json=<temp file>`), so the run is also printed as usual.
//   3. The report is then classified by `classifyVitestReport`. A problem is any of: a report that is missing or holds 0 tests;
//      an expected test file that is not in the report or holds no test; a test whose status is skipped, pending, todo or
//      disabled that no allowlist entry names (the entry names the file and the test's full name); an allowlist entry that
//      names no skipped test of the report (stale). Every problem is listed at once. A plain suite has no report: its log says
//      that no test of it can skip.
//   4. Exit code: the command's own code when it is not 0 (the problems are still printed); otherwise 1 when there is any
//      problem; otherwise 0.
//
// IMPORT
//   Importing this module runs nothing. `runSuite(id, options)` takes the process-spawning and file-reading steps as options.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ThrowawayRefusal, assertThrowawayEnv } from './throwaway-iris.mjs';
import { LIVE_SUITES, reporterArgs } from './lib/ci-checks.mjs';
import { REPO_ROOT } from './lib/live-gate-scan.mjs';
import { isEntryPoint, spawnInherited } from './lib/script-process.mjs';

/** The statuses of a test that did not run, as vitest 2 reports them. */
const SKIP_STATUSES = new Set(['skipped', 'pending', 'todo', 'disabled']);

/**
 * What is wrong with a parsed vitest JSON report of an armed suite. An empty list means the suite passed without skipping.
 *
 * @param {unknown} report - The parsed JSON of `vitest --reporter=json`.
 * @param {{ cwd: string, expectedFiles: readonly string[], allowedSkips: ReadonlyArray<{ file: string, test: string, reason: string }> }} options
 *   `cwd` is the directory the file names of `expectedFiles` and `allowedSkips` are relative to.
 * @returns {string[]}
 */
export function classifyVitestReport(report, { cwd, expectedFiles, allowedSkips }) {
  const files = report !== null && typeof report === 'object' && Array.isArray(report.testResults) ? report.testResults : undefined;
  if (files === undefined) return ['the report is not a vitest JSON report: it has no testResults list.'];

  const problems = [];
  const resolved = (file) => path.resolve(cwd, file);
  const relative = (file) => path.relative(cwd, path.resolve(file)).split(path.sep).join('/');
  const testsOf = (file) => (Array.isArray(file.assertionResults) ? file.assertionResults : []);

  if (files.reduce((total, file) => total + testsOf(file).length, 0) === 0) {
    problems.push('the report holds 0 tests: nothing ran.');
  }

  const byName = new Map(files.map((file) => [path.resolve(String(file.name)), file]));
  for (const expected of expectedFiles) {
    const found = byName.get(resolved(expected));
    if (found === undefined) problems.push(`expected test file is not in the report: ${expected}`);
    else if (testsOf(found).length === 0) problems.push(`expected test file reported no tests: ${expected}`);
  }

  const used = new Set();
  for (const file of files) {
    for (const test of testsOf(file)) {
      if (!SKIP_STATUSES.has(test.status)) continue;
      const index = allowedSkips.findIndex((entry) => resolved(entry.file) === path.resolve(String(file.name)) && entry.test === test.fullName);
      if (index >= 0) used.add(index);
      else problems.push(`unlisted skip (${test.status}): ${relative(file.name)} :: ${test.fullName}`);
    }
  }
  allowedSkips.forEach((entry, index) => {
    if (!used.has(index)) problems.push(`stale allowlist entry, it names no skipped test of the report: ${entry.file} :: ${entry.test}`);
  });
  return problems;
}

/** One line of counts from a vitest JSON report, for the log. */
function describeReport(report) {
  if (report === null || typeof report !== 'object') return 'no report';
  const count = (key) => (typeof report[key] === 'number' ? report[key] : '?');
  return `${count('numTotalTests')} tests, ${count('numPassedTests')} passed, ${count('numFailedTests')} failed, ${count('numPendingTests')} skipped, ${count('numTodoTests')} todo`;
}

/** Run `argv` in `cwd` with `env`, output inherited, forwarding INT and TERM to it while it runs; resolve with its exit code. */
function spawnForwarding(argv, { cwd, env }) {
  let child;
  const handlers = ['SIGINT', 'SIGTERM'].map((signal) => [signal, () => child?.kill(signal)]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const onChild = (spawned) => {
    child = spawned;
  };
  return spawnInherited(argv, { label: 'ci-live-suite', cwd, env, onChild }).finally(() => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  });
}

/**
 * Run the suite `id` and return the exit code.
 *
 * @param {string} id
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   suites?: typeof LIVE_SUITES,
 *   repoRoot?: string,
 *   spawnCommand?: (argv: string[], options: { cwd: string, env: Record<string, string | undefined> }) => Promise<number>,
 *   log?: (line: string) => void,
 * }} [options]
 * @returns {Promise<number>}
 */
export async function runSuite(id, options = {}) {
  const {
    env = process.env,
    suites = LIVE_SUITES,
    repoRoot = REPO_ROOT,
    spawnCommand = spawnForwarding,
    log = (line) => process.stderr.write(`${line}\n`),
  } = options;

  const suite = Object.hasOwn(suites, id) ? suites[id] : undefined;
  if (suite === undefined) {
    log(`ci-live-suite: unknown suite ${JSON.stringify(id)}; the suites are: ${Object.keys(suites).join(', ')}.`);
    return 2;
  }
  if (suite.kind !== 'harness') {
    try {
      assertThrowawayEnv(env);
    } catch (error) {
      if (!(error instanceof ThrowawayRefusal)) throw error;
      log(`ci-live-suite: refusing to run ${id}: ${error.message}`);
      return 2;
    }
  }

  const reportDir = suite.kind === 'plain' ? undefined : mkdtempSync(path.join(tmpdir(), 'ci-live-suite-'));
  try {
    const reportFile = reportDir === undefined ? undefined : path.join(reportDir, 'report.json');
    const argv = reportFile === undefined ? [...suite.command] : [...suite.command, ...reporterArgs(reportFile)];
    log(`ci-live-suite: ${id}: ${argv.join(' ')}`);
    const code = await spawnCommand(argv, { cwd: path.join(repoRoot, suite.cwd), env });

    const problems = [];
    let report;
    if (reportFile !== undefined) {
      if (!existsSync(reportFile)) {
        problems.push(`report missing: the command wrote no JSON report to ${reportFile}.`);
      } else {
        try {
          report = JSON.parse(readFileSync(reportFile, 'utf8'));
          problems.push(
            ...classifyVitestReport(report, { cwd: repoRoot, expectedFiles: suite.expectedFiles(), allowedSkips: suite.allowedSkips }),
          );
        } catch (error) {
          problems.push(`report unreadable: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (problems.length > 0) {
      log(`ci-live-suite: ${id}: ${problems.length} problem(s) with the run (${describeReport(report)}):`);
      for (const problem of problems) log(`  - ${problem}`);
    } else if (report !== undefined) {
      log(`ci-live-suite: ${id}: ${describeReport(report)}; 0 unlisted skips (${suite.allowedSkips.length} allowlisted).`);
    } else if (suite.kind === 'plain') {
      log(`ci-live-suite: ${id}: a plain command with no test report, so no test of it can skip; 0 unlisted skips.`);
    }
    if (code !== 0) {
      log(`ci-live-suite: ${id}: the command exited ${code}.`);
      return code;
    }
    return problems.length > 0 ? 1 : 0;
  } finally {
    if (reportDir !== undefined) rmSync(reportDir, { recursive: true, force: true });
  }
}

/**
 * The entry point: `ci-live-suite.mjs <suite-id>`.
 *
 * @param {readonly string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<number>} The exit code.
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 1) {
    process.stderr.write(`usage: node scripts/ci-live-suite.mjs <suite-id>\nsuites: ${Object.keys(LIVE_SUITES).join(', ')}\n`);
    return 2;
  }
  return runSuite(argv[0], { env });
}

if (isEntryPoint(import.meta.url)) {
  main().then((code) => process.exit(code));
}
