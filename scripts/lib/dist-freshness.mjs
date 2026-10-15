// Story 34.7 AC 34.7.5 (ledger `34-6-CR-11`) — packaging-boundary build-freshness
// check, shared by every publishable package's OWN prepublish gate.
//
// THE GAP THIS CLOSES. Neither existing prepublish gate verifies the package about to
// be packaged was actually BUILT: `prepublishOnly` runs BEFORE `prepack`;
// `scripts/verify-iris-reachable.mjs` imports only `@iris-mcp/shared`'s dist, never the
// CALLING package's own; and `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` runs
// vitest over TypeScript SOURCE, not the built output. No package in the workspace
// declares a `prepare`/`prepack` script, while every publishable server package
// declares `files: ["dist"]`. So with a stale or missing `dist/`, both gates pass green
// and `npm`/`pnpm` pack the tarball anyway — for a first public release, an empty or
// stale tarball on the registry is unrecoverable (npm versions are immutable).
//
// PER-PACKAGE AND SELF-REFERENTIAL BY CONSTRUCTION. `checkDistFresh` takes the CALLING
// package's own directory as an explicit argument — it never derives a path from this
// module's own `import.meta.url`, which would always resolve to this shared
// `scripts/lib/` location regardless of which package invoked it (exactly the "a gate
// that checks someone else's dist" defect this AC exists to avoid). Every caller passes
// its OWN package directory (`process.cwd()` from a `prepublishOnly` script, which
// npm/pnpm set to that package's root — or, for `prepublish-gate.mjs`, the
// `packageDir` it already computes from its own `import.meta.url`), so this function
// always inspects the SAME package that is about to be packaged, never a sibling's.
//
// GENERIC BY DESIGN — no hand-maintained package list. A package that declares no
// dist-shipping entry in its own `package.json` `files` (e.g. `@iris-mcp/all`, a
// dependencies-only meta-package with no build step of its own) is skipped rather than
// failed closed on a shape this check was never designed to judge — derived
// mechanically from each package's own manifest, per Rule #20's "encode the existing
// set as a generated/derived signal, never a hand-maintained flag".

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * How far past `now` a `dist/` mtime may sit before the build output is treated as
 * untrustworthy. A clock-skewed or hand-touched file dated in the future would make the
 * newest-`dist` versus newest-`src` comparison pass for any later source edit.
 */
const FUTURE_MTIME_TOLERANCE_MS = 60_000;

/** A fail-closed finding raised inside the walkers; converted to `{ ok: false }` once. */
class FreshnessFinding extends Error {}

/**
 * Normalize one `files` entry for the dist-shipping comparison: the entry's first path
 * segment, after any leading `./` or `/`. Every entry that names `dist` or a path under
 * it (`dist`, `./dist`, `/dist`, `dist/`, `dist/*`, `dist/**`, `dist/**\/*.js`,
 * `dist/index.js`, ...) normalizes to `dist`. Negations (`!dist/**\/__tests__`) and
 * non-string entries never name it.
 *
 * @param {unknown} entry
 * @returns {string | undefined}
 */
function normalizeFilesEntry(entry) {
  if (typeof entry !== 'string' || entry.startsWith('!')) return undefined;
  return entry.replace(/^(\.?\/)+/, '').split('/')[0];
}

/**
 * Directories under `src/` whose files never reach the published build: every package
 * ships `files: ["dist", "!dist/**\/__tests__"]`, so a test or fixture edit cannot make
 * the shipped `dist/` stale (and a non-TypeScript fixture would never be re-emitted by a
 * rebuild, leaving the comparison stale for good).
 */
const SRC_DIRS_NOT_SHIPPED = new Set(['__tests__']);

/**
 * Recursively find the newest file modification time under `dir`.
 *
 * A symlinked file is followed (its target's mtime counts). A dangling symlink, or a
 * symlink to a directory, is not something the staleness comparison can judge, so it
 * raises a {@link FreshnessFinding} (fail closed) rather than being skipped silently.
 *
 * @param {string} dir
 * @param {ReadonlySet<string>} [skipDirs] - Directory names not descended into, at any depth.
 * @returns {number} Newest mtime in milliseconds, or `-Infinity` if `dir` contains no
 *   files at all (distinguishes "no build output ever happened" from "genuinely fresh").
 * @throws {FreshnessFinding | Error} On an unreadable entry or an unsupported symlink;
 *   the caller converts either to a `{ ok: false }` result.
 */
