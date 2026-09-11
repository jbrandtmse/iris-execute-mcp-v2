/**
 * Story 36.1 QA — `iris_execute_tests` running-result contract epic-done gate,
 * as a DEFAULT-SUITE, always-discoverable process gate (Rule #21 shape,
 * mirrors `execute-classmethod-epic-gate.test.ts`'s `ctx.skip()`-on-unavailable
 * pattern).
 *
 * Story 36.1 exists to fix a real beta-feedback incident: `iris_execute_tests`
 * returned a hard `Error: Test execution timed out` for a genuinely slow test
 * run that was still executing server-side, discarding the run's handles and
 * prompting the caller to re-submit (creating a SECOND concurrent run against
 * shared fixtures). The dev's own live proof of the fix (AC 36.1.8) was a
 * disposable smoke script (`scratchpad/smoke-36-1.mjs`) deleted before
 * staging — genuine when it ran, but not re-runnable and not part of any
 * gate, exactly the shape Rule #59 warns against ("it passes" is not "it
 * would fail if broken", and only on the path actually guarded).
 *
 * This file closes that gap: it is NOT named `*.integration.test.ts`, so it
 * IS collected by the default `vitest.config.ts` include glob and runs as
 * part of `pnpm turbo run test`. It drives the REAL production handler
 * (`createExecuteTestsHandler()`, exported from `../tools/execute.js` — the
 * exact function `executeTestsTool.handler` is built from) over real HTTP
 * against a real IRIS instance, exercising:
 *  - a genuinely slow run (a dedicated 10-second `Hang`-based fixture —
 *    cut from 30 s at the Story 36.1 code review; the running branch needs
 *    only `timeout` < the hang) returning `status: "running"` with a
 *    captured `jobId` and `runIndex` within a small caller-supplied
 *    `timeout` (AC 36.1.3/36.1.5);
 *  - that the SAME run's `%UnitTest_Result.TestInstance` row, once the run
 *    actually finishes server-side, carries EXACTLY that `InstanceIndex`
 *    (oracle from reality, Rule #36 — never asserted against a re-derived
 *    or mocked value, never `MAX()`);
 *  - cleanup: the job's Atelier queue node is drained with one
 *    `GET /work/{jobId}` once the run has finished (probe (c): a finished
 *    job's node is consumed by that poll), so each run leaves the instance
 *    at baseline instead of leaking an `^IRIS.TempAtelierAsyncQueue` orphan.
 *
 * It degrades gracefully (never fails a pristine/offline checkout) via a
 * `beforeAll` availability probe + a per-test `ctx.skip()`, exactly like the
 * `iris-mcp-all` process gates and `execute-classmethod-epic-gate.test.ts`.
 *
 * FIXTURE PLACEMENT (deliberate, QA decision — see the fixture class's own
 * banner): `ExecuteMCPv2.QAFixtures.LongRunningTest` lives OUTSIDE the
 * `ExecuteMCPv2.Tests` package specifically so a package-level run targeting
 * `ExecuteMCPv2.Tests` (the Rule #35 412-`Test*`-method OS suite) never
 * discovers or executes it — a slow `Hang` inside that suite would skew
 * both its count and its wall-clock runtime. It is also NOT part of the
 * bootstrap manifest (Rule #39 — test/fixture classes stay out of
 * `scripts/gen-bootstrap.mjs`); it must be deployed manually via
 * `iris_doc_load` on any instance that is meant to run this gate for real
 * (`src/ExecuteMCPv2/QAFixtures/LongRunningTest.cls`).
 *
 * Rule #59 mutation evidence (recorded in the Story 36.1 QA Results and
 * re-run at its code review, not automated here — reverting production code
 * inside a permanent suite would itself be a footgun): reverting the
 * "running" branch in `execute.ts` back to the pre-Story-36.1 hard timeout
 * error drives this gate's first assertion RED (the call RETURNS
 * `isError: true` with no `structuredContent` — `expected true to be
 * false`); restoring returns it to GREEN.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  IrisApiError,
  IrisHttpClient,
  atelierPath,
  loadConfig,
  ping,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
} from "@iris-mcp/shared";
import { createExecuteTestsHandler } from "../tools/execute.js";

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

/** Deliberately OUTSIDE `ExecuteMCPv2.Tests` — see this file's banner. */
const FIXTURE = "ExecuteMCPv2.QAFixtures.LongRunningTest";

/**
 * Opt-in CI switch: when set, an unavailable environment is a hard FAILURE
 * rather than a skip (mirrors `execute-classmethod-epic-gate.test.ts`).
 */
const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

let skipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;

/**
 * Is the QA fixture deployed on this instance? Probed through the stock
 * Atelier `/doc/` surface — never through `iris_execute_tests` itself, the
 * exact discipline `execute-classmethod-epic-gate.test.ts`'s
 * `fixtureIsDeployed` documents: probing the endpoint under test would let a
 * genuine regression there present as "service not available" and silently
 * skip the whole gate.
 */
