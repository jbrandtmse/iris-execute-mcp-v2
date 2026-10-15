#!/usr/bin/env node
/**
 * The packaging/prepublish enforcement surface for `@iris-mcp/admin`'s live-IRIS gate files
 * (the "Live gates" convention: a live gate armed by `IRIS_REQUIRE_LIVE` is listed in its
 * owning package's `scripts/prepublish-gate.mjs`, wired to `prepublishOnly`).
 *
 * A live gate's `beforeAll` probe skips (green, nothing asserted) when IRIS or the deployed
 * `ExecuteMCPv2` route is unavailable; `IRIS_REQUIRE_LIVE=1` turns that skip into a hard
 * failure. This script is what sets it for this package, so the gate can fail closed at the
 * packaging boundary.
 *
 * It runs AFTER `scripts/verify-iris-reachable.mjs` in this package's `prepublishOnly`, which
 * keeps that script's checks (the target resolution and its CI refusal, `checkDistFresh`, the
 * reachability ping); this script adds only the armed gate run.
 *
 * Spawned through `cmd.exe /d /s /c` on Windows for the reason documented in
 * `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`: an env-var prefix on the script line
 * does not work under the bare `cmd.exe` npm/pnpm use there, so the variable is passed
 * through `spawnSync`'s `env` instead.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Every IRIS_REQUIRE_LIVE-armed live-IRIS gate file in THIS package belongs in this list.
const gateTestFiles = [
  // `iris_resource_manage` `listPrivileges` against the deployed sqlprivilege route: `system`
  // reaches it as 1/0 and a malformed `target` gets the validation message (read-only).
  "src/__tests__/resource-listprivileges-live-gate.test.ts",
];

const vitestArgs = ["exec", "vitest", "run", ...gateTestFiles];

const env = { ...process.env, IRIS_REQUIRE_LIVE: "1" };

console.log(
  `[prepublish-gate] Running ${gateTestFiles.length} live-IRIS gate file(s) with ` +
    "IRIS_REQUIRE_LIVE=1 - this MUST fail closed (non-zero exit) if IRIS is " +
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