function newestMtimeMs(dir, skipDirs = new Set()) {
  let newest = -Infinity;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      let target;
      try {
        target = statSync(full);
      } catch {
        throw new FreshnessFinding(`${full} is a dangling symlink`);
      }
      if (target.isDirectory()) {
        throw new FreshnessFinding(`${full} is a symlink to a directory`);
      }
      if (target.isFile() && target.mtimeMs > newest) newest = target.mtimeMs;
    } else if (entry.isDirectory()) {
      const childNewest = newestMtimeMs(full, skipDirs);
      if (childNewest > newest) newest = childNewest;
    } else if (entry.isFile()) {
      const mtime = statSync(full).mtimeMs;
      if (mtime > newest) newest = mtime;
    }
  }
  return newest;
}

/**
 * Collect every `{ field, target }` pair of a package manifest that names a file the
 * published package must resolve at runtime: `main`, `module`, `bin` (a string or a
 * name-to-path map) and every string leaf of `exports`, recursing through condition
 * objects and arrays.
 *
 * @param {Record<string, unknown>} pkgJson
 * @returns {Array<{ field: string, target: string }>}
 */
function collectDeclaredTargets(pkgJson) {
  /** @type {Array<{ field: string, target: string }>} */
  const found = [];
  const walk = (field, value) => {
    if (typeof value === 'string') {
      found.push({ field, target: value });
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(`${field}[${index}]`, item));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        walk(/^[A-Za-z_$][\w$]*$/.test(key) ? `${field}.${key}` : `${field}[${JSON.stringify(key)}]`, child);
      }
    }
  };
  if (typeof pkgJson.main === 'string') walk('main', pkgJson.main);
  if (typeof pkgJson.module === 'string') walk('module', pkgJson.module);
  if (pkgJson.bin !== undefined) walk('bin', pkgJson.bin);
  if (pkgJson.exports !== undefined) walk('exports', pkgJson.exports);
  return found;
}

/**
 * Verify `pkgDir`'s own `dist/` is present, non-empty, not dated in the future, at
 * least as new as `src/` (when `src/` exists; files under a `src/` `__tests__` directory
 * are not compared, because they never ship), and contains every `dist/` file the
 * manifest's `main`, `module`, `bin` and `exports` declare. Skips (returns
 * `{ ok: true, skipped: true }`) when `pkgDir`'s own `package.json` has no `files` entry
 * that names `dist` or a path under it (`dist`, `./dist`, `dist/`, `dist/**`,
 * `dist/*.js`, ...; negations are ignored) - including a manifest with no `files` array,
 * or an empty one - since a package with no build step of its own has nothing for this
 * check to verify.
 *
 * Never throws. A missing or malformed `package.json`, an unreadable file or directory,
 * a dangling or directory symlink, a future-dated `dist/` file and a missing declared
 * target each return `{ ok: false, reason }` naming the cause, so a caller fails closed
 * with a clear message instead of an uncaught stack trace. A symlinked FILE is followed.
 * Declared targets that resolve outside `dist/` (for example a `./src/...` export) are
 * not this check's concern and are not examined.
 *
 * @param {string} pkgDir - The package's own root directory (its `package.json`'s
 *   directory). Pass `process.cwd()` from a `prepublishOnly` script, never a
 *   hard-coded or relative-to-this-module path.
 * @param {string} pkgName - For the message only (e.g. `process.env.npm_package_name`).
 * @param {{ now?: number }} [options] - `now` is the reference time in epoch
 *   milliseconds for the future-mtime check (default `Date.now()`); tests inject it.
 * @returns {{ ok: boolean, reason?: string, skipped?: boolean }}
 */
export function checkDistFresh(pkgDir, pkgName, options = {}) {
  try {
    return inspectDist(pkgDir, pkgName, options.now ?? Date.now());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason:
        `${pkgName}'s build output could not be verified: ${detail}. Fix the cause, run ` +
        `"pnpm turbo run build" and retry - publishing must not proceed unverified.`,
    };
  }
}

