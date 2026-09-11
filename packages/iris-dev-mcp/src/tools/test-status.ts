/**
 * `iris_test_status` — companion tool to `iris_execute_tests` (Story 36.2).
 *
 * Epic 36's ONLY new tool (constraint E-3): it owns re-attach-by-`jobId`,
 * read-by-`runIndex`, and `cancel` — the seam Story 36.1 documented but
 * deliberately did not build (Rule #52; `execute.ts`'s "Seam for Story 36.2"
 * Dev Notes). Architecture decision L1 ("Long-Running Tool Calls Over
 * Asynchronous Server Jobs") requires this live on a SEPARATE tool, never a
 * new `action` on `iris_execute_tests` (that would rename its frozen
 * governance key and trip the Rule #23 drift test).
 *
 * Every envelope this tool returns is built through {@link testRunEnvelope} —
 * the SAME shared builder `iris_execute_tests` uses (never a parallel one,
 * Rule #52) — so a `poll` result and an `iris_execute_tests` result for the
 * SAME run are shape-identical, and (for a `completed` run) value-identical
 * too (AC 36.2.2).
 *
 * Two data sources back this tool, and they must never be confused:
 *  - The Atelier async work queue (`GET`/`DELETE /work/{jobId}`) — live,
 *    in-flight state, keyed by `jobId`. A poll that observes a TERMINAL state
 *    (no `Retry-After`) consumes the queue node; so does a `DELETE`. This is
 *    ONE-SHOT per job (probe (b), Story 36.1). The queue global
 *    (`^IRIS.TempAtelierAsyncQueue`) is INSTANCE-wide (IRISTEMP) and
 *    `%Api.Atelier.v8`'s `PollAsync`/`CancelAsync` ignore the URL namespace,
 *    so `jobId` is only meaningful together with the namespace the run was
 *    submitted in (see the `namespace` parameter).
 *  - `%UnitTest_Result.*` (via `action/query` SQL) — the durable record,
 *    PER-NAMESPACE, keyed by `InstanceIndex` ("runIndex" in this tool's
 *    vocabulary). A run is "finished" iff `TestInstance.DateTime` is
 *    non-empty (`$D(^UnitTest.Result(idx))` moves `10` → `11`, probe (f)) — a
 *    CANCELLED run stays unfinished FOREVER (probe (e)); the result table
 *    alone can never distinguish "still running" from "cancelled/crashed".
 *
 * Value identity with the drain path (`%Api.Atelier.v8:UnitTestResultToJSON`
 * → `summarizeAtelierResults`), field by field, each confirmed live:
 *  - `duration`: `%UnitTest_Result.TestMethod.Duration` is SECONDS
 *    (`%Numeric(SCALE=6)`) while the drain emits `Duration * 1000` computed in
 *    exact ObjectScript decimal arithmetic — {@link secondsToDrainMilliseconds}
 *    reproduces that value exactly (a plain IEEE `* 1000` does not: e.g.
 *    `8.007687 * 1000 === 8007.687000000001`).
 *  - `message`: for a FAILED method only, the method-level error (when both
 *    `ErrorAction` and `ErrorDescription` are set — e.g. a thrown exception;
 *    one leading space stripped) followed by each FAILED `TestAssert`'s
 *    `Action: Description` in `Counter` order, joined `"; "`.
 *  - `details` order: class then method, `%EXACT` collation — the drain's own
 *    `$ORDER(^UnitTest.Result(idx,"(root)",class,method))` traversal.
 *  - a finished run with NO method rows (e.g. an `OnBeforeAllTests` failure)
 *    is the AC 34.5.3/34.6.4 zero-result guard (`isError: true`, the
 *    class-level reason) — never a green `completed` with `total: 0`.
 */

import {
  IrisApiError,
  IrisConnectionError,
  atelierPath,
  type ToolDefinition,
  type ToolResult,
  type ToolContext,
} from "@iris-mcp/shared";
import { z } from "zod";
import {
  testRunEnvelope,
  buildRunningHint,
  readGlobalNode,
  summarizeAtelierResults,
  type PartialSnapshot,
  type RunHandles,
  type TestDetail,
  type AtelierTestResult,
} from "./execute.js";

type SqlCtx = Pick<ToolContext, "http" | "atelierVersion">;

/** The Atelier async work-queue global (IRISTEMP, instance-wide). */
const QUEUE_GLOBAL = "IRIS.TempAtelierAsyncQueue";

