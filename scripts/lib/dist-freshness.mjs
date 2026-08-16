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
// `files: ["dist"]` in its own `package.json` (e.g. `@iris-mcp/all`, a
// dependencies-only meta-package with no build step of its own) is skipped rather than
// failed closed on a shape this check was never designed to judge — derived
// mechanically from each package's own manifest, per Rule #20's "encode the existing
// set as a generated/derived signal, never a hand-maintained flag".

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recursively find the newest file modification time under `dir`.
 *
 * @param {string} dir
 * @returns {number} Newest mtime in milliseconds, or `-Infinity` if `dir` contains no
 *   files at all (distinguishes "no build output ever happened" from "genuinely fresh").
 */
function newestMtimeMs(dir) {
  let newest = -Infinity;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const childNewest = newestMtimeMs(full);
      if (childNewest > newest) newest = childNewest;
    } else if (entry.isFile()) {
      const mtime = statSync(full).mtimeMs;
      if (mtime > newest) newest = mtime;
    }
  }
  return newest;
}

/**
 * Verify `pkgDir`'s own `dist/` is present, non-empty, and at least as new as `src/`
 * (when `src/` exists). Skips (returns `{ ok: true }`) when `pkgDir`'s own
 * `package.json` does not declare `files: ["dist"]` — a package with no build step of
 * its own has nothing for this check to verify.
 *
 * Never throws for an ordinary stale/missing-build finding (only lets a genuinely
 * unexpected filesystem error propagate) — callers fail closed with a clear message
 * instead of an uncaught stack trace.
 *
 * @param {string} pkgDir - The package's own root directory (its `package.json`'s
 *   directory). Pass `process.cwd()` from a `prepublishOnly` script, never a
 *   hard-coded or relative-to-this-module path.
 * @param {string} pkgName - For the message only (e.g. `process.env.npm_package_name`).
 * @returns {{ ok: boolean, reason?: string, skipped?: boolean }}
 */
export function checkDistFresh(pkgDir, pkgName) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const declaresDist = Array.isArray(pkgJson.files) && pkgJson.files.includes('dist');
    if (!declaresDist) {
      return { ok: true, skipped: true };
    }
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

  if (!existsSync(srcDir)) {
    // No src/ to compare against — dist/ is present and non-empty, the best signal
    // available. No package this gate is wired into lacks a src/ directory today, but
    // this keeps the check from failing closed on a shape it was never designed to
    // judge.
    return { ok: true };
  }

  const srcNewest = newestMtimeMs(srcDir);
  if (srcNewest > distNewest) {
    return {
      ok: false,
      reason:
        `${pkgName}'s src/ has been modified more recently than its dist/ (newest src ` +
        `mtime ${new Date(srcNewest).toISOString()} > newest dist mtime ` +
        `${new Date(distNewest).toISOString()}). The build output is STALE. Run ` +
        `"pnpm turbo run build" and retry — publishing must not proceed with a stale ` +
        `dist/.`,
    };
  }

  return { ok: true };
}
