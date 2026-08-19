#!/usr/bin/env node
/**
 * Story 35.8 (AC 35.8.4) — the packaging/prepublish enforcement surface for
 * `@iris-mcp/all`'s Epic 35 defect gate (`src/__tests__/epic35-defect-gate.test.ts`).
 *
 * WHY THIS EXISTS. The gate is the epic-done proof that all nine Epic 35
 * corrected contracts hold on the REAL surface. Like every live-IRIS gate in
 * this repo it degrades gracefully (beforeAll probe + ctx.skip()) when IRIS is
 * unreachable — green with nothing asserted. `IRIS_REQUIRE_LIVE=1` converts
 * that skip into a hard failure, and it must be armed SOMEWHERE on the
 * packaging path or the gate protects nothing (Rule #59's named disqualifier —
 * "an arming env var nothing sets" — Epic 34 retro incident #6; the same gap
 * Story 35.2's review closed for @iris-mcp/data as `35-2-CR-1`). This repo has
 * no CI (`.github/workflows` absent), so `prepublishOnly` IS the packaging
 * boundary. Until this story, `@iris-mcp/all`'s `prepublishOnly` ran only
 * `scripts/verify-iris-reachable.mjs` — a bare ping that never ran a single
 * gate leg.
 *
 * SUPERSEDES `scripts/verify-iris-reachable.mjs` for this package, losing
 * nothing: the dist-freshness check below runs FIRST (stronger — see the next
 * paragraph), and the reachability ping is subsumed by `IRIS_REQUIRE_LIVE=1`,
 * under which the gate's own `beforeAll` throws on an unreachable host, wrong
 * credentials, an undeployed ExecuteMCPv2 REST app, or a missing F1 fixture.
 * Mirrors the shape `@iris-mcp/dev` (34.6) and `@iris-mcp/data` (35.2)
 * established rather than inventing a third.
 *
 * DIST-FRESHNESS, WIDER THAN USUAL. `checkDistFresh(process.cwd(), ...)` on
 * this package is a deliberate no-op (`@iris-mcp/all` declares no
 * `files: ["dist"]` — it is a dependencies-only meta-package). But the gate
 * does NOT drive this package's code: it dynamically imports the BUILT
 * `dist/tools/index.js` of `@iris-mcp/shared` and the four leaf packages the
 * nine fixes live in (dev, admin, data, interop — ops carries no Epic 35 fix
 * and no leg drives it). A stale leaf dist would let the gate pass over code
 * that is not what ships, so each of those five dists is freshness-checked
 * explicitly here, fail-closed, before vitest runs.
 *
 * Implemented as a plain Node script (env set via `process.env`, inherited by
 * the spawned vitest) and spawned through `cmd.exe /d /s /c` on Windows, for
 * the two reasons documented at length in
 * `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`: a POSIX
 * `IRIS_REQUIRE_LIVE=1 vitest run ...` prefix silently fails under the bare
 * `cmd.exe` npm/pnpm use on Windows, and `spawn("pnpm", ...)` without a shell
 * cannot execute the `pnpm.cmd` shim.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkDistFresh } from "../../../scripts/lib/dist-freshness.mjs";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(packageDir, "..", "..");

// Self-check first (a deliberate skip for this dist-less meta-package, kept so
// the day @iris-mcp/all gains a build output it is freshness-checked too).
const selfCheck = checkDistFresh(packageDir, "@iris-mcp/all");
if (!selfCheck.ok) {
  console.error(`[prepublish-gate] FAILED CLOSED: ${selfCheck.reason}`);
  process.exit(1);
}

// The packages whose BUILT dists the gate drives (see the header).
const DRIVEN_PACKAGES = [
  ["shared", "@iris-mcp/shared"],
  ["iris-dev-mcp", "@iris-mcp/dev"],
  ["iris-admin-mcp", "@iris-mcp/admin"],
  ["iris-data-mcp", "@iris-mcp/data"],
  ["iris-interop-mcp", "@iris-mcp/interop"],
];

for (const [dir, name] of DRIVEN_PACKAGES) {
  const check = checkDistFresh(path.join(repoRoot, "packages", dir), name);
  if (!check.ok) {
    console.error(`[prepublish-gate] FAILED CLOSED: ${check.reason}`);
    process.exit(1);
  }
  // Fail closed on the SKIPPED shape too (35.8 review, Blind B4): `skipped`
  // means the package's own package.json stopped declaring `files: ["dist"]` —
  // a manifest regression for a package whose dist the gate DRIVES. Logging
  // and proceeding would let a stale-but-present dist pass the gate.
  if (check.skipped) {
    console.error(
      `[prepublish-gate] FAILED CLOSED: ${name} declares no dist/ build output, ` +
        "but the Epic 35 defect gate drives its built dist. Restore " +
        '`files: ["dist"]` in that package\'s package.json — publishing must not ' +
        "proceed over an unverifiable build.",
    );
    process.exit(1);
  }
  console.log(`[prepublish-gate] ${name}'s dist/ is present and fresh.`);
}

// Every IRIS_REQUIRE_LIVE-ARMED live-IRIS gate file in THIS package belongs in
// this list (35.8 review, Edge E1 — precision: the membership rule is ARMED,
// not merely live). A file that uses the `beforeAll` probe + ctx.skip() shape
// without honoring IRIS_REQUIRE_LIVE gains nothing from being listed — it
// would skip even here (this package's *-process-gate.test.ts files are that
// shape today: live but unarmed); arming one means adding the REQUIRE_LIVE
// contract to the file AND listing it here (the standing instruction from
// `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`, applied per-package).
const gateTestFiles = ["src/__tests__/epic35-defect-gate.test.ts"];

const vitestArgs = ["exec", "vitest", "run", ...gateTestFiles];

const env = { ...process.env, IRIS_REQUIRE_LIVE: "1" };

console.log(
  `[prepublish-gate] Running ${gateTestFiles.length} live-IRIS gate file(s) with ` +
    "IRIS_REQUIRE_LIVE=1 — this MUST fail closed (non-zero exit) if IRIS is " +
    "unreachable, ExecuteMCPv2 is not deployed, or the Story 35.1 fixtures are " +
    `not loaded:\n  - ${gateTestFiles.join("\n  - ")}`,
);

const result =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "pnpm", ...vitestArgs], {
        cwd: packageDir,
        stdio: "inherit",
        env,
      })
    : spawnSync("pnpm", vitestArgs, {
        cwd: packageDir,
        stdio: "inherit",
        env,
      });

if (result.error) {
  console.error("[prepublish-gate] Failed to spawn the gate:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    "[prepublish-gate] FAILED CLOSED: the Epic 35 defect gate did not pass with IRIS_REQUIRE_LIVE=1. " +
      "Publishing must not proceed. Point IRIS_HOST/IRIS_PORT/IRIS_USERNAME/IRIS_PASSWORD at a " +
      "reachable IRIS instance with src/ExecuteMCPv2/ (including src/ExecuteMCPv2/Tests/) loaded, then retry.",
  );
}

process.exit(result.status ?? 1);
