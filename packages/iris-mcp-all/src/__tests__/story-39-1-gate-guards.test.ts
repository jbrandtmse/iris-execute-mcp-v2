/**
 * Stories 39.1, 39.3, 39.4 and 39.5 -- the arming guard of the live message-search gates listed in `GATES`
 * (`story-39-1-message-search-live-gate.test.ts`, `story-39-3-body-search-live-gate.test.ts`,
 * `story-39-3-qa-live-gate.test.ts`, `story-39-4-search-table-live-gate.test.ts`,
 * `story-39-4-qa-live-gate.test.ts` and `story-39-5-body-reader-live-gate.test.ts`) on their own real path
 * (project rule #59). No IRIS and no shared state.
 *
 * Each gate runs in the default suite and in the prepublish gate. Run against an IRIS that is not reachable (a
 * closed local port) it must skip every test with the reason when it is not armed, and fail in `beforeAll` with
 * "may not be skipped" when `IRIS_REQUIRE_LIVE` is set; otherwise a publish on an unreachable or stale
 * environment would pass with every row skipped. Each case runs the gate file in its own vitest process, so
 * the real `beforeAll` branches execute. A source-order check pins that the gate derives its skip reason from
 * the freshness of every dist it drives before its first built-server session, and checks the deployed
 * `BOOTSTRAP_VERSION` before any test.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inheritedEnv, resolveSdkEsmDir, staleDistReason } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

const DRIVEN_PACKAGES = ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"];

/** The gates this guard covers, each with the tag its skip line carries and the story its failure names. */
const GATES = [
  { file: "story-39-1-message-search-live-gate.test.ts", tag: "story-39-1-message-search-live-gate", story: "Story 39.1" },
  { file: "story-39-3-body-search-live-gate.test.ts", tag: "story-39-3-body-search-live-gate", story: "Story 39.3" },
  { file: "story-39-3-qa-live-gate.test.ts", tag: "story-39-3-qa-live-gate", story: "Story 39.3 QA" },
  { file: "story-39-4-search-table-live-gate.test.ts", tag: "story-39-4-search-table-live-gate", story: "Story 39.4" },
  { file: "story-39-4-qa-live-gate.test.ts", tag: "story-39-4-qa-live-gate", story: "Story 39.4 QA" },
  { file: "story-39-5-body-reader-live-gate.test.ts", tag: "story-39-5-body-reader-live-gate", story: "Story 39.5" },
] as const;

/** The vitest entry point this package's tests run under. */
const VITEST_ENTRY = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

let closedPort = "";

/** A local port nothing listens on: bind an ephemeral port, then release it. */
async function reserveClosedPort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(String(port)));
    });
  });
}

/** The reason a gate's `beforeAll` derives here, in its order: a stale dist, the SDK, the closed port. */
function expectedSkipReason(): string {
  let reason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of DRIVEN_PACKAGES) reason ??= staleDistReason(REPO_ROOT, pkg);
  return (
    reason ??
    (resolveSdkEsmDir(REPO_ROOT) === undefined
      ? "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm"
      : `IRIS is not reachable at http://127.0.0.1:${closedPort}/api/atelier/`)
  );
}

/** Run a gate file in its own vitest process against the closed port; the output is both streams. */
function runGate(file: string, armed: boolean): { status: number | null; output: string } {
  const outcome = spawnSync(process.execPath, [VITEST_ENTRY, "run", `src/__tests__/${file}`], {
    cwd: PACKAGE_DIR,
    env: {
      ...inheritedEnv(["VITEST", "VITEST_WORKER_ID", "VITEST_POOL_ID", "VITEST_MODE", "TEST", "NODE_ENV"]),
      IRIS_HOST: "127.0.0.1",
      IRIS_PORT: closedPort,
      IRIS_USERNAME: "_SYSTEM",
      IRIS_PASSWORD: "SYS",
      IRIS_NAMESPACE: "HSCUSTOM",
      IRIS_HTTPS: "false",
      ...(armed ? { IRIS_REQUIRE_LIVE: "1" } : {}),
    },
    encoding: "utf8",
    timeout: 90000,
  });
  return { status: outcome.status, output: `${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}` };
}

beforeAll(async () => {
  closedPort = await reserveClosedPort();
});

afterAll(() => {
  closedPort = "";
});

describe.each(GATES)("$story: the live gate's arming guard, on its own real path (unarmed and armed prerequisites)", (gate) => {
  it("unarmed, with IRIS not reachable: every gate test is skipped with the reason, and the run passes", () => {
    const { status, output } = runGate(gate.file, false);

    expect(output).toContain(`[SKIP] ${gate.tag}: ${expectedSkipReason()}`);
    expect(output).toMatch(/Tests\s+\d+ skipped \(\d+\)/);
    expect(output).not.toContain("may not be skipped");
    expect(status, output).toBe(0);
  }, 120000);

  it("armed, with IRIS not reachable: the gate fails in beforeAll with 'may not be skipped: <reason>'", () => {
    const { status, output } = runGate(gate.file, true);

    expect(output).toContain(`${gate.story} live gate may not be skipped: ${expectedSkipReason()}`);
    expect(status, "the armed run must not pass").not.toBe(0);
  }, 120000);
});

describe.each(GATES)("$story: the live gate refuses a stale dist and checks the deployed BOOTSTRAP_VERSION before any test", (gate) => {
  const source = readFileSync(path.join(__dirname, gate.file), "utf8");

  it("derives its skip reason from the shared dist and every driven dist before its first built-server session", () => {
    const shared = source.indexOf('skipReason = staleDistReason(REPO_ROOT, "shared");');
    const driven = source.indexOf('for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);');
    const session = source.search(/dev = await openWireSession\(/);
    expect(shared, "the gate checks the shared dist").toBeGreaterThan(-1);
    expect(driven, "the gate checks the dev, admin and interop dists after the shared one").toBeGreaterThan(shared);
    expect(session, "the gate opens its first session after both checks").toBeGreaterThan(driven);
  });

  it("calls assertDeployedBootstrapVersion right after its first session opens, ahead of every describe", () => {
    expect(source).toMatch(/dev = await openWireSession\([^\n]*\);\n[^\n]*\n\s*await assertDeployedBootstrapVersion\(REPO_ROOT, TARGET\);/);
    const check = source.indexOf("await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);");
    const firstSuite = source.search(/^describe\(/m);
    expect(firstSuite, "the gate has a describe").toBeGreaterThan(-1);
    expect(check).toBeLessThan(firstSuite);
  });
});