/**
 * `%Api.Atelier.v8`'s `PollAsync`/`CancelAsync` declare `pID As %Integer`, and
 * the queue id is `$Increment`-allocated — a real `jobId` is ALWAYS all
 * digits. Anything else is refused BEFORE any IRIS call: the id is spliced
 * into the Atelier URL path (`work/<jobId>`, where `fetch`'s URL parser would
 * resolve `../` segments — `cancel` would otherwise `DELETE` an arbitrary
 * Atelier route, e.g. a document) and into a `/global` subscript list.
 */
const JOB_ID_PATTERN = /^\d+$/;

function invalidJobIdError(jobId: string): ToolResult {
  return testRunEnvelope({
    kind: "error",
    error:
      `jobId ${JSON.stringify(jobId)} is not an Atelier work-queue id — it must be the all-digits id ` +
      `iris_execute_tests returned (e.g. "31797604"). Nothing was sent to IRIS.`,
  });
}

// ── SQL helpers ──────────────────────────────────────────────────

/** Run one SQL query via the Atelier `action/query` route (same route
 * `execute.ts`'s `discoverPackageTests` and `iris_sql_execute` use). */
async function runSqlQuery(
  ctx: SqlCtx,
  ns: string,
  query: string,
  parameters: unknown[],
): Promise<Record<string, unknown>[]> {
  const path = atelierPath(ctx.atelierVersion, ns, "action/query");
  const resp = await ctx.http.post<Record<string, unknown>>(path, { query, parameters });
  const result = resp.result as Record<string, unknown>;
  const rows = (result?.content ?? result) as unknown[];
  return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
}

/** The exact join `execute.ts`'s `buildRunningHint` documents: only
 * `TestInstance` carries `InstanceIndex`, so method rows join down to it. */
const METHOD_JOIN =
  "FROM %UnitTest_Result.TestMethod tm " +
  "JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID " +
  "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID " +
  "JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID " +
  "WHERE ti.InstanceIndex = ?";

/** The drain's `$ORDER` traversal order (class, then method), in SQL. */
const METHOD_ORDER = " ORDER BY %EXACT(tc.Name), %EXACT(tm.Name)";

const STATUS_MAP: Record<number, string> = { 0: "failed", 1: "passed", 2: "skipped" };

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * `TestMethod.Duration` (SECONDS, `%Numeric(SCALE=6)`) → the drain's
 * MILLISECONDS, value-identical to `UnitTestResultToJSON`'s exact-decimal
 * `Duration * 1000`: scale to integer microseconds first (exact for SCALE=6),
 * then ONE correctly-rounded division — the nearest double to the exact
 * decimal, i.e. exactly what `JSON.parse` yields for the drain's number.
 */
function secondsToDrainMilliseconds(raw: unknown): number {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(seconds * 1e6) / 1000;
}

/** Is `%UnitTest_Result.TestInstance` present for this index, and finished? */
async function readTestInstanceStatus(
  ctx: SqlCtx,
  ns: string,
  runIndex: number,
): Promise<{ exists: boolean; finished: boolean }> {
  const rows = await runSqlQuery(
    ctx,
    ns,
    "SELECT DateTime AS FinishedAt FROM %UnitTest_Result.TestInstance WHERE InstanceIndex = ?",
    [runIndex],
  );
  if (rows.length === 0) return { exists: false, finished: false };
  const finishedAt = rows[0]?.FinishedAt;
  return { exists: true, finished: typeof finishedAt === "string" && finishedAt !== "" };
}

/**
 * Build a `completed` summary from `%UnitTest_Result.*` by EXACT
 * `InstanceIndex` — never from drained Atelier rows alone (AC 36.2.2 (ii):
 * the drain is DELTA, so an earlier caller's own drain can never be assumed
 * absent). Every field is value-identical to the drain path — see this
 * file's banner.
 */
