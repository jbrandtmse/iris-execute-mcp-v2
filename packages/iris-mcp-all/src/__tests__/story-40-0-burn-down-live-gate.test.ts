/**
 * Story 40.0 live gate: the Epic 39 deferred cleanup, driven on the REAL wire against disposable namespaces, in the
 * default suite (rule #59: each row names the path it guards).
 *
 * Paths: the BUILT iris-dev-mcp, iris-admin-mcp, iris-interop-mcp and iris-ops-mcp dists, spawned as child processes
 * and driven by the MCP SDK `Client` over stdio. The oracles are SQL written by hand and run through the raw Atelier
 * `action/query` route, the live `Ens.DataType.LogType` lists read the same way, raw HTTP to the custom route, and the
 * window membership that fixture xi's own seed builds in; never the tools under test. Two fixes are proven here:
 *
 *  - DW-584: `errorCount24h` counts the Error entries (type 2), and it and `messageCount24h` cover the 24 hours before
 *    the call in UTC. Path: SDK `Client` -> built ops server -> `iris_metrics_interop` -> the monitor route ->
 *    `Ens_Util.Log` and `Ens.MessageHeader` of the scratch namespace. The process-time-zone half: this instance runs at
 *    time zone 0 and its REST workers' zone is never changed, so the time-zone row drives the route's own collector
 *    instead. Path: SDK `Client` -> built dev server -> `iris_execute_classmethod` -> `Story400.Seed.MetricsAtZone` in
 *    the scratch namespace -> `ExecuteMCPv2.REST.Monitor:CollectInteropMetrics` (the method the route calls), with the
 *    calling process at time zones 420 and -600; a cutoff taken from `$Horolog` would count a 31-hour or a 14-hour
 *    window there.
 *  - DW-585: the `type` filter of `iris_production_logs` maps a display name to its stored number. Path: SDK `Client` ->
 *    built interop server -> `iris_production_logs` -> the Event Log route, for all six names the live
 *    `Ens.DataType.LogType` lists hold; raw HTTP to the route for a number (an older request) and an unknown value.
 *
 * Fixture xi (`interop-namespace-fixture.ts`, `seedEventLogCounts`): the mapping-only interop namespace
 * `EXECMCPTMP400A` holds ten Event Log rows and three headers whose times are the seed's own T0 plus an offset, so
 * the 24-hour window is known by construction. `EXECMCPTMP400B` has no mappings (the not-configured case). No
 * production is started, `EnableNamespace` is never called, and no message or Event Log row of HSCUSTOM is read.
 * `beforeAll` removes leftovers by name and asserts there are none; `afterAll` removes both namespaces, their
 * database files and the fixture class, and asserts nothing is left.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, all required and none defaulted, and
 * only when `IRIS_REQUIRE_LIVE` arms the run (without it every row skips before any request). Writes only the namespaces and databases `EXECMCPTMP400A` and `EXECMCPTMP400B` and the
 * HSCUSTOM class `ExecuteMCPv2.Temp.Story391Fixture`; the Atelier oracle reads the dictionary of HSCUSTOM. A missing
 * or stale dist, an unresolvable SDK or an unreachable IRIS skips each row with the reason, or fails with "may not be
 * skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierQuery,
  distEntry,
  fixtureDocumentNames,
  irisTargetFromEnv,
  isIrisReachable,
  liveArmingSkipReason,
  openWireSession,
  rawIrisRequest,
  resolveSdkEsmDir,
  skipTest,
  staleDistReason,
  teardownRecorder,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  FIXTURE_DOC,
  createInteropNamespace,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
  seedEventLogCounts,
} from "./interop-namespace-fixture.js";
import { eventLogOracle } from "./header-row-oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-0-burn-down-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The interop-enabled scratch namespace holding fixture xi, and the bare one with no mappings. */
const NS_A = "EXECMCPTMP400A";
const NS_B = "EXECMCPTMP400B";
const NAMESPACES = [NS_A, NS_B];