/**
 * The body of {@link checkDistFresh}. May throw; the caller converts every throw to a
 * fail-closed result.
 *
 * @param {string} pkgDir
 * @param {string} pkgName
 * @param {number} now
 * @returns {{ ok: boolean, reason?: string, skipped?: boolean }}
 */
function inspectDist(pkgDir, pkgName, now) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  let pkgJson;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new FreshnessFinding(`package.json at ${pkgJsonPath} is missing or malformed (${detail})`);
  }
  if (pkgJson === null || typeof pkgJson !== 'object' || Array.isArray(pkgJson)) {
    throw new FreshnessFinding(`package.json at ${pkgJsonPath} is not a JSON object`);
  }

  const declaresDist =
    Array.isArray(pkgJson.files) && pkgJson.files.some((entry) => normalizeFilesEntry(entry) === 'dist');
  if (!declaresDist) {
    return { ok: true, skipped: true };
  }

  const distDir = join(pkgDir, 'dist');
  const srcDir = join(pkgDir, 'src');

  if (!existsSync(distDir)) {
    return {
      ok: false,
      reason:
        `${pkgName} has no dist/ directory at ${distDir}. Run "pnpm turbo run build" ` +
        `first — publishing must not proceed with no build output.`,
    };
  }

  const distNewest = newestMtimeMs(distDir);
  if (distNewest === -Infinity) {
    return {
      ok: false,
      reason:
        `${pkgName}'s dist/ directory at ${distDir} exists but contains no files. Run ` +
        `"pnpm turbo run build" first — publishing must not proceed with an empty ` +
        `build output.`,
    };
  }

  if (distNewest > now + FUTURE_MTIME_TOLERANCE_MS) {
    return {
      ok: false,
      reason:
        `${pkgName}'s dist/ at ${distDir} holds a file dated ${new Date(distNewest).toISOString()}, ` +
        `more than ${FUTURE_MTIME_TOLERANCE_MS / 1000} s after the current time ` +
        `(${new Date(now).toISOString()}). A future-dated build output would hide every later ` +
        `src/ edit from the staleness check. Fix the clock or rebuild with "pnpm turbo run build".`,
    };
  }

  const distRoot = resolve(distDir);
  for (const { field, target } of collectDeclaredTargets(pkgJson)) {
    if (target.includes('*')) continue; // a subpath pattern names no single file
    const resolved = resolve(pkgDir, target);
    const fromDist = relative(distRoot, resolved);
    if (fromDist === '' || fromDist === '..' || fromDist.startsWith(`..${sep}`) || isAbsolute(fromDist)) {
      continue; // outside dist/ - not this check's concern
    }
    if (!existsSync(resolved)) {
      return {
        ok: false,
        reason:
          `${pkgName}'s package.json field ${field} points at ${target}, which does not ` +
          `exist (looked for ${resolved}). Run "pnpm turbo run build" - publishing must ` +
          `not proceed with a manifest that names a missing file.`,
      };
    }
  }

  if (!existsSync(srcDir)) {
    // No src/ to compare against — dist/ is present and non-empty, the best signal
    // available. No package this gate is wired into lacks a src/ directory today, but
    // this keeps the check from failing closed on a shape it was never designed to
    // judge.
    return { ok: true };
  }

  const srcNewest = newestMtimeMs(srcDir, SRC_DIRS_NOT_SHIPPED);
  if (srcNewest > distNewest) {
    return {
      ok: false,
      reason:
        `${pkgName}'s src/ has been modified more recently than its dist/ (newest src ` +
        `mtime ${new Date(srcNewest).toISOString()} > newest dist mtime ` +
        `${new Date(distNewest).toISOString()}). The build output is STALE. Run ` +
        `"pnpm turbo run build" and retry — publishing must not proceed with a stale ` +
        `dist/. If the rebuild leaves this unchanged (the compiler emits nothing when a ` +
        `file's content did not change, for example after a touch or a regenerated ` +
        `identical file), delete the package's dist/ and tsconfig.tsbuildinfo, then rebuild.`,
    };
  }

  return { ok: true };
}
