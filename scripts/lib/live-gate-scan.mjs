// The scans of the workspace's test sources that find the live gates, shared by the two tests that pin them
// (`live-gate-roster.test.ts`, `live-arming-guard.test.ts`) and by the CI check registry (`ci-checks.mjs`) and its
// self-test, so that none of them can disagree with the others about which files are live.
//
// CONTRACT
//   An ARMED GATE is a test file that refuses to skip when `IRIS_REQUIRE_LIVE` is set: it compares the arming variable,
//   or its import-time constants come from the throwaway plan. It is listed in the `gateTestFiles` roster of its
//   package's `scripts/prepublish-gate.mjs`, unless a named exemption says why not.
//   A LIVE-CAPABLE file can reach IRIS when armed: it resolves a live target or an integration configuration, or reads
//   the availability flag.
//   Every scan reads files and never runs anything. The test sources are those under a package's `src` and `tests`
//   directories and the launcher's `src`, and the guard files that name the scanned patterns are left out.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root (this file is `scripts/lib/`). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');
export const LAUNCHER_DIR = path.join(REPO_ROOT, 'extensions', 'iris-mcp-launcher');

/** The quoted entries of a gate script's `const gateTestFiles = [ ... ];` literal, comments removed. */
export function listedGateFiles(scriptSource) {
  const literal = /const gateTestFiles = \[([\s\S]*?)\];/.exec(scriptSource)?.[1] ?? '';
  const withoutComments = literal.replace(/\/\/[^\n]*/g, '');
  return [...withoutComments.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '');
}

/**
 * What marks a test file as an armed live gate: it compares the arming variable (`... IRIS_REQUIRE_LIVE === ...`), or its
 * import-time constants come from the throwaway plan (a `const` at the start of a line), the arming of the throwaway
 * bootstrap-guard gate through `IRIS_THROWAWAY`.
 */
export const ARMED_GATE = /process\.env\.IRIS_REQUIRE_LIVE\s*===|^const \w+ = throwawayGatePlan\(/m;

/**
 * Armed live gates that are off every roster by design. Each is armed by something a package's prepublish run does not
 * set, so listing it in `gateTestFiles` would run it where it can only fail or skip.
 *
 * @type {ReadonlyArray<{ pkg: string, file: string, reason: string }>}
 */
export const NAMED_EXEMPTIONS = [
  {
    pkg: 'iris-mcp-all',
    file: 'src/__tests__/story-42-2-bootstrap-guard-live-gate.test.ts',
    reason:
      "armed by IRIS_THROWAWAY, which only scripts/throwaway-iris.mjs sets (pnpm live:bootstrap-guard, Story 42.3's CI); it refuses any target that already holds ExecuteMCPv2 classes, so a prepublish run against a real instance could never pass it",
  },
];

/** Whether `file` of package directory `pkg` is a named exemption. */
export const isNamedExemption = (pkg, file) =>
  NAMED_EXEMPTIONS.some((exemption) => exemption.pkg === pkg && exemption.file === file);

/** The package's test files that are armed live gates (see {@link ARMED_GATE}), as `src/__tests__/<name>`. */
export function armedTestFiles(pkgDir) {
  const testsDir = path.join(pkgDir, 'src', '__tests__');
  if (!existsSync(testsDir)) return [];
  return readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.ts'))
    .filter((name) => ARMED_GATE.test(readFileSync(path.join(testsDir, name), 'utf8')))
    .map((name) => `src/__tests__/${name}`);
}

/**
 * The files a package's `scripts/prepublish-gate.mjs` runs armed (its `gateTestFiles`), as paths relative to the package
 * directory; empty when the package has no such script.
 */
export function readRoster(packageDir) {
  const script = path.join(packageDir, 'scripts', 'prepublish-gate.mjs');
  return existsSync(script) ? listedGateFiles(readFileSync(script, 'utf8')) : [];
}

/** A test file that can reach IRIS: it resolves a live target or an integration config, or it reads the availability flag. */
export const LIVE_CAPABLE =
  /process\.env\.IRIS_(?:TEST_)?HOST\s*\?\?|\birisTargetFromEnv\(|\bliveGateTarget\(|\bliveArmingSkipReason\(|\bresolveLiveTarget\(|\bgetIntegrationConfig\(|__IRIS_AVAILABLE__/;

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'coverage']);

/** The two guard files: they name the patterns they scan for, so the scans leave them out. */
export const GUARD_FILES = [
  'packages/iris-mcp-all/src/__tests__/live-arming-guard.test.ts',
  'extensions/iris-mcp-launcher/src/__tests__/live-arming-guard.test.ts',
];

/** Every file under `dir` whose name ends in one of `extensions`. */
export function walk(dir, extensions) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) found.push(full);
  }
  return found;
}

/** `file` relative to the repository root, with forward slashes. */
export const relativeToRepo = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

/** The directory names of the workspace packages (the entries of `packages/` that hold a `package.json`). */
export function workspacePackageDirs() {
  return readdirSync(PACKAGES_DIR).filter((name) => existsSync(path.join(PACKAGES_DIR, name, 'package.json')));
}

/** Test sources: every `.test.ts` and every `.ts` or `.mjs` helper under a `__tests__` or `test-helpers` directory, as absolute paths. */
export function testSources() {
  const roots = [
    ...workspacePackageDirs().flatMap((name) => [path.join(PACKAGES_DIR, name, 'src'), path.join(PACKAGES_DIR, name, 'tests')]),
    path.join(LAUNCHER_DIR, 'src'),
  ];
  return roots
    .flatMap((root) => walk(root, ['.ts', '.mts', '.mjs']))
    .filter((file) => {
      const rel = relativeToRepo(file);
      return /(^|\/)(__tests__|test-helpers)\//.test(rel) || rel.endsWith('.test.ts');
    })
    .filter((file) => !GUARD_FILES.includes(relativeToRepo(file)))
    .sort();
}

/** The live-capable `*.test.ts` files (see {@link LIVE_CAPABLE}), as absolute paths. */
export function liveCapableTestFiles() {
  return testSources().filter((file) => file.endsWith('.test.ts') && LIVE_CAPABLE.test(readFileSync(file, 'utf8')));
}