/** The IDs each display name must return in A, newest first, written out from the fixture table. */
const EXPECTED_IDS: Record<string, number[]> = {
  Error: [10, 8, 7, 2],
  Warning: [9, 3],
  Assert: [1],
  Info: [4],
  Trace: [5],
  Alert: [6],
};

/** The type of each Event Log row of fixture xi, by ID, written out from the fixture table. */
const SEEDED_TYPE: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 2, 8: 2, 9: 3, 10: 2 };

const LOGS_ROUTE = "/api/executemcp/v2/interop/production/logs";

/** The keys of one namespace's metrics, in the order `CollectInteropMetrics` sets them, written out from its source. */
const METRICS_KEYS = [
  "namespace",
  "productionName",
  "productionState",
  "productionStateCode",
  "queueDepth",
  "errorCount24h",
  "messageCount24h",
];

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
let interop: WireSession;
let ops: WireSession;

function wireOptions(pkg: string): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-40-0-live-gate",
  };
}

/** The target of the raw Atelier oracle: the scratch namespace A. */
const oracleTarget = (): typeof TARGET => ({ ...TARGET, namespace: NS_A });

type Row = Record<string, unknown>;

/** The parsed structured content of a successful call: no error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

interface LogsContent {
  entries: Row[];
  count: number;
}

interface MetricsContent {
  namespaces: Array<{
    namespace: string;
    productionName: string;
    productionState: string;
    queueDepth: number;
    errorCount24h: number;
    messageCount24h: number;
  }>;
  count: number;
}

/** `iris_production_logs` over A through the built interop server. */
function productionLogs(args: Record<string, unknown>): Promise<WireToolResult> {
  return interop.call("iris_production_logs", { namespace: NS_A, count: 100, ...args });
}

const idsOf = (rows: Row[]): number[] => rows.map((row) => Number(row["id"]));

/** The raw route's result for a query string over A: its HTTP status, error list and `result`. */
async function rawLogs(query: string): Promise<{ status: number; errors: unknown[]; result: LogsContent }> {
  const answer = await rawIrisRequest(TARGET, `${LOGS_ROUTE}?namespace=${NS_A}&${query}`, { method: "GET" });
  const body = answer.json as { status?: { errors?: unknown[] }; result?: LogsContent };
  return { status: answer.status, errors: body?.status?.errors ?? [], result: body?.result as LogsContent };
}

/** The display names and stored values of `Ens.DataType.LogType`, read live from the class dictionary (the first piece of each list is empty). */
async function liveLogTypes(): Promise<Array<{ name: string; value: number }>> {
  const rows = await atelierQuery(
    TARGET,
    "SELECT Name, _Default AS Dflt FROM %Dictionary.CompiledParameter WHERE parent = 'Ens.DataType.LogType' AND Name IN ('DISPLAYLIST', 'VALUELIST')",
  );
  const listOf = (parameter: string): string[] => String(rows.find((row) => row["Name"] === parameter)?.["Dflt"] ?? "").split(",").slice(1);
  const names = listOf("DISPLAYLIST");
  const values = listOf("VALUELIST");
  expect(names.length, "DISPLAYLIST holds the six types the tool offers").toBe(6);
  expect(values.length, "VALUELIST holds as many pieces as DISPLAYLIST").toBe(names.length);
  return names.map((name, index) => ({ name, value: Number(values[index]) }));
}

// -- Setup and teardown ------------------------------------------------

