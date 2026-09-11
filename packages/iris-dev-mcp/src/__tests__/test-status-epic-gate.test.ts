/**
 * Story 36.2 — `iris_test_status` live round-trip capstone (AC 36.2.4), as a
 * DEFAULT-SUITE, always-discoverable process gate (Rule #21 shape: a
 * `beforeAll` availability probe + a per-test `ctx.skip()`, with
 * `IRIS_REQUIRE_LIVE` opt-in hard-fail) — ARMED on the packaging path: this
 * file is listed in `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`,
 * which runs it with `IRIS_REQUIRE_LIVE=1` (the `epic35-defect-gate.test.ts`
 * arrangement), so a publish fails closed if IRIS or a fixture is missing.
 *
 * Test 1 — the round trip this epic exists to close, on Story 36.1's
 * single-method fixture (`LongRunningTest`, 10 s `Hang`):
 *   Leg 1  `iris_execute_tests` (timeout 5) ⇒ `running` + jobId + runIndex.
 *   Leg 2  `poll` by jobId while still running ⇒ strictly `running`.
 *   Leg 3  `poll` by jobId until `completed` (runIndexSource "result-table").
 *   Leg 4  its `details` equal an INDEPENDENT SQL query for that
 *          InstanceIndex (oracle written here, never the tool's own query).
 *   Leg 5  the job's Atelier queue node is GONE (read through /global) — the
 *          drain that closes ledger `36-1-CR-3`.
 *   Leg 6  `poll` by runIndex ALONE still returns the identical `completed`.
 *   Leg 7  cancel on a second submission THROUGH THE REAL GOVERNANCE GATE
 *          (`McpServerBase`): denied by default (job left running), then
 *          enabled by a process-local `IRIS_GOVERNANCE` override; the run is
 *          then observed PAST its natural finish time and must still be
 *          unfinished — proof the worker was actually stopped.
 *
 * Test 2 — DELTA-drain completeness + drain-vs-SQL value identity (AC 36.2.2),
 * on `DeltaDrainTest` (three fast methods — a pass, a deliberate assert
 * failure, a deliberate thrown exception — then a 6 s slow pass):
 * `iris_execute_tests`' own `running` response has ALREADY drained the three
 * fast rows (probe (d): they never reappear), so `iris_test_status`'
 * `completed` must still carry EVERY method, and its rows for the three fast
 * methods must EQUAL, exactly, the drain-path rows `iris_execute_tests`
 * returned for the SAME run (name prefix, status, millisecond duration,
 * assert-failure and thrown-exception messages, order).
 *
 * Rule #59 mutation evidence (each leg broken on the path it guards, run
 * against the live instance, restored byte-identical; recorded in the story's
 * Review Findings — reverting production code inside a permanent suite is
 * itself a footgun, so it is not automated here):
 *  - SQL-path completion reverted to the terminal drain's rows ⇒ Test 2 RED
 *    (`total` 1, not 4 — the already-drained fast rows are lost).
 *  - method-level error dropped from the SQL-path message ⇒ Test 2 RED
 *    (`Test3FastThrows` message "" vs the drain's).
 *  - the cancel DELETE skipped ⇒ Test 1 Leg 7 RED (the run finalizes).
 *  - `poll` resolving a finished run from SQL WITHOUT the terminal GET ⇒
 *    Test 1 Leg 5 RED (queue node still present).
 *  - `cancel` reclassified `mutates: "read"` ⇒ Test 1 Leg 7 RED (not denied).
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  IrisApiError,
  IrisHttpClient,
  McpServerBase,
  atelierPath,
  loadConfig,
  ping,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
  type McpServerBaseOptions,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { createExecuteTestsHandler } from "../tools/execute.js";
import { testStatusTool } from "../tools/test-status.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

function getConfig() {
  return loadConfig({
    IRIS_HOST,
    IRIS_PORT,
    IRIS_USERNAME,
    IRIS_PASSWORD,
    IRIS_NAMESPACE,
    IRIS_HTTPS: "false",
  });
}

/** Deliberately OUTSIDE `ExecuteMCPv2.Tests` — see each fixture class's own banner. */
const FIXTURE = "ExecuteMCPv2.QAFixtures.LongRunningTest"; // 1 method, Hang 10
const FIXTURE_HANG_MS = 10_000;
const DELTA_FIXTURE = "ExecuteMCPv2.QAFixtures.DeltaDrainTest"; // 3 fast + 1 slow (Hang 6)

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

let skipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;

/** Same discipline as `execute-classmethod-epic-gate.test.ts`'s
 * `fixtureIsDeployed`: probe the stock Atelier `/doc/` surface, never the
 * endpoint under test. */
async function fixtureIsDeployed(version: number, ns: string, fixture: string): Promise<boolean> {
  try {
    await client.get(atelierPath(version, ns, `doc/${encodeURIComponent(`${fixture}.cls`)}`));
    return true;
  } catch (error) {
    if (error instanceof IrisApiError && error.statusCode === 404) return false;
    throw error;
  }
}

async function sql(version: number, ns: string, query: string, parameters: unknown[]) {
  const resp = await client.post<Record<string, unknown>>(atelierPath(version, ns, "action/query"), {
    query,
    parameters,
  });
  const result = resp.result as Record<string, unknown>;
  const rows = (result?.content ?? result) as unknown[];
  return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
}

/** The independent oracle (Rule #36): a SQL query written directly here,
 * never reusing `test-status.ts`'s own query construction. */
async function queryMethodRows(
  version: number,
  ns: string,
  instanceIndex: number,
): Promise<{ ClassName: string; MethodName: string; Status: number; Duration: number }[]> {
  return (await sql(
    version,
    ns,
    "SELECT tc.Name AS ClassName, tm.Name AS MethodName, tm.Status, tm.Duration " +
      "FROM %UnitTest_Result.TestMethod tm JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID " +
      "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID " +
      "JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID WHERE ti.InstanceIndex = ?",
    [instanceIndex],
  )) as unknown as { ClassName: string; MethodName: string; Status: number; Duration: number }[];
}

/** `TestInstance.DateTime` non-empty ⇔ finished (AC 36.2.2's own definition). */
async function runIsFinished(version: number, ns: string, idx: number): Promise<boolean> {
  const rows = await sql(version, ns, "SELECT DateTime FROM %UnitTest_Result.TestInstance WHERE InstanceIndex = ?", [
    idx,
  ]);
  const finishedAt = rows[0]?.DateTime;
  return typeof finishedAt === "string" && finishedAt !== "";
}

/** Read the job's queue node `("unittest","id")` through the ExecuteMCPv2
 * `/global` route — `defined:false` once the job's subtree is killed. */
async function queueNodeDefined(ns: string, jobId: string): Promise<boolean> {
  const params = new URLSearchParams({
    global: "IRIS.TempAtelierAsyncQueue",
    subscripts: `${jobId},"unittest","id"`,
    namespace: ns,
  });
  const resp = await client.get<{ value: string; defined: boolean }>(`/api/executemcp/v2/global?${params}`);
  return resp.result.defined === true;
}

/** Best-effort drain: poll `GET /work/{jobId}` until Atelier no longer
 * reports `Retry-After` (a terminal poll consumes the queue node), or give up. */
async function drainQueueNode(version: number, ns: string, jobId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const resp = (await client.get(atelierPath(version, ns, `work/${jobId}`))) as unknown as Record<string, unknown>;
      if (!resp.retryafter) return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function pollUntilCompleted(jobId: string, deadlineMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + deadlineMs;
  let last: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    const poll = await testStatusTool.handler({ action: "poll", jobId }, ctx);
    last = poll.structuredContent as Record<string, unknown>;
    if (last.status === "completed") return last;
    expect(last.status, `unexpected poll state: ${JSON.stringify(last)}`).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`iris_test_status:poll never reported completed in time (last: ${JSON.stringify(last)})`);
}

