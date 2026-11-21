/**
 * Story 43.2 QA (matrix row Era log; decision #10; AD-3, AD-19; Rule #59) - the `[INFO]` line that names the era a factory call served.
 *
 * Each BUILT server is started against 127.0.0.1:1 (a closed local port; no IRIS instance is reached) with sentinel credentials, a
 * sentinel namespace and a second profile with a sentinel password, then driven by hand on the 2025-11-25 era, on the 2026-07-28 era,
 * and over the probe-discard path (`server/discover`, then `initialize`), with calls whose arguments and client identity are sentinels
 * too. For every `LOG_LEVEL` (unset, `DEBUG`, `INFO`, `WARN`, `ERROR`):
 *  - the line goes to stderr and never to stdout, whose every line stays a JSON-RPC response;
 *  - it is exactly the documented text, with nothing appended, so it carries no credential, namespace, argument or client identity;
 *    nothing on stderr carries the sentinel password;
 *  - it appears once per factory call (one for each single-era run, a modern line then a legacy line for the probe-discard path),
 *    however many requests follow, when the level shows `[INFO]` (unset, `DEBUG`, `INFO`), and never when it does not (`WARN`, `ERROR`).
 * The file fails, never skips, on a stale dist.
 */

import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import { GOLDEN_PACKAGES } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { distEntry, staleDistReason } from "./process-gate-helpers.js";
import {
  LEGACY_ERA_LINE,
  MODERN_ERA_LINE,
  EXAMPLE_META,
  eraLines,
  handEnv,
  legacyInitializeParams,
  startHandWire,
} from "./story-43-2-qa-hand-wire";

const stale = ["shared", ...GOLDEN_PACKAGES].map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const).filter(([, reason]) => reason !== undefined);
if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);

const SENTINELS = {
  user: "sentinel-user-43x2",
  password: "sentinel-password-43x2",
  namespace: "SENTINELNS43X2",
  otherPassword: "sentinel-other-password-43x2",
  argument: "Sentinel.Argument43x2.cls",
  client: "sentinel-client-43x2",
};

/** What the line shows at each `LOG_LEVEL`: `[INFO]` is visible unless the level is `WARN` or `ERROR`. */
const LEVELS: Array<[string, string | undefined, boolean]> = [
  ["unset", undefined, true],
  ["DEBUG", "DEBUG", true],
  ["INFO", "INFO", true],
  ["WARN", "WARN", false],
  ["ERROR", "ERROR", false],
];

type Scenario = "legacy" | "modern" | "probe-discard";

/** Run `scenario` against `pkg` with `level` and return stderr and every stdout line. */
async function run(pkg: string, level: string | undefined, scenario: Scenario): Promise<{ stderr: string; stdout: string[]; stdoutAreResponses: boolean }> {
  const wire = startHandWire(
    distEntry(REPO_ROOT, pkg),
    handEnv({
      LOG_LEVEL: level,
      IRIS_USERNAME: SENTINELS.user,
      IRIS_PASSWORD: SENTINELS.password,
      IRIS_NAMESPACE: SENTINELS.namespace,
      IRIS_PROFILES: JSON.stringify({ other: { host: "127.0.0.1", port: 1, username: SENTINELS.user, password: SENTINELS.otherPassword, namespace: SENTINELS.namespace } }),
    }),
  );
  try {
    let id = 0;
    const modernEnvelope = { ...EXAMPLE_META, "io.modelcontextprotocol/clientInfo": { name: SENTINELS.client, version: "0.0.0" } };
    if (scenario !== "legacy") await wire.request(++id, "server/discover", { _meta: modernEnvelope });
    if (scenario !== "modern") {
      await wire.request(++id, "initialize", legacyInitializeParams());
      wire.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    }
    // Calls whose arguments are sentinels, on whichever era the connection ended up on, and a second discover where the era is modern.
    const argumentsOf = { name: SENTINELS.argument, server: "other", namespace: SENTINELS.namespace };
    for (let call = 0; call < 3; call += 1) {
      const params = scenario === "modern" ? { name: "iris_doc_get", arguments: argumentsOf, _meta: modernEnvelope } : { name: "iris_doc_get", arguments: argumentsOf };
      await wire.request(++id, "tools/call", params);
    }
    await wire.request(++id, "tools/list", scenario === "modern" ? { _meta: modernEnvelope } : {});
    if (scenario === "modern") await wire.request(++id, "server/discover", { _meta: modernEnvelope });
    await wire.quiet(150);
    const stdout = wire.stdout();
    return {
      stderr: wire.stderr(),
      stdout: stdout.map((line) => line.raw),
      stdoutAreResponses: stdout.every((line) => line.message !== undefined && line.message.method === undefined),
    };
  } finally {
    await wire.close();
  }
}

const EXPECTED_LINES: Record<Scenario, string[]> = {
  legacy: [LEGACY_ERA_LINE],
  modern: [MODERN_ERA_LINE],
  "probe-discard": [MODERN_ERA_LINE, LEGACY_ERA_LINE],
};

/** The checks that hold at every level. */
function expectNoLeak(result: { stderr: string; stdout: string[]; stdoutAreResponses: boolean }, label: string): void {
  expect(result.stdoutAreResponses, `${label}: stdout stays JSON-RPC responses`).toBe(true);
  for (const phrase of ["Serving MCP protocol revision", "Serving the 2025-era MCP handshake"]) {
    expect(result.stdout.some((line) => line.includes(phrase)), `${label}: "${phrase}" is on stdout`).toBe(false);
  }
  expect(result.stderr.includes(SENTINELS.password), `${label}: the password reaches stderr`).toBe(false);
  expect(result.stderr.includes(SENTINELS.otherPassword), `${label}: the other profile's password reaches stderr`).toBe(false);
  for (const line of eraLines(result.stderr)) {
    for (const [name, sentinel] of Object.entries(SENTINELS)) expect(line.includes(sentinel), `${label}: the era line carries the ${name}`).toBe(false);
  }
}

describe.each(LEVELS)("the era line at LOG_LEVEL %s", (_name, level, shown) => {
  it.each(["legacy", "modern", "probe-discard"] as const)("on dev, %s: once per factory call on stderr when [INFO] is shown, never on stdout, carrying nothing", async (scenario) => {
    const result = await run("iris-dev-mcp", level, scenario);
    expectNoLeak(result, scenario);
    expect(eraLines(result.stderr), `${scenario}: the era lines`).toEqual(shown ? EXPECTED_LINES[scenario] : []);
    if (shown) {
      // The line is a whole stderr line of its own, with nothing before or after it on that line.
      for (const expected of EXPECTED_LINES[scenario]) expect(result.stderr.split("\n")).toContain(expected);
    }
  });
});

describe.each(GOLDEN_PACKAGES.filter((pkg) => pkg !== "iris-dev-mcp"))("the era line of %s", (pkg) => {
  it.each(["legacy", "modern", "probe-discard"] as const)("%s: once per factory call on stderr, never on stdout, carrying nothing", async (scenario) => {
    const result = await run(pkg, undefined, scenario);
    expectNoLeak(result, `${pkg} ${scenario}`);
    expect(eraLines(result.stderr)).toEqual(EXPECTED_LINES[scenario]);
  });
});
