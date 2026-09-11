#!/usr/bin/env node
/**
 * Story 34.6 AC 34.6.3 — the packaging/prepublish enforcement surface.
 *
 * This repo has no CI (`.github/workflows` does not exist — verified 2026-08-15), and
 * `IRIS_REQUIRE_LIVE` (the opt-in switch that turns the epic-done gate's graceful skip
 * into a hard failure — see `src/__tests__/execute-classmethod-epic-gate.test.ts`) was
 * previously armed nowhere in the repository. That combination meant a release could be
 * packaged with IRIS completely unreachable, all six gate legs silently skipped, and the
 * suite reporting green throughout. `npm`/`pnpm` invoke a package's `prepublishOnly`
 * script automatically before `npm publish`/`pnpm publish` (and `--dry-run` still runs
 * it, without uploading anything) — that hook IS the packaging boundary for this
 * package, so it is where the gate gets armed.
 *
 * Implemented as a plain Node script rather than an inline
 * `IRIS_REQUIRE_LIVE=1 vitest run ...` `package.json` command: that POSIX
 * env-var-prefix shell syntax silently fails on Windows (this repo's own dev/publish
 * environment) without a `cross-env` dependency the project does not otherwise need —
 * `npm`/`pnpm` run `package.json` scripts through a bare `cmd.exe` on Windows, which has
 * no such syntax and would instead try (and fail) to execute a program literally named
 * `IRIS_REQUIRE_LIVE=1`. Setting the env var in Node (`process.env`, inherited by the
 * spawned child) is OS-agnostic by construction.
 *
 * `pnpm exec vitest ...` is spawned through `cmd.exe /d /s /c` on Windows rather than
 * called bare — mirrors the fix already established in this repo for the identical
 * `spawn("npx")`-cannot-execute-`.cmd`-shim class of failure (Story 32.2, CVE-2024-27980
 * hardening): `spawn("pnpm", [...])` without a shell cannot execute the `pnpm.cmd` shim
 * on Windows either.
 *
 * Story 34.7 AC 34.7.5 (ledger `34-6-CR-11`): this gate runs vitest over TypeScript
 * SOURCE, not the built `dist/` — so, like `scripts/verify-iris-reachable.mjs`, it
 * never verified `@iris-mcp/dev`'s own package actually got BUILT before packaging.
 * Runs `scripts/lib/dist-freshness.mjs`'s `checkDistFresh` FIRST, against this
 * package's own `packageDir` (computed below from this script's own location, which —
 * unlike the shared repo-root script — genuinely IS this package, so self-referential
 * by construction here too).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkDistFresh } from "../../../scripts/lib/dist-freshness.mjs";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const distCheck = checkDistFresh(packageDir, "@iris-mcp/dev");
if (!distCheck.ok) {
  console.error(`[prepublish-gate] FAILED CLOSED: ${distCheck.reason}`);
  process.exit(1);
}
console.log(
  distCheck.skipped
    ? "[prepublish-gate] @iris-mcp/dev declares no dist/ build output of its own — build-freshness check skipped."
    : "[prepublish-gate] @iris-mcp/dev's dist/ is present and fresh.",
);

// Story 34.8 code review: every live-IRIS gate file must be listed here, NOT just the
// epic gate. Each of these uses the same `beforeAll` probe + `ctx.skip()` shape, which
// silently SKIPS when IRIS is unreachable or the fixtures are not deployed — green, with
// nothing actually verified. `IRIS_REQUIRE_LIVE=1` (below) is what converts that skip into
// a hard failure, and it only applies to the files named here. `request-body-utf8-decode`
// is the ONLY end-to-end proof that non-ASCII request bodies decode correctly; omitting it
// meant a publish could ship that fix entirely unexecuted — the same defect class already
// recorded as ledger `34-4-R3` / AC 34.6.3 and fixed for the epic gate.
// Story 36.2 code review: Epic 36's two live gates were absent from this list, so
// `IRIS_REQUIRE_LIVE` was never set on them on any path (Rule #59 — "an arming env var
// nothing sets"): Story 36.1's running-result contract gate, and Story 36.2's
// `iris_test_status` capstone (AC 36.2.4, "armed like epic35-defect-gate.test.ts").
// Both need the `src/ExecuteMCPv2/QAFixtures/*.cls` fixtures deployed on the target.
const gateTestFiles = [
  "src/__tests__/execute-classmethod-epic-gate.test.ts",
  "src/__tests__/request-body-utf8-decode.test.ts",
  "src/__tests__/execute-tests-running-contract-epic-gate.test.ts",
  "src/__tests__/test-status-epic-gate.test.ts",
];

const vitestArgs = ["exec", "vitest", "run", ...gateTestFiles];

const env = { ...process.env, IRIS_REQUIRE_LIVE: "1" };

console.log(
  `[prepublish-gate] Running ${gateTestFiles.length} live-IRIS gate file(s) with ` +
    "IRIS_REQUIRE_LIVE=1 — this MUST fail closed (non-zero exit) if IRIS is " +
    `unreachable or the reproduction fixtures are not deployed:\n  - ${gateTestFiles.join("\n  - ")}`,
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
      "reachable IRIS instance with src/ExecuteMCPv2/Tests/ loaded, then retry.",
  );
}

process.exit(result.status ?? 1);