beforeAll(async () => {
  try {
    const config = getConfig();
    client = new IrisHttpClient(config);
    const available = await ping(client, 3000);
    if (!available) {
      skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    } else {
      const version = await negotiateVersion(client);
      ctx = buildToolContext("NS", config, client, version);
      for (const fixture of [FIXTURE, DELTA_FIXTURE]) {
        if (!(await fixtureIsDeployed(version, ctx.resolveNamespace(), fixture))) {
          skipReason =
            `The QA fixture is not deployed in ${ctx.resolveNamespace()} (${fixture} not found via the ` +
            `Atelier API). Load src/ExecuteMCPv2/QAFixtures/*.cls to run this gate.`;
          break;
        }
      }
    }
  } catch (error) {
    skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the epic-done gate may not be skipped: ${skipReason}`);
  }
}, 30000);

function makeServerOpts(tools: ToolDefinition[]): McpServerBaseOptions {
  return { name: "@iris-mcp/dev", version: "0.0.0", tools };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

describe("iris_test_status live round-trip capstone (Story 36.2 AC 36.2.4, Rule #21 default-suite shape)", () => {
  it(
    "running (via iris_execute_tests) -> poll while running -> poll completed (SQL-equal to a live oracle) -> queue node gone -> poll by runIndex alone -> cancel through the REAL governance gate, observed past the natural finish",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] iris_test_status live capstone: ${skipReason}`);
        testCtx.skip();
        return;
      }

      const version = await negotiateVersion(client);
      const ns = ctx.resolveNamespace();
      const executeHandler = createExecuteTestsHandler();
      let firstJobId: string | undefined;
      let secondJobId: string | undefined;
      const servers: McpServerBase[] = [];

      try {
        // ── Leg 1: submit, expect running (Story 36.1) ──────────────
        const running = await executeHandler({ target: FIXTURE, level: "class", timeout: 5 }, ctx);
        expect(running.isError).toBe(false);
        const runningStructured = running.structuredContent as { status: string; jobId: string; runIndex: number | null };
        expect(runningStructured.status).toBe("running");
        firstJobId = runningStructured.jobId;
        expect(firstJobId).toMatch(/^\d+$/);

        // ── Leg 2: poll by jobId WHILE running ⇒ strictly running ──
        // At most ~5 s of a 10 s Hang has elapsed, so "completed" here would
        // be a premature-completion defect, not a race to tolerate.
        const pollRunning = await testStatusTool.handler({ action: "poll", jobId: firstJobId }, ctx);
        const pollRunningStructured = pollRunning.structuredContent as { status: string; jobId: string };
        expect(pollRunningStructured.status).toBe("running");
        expect(pollRunningStructured.jobId).toBe(firstJobId);

        // ── Leg 3: poll by jobId until completed ───────────────────
        const completedStructured = await pollUntilCompleted(firstJobId, 30_000);
        expect(completedStructured.runIndexSource).toBe("result-table");
        const runIndex = completedStructured.runIndex as number;
        expect(typeof runIndex).toBe("number");
        if (runningStructured.runIndex !== null) expect(runIndex).toBe(runningStructured.runIndex);

        // ── Leg 4: independent SQL oracle equality (Rule #36) ──────────
        const oracleRows = await queryMethodRows(version, ns, runIndex);
        expect(oracleRows).toHaveLength(1);
        const oracleRow = oracleRows[0]!;
        const details = completedStructured.details as { class: string; method: string; status: string; duration: number }[];
        expect(details).toHaveLength(1);
        expect(details[0]?.class).toBe(oracleRow.ClassName);
        expect(details[0]?.method).toBe(oracleRow.MethodName);
        expect(details[0]?.status).toBe(oracleRow.Status === 1 ? "passed" : "failed");
        // SQL seconds -> the drain's milliseconds (value identity vs the
        // DRAIN path itself is Test 2's job; this pins the SQL read).
        expect(details[0]?.duration).toBeCloseTo(oracleRow.Duration * 1000, 2);
        expect(details[0]?.duration).toBeGreaterThan(8000); // genuinely OUR slow run, not a fast neighbor.

        // ── Leg 5: the terminal poll consumed the queue node (36-1-CR-3) ──
        expect(await queueNodeDefined(ns, firstJobId)).toBe(false);

        // ── Leg 6: poll by runIndex ALONE still returns the identical completed ──
        const pollByIndex = await testStatusTool.handler({ action: "poll", runIndex }, ctx);
        const byIndexStructured = pollByIndex.structuredContent as Record<string, unknown>;
        expect(byIndexStructured.status).toBe("completed");
        expect(byIndexStructured.runIndexSource).toBe("result-table");
        expect(byIndexStructured.jobId).toBeUndefined();
        expect(byIndexStructured.details).toEqual(completedStructured.details);

        // ── Leg 7: cancel through the REAL governance gate (Rule #59) ──
        const submittedAt = Date.now();
        const secondRunning = await executeHandler({ target: FIXTURE, level: "class", timeout: 5 }, ctx);
        const secondStructured = secondRunning.structuredContent as { status: string; jobId: string };
        expect(secondStructured.status).toBe("running");
        secondJobId = secondStructured.jobId;

        const savedEnv = {
          IRIS_HOST: process.env.IRIS_HOST,
          IRIS_PORT: process.env.IRIS_PORT,
          IRIS_USERNAME: process.env.IRIS_USERNAME,
          IRIS_PASSWORD: process.env.IRIS_PASSWORD,
          IRIS_NAMESPACE: process.env.IRIS_NAMESPACE,
          IRIS_HTTPS: process.env.IRIS_HTTPS,
          IRIS_GOVERNANCE: process.env.IRIS_GOVERNANCE,
        };
        try {
          process.env.IRIS_HOST = IRIS_HOST;
          process.env.IRIS_PORT = IRIS_PORT;
          process.env.IRIS_USERNAME = IRIS_USERNAME;
          process.env.IRIS_PASSWORD = IRIS_PASSWORD;
          process.env.IRIS_NAMESPACE = IRIS_NAMESPACE;
          process.env.IRIS_HTTPS = "false";
          delete process.env.IRIS_GOVERNANCE;

          // DEFAULT governance: cancel must be REFUSED on the real gate, and
          // the job must be left genuinely untouched (still running).
          const deniedServer = new McpServerBase(makeServerOpts([testStatusTool]));
          servers.push(deniedServer);
          await deniedServer.start("stdio");
          const deniedResult = await callTool(deniedServer, "iris_test_status", { action: "cancel", jobId: secondJobId });
          expect(deniedResult.isError).toBe(true);
          expect(deniedResult.structuredContent).toMatchObject({
            code: "GOVERNANCE_DISABLED",
            action: "iris_test_status:cancel",
          });
          const stillRunning = await testStatusTool.handler({ action: "poll", jobId: secondJobId }, ctx);
          expect((stillRunning.structuredContent as { status: string }).status).toBe("running");

          // Explicit override, THIS PROCESS ONLY: cancel is now allowed.
          process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { "iris_test_status:cancel": true } });
          const enabledServer = new McpServerBase(makeServerOpts([testStatusTool]));
          servers.push(enabledServer);
          await enabledServer.start("stdio");
          const cancelResult = await callTool(enabledServer, "iris_test_status", { action: "cancel", jobId: secondJobId });
          const cancelStructured = cancelResult.structuredContent as {
            status: string;
            jobId: string;
            runIndex: number | null;
            observed: { queueNode: string; resultRow: string };
          };
          expect(cancelStructured.status).toBe("cancelled");
          expect(cancelStructured.jobId).toBe(secondJobId);
          expect(typeof cancelStructured.runIndex).toBe("number");
          expect(cancelStructured.observed.queueNode).toBe("gone");
          expect(cancelStructured.observed.resultRow).toMatch(/^unfinished/);
          const cancelledIndex = cancelStructured.runIndex as number;

          // Observe PAST the natural finish: an un-cancelled run would have
          // finalized by now (submission + 10 s Hang + margin). Only a
          // stopped worker leaves it unfinished.
          const naturalFinish = submittedAt + FIXTURE_HANG_MS + 4_000;
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, naturalFinish - Date.now())));
          expect(await runIsFinished(version, ns, cancelledIndex)).toBe(false);
          const afterCancel = await testStatusTool.handler({ action: "poll", runIndex: cancelledIndex }, ctx);
          expect((afterCancel.structuredContent as { status: string }).status).toBe("unfinished");
        } finally {
          for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
          }
        }
      } finally {
        for (const server of servers) await server.stop();
        // Leave the instance at baseline (a consumed id 404s, which drains nothing).
        if (firstJobId !== undefined) await drainQueueNode(version, ns, firstJobId);
        if (secondJobId !== undefined) await drainQueueNode(version, ns, secondJobId);
      }
    },
    { timeout: 120_000 },
  );

  it(
    "DELTA-drain completeness: after iris_execute_tests' running response already drained the fast rows, the completed envelope carries EVERY method and its rows EQUAL the drain path's for the same run",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] iris_test_status delta-drain capstone: ${skipReason}`);
        testCtx.skip();
        return;
      }

      const version = await negotiateVersion(client);
      const ns = ctx.resolveNamespace();
      const executeHandler = createExecuteTestsHandler();
      let jobId: string | undefined;

      try {
        const running = await executeHandler({ target: DELTA_FIXTURE, level: "class", timeout: 3 }, ctx);
        const runningStructured = running.structuredContent as {
          status: string;
          jobId: string;
          partial: { total: number; details: { class: string; method: string; status: string; duration: number; message: string }[] };
        };
        expect(runningStructured.status).toBe("running");
        jobId = runningStructured.jobId;
        // Precondition that makes this leg meaningful: the three FAST rows were
        // already drained (and so never reappear in any later drain).
        const drained = runningStructured.partial.details;
        expect(drained.map((d) => d.method)).toEqual(["Test1FastPass", "Test2FastAssertFail", "Test3FastThrows"]);

        const completed = await pollUntilCompleted(jobId, 20_000);
        const details = completed.details as { class: string; method: string; status: string; duration: number; message: string }[];
        // Completeness: EVERY method, not just what the terminal drain held.
        expect(completed.total).toBe(4);
        expect(completed.passed).toBe(2);
        expect(completed.failed).toBe(2);
        expect(details.map((d) => d.method)).toEqual([
          "Test1FastPass",
          "Test2FastAssertFail",
          "Test3FastThrows",
          "Test9SlowPass",
        ]);
        // Value identity with the DRAIN path for the same run (AC 36.2.2): exact
        // deep equality — name prefix, status, ms duration, both message kinds.
        expect(details.slice(0, 3)).toEqual(drained);
        expect(drained[1]?.message).toContain("deliberate assert failure (QA fixture)");
        expect(drained[2]?.message).toContain("deliberate throw (QA fixture)");

        // The slow row (drained only by the terminal poll the tool consumed)
        // against the independent SQL oracle.
        const oracle = (await queryMethodRows(version, ns, completed.runIndex as number)).find(
          (r) => r.MethodName === "Test9SlowPass",
        );
        expect(oracle?.Status).toBe(1);
        expect(details[3]?.duration).toBeCloseTo((oracle?.Duration ?? 0) * 1000, 2);
        expect(details[3]?.duration).toBeGreaterThan(5000);
        expect(await queueNodeDefined(ns, jobId)).toBe(false);
      } finally {
        if (jobId !== undefined) await drainQueueNode(version, ns, jobId);
      }
    },
    { timeout: 60_000 },
  );
});