async function buildCompletedSummaryFromSql(ctx: SqlCtx, ns: string, runIndex: number): Promise<PartialSnapshot> {
  const methodRows = await runSqlQuery(
    ctx,
    ns,
    "SELECT tc.Name AS ClassName, tm.Name AS MethodName, tm.Status, tm.Duration, tm.ErrorAction, " +
      `tm.ErrorDescription ${METHOD_JOIN}${METHOD_ORDER}`,
    [runIndex],
  );
  const assertRows = await runSqlQuery(
    ctx,
    ns,
    "SELECT tc.Name AS ClassName, tm.Name AS MethodName, ta.Action, ta.Description " +
      "FROM %UnitTest_Result.TestAssert ta JOIN %UnitTest_Result.TestMethod tm ON ta.TestMethod = tm.ID " +
      "JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID JOIN %UnitTest_Result.TestSuite ts ON " +
      "tc.TestSuite = ts.ID JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID " +
      `WHERE ti.InstanceIndex = ? AND ta.Status = 0${METHOD_ORDER}, ta.Counter`,
    [runIndex],
  );

  const failuresByMethod = new Map<string, string[]>();
  for (const row of assertRows) {
    const key = `${str(row.ClassName)}::${str(row.MethodName)}`;
    const list = failuresByMethod.get(key) ?? [];
    list.push(`${str(row.Action)}: ${str(row.Description)}`);
    failuresByMethod.set(key, list);
  }

  let total = 0,
    passed = 0,
    failed = 0,
    skipped = 0;
  const details: TestDetail[] = [];
  for (const row of methodRows) {
    total++;
    const status = Number(row.Status);
    if (status === 1) passed++;
    else if (status === 0) failed++;
    else skipped++;
    const className = str(row.ClassName);
    const methodName = str(row.MethodName); // already Test-prefixed by %UnitTest_Result
    // The drain attaches messages to FAILED methods only (UnitTestResultToJSON).
    const messages: string[] = [];
    if (status === 0) {
      const errorAction = str(row.ErrorAction);
      const errorDescription = str(row.ErrorDescription);
      if (errorAction !== "" && errorDescription !== "") {
        messages.push(errorDescription.startsWith(" ") ? errorDescription.slice(1) : errorDescription);
      }
      messages.push(...(failuresByMethod.get(`${className}::${methodName}`) ?? []));
    }
    details.push({
      class: className,
      method: methodName,
      status: STATUS_MAP[status] ?? "unknown",
      duration: secondsToDrainMilliseconds(row.Duration),
      message: messages.join("; "),
    });
  }
  return { total, passed, failed, skipped, details };
}

/**
 * Class-level failures of a run (e.g. `OnBeforeAllTests`), formatted exactly
 * as the drain path reports them (`UnitTestResultToJSON`'s class row `error`
 * → `summarizeAtelierResults`' `classLevelErrors`), for the zero-result guard.
 */
async function readClassLevelErrors(ctx: SqlCtx, ns: string, runIndex: number): Promise<string[]> {
  const rows = await runSqlQuery(
    ctx,
    ns,
    "SELECT tc.Name AS ClassName, tc.ErrorAction, tc.ErrorDescription FROM %UnitTest_Result.TestCase tc " +
      "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID " +
      "JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID " +
      "WHERE ti.InstanceIndex = ? AND tc.Status = 0 ORDER BY %EXACT(tc.Name)",
    [runIndex],
  );
  return rows.map((row) => {
    const action = str(row.ErrorAction);
    const description = str(row.ErrorDescription);
    return action !== "" && description !== ""
      ? `${str(row.ClassName)}: ${action}:${description.startsWith(" ") ? "" : " "}${description}`
      : `${str(row.ClassName)}: the test runner reported a class-level failure`;
  });
}

/**
 * The `completed` envelope for a FINISHED run, read from `%UnitTest_Result` —
 * or, when the run recorded no method-level rows at all, the SAME zero-result
 * guard `iris_execute_tests` returns for that run (AC 34.5.3/34.6.4:
 * `isError: true` + the class-level reason), never a green `total: 0`.
 */
async function completedFromResultTable(
  ctx: SqlCtx,
  ns: string,
  runIndex: number,
  handles: RunHandles,
  note?: string,
): Promise<ToolResult> {
  const summary = await buildCompletedSummaryFromSql(ctx, ns, runIndex);
  if (summary.total === 0) {
    const classLevelErrors = await readClassLevelErrors(ctx, ns, runIndex);
    const reason =
      classLevelErrors.length > 0
        ? `Test run at runIndex ${runIndex} produced no method-level results — ${classLevelErrors.join("; ")}`
        : `Test run at runIndex ${runIndex} recorded no method-level results (no test method ran).`;
    return testRunEnvelope({ kind: "error", error: note ? `${reason} ${note}` : reason, handles });
  }
  return testRunEnvelope({ kind: "completed", summary, handles, timeoutCapped: false, ...(note ? { note } : {}) });
}

