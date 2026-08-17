#!/usr/bin/env node
/**
 * Story 35.2 code review (`35-2-CR-1`, HIGH) — the packaging/prepublish enforcement
 * surface for `@iris-mcp/data`'s live-IRIS gate files.
 *
 * WHY THIS EXISTS. Story 35.2 added `src/__tests__/analytics-cubes-wire-gate.test.ts`,
 * the ONLY permanent regression proof that `iris_analytics_cubes:build` returns a
 * parseable JSON wire body (ledger `35-SWEEP-2`, HIGH, beta blocker). Like every
 * live-IRIS gate in this repo it uses a `beforeAll` reachability probe and returns
 * early — GREEN, with nothing asserted — when IRIS is unreachable or `ExecuteMCPv2`
 * is not deployed. `IRIS_REQUIRE_LIVE=1` is the switch that converts that skip into a
 * hard failure, and it was armed NOWHERE for this package: `@iris-mcp/data`'s
 * `prepublishOnly` ran `scripts/verify-iris-reachable.mjs`, which only pings IRIS and
 * never runs the gate, while the one script that does arm the variable
 * (`packages/iris-dev-mcp/scripts/prepublish-gate.mjs`) runs vitest from
 * `packages/iris-dev-mcp` over two `@iris-mcp/dev` files. This repo has no CI
 * (`.github/workflows` absent), so the packaging boundary is the only enforcement
 * surface — meaning the story's sole permanent regression test could silently skip
 * forever and the defect could ship reintroduced.
 *
 * That is Rule #59's named disqualifier verbatim ("an arming env var nothing sets"),
 * and a direct recurrence of the Epic 34 incident already recorded as ledger
 * `34-4-R3` / AC 34.6.3 and as incident #6 in the Epic 34 retro — which is exactly
 * why `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` carries the standing
 * instruction "every live-IRIS gate file must be listed here, NOT just the epic gate".
 * That invariant is per-package, so it needs a per-package gate: this file.
 *
 * SUPERSEDES `scripts/verify-iris-reachable.mjs` for this package, and loses nothing.
 * That script contributed two checks, both preserved here: `checkDistFresh` runs
 * FIRST below (identically), and its IRIS-reachability ping is subsumed by
 * `IRIS_REQUIRE_LIVE=1` — under which the gate's own `beforeAll` throws on an
 * unreachable host, wrong credentials, or an undeployed `ExecuteMCPv2`, i.e. a
 * strictly STRONGER precondition than a bare ping. Mirrors `@iris-mcp/dev`'s wiring
 * exactly rather than inventing a second shape.
 *
 * Implemented as a plain Node script, and spawned through `cmd.exe /d /s /c` on
 * Windows, for the same two reasons documented at length in
 * `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`: a POSIX
 * `IRIS_REQUIRE_LIVE=1 vitest run ...` env-var prefix silently fails under the bare
 * `cmd.exe` that npm/pnpm use on Windows (this repo's own publish environment), and
 * `spawn("pnpm", ...)` without a shell cannot execute the `pnpm.cmd` shim.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkDistFresh } from "../../../scripts/lib/dist-freshness.mjs";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const distCheck = checkDistFresh(packageDir, "@iris-mcp/data");
if (!distCheck.ok) {
  console.error(`[prepublish-gate] FAILED CLOSED: ${distCheck.reason}`);
  process.exit(1);
}
console.log(
  distCheck.skipped
    ? "[prepublish-gate] @iris-mcp/data declares no dist/ build output of its own — build-freshness check skipped."
    : "[prepublish-gate] @iris-mcp/data's dist/ is present and fresh.",
);

// Every live-IRIS gate file in THIS package belongs in this list. A file that uses the
// `beforeAll` probe + early-return-on-unavailable shape and is not listed here is a gate
// that can never fail closed at the packaging boundary.
const gateTestFiles = ["src/__tests__/analytics-cubes-wire-gate.test.ts"];

const vitestArgs = ["exec", "vitest", "run", ...gateTestFiles];

const env = { ...process.env, IRIS_REQUIRE_LIVE: "1" };

console.log(
  `[prepublish-gate] Running ${gateTestFiles.length} live-IRIS gate file(s) with ` +
    "IRIS_REQUIRE_LIVE=1 — this MUST fail closed (non-zero exit) if IRIS is " +
    `unreachable or ExecuteMCPv2 is not deployed:\n  - ${gateTestFiles.join("\n  - ")}`,
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
    "[prepublish-gate] FAILED CLOSED: a live-IRIS gate did not pass with IRIS_REQUIRE_LIVE=1. " +
      "Publishing must not proceed. Point IRIS_HOST/IRIS_PORT/IRIS_USERNAME/IRIS_PASSWORD at a " +
      "reachable IRIS instance with src/ExecuteMCPv2/ deployed, then retry.",
  );
}

process.exit(result.status ?? 1);
