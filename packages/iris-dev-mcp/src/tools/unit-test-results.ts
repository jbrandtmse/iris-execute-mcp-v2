/**
 * Reads of the durable `%UnitTest_Result` record (per namespace, keyed by `InstanceIndex`, called
 * "runIndex" in the test tools' vocabulary), shared by `iris_test_status` (`test-status.ts`) and
 * `iris_test_coverage` (`test-coverage.ts`). They moved here from `test-status.ts` in Story 40.1,
 * unchanged, so both tools build a run's summary from the same code without an import cycle.
 *
 * A run is "finished" iff `TestInstance.DateTime` is non-empty. Value identity with the Atelier drain
 * path (`%Api.Atelier.v8:UnitTestResultToJSON` -> `summarizeAtelierResults`), field by field, is
 * documented in the banner of `test-status.ts`.
 */

import { atelierPath, type ToolContext } from "@iris-mcp/shared";
import type { PartialSnapshot, TestDetail } from "./execute.js";

export type SqlCtx = Pick<ToolContext, "http" | "atelierVersion">;

// ── SQL helpers ──────────────────────────────────────────────────

/** Run one SQL query via the Atelier `action/query` route (the same route
 * `execute.ts`'s `discoverPackageTests` uses). */
export async function runSqlQuery(
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
export const METHOD_JOIN =
  "FROM %UnitTest_Result.TestMethod tm " +
  "JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID " +
  "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID " +
  "JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID " +
  "WHERE ti.InstanceIndex = ?";

/** The drain's `$ORDER` traversal order (class, then method), in SQL. */
export const METHOD_ORDER = " ORDER BY %EXACT(tc.Name), %EXACT(tm.Name)";

export const STATUS_MAP: Record<number, string> = { 0: "failed", 1: "passed", 2: "skipped" };

export function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * `TestMethod.Duration` (SECONDS, `%Numeric(SCALE=6)`) → the drain's
 * MILLISECONDS, value-identical to `UnitTestResultToJSON`'s exact-decimal
 * `Duration * 1000`: scale to integer microseconds first (exact for SCALE=6),
 * then ONE correctly-rounded division — the nearest double to the exact
 * decimal, i.e. exactly what `JSON.parse` yields for the drain's number.
 */
export function secondsToDrainMilliseconds(raw: unknown): number {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(seconds * 1e6) / 1000;
}

/** Is `%UnitTest_Result.TestInstance` present for this index, and finished? */
export async function readTestInstanceStatus(
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
 * absent). Every field is value-identical to the drain path — see the banner of
 * `test-status.ts`.
 */
export async function buildCompletedSummaryFromSql(ctx: SqlCtx, ns: string, runIndex: number): Promise<PartialSnapshot> {
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
export async function readClassLevelErrors(ctx: SqlCtx, ns: string, runIndex: number): Promise<string[]> {
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
export async function buildInterimPartialFromSql(ctx: SqlCtx, ns: string, runIndex: number): Promise<PartialSnapshot> {
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