/**
 * Interim (mid-run) rows for the `unfinished` state's `partial` snapshot.
 * `%UnitTest_Result.TestMethod` rows exist and read `Status 1` (and
 * `Duration 0`) BEFORE the method has actually finished (Task 1 probe,
 * reconfirming the Story 36.1 review's manual-SQL trap) — such a row is
 * reported as `"in-progress"`, never `"passed"`, and excluded from the
 * `total`/`passed`/`failed`/`skipped` counts entirely (so those counts stay
 * internally consistent: `total === passed+failed+skipped`), satisfying AC
 * 36.2.2 (iv)'s "never reported as passes" at the per-row level, not merely
 * by nesting under `partial`.
 */
async function buildInterimPartialFromSql(ctx: SqlCtx, ns: string, runIndex: number): Promise<PartialSnapshot> {
  const methodRows = await runSqlQuery(
    ctx,
    ns,
    `SELECT tc.Name AS ClassName, tm.Name AS MethodName, tm.Status, tm.Duration ${METHOD_JOIN}${METHOD_ORDER}`,
    [runIndex],
  );
  let total = 0,
    passed = 0,
    failed = 0,
    skipped = 0;
  const details: TestDetail[] = [];
  for (const row of methodRows) {
    const duration = secondsToDrainMilliseconds(row.Duration);
    const status = Number(row.Status);
    const provisional = duration === 0;
    if (!provisional) {
      total++;
      if (status === 1) passed++;
      else if (status === 0) failed++;
      else skipped++;
    }
    details.push({
      class: str(row.ClassName),
      method: str(row.MethodName),
      status: provisional ? "in-progress" : (STATUS_MAP[status] ?? "unknown"),
      duration,
      message: provisional ? "Row not final — this method has not finished executing yet." : "",
    });
  }
  return { total, passed, failed, skipped, details };
}

// ── Atelier drain parsing (poll's one-shot GET /work/{jobId}) ────

/** Parse one `GET /work/{jobId}` response body into result rows — the same
 * `Array` / `{content: [...]}` shapes `execute.ts`'s poll loop accepts. New
 * code (not an extraction of that loop, which Rule #19 keeps untouched): a
 * single poll here is inherently a ONE-SHOT read, never an accumulating loop. */
function extractAtelierChunk(pollResult: unknown): AtelierTestResult[] {
  if (Array.isArray(pollResult)) return pollResult as AtelierTestResult[];
  const resultObj = pollResult as Record<string, unknown> | undefined;
  if (Array.isArray(resultObj?.content)) return resultObj!.content as AtelierTestResult[];
  return [];
}

function toPartialSnapshot(chunk: AtelierTestResult[]): PartialSnapshot {
  const s = summarizeAtelierResults(chunk);
  return { total: s.total, passed: s.passed, failed: s.failed, skipped: s.skipped, details: s.details };
}

// ── Queue-node reads (ExecuteMCPv2 /global, best-effort) ─────────

/** Best-effort read of the job's queue-node run index — `undefined` maps to
 * `null` (never observed / not yet allocated), matching `RunHandles`. */
