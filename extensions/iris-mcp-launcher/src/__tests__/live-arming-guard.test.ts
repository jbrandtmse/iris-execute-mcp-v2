/**
 * Story 42.2 (DW-627) - the launcher's live-IRIS tests connect to nothing unless `IRIS_REQUIRE_LIVE` arms them.
 *
 * `governanceUiRoundTrip.test.ts` and `localSpawnIntegration.test.ts` reach a live IRIS when they are armed
 * (`liveArming.ts`). This guard runs both, plus the pure arming table, in a child `vitest run` with no `IRIS_*` variable in
 * its environment, under the connection-refusing preload `scripts/lib/no-live-iris-preload.mjs` (loaded through NODE_OPTIONS,
 * so the vitest pool and every child it spawns inherit it). The child must exit 0 and the preload's connect log, which records
 * every connect to port 52773 or 1972 and to the inert host of an unarmed leg, must be empty.
 *
 * The package-side guard (`packages/iris-mcp-all/src/__tests__/live-arming-guard.test.ts`) proves the preload refuses and
 * logs, and scans the workspace tests; this one covers the extension, which cannot import `@iris-mcp/shared` (AD-2).
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// extensions/iris-mcp-launcher/src/__tests__/ -> the extension is two levels up, the repository root four.
// `__dirname` (not import.meta.url) so this file type-checks under the extension's CommonJS tsconfig.
const EXTENSION_DIR = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(EXTENSION_DIR, "..", "..");
const PRELOAD_URL = pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", "no-live-iris-preload.mjs")).href;
const VITEST_ENTRY = path.join(
  path.dirname(createRequire(path.join(EXTENSION_DIR, "package.json")).resolve("vitest/package.json")),
  "vitest.mjs",
);

/** The launcher's live-capable test files and the arming table, relative to the extension. */
const FILES = [
  "src/__tests__/governanceUiRoundTrip.test.ts",
  "src/__tests__/localSpawnIntegration.test.ts",
  "src/__tests__/liveArming.test.ts",
];

/** Run `vitest run <FILES>` in the extension with no IRIS_* variable, under the preload; resolve what it printed and logged. */
function runUnarmed(): Promise<{ status: number | null; output: string; connects: string[] }> {
  const scratch = mkdtempSync(path.join(tmpdir(), "launcher-arming-guard-"));
  const connectLog = path.join(scratch, "connects.log");
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (typeof value !== "string" || upper.startsWith("IRIS_") || upper.startsWith("VITEST")) continue;
    if (["TEST", "NODE_ENV", "NODE_OPTIONS"].includes(upper)) continue;
    env[key] = value;
  }
  env["NODE_OPTIONS"] = `--import=${PRELOAD_URL}`;
  env["IRIS_MCP_CONNECT_LOG"] = connectLog;
  env["IRIS_MCP_WATCH_PORTS"] = "52773,1972";
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [VITEST_ENTRY, "run", ...FILES], { cwd: EXTENSION_DIR, env });
    const chunks: string[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rmSync(scratch, { recursive: true, force: true });
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      const connects = existsSync(connectLog)
        ? readFileSync(connectLog, "utf8")
            .split("\n")
            .filter((line) => line !== "")
        : [];
      rmSync(scratch, { recursive: true, force: true });
      resolve({ status, output: chunks.join(""), connects });
    });
  });
}

describe("the launcher's live-IRIS tests, with no arming variable", () => {
  it("run to completion and connect to nothing", async () => {
    for (const file of FILES) {
      expect(existsSync(path.join(EXTENSION_DIR, file)), `${file} exists`).toBe(true);
    }
    expect(existsSync(path.join(REPO_ROOT, "scripts", "lib", "no-live-iris-preload.mjs")), "the preload exists").toBe(true);

    const run = await runUnarmed();

    expect(run.status, run.output.slice(-3000)).toBe(0);
    expect(run.connects, "connects the preload refused").toEqual([]);
    expect(run.output, "all three files ran").toMatch(/Test Files\s+3 passed \(3\)/);
  }, 260_000);
});