async function fixtureIsDeployed(version: number, ns: string): Promise<boolean> {
  try {
    await client.get(atelierPath(version, ns, `doc/${encodeURIComponent(`${FIXTURE}.cls`)}`));
    return true;
  } catch (error) {
    if (error instanceof IrisApiError && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Query `%UnitTest_Result.TestInstance` for a specific `InstanceIndex`, via
 * the same Atelier `action/query` SQL route `execute.ts`'s own
 * `discoverPackageTests` uses — a test-only helper, not production code.
 */
async function queryTestInstance(
  version: number,
  ns: string,
  instanceIndex: number,
): Promise<{ InstanceIndex: number; Duration: number; ConfigurationName: string }[]> {
  const path = atelierPath(version, ns, "action/query");
  const resp = await client.post<Record<string, unknown>>(path, {
    query:
      "SELECT InstanceIndex, Duration, ConfigurationName FROM %UnitTest_Result.TestInstance WHERE InstanceIndex = ?",
    parameters: [instanceIndex],
  });
  const result = resp.result as Record<string, unknown>;
  const rows = (result?.content ?? result) as unknown[];
  return (Array.isArray(rows) ? rows : []) as {
    InstanceIndex: number;
    Duration: number;
    ConfigurationName: string;
  }[];
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
      if (!(await fixtureIsDeployed(version, ctx.resolveNamespace()))) {
        skipReason =
          `The QA fixture is not deployed in ${ctx.resolveNamespace()} (${FIXTURE} not found via the ` +
          `Atelier API). Load src/ExecuteMCPv2/QAFixtures/LongRunningTest.cls to run this gate.`;
      }
    }
  } catch (error) {
    skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(
      `IRIS_REQUIRE_LIVE is set, so the epic-done gate may not be skipped: ${skipReason}`,
    );
  }
}, 30000);

describe("iris_execute_tests running-result contract epic-done gate (Story 36.1 AC 36.1.3/36.1.5/36.1.8, Rule #21 default-suite shape)", () => {
  it(
    "a genuinely slow run reports status:'running' with jobId+runIndex within a small timeout, and the SAME run's %UnitTest_Result.TestInstance row carries EXACTLY that InstanceIndex once it finishes",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-tests running-contract epic gate: ${skipReason}`);
        testCtx.skip();
        return;
      }

      const handler = createExecuteTestsHandler();
      const version = await negotiateVersion(client);
      const ns = ctx.resolveNamespace();
      let jobId: string | undefined;

      try {
        // The fixture Hangs for 10 real seconds; a 3-second wait budget is
        // comfortably inside that window (live-measured on this repo's dev
        // instance: the `IRIS.TempAtelierAsyncQueue` run-index node is
        // published within tens of milliseconds of queueing, and the tool
        // reads it from the FIRST still-running poll).
        const running = await handler({ target: FIXTURE, level: "class", timeout: 3 }, ctx);

        expect(running.isError).toBe(false);
        const runningStructured = running.structuredContent as {
          status: string;
          jobId: string;
          runIndex: number | null;
          runIndexSource: string | null;
        };
        expect(runningStructured.status).toBe("running");
        expect(typeof runningStructured.jobId).toBe("string");
        expect(runningStructured.jobId.length).toBeGreaterThan(0);
        jobId = runningStructured.jobId;
        // The captured-handle property this story's AC 36.1.3/36.1.5 exists
        // to deliver: a genuinely slow run must NOT come back with an
        // unknown handle — that is exactly the reporter's original complaint
        // (the job id was discarded and the run became uncorrelatable).
        expect(typeof runningStructured.runIndex).toBe("number");
        expect(runningStructured.runIndexSource).toBe("queue");
        const capturedRunIndex = runningStructured.runIndex as number;

        // The Hang keeps running server-side after the 3-second budget
        // expired (this tool never cancels — that is Story 36.2's job). Poll
        // for the SAME run's finished TestInstance row by its exact
        // InstanceIndex (Rule #36 oracle from reality — never
        // MAX(InstanceIndex)) instead of sleeping a fixed margin.
        let rows: Awaited<ReturnType<typeof queryTestInstance>> = [];
        const oracleDeadline = Date.now() + 45_000;
        while (Date.now() < oracleDeadline) {
          rows = await queryTestInstance(version, ns, capturedRunIndex);
          if (rows.length > 0 && Number(rows[0]?.Duration) > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        expect(rows).toHaveLength(1);
        const row = rows[0];
        if (!row) throw new Error("unreachable — toHaveLength(1) above guarantees rows[0] exists");
        expect(row.InstanceIndex).toBe(capturedRunIndex);
        // Sanity check that this is genuinely OUR slow run, not a coincidental
        // fast neighbor: the 10-second Hang alone accounts for most of the
        // recorded duration (seconds).
        expect(Number(row.Duration)).toBeGreaterThan(8);
      } finally {
        // Leave the instance at baseline: drain the finished job's Atelier
        // queue node (a poll that observes completion kills it). Best-effort.
        if (jobId !== undefined) {
          const drainDeadline = Date.now() + 20_000;
          while (Date.now() < drainDeadline) {
            try {
              const resp = (await client.get(atelierPath(version, ns, `work/${jobId}`))) as unknown as Record<
                string,
                unknown
              >;
              if (!resp.retryafter) break;
            } catch {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        }
      }
    },
    { timeout: 90_000 },
  );
});