beforeAll(async () => {
  skipReason = liveArmingSkipReason() ?? staleDistReason(REPO_ROOT, "shared");
  for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);
  skipReason ??= staleDistReason(REPO_ROOT, "iris-ops-mcp");
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else if (!(await isIrisReachable(TARGET.host, TARGET.port))) {
      skipReason = `IRIS is not reachable at http://${TARGET.host}:${TARGET.port}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.0 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  ops = await openWireSession(wireOptions("iris-ops-mcp"));
  await putFixtureClass(dev);
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS_A, { interop: true });
  await createInteropNamespace(admin, dev, NS_B, { interop: false });
  await seedEventLogCounts(dev, NS_A);

  // A positive control: the same check that must read empty after the run sees both namespaces and A's mapping now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees both namespaces while they exist").toEqual(
    expect.arrayContaining([
      `namespace ${NS_A}`,
      `database configuration ${NS_A}`,
      `package mapping ${NS_A} Ens`,
      `namespace ${NS_B}`,
      `database configuration ${NS_B}`,
    ]),
  );
}, 300000);

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
    for (const name of NAMESPACES) await attempt(`removing ${name}`, () => removeInteropNamespace(admin, dev, name));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, NAMESPACES), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story400", "Story391Fixture"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [ops, interop, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- DW-584 -------------------------------------------------------------

describe("Story 40.0: DW-584, the interop metrics count Error entries and message headers over the last 24 hours in UTC (AC-1)", () => {
  it("the seed is what the fixture table says: ten Event Log rows of the six types, in the order the window arithmetic assumes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const all = await eventLogOracle(oracleTarget());
    expect(idsOf(all), "ten rows, newest ID first").toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(
      all.map((entry) => [entry["id"], entry["type"], entry["itemName"], entry["text"]]),
      "type, item and text of every row",
    ).toEqual(
      [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((id) => [
        id,
        SEEDED_TYPE[id],
        id === 10 ? "Story400.Other" : "Story400.Item",
        `SYNTHPHI400-L${id}`,
      ]),
    );
  }, 120000);

  it("the seed refuses a namespace that already holds rows, and a refused call writes nothing", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const before = await eventLogOracle(oracleTarget());
    const refused = await dev.call("iris_execute_classmethod", { namespace: NS_A, className: "Story400.Seed", methodName: "Seed", args: [] });
    expect(refused.isError, allText(refused)).toBeFalsy();
    expect(refused.structuredContent?.["returnValue"]).toBe("REFUSED: the namespace already holds message headers");
    expect(await eventLogOracle(oracleTarget()), "the Event Log is unchanged").toEqual(before);
    const headers = await atelierQuery(oracleTarget(), "SELECT COUNT(*) AS N FROM Ens.MessageHeader");
    expect(Number(headers[0]?.["N"]), "the headers are unchanged").toBe(3);
  }, 120000);

  it("metrics for A: errorCount24h 3 (L2, L7, L10), messageCount24h 2 (H1, H2) and queueDepth 0, and the text lines carry them", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await ops.call("iris_metrics_interop", { namespace: NS_A });
    const content = succeeded<MetricsContent>(result);
    expect(content.count).toBe(1);
    expect(content.namespaces[0]).toMatchObject({ namespace: NS_A, errorCount24h: 3, messageCount24h: 2, queueDepth: 0 });
    expect(Object.keys(content), "the result keys are unchanged (AD-33)").toEqual(["namespaces", "count"]);
    expect(Object.keys(content.namespaces[0] ?? {}), "the namespace keys and their order are unchanged (AD-33)").toEqual(METRICS_KEYS);
    const text = allText(result);
    expect(text).toContain("Errors (24h): 3");
    expect(text).toContain("Messages (24h): 2");
    expect(text).toContain("Queue Depth: 0");
  }, 120000);

  it("the collector the route calls counts the same UTC window with its process at time zones 420 and -600: errorCount24h 3 and messageCount24h 2 in both", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const zone of [420, -600]) {
      const result = await dev.call("iris_execute_classmethod", {
        namespace: NS_A,
        className: "Story400.Seed",
        methodName: "MetricsAtZone",
        args: [zone],
      });
      expect(result.isError, allText(result)).toBeFalsy();
      const returned = String(result.structuredContent?.["returnValue"] ?? "");
      expect(returned, `time zone ${zone}: the collector returned its metrics`).toMatch(/^\{/);
      const metrics = JSON.parse(returned) as Record<string, unknown>;
      expect(metrics, `time zone ${zone}`).toMatchObject({ namespace: NS_A, errorCount24h: 3, messageCount24h: 2, queueDepth: 0 });
    }
  }, 120000);
});

// -- DW-585 -------------------------------------------------------------

describe("Story 40.0: DW-585, the type filter of iris_production_logs maps a display name to its stored number (AC-2)", () => {
  it("the live Ens.DataType.LogType lists hold exactly the six names the tool offers", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const types = await liveLogTypes();
    expect(types.map((type) => type.name).sort()).toEqual(Object.keys(EXPECTED_IDS).sort());
    expect(types.map((type) => type.value).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  }, 120000);

  it("each of the six display names returns the entries the SQL oracle selects for its live type value, newest first", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const { name, value } of await liveLogTypes()) {
      const content = succeeded<LogsContent>(await productionLogs({ type: name }));
      const expected = await eventLogOracle(oracleTarget(), `Type = ${value}`);
      expect(idsOf(expected), `${name}: the oracle selects the rows written by hand`).toEqual(EXPECTED_IDS[name]);
      expect(content.entries, `${name}: every field of every entry, in order`).toEqual(expected);
      expect(content.count, `${name}: count`).toBe(expected.length);
    }
  }, 180000);

  it("Error plus itemName Story400.Item returns the IDs 8, 7 and 2, equal to the oracle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<LogsContent>(await productionLogs({ type: "Error", itemName: "Story400.Item" }));
    const expected = await eventLogOracle(oracleTarget(), "Type = 2 AND ConfigName = 'Story400.Item'");
    expect(idsOf(expected), "the oracle selects the rows written by hand").toEqual([8, 7, 2]);
    expect(content.entries).toEqual(expected);
  }, 120000);

  it("the raw route still answers type=2 as type=Error (an older request), and an unknown value with no entries", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const byName = await rawLogs("type=Error&count=100");
    const byNumber = await rawLogs("type=2&count=100");
    const unknown = await rawLogs("type=Bogus&count=100");
    for (const [label, answer] of [["Error", byName], ["2", byNumber], ["Bogus", unknown]] as const) {
      expect(answer.status, `type=${label}: HTTP status`).toBe(200);
      expect(answer.errors, `type=${label}: no error`).toEqual([]);
    }
    expect(idsOf(byName.result.entries), "type=Error holds the four Error rows").toEqual([10, 8, 7, 2]);
    expect(byNumber.result, "type=2 equals type=Error").toEqual(byName.result);
    expect(unknown.result, "an unknown value matches nothing").toEqual({ entries: [], count: 0 });
    const lowerCase = await rawLogs("type=error&count=100");
    expect(lowerCase.result, "a lower-case name matches nothing").toEqual({ entries: [], count: 0 });
  }, 120000);
});

// -- Not configured ------------------------------------------------------

describe("Story 40.0: the not-configured namespace B (AC-3)", () => {
  it("iris_metrics_interop for B is not an error, with errorCount24h 0 and messageCount24h 0", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<MetricsContent>(await ops.call("iris_metrics_interop", { namespace: NS_B }));
    expect(content.namespaces[0]).toMatchObject({ namespace: NS_B, errorCount24h: 0, messageCount24h: 0, queueDepth: 0 });
    expect(Object.keys(content.namespaces[0] ?? {}), "the namespace keys and their order are unchanged (AD-33)").toEqual(METRICS_KEYS);
  }, 120000);

  it("iris_production_logs for B is an error with and without type Error, and IRIS's error text is identical (the mapping adds no dependency)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const plain = await interop.call("iris_production_logs", { namespace: NS_B });
    const typed = await interop.call("iris_production_logs", { namespace: NS_B, type: "Error" });
    expect(plain.isError, allText(plain)).toBe(true);
    expect(typed.isError, allText(typed)).toBe(true);
    // The tool's message names the request it sent (`&type=Error` for the second); the text after "Details: " is IRIS's own.
    const detailOf = (result: WireToolResult): string => /Details: ([\s\S]*)$/.exec(allText(result))?.[1] ?? "";
    expect(detailOf(plain), "the plain call carries IRIS's error text").toContain("Table 'ENS_UTIL.LOG' not found");
    expect(detailOf(typed), "IRIS's error texts are identical").toBe(detailOf(plain));
    expect(allText(typed), "the error is the missing table, not a missing class").not.toContain("LogType");
  }, 120000);
});
