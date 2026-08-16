#!/usr/bin/env node
/**
 * Story 34.6 QA fix (`34-6-QA-1`) — packaging-boundary IRIS-reachability gate
 * for every publishable `@iris-mcp/*` package OTHER than `@iris-mcp/dev`
 * (which has its own deeper epic-done gate:
 * `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`, armed via that
 * package's own `prepublishOnly`).
 *
 * Confirmed LIVE (2026-08-15, Story 34.6 QA, dry-run only — no registry
 * write): `pnpm -r --filter @iris-mcp/dev --filter @iris-mcp/shared publish
 * --dry-run --no-git-checks` with a deliberately wrong `IRIS_PASSWORD`
 * packaged and "published" (dry-run) `@iris-mcp/shared` COMPLETELY —
 * dependency-topological order runs `@iris-mcp/shared` (a dependency of
 * every other `@iris-mcp/*` package) before `@iris-mcp/dev`, whose
 * `prepublishOnly` gate only THEN ran and correctly failed closed. In a
 * REAL (non-dry-run) release, `@iris-mcp/shared` would already be on the
 * registry by the time that failure is observed — the recursive command's
 * own non-zero exit code cannot retroactively un-publish it. AC 34.6.3's
 * own text ("the gate must fail CLOSED when packaging a release") was true
 * for `@iris-mcp/dev` alone, not for the release the `.changeset/config.json`
 * `"fixed": [["@iris-mcp/*"]]` group actually ships. This script closes
 * that gap for every IRIS-touching package with a minimal, unconditional,
 * always-required reachability check (no graceful skip — this file is only
 * ever invoked at the publish boundary, never in a normal dev/test loop, so
 * there is no "developer without IRIS configured" case to accommodate).
 *
 * NOT a substitute for `@iris-mcp/dev`'s own epic-done gate: that suite
 * exercises the SPECIFIC regression Epic 34 fixed (`iris_execute_classmethod`
 * capture/byRef/namespace behavior) and only makes sense for the package
 * that ships that tool. This script verifies only the coarser, universal
 * precondition every IRIS-calling package shares — IRIS is up and this
 * instance's credentials authenticate — which is the right-sized net for
 * packages with no dedicated live-regression suite of their own.
 *
 * Wired into `@iris-mcp/client-config` too, despite that package having no
 * IRIS dependency of its own (no `@iris-mcp/shared` dependency, no
 * `IrisHttpClient` usage). The first draft deliberately excluded it on the
 * grounds that gating a config-file manager on IRIS reachability is a
 * mismatched requirement — but code-review finding `34-6-CR-1` reversed that
 * call for a stronger reason: `.changeset/config.json` puts every
 * `@iris-mcp/*` package in one `"fixed"` group, so they always version-bump
 * and publish as a single event, and `client-config` sorts FIRST in
 * `pnpm -r publish`'s dependency-topological order. Left ungated it was the
 * one package that could reach the registry before any gate in the release
 * fired at all — proven live with a bad-credential dry run that produced a
 * complete `client-config` tarball. Gating the whole group uniformly is the
 * lesser cost: a `client-config`-only release while IRIS is down is not a
 * shape this repo's fixed-group versioning can produce anyway.
 *
 * Imports `@iris-mcp/shared`'s BUILT dist via a relative `file://` URL
 * (mirrors `scripts/lib/tool-catalog.mjs`'s established pattern) rather than
 * a bare `"@iris-mcp/shared"` specifier: this script is invoked as an
 * arbitrary package's own `prepublishOnly` hook (cwd = that package's own
 * directory), so it resolves `@iris-mcp/shared`'s dist by a path relative to
 * ITS OWN file location (repo-root `scripts/`), not by package resolution
 * from the caller's cwd.
 *
 * Story 34.7 AC 34.7.5 (ledger `34-6-CR-11`) ALSO runs `scripts/lib/dist-freshness.mjs`
 * here, FIRST, before the IRIS-reachability check below: neither this script nor
 * `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` ever verified the package about
 * to be packaged had actually been built. `checkDistFresh` is per-package and
 * self-referential — it inspects `process.cwd()` (the CALLING package's own directory,
 * which npm/pnpm set when running that package's own `prepublishOnly` hook), never a
 * sibling's `dist/` (see that module's own banner for the full rationale).
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDistFresh } from "./lib/dist-freshness.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sharedDistEntry = resolve(repoRoot, "packages/shared/dist/index.js");

const pkgName = process.env.npm_package_name ?? "(unknown package)";
const timeoutMs = 10000;

const distCheck = checkDistFresh(process.cwd(), pkgName);
if (!distCheck.ok) {
  console.error(`[verify-iris-reachable] FAILED CLOSED: ${distCheck.reason}`);
  process.exit(1);
}
console.log(
  distCheck.skipped
    ? `[verify-iris-reachable] ${pkgName} declares no dist/ build output of its own — build-freshness check skipped.`
    : `[verify-iris-reachable] ${pkgName}'s dist/ is present and fresh.`,
);

console.log(
  `[verify-iris-reachable] Checking IRIS reachability before packaging ${pkgName} — ` +
    "this MUST fail closed (non-zero exit) if IRIS is unreachable or credentials are wrong.",
);

let shared;
try {
  shared = await import(pathToFileURL(sharedDistEntry).href);
} catch (e) {
  console.error(
    `[verify-iris-reachable] Could not import @iris-mcp/shared's built dist from ${sharedDistEntry}. ` +
      `Run "pnpm turbo run build" first — this check requires the built output, same as every ` +
      `other root script that loads a package's dist (see scripts/lib/tool-catalog.mjs). ` +
      `Underlying error: ${e?.message ?? e}`,
  );
  process.exit(1);
}

const { loadConfig, IrisHttpClient, ping } = shared;

// loadConfig() REQUIRES IRIS_USERNAME/IRIS_PASSWORD in the env it is given —
// by design, it throws rather than silently defaulting credentials (see its
// own doc comment). Mirrors execute-classmethod-epic-gate.test.ts's own
// local-dev-default env object (this repo's established convention) rather
// than calling loadConfig() bare, so this gate behaves predictably (local
// defaults) when no real release-target env vars are exported, and still
// honors real IRIS_HOST/IRIS_USERNAME/IRIS_PASSWORD when they are set.
const env = {
  IRIS_HOST: process.env.IRIS_HOST ?? "localhost",
  IRIS_PORT: process.env.IRIS_PORT ?? "52773",
  IRIS_USERNAME: process.env.IRIS_USERNAME ?? "_SYSTEM",
  IRIS_PASSWORD: process.env.IRIS_PASSWORD ?? "SYS",
  IRIS_NAMESPACE: process.env.IRIS_NAMESPACE ?? "HSCUSTOM",
  IRIS_HTTPS: process.env.IRIS_HTTPS ?? "false",
};

let reachable = false;
let config;
try {
  config = loadConfig(env);
  const client = new IrisHttpClient(config);
  reachable = await ping(client, timeoutMs);
} catch (e) {
  console.error(
    `[verify-iris-reachable] FAILED CLOSED: could not even build an IRIS connection (${e?.message ?? e}). ` +
      `Publishing ${pkgName} must not proceed.`,
  );
  process.exit(1);
}

if (!reachable) {
  console.error(
    `[verify-iris-reachable] FAILED CLOSED: IRIS is not reachable (or did not authenticate) at ` +
      `${config.baseUrl} within ${timeoutMs}ms. Publishing ${pkgName} must not proceed. Point ` +
      "IRIS_HOST/IRIS_PORT/IRIS_USERNAME/IRIS_PASSWORD at a reachable IRIS instance, then retry.",
  );
  process.exit(1);
}

console.log(
  `[verify-iris-reachable] IRIS reachable at ${config.baseUrl} — proceeding with ${pkgName} packaging.`,
);
process.exit(0);