async function readQueueRunIndex(ctx: SqlCtx, ns: string, jobId: string): Promise<number | null> {
  const node = await readGlobalNode(ctx, ns, QUEUE_GLOBAL, `${jobId},"unittest","id"`);
  if (node?.defined) {
    const parsed = Number(node.value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Refuse a `jobId` whose live queue node says it is NOT a unit-test job
 * (`QueueAsync` stores `requesttype` for every queued request: `compile`,
 * `search`, `unittest`, …). Without this, a mistyped or foreign id would have
 * `poll` drain — and on completion consume — another client's result, or
 * `cancel` stop another client's work. Best-effort: when the node is gone or
 * `/global` is unavailable, the Atelier call proceeds exactly as before.
 */
async function refuseNonUnitTestJob(
  ctx: SqlCtx,
  ns: string,
  jobId: string,
  action: "poll" | "cancel",
): Promise<ToolResult | undefined> {
  const node = await readGlobalNode(ctx, ns, QUEUE_GLOBAL, `${jobId},"requesttype"`);
  if (node?.defined && node.value !== "unittest") {
    const consequence =
      action === "poll"
        ? "a poll would drain, and on completion consume, another client's result"
        : "cancelling it would stop another client's work";
    return testRunEnvelope({
      kind: "error",
      error:
        `jobId '${jobId}' is an Atelier '${node.value}' work-queue job, not a unit-test run — ` +
        `iris_test_status:${action} refuses to touch it (${consequence}). Check the jobId iris_execute_tests returned.`,
      handles: { jobId },
    });
  }
  return undefined;
}

function validationError(message: string): ToolResult {
  return testRunEnvelope({ kind: "error", error: message });
}

function isIrisError(error: unknown): error is IrisApiError | IrisConnectionError {
  return error instanceof IrisApiError || error instanceof IrisConnectionError;
}

// ── `poll` ───────────────────────────────────────────────────────

/**
 * Resolve a run purely from `%UnitTest_Result` by `runIndex` — shared by
 * `poll`'s `runIndex`-alone path (AC 36.2.2 (iv)), `poll`'s terminal-drain
 * and `jobId`-404 paths (AC 36.2.2 (ii)/(iii)/(v)), and `cancel`'s
 * already-gone observation (AC 36.2.3). `jobId` is present only when the
 * caller supplied one — its presence distinguishes the "abandoned" (jobId
 * known, no live Atelier job left) case from the "unfinished" (runIndex
 * alone, no jobId at all to check) case (AC 36.2.2 (iv) vs (v)).
 */
async function resolveByRunIndex(
  ctx: SqlCtx,
  ns: string,
  runIndex: number,
  jobId: string | undefined,
): Promise<ToolResult> {
  const status = await readTestInstanceStatus(ctx, ns, runIndex);
  if (!status.exists) {
    return testRunEnvelope({
      kind: "error",
      error: `No test run recorded at InstanceIndex ${runIndex} in %UnitTest_Result.TestInstance (namespace ${ns}).`,
      handles: jobId !== undefined ? { jobId } : {},
    });
  }
  if (status.finished) {
    return completedFromResultTable(ctx, ns, runIndex, {
      ...(jobId !== undefined ? { jobId } : {}),
      runIndex,
      runIndexSource: "result-table",
    });
  }
  if (jobId !== undefined) {
    return testRunEnvelope({
      kind: "abandoned",
      jobId,
      runIndex,
      note:
        `No live Atelier job references jobId '${jobId}' any longer, and %UnitTest_Result.TestInstance ` +
        `${runIndex} has not finished (cancelled, crashed, or its worker died). It will never complete.`,
    });
  }
  const partial = await buildInterimPartialFromSql(ctx, ns, runIndex);
  return testRunEnvelope({
    kind: "unfinished",
    runIndex,
    partial,
    note:
      `The result table shows InstanceIndex ${runIndex} has not finished. It may still be running, or it was ` +
      `cancelled/crashed — the result table alone cannot tell which. Poll by jobId for an authoritative answer.`,
  });
}

async function handlePoll(
  args: { jobId?: string; runIndex?: number; namespace?: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const { jobId, runIndex: explicitRunIndex, namespace } = args;
  const ns = ctx.resolveNamespace(namespace);

  if (jobId !== undefined && jobId !== "" && !JOB_ID_PATTERN.test(jobId)) {
    return invalidJobIdError(jobId);
  }
  if (!jobId && explicitRunIndex === undefined) {
    return validationError(
      "iris_test_status:poll requires at least one of 'jobId' or 'runIndex' — neither was supplied.",
    );
  }

  if (!jobId) {
    // runIndex alone (AC 36.2.2 (iv)).
    return resolveByRunIndex(ctx, ns, explicitRunIndex as number, undefined);
  }

  const refusal = await refuseNonUnitTestJob(ctx, ns, jobId, "poll");
  if (refusal) return refusal;

  // Read the queue node BEFORE any GET /work call that could be terminal
  // (probe (b): the terminal poll kills the subtree before its own HTTP
  // response is even sent) — this is the ONLY chance to observe it fresh.
  const queueRunIndex = await readQueueRunIndex(ctx, ns, jobId);

  let pollResp: Awaited<ReturnType<ToolContext["http"]["get"]>>;
  try {
    pollResp = await ctx.http.get<unknown>(atelierPath(ctx.atelierVersion, ns, `work/${jobId}`));
  } catch (error: unknown) {
    if (error instanceof IrisApiError && error.statusCode === 404) {
      // (iii) jobId unknown / already consumed — fall back to a known runIndex.
      const idx = explicitRunIndex ?? queueRunIndex ?? undefined;
      if (idx === undefined) {
        return testRunEnvelope({
          kind: "error",
          error:
            `No known run for jobId '${jobId}' — Atelier no longer references it (already consumed by an ` +
            `earlier poll/cancel, or it never existed). Pass 'runIndex' to check %UnitTest_Result directly.`,
          handles: { jobId },
        });
      }
      return resolveByRunIndex(ctx, ns, idx, jobId);
    }
    if (isIrisError(error)) {
      return testRunEnvelope({
        kind: "error",
        error: `Error polling jobId '${jobId}': ${error.message}`,
        handles: { jobId, runIndex: queueRunIndex, runIndexSource: queueRunIndex !== null ? "queue" : null },
        hint: buildRunningHint(
          `This error came from polling job ${jobId} — the run may still be executing server-side.`,
          jobId,
          queueRunIndex,
          ns,
        ),
      });
    }
    throw error;
  }

  const pollEnvelope = pollResp as unknown as Record<string, unknown>;
  const partial = toPartialSnapshot(extractAtelierChunk(pollResp.result));

  if (pollEnvelope.retryafter) {
    return testRunEnvelope({
      kind: "running",
      handles: {
        jobId,
        runIndex: queueRunIndex,
        runIndexSource: queueRunIndex !== null ? "queue" : null,
      },
      namespace: ns,
      partial,
    });
  }

  // No Retry-After: the job just reached a terminal state and THIS poll
  // consumed its queue node (or it was already fully drained by an earlier
  // caller and this GET consumed the empty remainder). NEVER build a result
  // from this single drain alone (AC 36.2.2 (ii)) — the drain is delta; an
  // earlier `iris_execute_tests` "running" response may already have consumed
  // some rows, which never reappear here.
  const idx = queueRunIndex ?? explicitRunIndex;
  if (idx === undefined) {
    // No run index at all: the drained rows are the only data — returned
    // under `partial` with the explicit incompleteness explanation, NEVER as
    // top-level counts a consumer could take for a final result (L1 (2)).
    return testRunEnvelope({
      kind: "error",
      error:
        `Job ${jobId} finished (this poll consumed its Atelier queue entry), but no run index was captured, so ` +
        `its authoritative result cannot be read from %UnitTest_Result. The rows THIS poll drained are under ` +
        `'partial' — they may be missing rows an earlier caller already drained (the drain is delta, never ` +
        `cumulative across separate calls), so they are NOT a final result. Supply 'runIndex' (from ` +
        `iris_execute_tests' response) and poll again for the authoritative result.`,
      handles: { jobId, runIndex: null, runIndexSource: null },
      partial,
    });
  }
  try {
    // Authoritative: finished ⇒ completed from %UnitTest_Result (or the
    // zero-result guard); a run the finished job never finalized (its worker
    // died before saving, or a mis-predicted index) ⇒ abandoned; no row ⇒ error.
    return await resolveByRunIndex(ctx, ns, idx, jobId);
  } catch (error: unknown) {
    if (isIrisError(error)) {
      return testRunEnvelope({
        kind: "error",
        error:
          `Job ${jobId} finished (this poll consumed its Atelier queue entry), but reading its result from ` +
          `%UnitTest_Result at runIndex ${idx} failed: ${error.message}. Do NOT re-submit — poll again with ` +
          `runIndex ${idx} (Atelier no longer knows this jobId).`,
        handles: { jobId, runIndex: idx, runIndexSource: queueRunIndex !== null ? "queue" : null },
        partial,
      });
    }
    throw error;
  }
}

// ── `cancel` ─────────────────────────────────────────────────────

async function handleCancel(args: { jobId?: string; namespace?: string }, ctx: ToolContext): Promise<ToolResult> {
  const { jobId, namespace } = args;
  const ns = ctx.resolveNamespace(namespace);

  if (!jobId) {
    return validationError(
      "iris_test_status:cancel requires 'jobId' — the Atelier work-queue DELETE route operates on the job id; " +
        "'runIndex' alone cannot be used to cancel a run.",
    );
  }
  if (!JOB_ID_PATTERN.test(jobId)) return invalidJobIdError(jobId);

  const refusal = await refuseNonUnitTestJob(ctx, ns, jobId, "cancel");
  if (refusal) return refusal;

  // Read the run index BEFORE the DELETE (AC 36.2.3) — this is the ONLY
  // chance to read it; DELETE kills the queue node.
  const runIndex = await readQueueRunIndex(ctx, ns, jobId);
  const handles: RunHandles = { jobId, runIndex, runIndexSource: runIndex !== null ? "queue" : null };

  try {
    await ctx.http.delete(atelierPath(ctx.atelierVersion, ns, `work/${jobId}`));
  } catch (error: unknown) {
    if (error instanceof IrisApiError && error.statusCode === 404) {
      // Already gone before this cancel could act — observe via runIndex,
      // same fallback `poll` uses on its own 404.
      if (runIndex === null) {
        return testRunEnvelope({
          kind: "error",
          error:
            `jobId '${jobId}' was already gone (HTTP 404) before this cancel could act, and no run index was ` +
            `captured — nothing to observe. It may already have finished, been cancelled, or never existed.`,
          handles: { jobId },
        });
      }
      return resolveByRunIndex(ctx, ns, runIndex, jobId);
    }
    if (isIrisError(error)) {
      // Never lose the handles: whether the DELETE took effect is unknown.
      return testRunEnvelope({
        kind: "error",
        error: `cancel's DELETE /work/${jobId} failed: ${error.message} — whether it took effect is unknown.`,
        handles,
        hint:
          `Observe the job before retrying: call iris_test_status with action "poll" and jobId "${jobId}"` +
          `${runIndex !== null ? ` (or runIndex ${runIndex})` : ""} and namespace "${ns}".`,
      });
    }
    throw error;
  }

  // DELETE succeeded (HTTP 200) — OBSERVE what happened, never assume (AC 36.2.3).
  // `requesttype` is stored for every queued job, so its absence now is the
  // observation that the queue entry is gone.
  const queueAfter = await readGlobalNode(ctx, ns, QUEUE_GLOBAL, `${jobId},"requesttype"`);
  const queueNode =
    queueAfter === undefined
      ? "unknown (the /global read failed)"
      : queueAfter.defined
        ? "still present (unexpected after an HTTP 200 DELETE)"
        : "gone";

  if (runIndex === null) {
    return testRunEnvelope({
      kind: "cancelled",
      jobId,
      runIndex: null,
      observed: {
        queueNode,
        resultRow:
          "unknown — no run index was captured before the DELETE, so %UnitTest_Result could not be checked",
      },
    });
  }

  try {
    const status = await readTestInstanceStatus(ctx, ns, runIndex);
    if (status.exists && status.finished) {
      // The job had already finished but was never drained — cancelling
      // discarded only the queue entry; the results are preserved.
      return await completedFromResultTable(
        ctx,
        ns,
        runIndex,
        { jobId, runIndex, runIndexSource: "result-table" },
        `The job had already finished; cancelling discarded only its queue entry. Results are preserved — ` +
          `poll by runIndex ${runIndex}.`,
      );
    }
    return testRunEnvelope({
      kind: "cancelled",
      jobId,
      runIndex,
      observed: {
        queueNode,
        resultRow: status.exists
          ? `unfinished — TestInstance ${runIndex} has no finish time right after the DELETE; a run whose worker ` +
            `was stopped never finalizes (poll by runIndex ${runIndex} later to confirm it stays unfinished)`
          : `absent — no %UnitTest_Result.TestInstance row at runIndex ${runIndex} (cancelled before the run ` +
            `started, or the index was mis-predicted)`,
      },
    });
  } catch (error: unknown) {
    if (isIrisError(error)) {
      return testRunEnvelope({
        kind: "cancelled",
        jobId,
        runIndex,
        observed: {
          queueNode,
          resultRow:
            `unknown — reading %UnitTest_Result for runIndex ${runIndex} failed (${error.message}); poll by ` +
            `runIndex ${runIndex} to observe`,
        },
      });
    }
    throw error;
  }
}

// ── Tool definition ──────────────────────────────────────────────

export const testStatusTool: ToolDefinition = {
  name: "iris_test_status",
  title: "Test Run Status",
  description:
    "Companion to iris_execute_tests: re-attach to a test run by its jobId (Atelier work-queue id) and/or " +
    "runIndex (%UnitTest_Result InstanceIndex), or cancel one. Use this after iris_execute_tests returns " +
    "status:\"running\" (or after your own client abandoned a long call) instead of re-submitting the same " +
    "target — re-submitting starts a SECOND concurrent run against shared fixtures. Pass the run's own " +
    "namespace (the one iris_execute_tests reported). " +
    "action:\"poll\" (read, enabled by default): pass jobId to re-attach through the Atelier work queue — " +
    "returns status:\"running\" (with a partial, DELTA-only snapshot of whatever this ONE poll drained — never " +
    "cumulative across separate calls) while Retry-After is still present; status:\"completed\" once finished, " +
    "built AUTHORITATIVELY from %UnitTest_Result by exact InstanceIndex (never from the drained rows alone, " +
    "and never MAX(InstanceIndex)) — a jobId's queue node is read BEFORE the poll that could consume it, so " +
    "the runIndex is captured even on a job that finishes on this very call; a finished run with no " +
    "method-level results (e.g. a failed OnBeforeAllTests) is reported isError:true with the class-level " +
    "reason, exactly like iris_execute_tests. If Atelier no longer recognizes the jobId (HTTP 404 — already " +
    "consumed by an earlier poll/cancel, or stale) it falls back to runIndex when supplied, else reports a " +
    "clear not-found result naming that fallback. Pass runIndex alone to read %UnitTest_Result directly: " +
    "status:\"completed\" (SQL path) when TestInstance.DateTime is set, or status:\"unfinished\" when it is " +
    "not — the result table alone CANNOT distinguish still-running from cancelled/crashed (a cancelled run's " +
    "row never finishes), so an unfinished result carries interim rows only under partial (labelled " +
    "in-progress, never counted as passed) and recommends polling by jobId for an authoritative answer. A " +
    "jobId whose queue node is gone AND whose runIndex shows unfinished is reported status:\"abandoned\" (no " +
    "live job references it any longer). " +
    "action:\"cancel\" (write, DEFAULT-DISABLED by governance — enable via IRIS_GOVERNANCE, e.g. " +
    "{\"global\":{\"iris_test_status:cancel\":true}}): stops a RUNNING job (DELETE /work/{jobId}) and reports " +
    "the OBSERVED outcome, never an assumed one — status:\"cancelled\" with what was actually seen (queue " +
    "entry; result row), or, when the job had ALREADY finished but was never drained, status:\"completed\" " +
    "with a note that only the queue entry was discarded and results are preserved at that runIndex. cancel " +
    "requires jobId (there is no way to cancel by runIndex alone). Both actions refuse a jobId that is not a " +
    "unit-test job.",
  inputSchema: z.object({
    action: z
      .enum(["poll", "cancel"])
      .describe("'poll' (read) re-attaches/reads a run's status; 'cancel' (write, default-disabled) stops one."),
    jobId: z
      .string()
      .regex(JOB_ID_PATTERN, "jobId must be the all-digits Atelier work-queue id iris_execute_tests returned")
      .optional()
      .describe(
        "Atelier work-queue job id, all digits (from iris_execute_tests' 'jobId', or a prior poll's own " +
          "'jobId'). Required for 'cancel'; for 'poll', at least one of jobId/runIndex is required.",
      ),
    runIndex: z
      .coerce.number()
      .int()
      .positive()
      .optional()
      .describe(
        "%UnitTest_Result.TestInstance.InstanceIndex (from iris_execute_tests' 'runIndex', or a prior poll's " +
          "own 'runIndex'). For 'poll', usable alone (reads %UnitTest_Result directly) or as a fallback when " +
          "jobId is stale/unknown. Not usable for 'cancel' (cancelling requires jobId).",
      ),
    namespace: z
      .string()
      .optional()
      .describe(
        "The namespace the run was submitted in — pass iris_execute_tests' own 'namespace' (default: " +
          "configured). It MUST match: the Atelier work queue is instance-wide, but %UnitTest_Result is " +
          "per-namespace, so a different namespace reads a different run's results.",
      ),
  }),
  annotations: {
    // Mixed action (poll: read, cancel: write) — mirrors iris_env_promote's
    // precedent of one tool-level annotation set covering both actions.
    // Unlike iris_env_promote (whose 'execute' never deletes anything and so
    // stays destructiveHint:false), 'cancel' genuinely stops a running job and
    // permanently prevents its result from ever finalizing -- irreversible,
    // so destructiveHint is truthfully true at the tool level.
    readOnlyHint: false,
    destructiveHint: true,
    // Calling 'cancel' twice on the same jobId does not repeat the same
    // effect (the second call finds the job already gone and reports
    // differently); 'poll' itself is repeatable but its OWN result changes
    // over time for the same input (running -> completed) by design.
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  // Governance (Rules #28/#32): both action keys are NEW/post-foundation
  // (absent from the frozen governance-baseline.ts) -- both MUST be
  // classified. `cancel` is truthfully "write" and deliberately does NOT use
  // `defaultEnabled` -- stopping a run is not a recovery-of-last-resort
  // action like `iris_production_control:clean`.
  mutates: {
    poll: "read",
    cancel: "write",
  },
  handler: async (args, ctx) => {
    const input = args as { action: "poll" | "cancel"; jobId?: string; runIndex?: number; namespace?: string };
    if (input.action === "cancel") {
      return handleCancel(input, ctx);
    }
    return handlePoll(input, ctx);
  },
};
