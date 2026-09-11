/**
 * ObjectScript execution tools for the IRIS Development MCP server.
 *
 * Provides two tools for executing ObjectScript code on IRIS:
 * - {@link executeCommandTool} — Execute an ObjectScript command with I/O capture
 * - {@link executeClassMethodTool} — Invoke a class method by name with positional arguments
 *
 * All tools call the custom REST service at `/api/executemcp/v2/command` and
 * `/api/executemcp/v2/classmethod`, NOT the Atelier API.
 */

import {
  IrisApiError,
  IrisConnectionError,
  atelierPath,
  ensureUnitTestRoot,
  type ToolDefinition,
  type ToolResult,
} from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

/**
 * Extract a boolean `truncated` flag from an `IrisApiError`'s preserved
 * envelope `result`, when present (Story 34.5 AC 34.5.1 / `34-4-R4`).
 *
 * The `/command` and `/classmethod` REST endpoints place `truncated` on
 * the error envelope's `result` for failures reached after capture began
 * (Story 34.4); `IrisApiError.result` now carries that envelope through to
 * the tool layer (`http-client.ts`, Story 34.5). Returns `undefined` — not
 * `false` — for any error whose `result` never carried the flag (a
 * connection failure, a pre-capture validation error, or a pre-34.5
 * server), so callers can distinguish "never reported" from "reported
 * false" and the tool never invents a value the server didn't send.
 */
function extractTruncated(result: unknown): boolean | undefined {
  if (result && typeof result === "object" && "truncated" in result) {
    const value = (result as Record<string, unknown>).truncated;
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

// ── iris_execute_command ────────────────────────────────────────

export const executeCommandTool: ToolDefinition = {
  name: "iris_execute_command",
  title: "Execute Command",
  description:
    "Execute an ObjectScript command on IRIS with captured I/O output. " +
    "Write statements and other output are captured and returned in the response's " +
    "`output` field, capped at 32768 RAW characters — measured BEFORE JSON escaping, " +
    "not the serialized wire size — output beyond the ceiling is cut off and replaced " +
    "with a structured, machine-detectable marker " +
    "(`[IRIS-MCP-TRUNCATED ceiling=32768chars]`), never a bare '...'. JSON string " +
    "escaping (quotes, backslashes, tabs, control characters) can inflate the " +
    "SERIALIZED response body well past this raw-character figure for " +
    "metacharacter-heavy output — a 32768-character output of C0 control characters " +
    "(each costing a 6-character \\uXXXX escape) measured 196,495 serialized " +
    "characters, roughly 6x the raw ceiling and about 3.9x past the ~50,000-character " +
    "point at which some MCP clients divert inline results to a file. This ceiling bounds " +
    "the RESPONSE PAYLOAD only: the command has already fully executed by the time it is " +
    "applied, so it is not protection against the command's own execution time or " +
    "resource usage, and it is not a Web Gateway timeout safeguard. The response also " +
    "includes `truncated` (boolean — true whenever `output` does not contain everything " +
    "the command wrote, whether because it hit this ceiling or because it hit the " +
    "platform's long-string ceiling mid-command; the call still succeeds with a partial " +
    "capture, and this never happens silently).",
  inputSchema: z.object({
    command: z
      .string()
      .describe("ObjectScript command to execute (e.g., 'Write \"Hello\"')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { command, namespace } = args as {
      command: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    const body = {
      command,
      namespace: ns,
    };

    const path = `${BASE_URL}/command`;

    try {
      const response = await ctx.http.post(path, body);
      const result = response.result;
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        // AC 34.5.1 (34-4-R4): surface `truncated` on the error path too,
        // when the server's error envelope carried it. Additive —
        // `structuredContent` is omitted entirely (not set to `undefined`)
        // when the envelope never reported the flag, so a plain error
        // response is byte-identical to today's shape (Rule #19).
        const truncated = extractTruncated(error.result);
        return {
          content: [
            {
              type: "text",
              text: `Error executing command: ${error.message}`,
            },
          ],
          ...(truncated !== undefined ? { structuredContent: { truncated } } : {}),
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_execute_tests ─────────────────────────────────────────

/**
 * Injectable clock/sleep seam (Story 36.1 AC 36.1.7) so the "still running"
 * branch — and the counter/queue-node handle capture that runs alongside it
 * — can be pinned in tests WITHOUT burning wall-clock time. Chosen over
 * `vi.useFakeTimers()` (which would be the first use of fake timers in this
 * repo): an explicit `now`/`sleep` pair is a smaller, tool-local seam that
 * needs no global timer-mocking setup/teardown and composes simply with a
 * deterministic fake that advances on each `sleep` call. Production callers
 * never pass a `clock` — {@link executeTestsTool}'s exported `handler` is
 * `createExecuteTestsHandler()` with no argument, using {@link realClock}
 * (real `Date.now`/`setTimeout`), so today's behavior is byte-for-byte
 * unchanged (Rule #19).
 */
export interface TestClock {
  /** Current time in epoch milliseconds. */
  now: () => number;
  /** Resolve after (at least, in the real implementation) `ms` milliseconds. */
  sleep: (ms: number) => Promise<void>;
}

/** Real-time clock — production default. */
const realClock: TestClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Delay between poll requests (ms). */
const TEST_POLL_INTERVAL = 200;
/**
 * Fallback wait budget (seconds) when neither an explicit `timeout` argument
 * nor `IRIS_TEST_TIMEOUT` is set — today's hard-coded value (120s),
 * unchanged (Rule #19).
 */
const DEFAULT_TEST_TIMEOUT_SECONDS = 120;
/**
 * Hard upper cap (seconds) on the resolved wait budget, regardless of
 * source (AC 36.1.4). Mirrors the `IRIS_SQL_MAX_ROWS`/`rowsCapped`
 * clamp-and-flag precedent (`sql.ts`) — a value above this is silently
 * clamped and the response carries `timeoutCapped: true`.
 */
const MAX_TEST_TIMEOUT_SECONDS = 3600;
/**
 * Run-index capture strategy (AC 36.1.5, as ruled at the Story 36.1 code
 * review — AC 36.1.5 wins over the former "gate the reads on the 2nd
 * still-running poll" design, ledger `36-1-QA-1`/`36-1-QA-2`):
 *
 *  1. `^UnitTest.Result`'s root counter is read ONCE, BEFORE `POST /work` —
 *     so the "before" snapshot can never already include this job's own
 *     `$INCREMENT` (the worker allocates within tens of ms of queueing).
 *  2. On EVERY still-running poll (the first one included) until captured,
 *     `IRIS.TempAtelierAsyncQueue(<jobId>,"unittest","id")` is read — a value
 *     keyed by OUR jobId, so it can never name another client's run. The
 *     terminal poll kills that node before its HTTP response is sent
 *     (`%Api.Atelier.v8` PollAsync), so only a `retryafter` poll can see it.
 *  3. Only for a COMPLETED run whose queue capture never succeeded is the
 *     counter read again and the delta applied (see
 *     {@link attributeRunIndexByCounter}). A STILL-RUNNING run is never
 *     counter-attributed: its worker may not have allocated its index yet,
 *     so a delta of 1 there can be ANOTHER client's run (`36-1-QA-1`).
 *
 * The `/global` reads are best-effort: after this many CONSECUTIVE transport
 * failures (e.g. the ExecuteMCPv2 `/global` route is not deployed on the
 * instance) the per-poll queue-node read stops for the rest of the call,
 * instead of adding one failing GET to every 200 ms poll for the whole budget.
 */
const MAX_CAPTURE_READ_FAILURES = 3;

/**
 * The Atelier `/work` unittest endpoint's `methods` request filter and its
 * result rows both use test method names with the leading `Test` prefix
 * STRIPPED (e.g. `ExtractTablesSingleTable`, not
 * `TestExtractTablesSingleTable`) — even though the underlying ObjectScript
 * method, `%Dictionary.MethodDefinition`, this tool's own input schema, and
 * every documented example all use the prefixed form (the method's REAL
 * name; `%UnitTest.TestCase` requires every test method to start with
 * `Test`, so the prefix is always present on the real side).
 *
 * Verified live against HSCUSTOM (2026.1 Build 235U), Story 34.5 QA:
 * `ExecuteMCPv2.Tests.AdvisorDataTest:TestExtractTablesSingleTable` (the
 * prefixed, documented form) drained 0 rows; the identical target with the
 * prefix stripped drained 1 passing row. Reproduced across 4 distinct
 * methods on the same class, and the class-level run's own result rows
 * (13/13) carried stripped names too — the stripping is a property of the
 * endpoint's wire format at BOTH the request filter and every result row,
 * not something specific to the `methods` filter alone.
 *
 * Without this normalization, a caller using the tool's own documented
 * method-name form at `level: "method"` would drain zero rows and now hit
 * the AC 34.5.3 zero-result guard on a target that genuinely exists and
 * passes — turning a silent false-negative into a misleading "not found"
 * for a correct, documented call. {@link toAtelierMethodFilter} strips the
 * prefix before sending the filter so the documented form actually works;
 * {@link fromAtelierMethodName} restores it on every result row so the
 * tool's own output stays true to its documented shape (e.g. `"TestAdd"`,
 * not `"Add"`) at all three levels.
 */
function toAtelierMethodFilter(methodName: string): string {
  return methodName.startsWith("Test") ? methodName.slice(4) : methodName;
}

/** Reverse of {@link toAtelierMethodFilter} — see that function's doc. */
function fromAtelierMethodName(method: string): string {
  return `Test${method}`;
}

/**
 * Run handles (Story 36.1 AC 36.1.5/36.1.6) carried on every non-completed
 * return once a job exists, and additively on the completed envelope.
 * `runIndex`/`runIndexSource` are explicit (including `null`) rather than
 * omitted once a capture attempt has been made, so a structured consumer can
 * always distinguish "never attempted" (fields absent — no `jobId` yet) from
 * "attempted, still unknown" (`null`).
 */
interface RunHandles {
  jobId?: string;
  runIndex?: number | null;
  runIndexSource?: "queue" | "counter" | null;
  /** Present only when there is something specific to say about why
   * `runIndex` is `null` despite an attempt (e.g. an ambiguous counter
   * delta). */
  runIndexNote?: string;
}

/**
 * Read one global node via the EXISTING custom REST `/global` GET route
 * (`ExecuteMCPv2.REST.Global::GetGlobal`, already bootstrapped — the exact
 * request shape `iris_global_get` builds, per this story's Dev Notes). No
 * new ObjectScript surface (this story is pure TypeScript).
 *
 * Never throws: this is a best-effort instrumentation read for the handle-
 * capture mechanism, never a requirement for the tool's core result. A
 * transport failure, or a response that doesn't look like a `/global`
 * envelope (e.g. a stray atelier poll response accidentally read through
 * this path), returns `undefined` rather than a wrong value (Rule #54 — pin
 * only shapes the real endpoint can return: `{value, defined}`).
 */
async function readGlobalNode(
  ctx: { http: InstanceType<typeof import("@iris-mcp/shared").IrisHttpClient> },
  ns: string,
  globalName: string,
  subscripts: string,
): Promise<{ value: string; defined: boolean } | undefined> {
  const params = new URLSearchParams();
  params.set("global", globalName);
  if (subscripts) params.set("subscripts", subscripts);
  params.set("namespace", ns);
  const path = `${BASE_URL}/global?${params.toString()}`;
  try {
    const response = await ctx.http.get<Record<string, unknown>>(path);
    const result = response.result;
    if (result && typeof result === "object" && "defined" in result) {
      const defined = (result as Record<string, unknown>).defined === true;
      const rawValue = (result as Record<string, unknown>).value;
      const value =
        typeof rawValue === "string"
          ? rawValue
          : rawValue === undefined || rawValue === null
            ? ""
            : String(rawValue);
      return { value, defined };
    }
  } catch {
    // Best-effort — see banner.
  }
  return undefined;
}

/** Read `^UnitTest.Result`'s root counter value (best-effort). Returns
 * `undefined` only when the read itself failed/was unparseable — an unset
 * global reads as `0` (matching ObjectScript's own `$GET(^UnitTest.Result,0)`
 * fallback), not "unavailable". */
async function readUnitTestCounter(
  ctx: { http: InstanceType<typeof import("@iris-mcp/shared").IrisHttpClient> },
  ns: string,
): Promise<number | undefined> {
  const node = await readGlobalNode(ctx, ns, "UnitTest.Result", "");
  if (!node) return undefined;
  const parsed = Number(node.value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface ResolvedTimeout {
  timeoutMs: number;
  timeoutCapped: boolean;
}

/**
 * Resolve the effective wait budget (AC 36.1.4): explicit `timeout`
 * (seconds) argument > `ctx.config.testTimeoutMs` (`IRIS_TEST_TIMEOUT`) >
 * {@link DEFAULT_TEST_TIMEOUT_SECONDS}, clamped at
 * {@link MAX_TEST_TIMEOUT_SECONDS}.
 */
function resolveTestTimeout(
  explicitSeconds: number | undefined,
  configTestTimeoutMs: number | undefined,
): ResolvedTimeout {
  let timeoutMs: number;
  if (explicitSeconds !== undefined) {
    timeoutMs = explicitSeconds * 1000;
  } else if (configTestTimeoutMs !== undefined) {
    timeoutMs = configTestTimeoutMs;
  } else {
    timeoutMs = DEFAULT_TEST_TIMEOUT_SECONDS * 1000;
  }
  const capMs = MAX_TEST_TIMEOUT_SECONDS * 1000;
  if (timeoutMs > capMs) {
    return { timeoutMs: capMs, timeoutCapped: true };
  }
  return { timeoutMs, timeoutCapped: false };
}

/**
 * Build the `hint` field naming BOTH re-attach routes (AC 36.1.3) — the
 * Story 36.2 companion tool (forthcoming, AC 36.1.10) and the route that
 * works in EVERY preset today (`core` included, Lead decision L-2):
 * `iris_global_get` on the jobId's queue node for the run index, then
 * `iris_sql_execute` joined down from `%UnitTest_Result.TestInstance` — the
 * ONLY `%UnitTest_Result` table carrying the `InstanceIndex` column
 * (`TestSuite.TestInstance` → `TestCase.TestSuite` → `TestMethod.TestCase` →
 * `TestAssert.TestMethod`; live-verified via INFORMATION_SCHEMA.COLUMNS at
 * the Story 36.1 code review) — never `MAX(InstanceIndex)`. The query selects
 * `TestInstance.DateTime AS FinishedAt` because the rows exist WHILE the run
 * executes (live-captured at the code review: mid-run the TestInstance row
 * has `DateTime ""`/`Duration 0` and the still-hanging method already reads
 * `Status 1`) — an empty FinishedAt is the only signal they are not final.
 *
 * @param lead - The situation sentence ("Still executing server-side." for
 *   a running result; a "may still be executing" sentence for a polling
 *   error once the job exists).
 */
function buildRunningHint(lead: string, jobId: string, runIndex: number | null): string {
  const capturedPart = runIndex !== null ? `already captured: ${runIndex} — ` : "";
  return (
    `${lead} Do NOT re-submit — re-submitting starts a SECOND concurrent run against shared fixtures. ` +
    `Re-attach instead. Today, in every preset: (1) the runIndex (${capturedPart}re-readable while the job is ` +
    `queued or running via iris_global_get with global "IRIS.TempAtelierAsyncQueue" and subscripts ` +
    `'${jobId},"unittest","id"'); (2) iris_sql_execute "SELECT ti.DateTime AS FinishedAt, tc.Name AS ClassName, ` +
    `tm.Name AS MethodName, tm.Status, tm.Duration, tm.ErrorDescription FROM %UnitTest_Result.TestMethod tm ` +
    `JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID JOIN %UnitTest_Result.TestSuite ts ON ` +
    `tc.TestSuite = ts.ID JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID WHERE ` +
    `ti.InstanceIndex = ?" with parameters [runIndex] — only %UnitTest_Result.TestInstance carries the ` +
    `InstanceIndex column; TestSuite/TestCase/TestMethod (and TestAssert, via TestMethod) join down to it. An ` +
    `EMPTY FinishedAt means the run is STILL executing: its rows are in-progress, not final (a method that is ` +
    `still running already reads Status 1) — re-query until FinishedAt is set. Never MAX(InstanceIndex) — a ` +
    `concurrent run can allocate a higher index first. Forthcoming: iris_test_status (Story 36.2) will ` +
    `re-attach by jobId directly.`
  );
}

/**
 * Counter-delta run-index attribution for a COMPLETED run whose queue-node
 * capture never succeeded (AC 36.1.5; see {@link MAX_CAPTURE_READ_FAILURES}'s
 * banner for the full capture strategy). `counterBefore` was read BEFORE
 * `POST /work` and `counterAfter` after completion, so this job's own
 * allocation — if `%UnitTest.Manager` ever ran for it — lies inside the
 * window: a delta of exactly 1 is therefore this job's index. Any other
 * outcome yields `null` plus a `runIndexNote` saying why (never a guess).
 *
 * `drainedAnyRows` guards the one case where a delta of 1 is NOT ours: the
 * Atelier worker quits BEFORE publishing the run index or calling
 * `%UnitTest.Manager.RunTest` when the test class fails to compile (or there
 * is nothing to run) — `%Api.Atelier.v8:ExecuteAsyncRequest`, read at the
 * Story 36.1 code review — so a completed run that drained no result rows
 * never allocated an index, and a delta of 1 in that window belongs to
 * another client's run.
 */
function attributeRunIndexByCounter(
  counterBefore: number | undefined,
  counterAfter: number | undefined,
  drainedAnyRows: boolean,
): { runIndex: number | null; runIndexSource: "counter" | null; runIndexNote?: string } {
  if (counterBefore === undefined || counterAfter === undefined) {
    return {
      runIndex: null,
      runIndexSource: null,
      runIndexNote:
        "Run index not attributed: the run-index queue node was never observed and the ^UnitTest.Result " +
        "counter could not be read before queueing and/or after completion.",
    };
  }
  const delta = counterAfter - counterBefore;
  if (delta === 0) {
    return {
      runIndex: null,
      runIndexSource: null,
      runIndexNote:
        "No run index was allocated for this job: ^UnitTest.Result did not advance between queueing and " +
        "completion (e.g. the test class failed to compile, so %UnitTest.Manager never started).",
    };
  }
  if (!drainedAnyRows) {
    return {
      runIndex: null,
      runIndexSource: null,
      runIndexNote:
        `Run index not attributed: the run completed without draining any result rows, so ^UnitTest.Result ` +
        `advancing by ${delta} cannot be tied to this job (a job whose test class fails to compile never ` +
        `allocates an index — the increment may be another run's).`,
    };
  }
  if (delta === 1) {
    return { runIndex: counterAfter, runIndexSource: "counter" };
  }
  if (delta < 0) {
    return {
      runIndex: null,
      runIndexSource: null,
      runIndexNote:
        `Run index not attributed: ^UnitTest.Result moved backwards by ${-delta} between queueing and ` +
        `completion (the counter was reset or purged).`,
    };
  }
  return {
    runIndex: null,
    runIndexSource: null,
    runIndexNote:
      `Run index not attributed: ^UnitTest.Result advanced by ${delta} (expected 1) between queueing and ` +
      `completion — another run allocated an index concurrently, so no single index can be attributed.`,
  };
}

/** Result structure from the Atelier async unittest endpoint. */
interface AtelierTestResult {
  class: string;
  method?: string;
  status: number; // 0 = Failed, 1 = Passed, 2 = Skipped
  duration: number;
  failures: { message: string }[];
  error?: string;
}

/**
 * Discover test classes in a package by querying the class dictionary.
 * Returns an array of `{ class: string }` objects for use in the
 * Atelier async unittest request.
 */
async function discoverPackageTests(
  ctx: { http: InstanceType<typeof import("@iris-mcp/shared").IrisHttpClient>; atelierVersion: number },
  ns: string,
  packageName: string,
): Promise<{ class: string }[]> {
  const sqlPath = atelierPath(ctx.atelierVersion, ns, "action/query");
  const query =
    "SELECT Name FROM %Dictionary.ClassDefinition " +
    "WHERE Name %STARTSWITH ? AND Abstract = 0 AND " +
    "Name IN (SELECT Name FROM %Dictionary.ClassDefinitionQuery_SubclassOf('%UnitTest.TestCase'))";
  const resp = await ctx.http.post<Record<string, unknown>>(sqlPath, { query, parameters: [packageName + "."] });
  const result = resp.result as Record<string, unknown>;
  const rows = (result?.content ?? result) as unknown[];
  const tests: { class: string }[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = (row as Record<string, string>).Name ?? (row as Record<string, string>).name;
    if (name) tests.push({ class: name });
  }
  return tests;
}

/**
 * Build the zero-result guard's response envelope (AC 34.5.3/34.5.4, and its AC 34.6.4
 * machine-detectability fix, ledger item `34-5-R1`).
 *
 * BOTH guard sites below — the package discovery-time check and the shared post-run
 * check covering all three levels — call this SAME helper so their shapes can never
 * diverge again (the AC's own explicit requirement). Carries BOTH `structuredContent`
 * (so a structured consumer reading `structuredContent.total` sees `0` with a populated
 * `error`, never `undefined`) AND `isError: true` (the guard fires only when the
 * caller's target produced nothing — a failed request, not a clean run — so `isError`
 * is truthful). This is a recorded Project Lead decision (Story 34.6 AC 34.6.4): both
 * halves are required, not an either/or — see the story's Dev Notes for the rationale.
 *
 * Story 36.1 AC 36.1.6: this is the error-kind entry point of the ONE
 * shared envelope helper, {@link testRunEnvelope}, which every return of this
 * tool now goes through — the pre-existing two zero-result-guard call sites
 * (package discovery, and the shared post-run zero-method-rows check), the
 * "no job ID" early return, the transport-error catch, the "running" result
 * and the completed result — so their shapes and handle fields can never
 * diverge. `handles` is optional and additive (Rule #19): omitted entirely,
 * the output is byte-for-byte what it was before this story (the
 * pre-existing two call sites' own pinned tests exercise exactly that path,
 * unchanged).
 */
function zeroResultGuardResponse(error: string, handles: RunHandles = {}): ToolResult {
  return testRunEnvelope({ kind: "error", error, handles });
}

/** Method-level detail row of this tool's documented output. */
type TestDetail = { class: string; method: string; status: string; duration: number; message: string };

/** Drained-so-far counts + details (the `partial` object). */
interface PartialSnapshot {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  details: TestDetail[];
}

/**
 * Every envelope `iris_execute_tests` returns (Story 36.1 AC 36.1.3/36.1.5/
 * 36.1.6). Story 36.2's companion tool must emit these SAME shapes — it
 * reuses {@link testRunEnvelope} rather than re-building them (Rule #52 seam).
 */
type TestRunEnvelope =
  | {
      /** isError:true — AC 34.6.4 shape (top-level zero counts + `error`). */
      kind: "error";
      error: string;
      handles?: RunHandles;
      /** Drained-so-far rows, when a job exists and polling it failed. */
      partial?: PartialSnapshot;
      /** Do-not-re-submit / re-attach guidance, when the job may still be running. */
      hint?: string;
    }
  | {
      /** isError:false — the wait budget expired with the job still running (AC 36.1.3). */
      kind: "running";
      handles: RunHandles & { jobId: string };
      elapsedMs: number;
      timeoutMs: number;
      timeoutCapped: boolean;
      target: string;
      level: string;
      namespace: string;
      partial: PartialSnapshot;
    }
  | {
      /** No isError — a finished run; pre-36.1 keys first and byte-identical (Rule #19). */
      kind: "completed";
      summary: PartialSnapshot;
      handles: RunHandles & { jobId: string };
      timeoutCapped: boolean;
      methodMismatchWarning?: string;
    };

/** The handle fields, in their one canonical order and presence rules. */
function handleFields(handles: RunHandles): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (handles.jobId !== undefined) fields.jobId = handles.jobId;
  if (handles.runIndex !== undefined) fields.runIndex = handles.runIndex;
  if (handles.runIndexSource !== undefined) fields.runIndexSource = handles.runIndexSource;
  if (handles.runIndexNote !== undefined) fields.runIndexNote = handles.runIndexNote;
  return fields;
}

/**
 * The ONE shared envelope helper (AC 36.1.6) — see {@link TestRunEnvelope}.
 */
function testRunEnvelope(envelope: TestRunEnvelope): ToolResult {
  if (envelope.kind === "error") {
    const structured: Record<string, unknown> = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      details: [] as TestDetail[],
      error: envelope.error,
      ...handleFields(envelope.handles ?? {}),
      ...(envelope.partial !== undefined ? { partial: envelope.partial } : {}),
      ...(envelope.hint !== undefined ? { hint: envelope.hint } : {}),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured,
      isError: true,
    };
  }

  if (envelope.kind === "running") {
    const { handles } = envelope;
    // isError: false — the request SUCCEEDED (the run was submitted and is
    // executing); ratified at the Epic 35 retro (`35-6-CR-1`): ongoing/partial
    // state lives in structuredContent without isError. Counts live ONLY under
    // `partial` — never a top-level total a consumer could take as final.
    const structured: Record<string, unknown> = {
      status: "running",
      jobId: handles.jobId,
      runIndex: handles.runIndex ?? null,
      runIndexSource: handles.runIndexSource ?? null,
      ...(handles.runIndexNote ? { runIndexNote: handles.runIndexNote } : {}),
      elapsedMs: envelope.elapsedMs,
      timeoutMs: envelope.timeoutMs,
      target: envelope.target,
      level: envelope.level,
      namespace: envelope.namespace,
      partial: envelope.partial,
      ...(envelope.timeoutCapped ? { timeoutCapped: true } : {}),
      hint: buildRunningHint("Still executing server-side.", handles.jobId, handles.runIndex ?? null),
    };
    const firstLine =
      `TEST RUN STILL EXECUTING — not finished, not failed. jobId=${handles.jobId} ` +
      `runIndex=${handles.runIndex ?? "unknown"}. Do NOT re-submit.`;
    return {
      content: [{ type: "text", text: `${firstLine}\n\n${JSON.stringify(structured, null, 2)}` }],
      structuredContent: structured,
      isError: false,
    };
  }

  const { summary, handles } = envelope;
  const result: Record<string, unknown> = {
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    details: summary.details,
    // Additive (AC 36.1.5) — the pre-36.1 keys above stay byte-identical.
    status: "completed",
    jobId: handles.jobId,
    runIndex: handles.runIndex ?? null,
    runIndexSource: handles.runIndexSource ?? null,
    ...(handles.runIndexNote ? { runIndexNote: handles.runIndexNote } : {}),
    ...(envelope.timeoutCapped ? { timeoutCapped: true } : {}),
    ...(envelope.methodMismatchWarning ? { methodMismatchWarning: envelope.methodMismatchWarning } : {}),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

/** One summarized method/class-level drain (shared by the completed AND the
 * "still running" partial-snapshot envelopes). */
interface SummarizedResults {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  details: { class: string; method: string; status: string; duration: number; message: string }[];
  classLevelErrors: string[];
}

/**
 * Transform accumulated Atelier result rows into this tool's documented
 * shape. Extracted (Story 36.1) so the identical transform can be reused for
 * BOTH a completed run and a "running" envelope's `partial` snapshot,
 * without duplicating the counting/restoration logic. Behavior is
 * UNCHANGED from the pre-36.1 inline version except the ledger `34-5-R3`
 * (return leg) fix noted below (AC 36.1.12 (b)) — sanctioned as one of the
 * two edits AC 36.1.1 permits outside the poll loop's own lines.
 */
function summarizeAtelierResults(results: AtelierTestResult[]): SummarizedResults {
  const statusMap: Record<number, string> = { 0: "failed", 1: "passed", 2: "skipped" };
  let total = 0,
    passed = 0,
    failed = 0,
    skipped = 0;
  const details: SummarizedResults["details"] = [];
  // Diagnostics carried by class-level (summary) rows — rows with no
  // `method`. Normally these are a harmless per-class roll-up and are
  // dropped, but the runner ALSO uses them to report a failure that
  // prevented any method from running at all (verified live on HSCUSTOM
  // 2026.1 Build 235U: a `%UnitTest.TestCase` subclass whose
  // `OnBeforeAllTests` returns an error drains exactly one row —
  // `{class, status: 0, failures: [], error: "OnBeforeAllTests: ERROR
  // #5001: ..."}` — and no method rows at all). Capturing them here lets
  // the zero-result guard report WHY nothing ran instead of blaming the
  // caller's target name for a run that failed in setup.
  const classLevelErrors: string[] = [];

  for (const r of results) {
    // 34-5-R3 (return leg, AC 36.1.12 (b)): presence check, not truthiness.
    // A method literally named `Test` restores to `r.method === ""` after
    // the Atelier endpoint's own prefix-stripping — a valid, PRESENT value
    // that the pre-36.1 `if (r.method)` truthiness check silently dropped,
    // collapsing it into the class-summary branch below and colliding with
    // the real class-summary row in the poll loop's accumulator key.
    if (r.method !== undefined) {
      total++;
      const status = statusMap[r.status] ?? "unknown";
      if (r.status === 1) passed++;
      else if (r.status === 0) failed++;
      else skipped++;

      const messages: string[] = [];
      if (r.error) messages.push(r.error);
      for (const f of r.failures ?? []) {
        if (f.message) messages.push(f.message);
      }

      details.push({
        class: r.class,
        method: fromAtelierMethodName(r.method),
        status,
        duration: r.duration,
        message: messages.join("; "),
      });
    } else if (r.error || r.status === 0) {
      // Class-level row reporting a run-level failure (see
      // `classLevelErrors` above). Kept out of the counts — it is not a
      // test method — but retained so the guard can surface it.
      classLevelErrors.push(
        r.error ? `${r.class}: ${r.error}` : `${r.class}: the test runner reported a class-level failure`,
      );
    }
    // Other class-level results are summary — we only report method-level details
  }

  return { total, passed, failed, skipped, details, classLevelErrors };
}

/**
 * Handler factory (Story 36.1 AC 36.1.7 testability seam) — see
 * {@link TestClock}'s banner. {@link executeTestsTool}'s exported `handler`
 * is `createExecuteTestsHandler()` (no argument, real clock); tests import
 * this factory directly to inject a deterministic fake.
 */
export function createExecuteTestsHandler(clock: TestClock = realClock): ToolDefinition["handler"] {
  return async (args, ctx) => {
    const { target, level, namespace, timeout } = args as {
      target: string;
      level: "package" | "class" | "method";
      namespace?: string;
      timeout?: number;
    };

    const ns = ctx.resolveNamespace(namespace);
    const { timeoutMs, timeoutCapped } = resolveTestTimeout(timeout, ctx.config.testTimeoutMs);

    // Run handles (AC 36.1.5/36.1.6) — outer-scoped so the transport-error
    // catch below can report whatever was captured before the failure.
    let jobId: string | undefined;
    let runIndex: number | null = null;
    let runIndexSource: "queue" | "counter" | null = null;
    let runIndexNote: string | undefined;
    // AC 36.1.12 (c) / 34-5-R4: the raw (as-typed) requested method name at
    // `level: "method"`, for the post-run mismatch check.
    let requestedMethodName: string | undefined;
    // Best-effort `^UnitTest.Result` counter snapshot, read BEFORE `POST
    // /work` (AC 36.1.5) — see MAX_CAPTURE_READ_FAILURES's banner.
    let counterBefore: number | undefined;
    // Accumulated drains (see the poll loop below) — outer-scoped so the
    // transport-error catch can report the rows drained before the failure.
    const accumulated = new Map<string, AtelierTestResult>();

    const currentHandles = (): RunHandles => ({
      ...(jobId !== undefined ? { jobId } : {}),
      ...(jobId !== undefined ? { runIndex, runIndexSource } : {}),
      ...(runIndexNote ? { runIndexNote } : {}),
    });
    const partialSnapshot = (): PartialSnapshot => {
      const s = summarizeAtelierResults([...accumulated.values()]);
      return { total: s.total, passed: s.passed, failed: s.failed, skipped: s.skipped, details: s.details };
    };

    try {
      // Build the tests array for the Atelier async unittest request
      let tests: { class: string; methods?: string[] }[];

      if (level === "package") {
        // Discover all %UnitTest.TestCase subclasses in the package
        tests = await discoverPackageTests(ctx, ns, target);
        if (tests.length === 0) {
          return zeroResultGuardResponse(`No test classes found in package '${target}'`);
        }
      } else if (level === "class") {
        tests = [{ class: target }];
      } else {
        // method level: "ClassName:MethodName" (AC 36.1.12 (a), ledger
        // `34-5-R2`): trim segments; reject more than one ':' separator or
        // an empty class segment with an explicit malformed-target error,
        // distinct from the zero-result guard. The Story 34.5-pinned edges
        // are UNCHANGED: no ':' at all (whole class runs unfiltered) and a
        // single trailing ':' with an empty method part (also runs the
        // whole class unfiltered, guarded generically by the zero-result
        // check below on a genuine zero-match) — neither is "malformed" by
        // this check, only >1 colon or an empty class segment are.
        const segments = target.split(":");
        if (segments.length > 2) {
          return zeroResultGuardResponse(
            `Malformed method-level target '${target}': at most one ':' separator is allowed (got ${segments.length - 1}).`,
          );
        }
        const className = (segments[0] ?? "").trim();
        if (className === "") {
          return zeroResultGuardResponse(
            `Malformed method-level target '${target}': the class segment before ':' must not be empty.`,
          );
        }
        const rawMethodName = segments.length > 1 ? segments[1] : undefined;
        const methodName = rawMethodName !== undefined ? rawMethodName.trim() : undefined;
        const testEntry: { class: string; methods?: string[] } = { class: className };
        if (methodName) {
          testEntry.methods = [toAtelierMethodFilter(methodName)];
          requestedMethodName = methodName;
        }
        tests = [testEntry];
      }

      // Ensure ^UnitTestRoot is defined in the target namespace. The
      // Atelier /work unittest endpoint silently crashes the response
      // serializer (%Api.Atelier.v8::UnitTestResultToJSON) with a
      // <SUBSCRIPT> error when ^UnitTestRoot is undefined, even with the
      // /noload qualifier. The bootstrap only ensures this in the
      // configured namespace; this per-call ensure covers any target
      // namespace the tool is invoked against. Wrapped in its own try/catch
      // so an ensure failure (e.g., Setup class not deployed in target ns)
      // does not block the test attempt — the user may have set the global
      // manually already.
      try {
        await ensureUnitTestRoot(ctx.http, ns, ctx.atelierVersion);
      } catch {
        // Fall through — the subsequent /work call will surface any real
        // missing-global error in its response if the global is still unset.
      }

      // AC 36.1.5: the counter "before" snapshot is taken BEFORE queueing, so
      // it can never already include this job's own allocation (see
      // MAX_CAPTURE_READ_FAILURES's banner). Best-effort — `undefined` if the
      // read fails, in which case no counter attribution is attempted.
      counterBefore = await readUnitTestCounter(ctx, ns);

      // Queue the async unittest request via Atelier work endpoint
      const workPath = atelierPath(ctx.atelierVersion, ns, "work");
      const queueResp = await ctx.http.post<Record<string, unknown>>(workPath, {
        request: "unittest",
        tests,
        console: false,
      });

      const queueResult = queueResp.result as Record<string, unknown>;
      jobId = (queueResult?.location ?? (queueResult?.content as Record<string, unknown>)?.location) as
        | string
        | undefined;
      if (!jobId) {
        return zeroResultGuardResponse("Failed to queue test execution — no job ID returned");
      }

      // Poll for results with timeout
      const pollPath = atelierPath(ctx.atelierVersion, ns, `work/${jobId}`);
      const startTime = clock.now();
      const deadline = startTime + timeoutMs;
      let testResults: AtelierTestResult[] | undefined;

      // Accumulate results across polls. The Atelier /work/{id} endpoint
      // signals "job still running" with a Retry-After header, and each GET
      // DRAINS the results accumulated since the previous GET (delta
      // semantics — verified live 2026-07-09: a 5-method class delivered its
      // methods spread across successive polls, each drain carrying only the
      // newly-finished ones). Two historical bugs guard this loop's shape:
      //  - Accepting the FIRST non-empty drain as final truncates the run to
      //    whichever methods finished before that poll (a 41-method class
      //    reported as total=2 with a green envelope — silent under-report).
      //  - Keeping only the LAST drain discards every earlier drain (same
      //    truncation, different subset).
      // So: collect EVERY poll's chunk into a map (keyed by class::method —
      // also correct if the endpoint ever returns cumulative sets, since the
      // key dedupes repeats), and finalize only when Retry-After is absent.
      // (`accumulated` itself is declared above the try block so the
      // transport-error catch can report the drained-so-far rows.)
      // 34-5-R3 (return leg, AC 36.1.12 (b)): presence check, not
      // truthiness — see summarizeAtelierResults' matching fix.
      const resultKey = (r: AtelierTestResult): string =>
        r.method !== undefined ? `${r.class}::${r.method}` : `class-summary::${r.class}`;

      let captureReadFailures = 0;

      while (clock.now() < deadline) {
        const pollResp = await ctx.http.get<unknown>(pollPath);
        const pollResult = pollResp.result;
        const pollEnvelope = pollResp as unknown as Record<string, unknown>;
        const hasRetry = !!pollEnvelope.retryafter;

        // Collect whatever this poll carried (a partial drain while running,
        // or the final drain on the terminal poll). Both array and
        // { content: [...] } shapes are seen from the endpoint.
        let chunk: AtelierTestResult[] = [];
        if (Array.isArray(pollResult)) {
          chunk = pollResult as AtelierTestResult[];
        } else {
          const resultObj = pollResult as Record<string, unknown> | undefined;
          if (Array.isArray(resultObj?.content)) {
            chunk = resultObj!.content as AtelierTestResult[];
          }
        }
        for (const r of chunk) {
          accumulated.set(resultKey(r), r);
        }

        if (!hasRetry) {
          // No Retry-After → the job has COMPLETED. Everything has been
          // drained into the accumulator; finalize (may be empty — tests
          // ran but produced no results).
          testResults = [...accumulated.values()];
          break;
        }

        // Job still running (AC 36.1.5 per-iteration run-index read —
        // additions only; this does not alter how a drain is collected,
        // keyed, or finalized above). Attempted from the FIRST still-running
        // poll until captured; the node is keyed by OUR jobId, so it can
        // never name another client's run. See MAX_CAPTURE_READ_FAILURES.
        if (runIndexSource === null && captureReadFailures < MAX_CAPTURE_READ_FAILURES) {
          const node = await readGlobalNode(ctx, ns, "IRIS.TempAtelierAsyncQueue", `${jobId},"unittest","id"`);
          if (node === undefined) {
            captureReadFailures++;
          } else {
            captureReadFailures = 0;
            if (node.defined) {
              const parsed = Number(node.value);
              if (Number.isFinite(parsed)) {
                runIndex = parsed;
                runIndexSource = "queue";
              }
            }
          }
        }

        // Job still running — wait and re-poll for the next drain.
        await clock.sleep(TEST_POLL_INTERVAL);
      }

      if (!testResults) {
        // Wait budget expired with the job still running (AC 36.1.3). The
        // counter fallback is deliberately NOT applied here (`36-1-QA-1`):
        // this job's worker may not have allocated its index yet, so a
        // counter delta of 1 could be another client's run.
        if (runIndexSource === null) {
          runIndexNote =
            captureReadFailures >= MAX_CAPTURE_READ_FAILURES
              ? `Run index not captured: reading IRIS.TempAtelierAsyncQueue(${jobId},"unittest","id") via the ` +
                `ExecuteMCPv2 /global route failed repeatedly. Re-attach by jobId (see hint).`
              : `Run index not yet allocated/captured: the async worker had not published it to ` +
                `IRIS.TempAtelierAsyncQueue(${jobId},"unittest","id") when the wait budget expired. It is never ` +
                `inferred from the ^UnitTest.Result counter while the run is executing (a concurrent run could ` +
                `be counted instead). Re-attach by jobId (see hint).`;
        }
        return testRunEnvelope({
          kind: "running",
          handles: { jobId, runIndex, runIndexSource, ...(runIndexNote ? { runIndexNote } : {}) },
          elapsedMs: clock.now() - startTime,
          timeoutMs,
          timeoutCapped,
          target,
          level,
          namespace: ns,
          partial: partialSnapshot(),
        });
      }

      // Counter-delta fallback (AC 36.1.5) — COMPLETED runs only, and only
      // when the queue-node capture never succeeded (a fast run can finish
      // on its first poll, whose response is sent after the node is killed).
      if (runIndexSource === null) {
        const attribution = attributeRunIndexByCounter(
          counterBefore,
          await readUnitTestCounter(ctx, ns),
          accumulated.size > 0,
        );
        runIndex = attribution.runIndex;
        runIndexSource = attribution.runIndexSource;
        runIndexNote = attribution.runIndexNote;
      }

      const summarized = summarizeAtelierResults(testResults);
      const { total, passed, failed, skipped, details, classLevelErrors } = summarized;

      // AC 34.5.3 (34-4-R10): `package` partially guards a zero-match run via
      // the discovery-time check above (empty `tests` array). `class` and
      // `method` have no discovery step at all — the target is trusted and
      // handed straight to the /work queue — so a typo'd class or method name, or
      // a `ClassName:MethodName` spec the endpoint doesn't match, drains
      // zero method-level rows and would otherwise report `total: 0,
      // passed: 0, failed: 0` with no error field, indistinguishable from a
      // genuine clean run on an intentionally-empty test class. Mirror the
      // package-level guard's shape exactly — both call zeroResultGuardResponse,
      // which since AC 34.6.4 also carries `isError: true` and `structuredContent`
      // (see that helper's banner) — so a typo is never mistaken for success and
      // is machine-detectable by both `isError`- and `structuredContent`-reading
      // consumers.
      //
      // The guard applies at ALL THREE levels (AC 34.5.4). `package`'s
      // pre-existing discovery-time check only covers "the package contains
      // no test classes"; a package whose classes ARE discovered but whose
      // run drains zero method rows fell through to the same silent
      // `total: 0` (confirmed live against a package of two real
      // `%UnitTest.TestCase` subclasses that produce no method rows).
      //
      // When the runner told us WHY nothing ran (a class-level failure row —
      // a setup/`OnBeforeAllTests` error), report that reason instead of
      // "No tests found": the tests were found, the run failed. Blaming the
      // target name for a setup failure is the same lying-verification-
      // surface defect this story exists to close.
      if (total === 0) {
        const reason =
          classLevelErrors.length > 0
            ? `Test run for '${target}' at level '${level}' produced no method-level results — ${classLevelErrors.join("; ")}`
            : `No tests found for '${target}' at level '${level}'`;
        return zeroResultGuardResponse(reason, currentHandles());
      }

      // AC 36.1.12 (c) / 34-5-R4: at level "method", verify the drained
      // rows' restored names actually match what was requested. The
      // Atelier endpoint's Test-prefix-stripped filter is many-to-one
      // (`Class:Validate` and `Class:TestValidate` both send filter
      // "Validate"), so a caller who omits the documented "Test" prefix can
      // silently execute a DIFFERENTLY-named method and see a normal-looking
      // passing result. Report the mismatch explicitly rather than staying
      // silent about it.
      let methodMismatchWarning: string | undefined;
      if (level === "method" && requestedMethodName && details.length > 0) {
        const distinctActual = [...new Set(details.map((d) => d.method))];
        if (!distinctActual.every((name) => name === requestedMethodName)) {
          methodMismatchWarning =
            `Requested method '${requestedMethodName}' does not match the method(s) actually returned ` +
            `(${distinctActual.join(", ")}). The Atelier endpoint's Test-prefix-stripped filter can match a ` +
            `differently-named method when the requested name's stripped form collides with another method's ` +
            `— verify the correct method ran.`;
        }
      }

      return testRunEnvelope({
        kind: "completed",
        summary: { total, passed, failed, skipped, details },
        handles: { jobId, runIndex, runIndexSource, ...(runIndexNote ? { runIndexNote } : {}) },
        timeoutCapped,
        ...(methodMismatchWarning ? { methodMismatchWarning } : {}),
      });
    } catch (error: unknown) {
      // Once a job exists server-side, a transport failure while POLLING it
      // (an HTTP error — IrisApiError — or a network/per-request timeout —
      // IrisConnectionError) says nothing about the run itself, which may
      // still be executing. Never lose the handle (architecture L1: return
      // every handle held; AC 36.1.6): report it with the drained-so-far rows
      // and the do-not-re-submit / re-attach guidance.
      if (jobId !== undefined && (error instanceof IrisApiError || error instanceof IrisConnectionError)) {
        return testRunEnvelope({
          kind: "error",
          error: `Error executing tests for '${target}': ${error.message}`,
          handles: currentHandles(),
          partial: partialSnapshot(),
          hint: buildRunningHint(
            `This error came from polling job ${jobId}, not from the test run — the run may still be executing server-side.`,
            jobId,
            runIndex,
          ),
        });
      }
      if (error instanceof IrisApiError) {
        return zeroResultGuardResponse(
          `Error executing tests for '${target}': ${error.message}`,
          currentHandles(),
        );
      }
      throw error;
    }
  };
}

export const executeTestsTool: ToolDefinition = {
  name: "iris_execute_tests",
  title: "Execute Tests",
  description:
    "Run ObjectScript unit tests at package, class, or method level with structured results. " +
    "Uses the Atelier async work queue. Default wait budget: 120 seconds — override per-call with " +
    "`timeout` (seconds) or set the IRIS_TEST_TIMEOUT environment variable (precedence: `timeout` " +
    "argument > IRIS_TEST_TIMEOUT > 120s default; hard-capped at 3600s, and a larger value is silently " +
    "clamped with `timeoutCapped: true` in the response). MCP clients impose their OWN `tools/call` " +
    "ceiling independently of this budget (the MCP TypeScript SDK defaults to 60 seconds; several " +
    "clients cap at 60s-2min, not always configurable) — a long synchronous wait may be abandoned by " +
    "the CLIENT even while the run keeps executing server-side, so a large `timeout` is a convenience, " +
    "not a guarantee. If the wait budget expires while the run is STILL EXECUTING, the tool returns " +
    "`isError: false` with `status: \"running\"`, the run's `jobId` and (once populated) `runIndex`, " +
    "and a `partial` snapshot of whatever has drained so far under a `partial.total`/etc — this is NOT " +
    "a failure and NOT a final result. Do NOT re-submit the same target on a running result — that " +
    "starts a SECOND concurrent run against shared fixtures. Re-attach instead (the response's `hint` " +
    "carries the exact calls): today, `iris_global_get` on `IRIS.TempAtelierAsyncQueue(<jobId>,\"unittest\",\"id\")` " +
    "for the runIndex, then `iris_sql_execute` over `%UnitTest_Result` — only `TestInstance` carries the " +
    "`InstanceIndex` column, so join `TestMethod` → `TestCase` → `TestSuite` → `TestInstance` and filter " +
    "`ti.InstanceIndex = <runIndex>` (never MAX(InstanceIndex) — a concurrent run can allocate a higher " +
    "index first); the rows exist while the run is still executing, so treat them as final only once " +
    "`TestInstance.DateTime` is set. A dedicated re-attach tool is forthcoming. A " +
    "completed run also carries `status: \"completed\"`, `jobId`, `runIndex`, and `runIndexSource` " +
    "(\"queue\", or \"counter\" for a completed run whose queue node was never observed) so results can be " +
    "correlated by handle instead of guessed at; when the index cannot be attributed it is null with a " +
    "`runIndexNote` saying why. Concurrency caveat: two runs of the SAME class started close together " +
    "share that class's fixtures, AND the Atelier endpoint predicts each run's index before " +
    "%UnitTest.Manager actually allocates it — a race between near-simultaneous submissions can " +
    "misattribute a run's own index. Returns total, passed, failed, skipped counts and per-test details.",
  inputSchema: z.object({
    target: z
      .string()
      .describe(
        "Test target: package name (e.g., 'MyApp.Tests'), class name (e.g., 'MyApp.Tests.UtilsTest'), " +
          "or class:method (e.g., 'MyApp.Tests.UtilsTest:TestSomething')",
      ),
    level: z
      .enum(["package", "class", "method"])
      .describe("Granularity of test execution"),
    timeout: z
      .coerce.number()
      .positive()
      .optional()
      .describe(
        "Maximum time to wait for results, in SECONDS, before returning a 'running' result instead of " +
          "blocking further (default: 120, or IRIS_TEST_TIMEOUT if set; hard-capped at 3600s — a larger " +
          "value is silently clamped and the response carries timeoutCapped:true). MCP clients impose " +
          "their own tools/call ceiling independently of this value (commonly 60s, not all configurable) " +
          "— a long wait may be abandoned by the client before this budget elapses. Treat the " +
          "running-result-plus-re-attach contract as the robust path for a genuinely slow suite, not a " +
          "large timeout value.",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: createExecuteTestsHandler(),
};

// ── iris_execute_classmethod ────────────────────────────────────

/**
 * Ensure a value is a record suitable for MCP `structuredContent` (never a
 * bare array). Local copy — mirrors `iris-data-mcp/docdb.ts`'s `toStructured`;
 * there is no shared exported version (each server keeps its own copy per
 * [[feedback_mcp_structured_content]]). The `/classmethod` endpoint always
 * returns a JSON object today, but every response on this surface is routed
 * through the same discipline as a matter of policy, not because a concrete
 * array-shaped response has been observed.
 */
function toStructured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { items: value, count: value.length };
  }
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return { value };
}

export const executeClassMethodTool: ToolDefinition = {
  name: "iris_execute_classmethod",
  title: "Execute Class Method",
  description:
    "Invoke an ObjectScript class method by name with optional positional arguments. " +
    "Supports up to 20 arguments. Each entry in `args` is either a plain scalar " +
    "(string, number, or boolean), passed by value, or a `{byRef: true, value?}` " +
    "marker object, passed by reference — use this for `ByRef`/`Output` parameters. " +
    "Omit `value` entirely for Output-style undefined-in (e.g. `{\"byRef\": true}`); " +
    "`value` may not be JSON null or a non-scalar. The `byRef` flag controls only " +
    "whether the position's post-call value is reported back in `byRefValues` — every " +
    "position is bound by reference to the target regardless of the flag, so " +
    "`byRef: false` does not protect a plain scalar argument from being mutated by a " +
    "target that happens to assign it; it only means that mutation is not read back. " +
    "The response's `argCount` field is unchanged from prior versions of this tool. " +
    "`returnValue`, `byRefValues`, and `output` (any text the target wrote to the " +
    "current device via Write during the call — no wrapper class is needed for methods " +
    "that narrate, run stock tools like %UnitTest.Manager.RunTest, or switch namespace " +
    "mid-execution) TOGETHER share ONE 32768-RAW-CHARACTER response budget — measured " +
    "BEFORE JSON escaping, not the serialized wire size; metacharacter-heavy content " +
    "(quotes, backslashes, tabs, control characters) can serialize to a much larger " +
    "wire size for the same raw-character count — a single 32768-character field of C0 " +
    "control characters (each costing a 6-character \\uXXXX escape) measured 196,495 " +
    "serialized characters, roughly 6x the raw ceiling and about 3.9x past the " +
    "~50,000-character point at which some MCP clients divert inline results to a file. " +
    "The budget is spent in this field " +
    "order: `returnValue` first (so the method's actual result is never starved by " +
    "narration), then `byRefValues`, then `output` last (narration is usually the " +
    "field that actually exceeds the budget, so it usually absorbs the truncation). " +
    "Whatever a field does not use is available to the next field in that order — a " +
    "small `returnValue` leaves nearly the whole 32768 for `byRefValues`/`output`, " +
    "while a `returnValue` alone longer than 32768 characters consumes the ENTIRE " +
    "budget, leaving nothing for the other two. Truncated content is cut off and " +
    "replaced with a structured, machine-detectable elision marker " +
    "(`[IRIS-MCP-TRUNCATED ceiling=<N>chars]`, where `<N>` is however much of the " +
    "shared budget remained for that field at that point — not always 32768 — never a " +
    "bare '...'), EXCEPT when the remaining budget is smaller than the marker itself " +
    "(~37-41 characters), in which case the field is a plain hard-cut prefix with NO " +
    "marker and the `truncated`/`byRefTruncated` flag is the only signal — so the " +
    "absence of a marker is not proof a field is complete. `byRefValues` (an object " +
    "keyed by zero-based position index, present " +
    "only for marked positions whose target-side local ended up defined — a plain " +
    "scalar out-value is the raw value, and an idiomatic subscripted Output array is a " +
    "nested {value?, subscripts?} object) is ADDITIONALLY bounded by its own 1000-node " +
    "structural ceiling, independent of (and on top of) the shared character budget " +
    "above. The shared character budget is charged for every piece of `byRefValues` " +
    "content emitted — leaf values, `<Object:...>` placeholders, and subscript keys — " +
    "but not for the per-node JSON scaffolding, which the 1000-node ceiling bounds " +
    "instead. Once either budget is exhausted, further subscript entries are omitted " +
    "from the affected node (marked `subscriptsTruncated: true`), and a marked " +
    "position reached after the shared budget is already gone is OMITTED from " +
    "`byRefValues` entirely. A position reached with budget still remaining, but whose " +
    "value does not fit in what remains, is cut " +
    "short in one of two ways: with the elision marker described above when there is " +
    "room for the marker itself, or — when the remaining budget is smaller than " +
    "the marker (under ~40 characters) — as a plain unmarked prefix of the real value, " +
    "since emitting the marker there would replace a value with something larger than " +
    "itself. In that last case `byRefTruncated` is the ONLY signal: the value carries no " +
    "marker of its own, so do not treat the absence of a marker as proof a byRef value " +
    "is complete. `truncated` (boolean — true whenever `output` does not contain " +
    "everything the target wrote, whether because it hit the shared budget or " +
    "the platform's long-string ceiling mid-call; the call still succeeds with a partial " +
    "capture, and this never happens silently); `returnValueTruncated` (boolean — true " +
    "whenever `returnValue` was cut short by the shared budget, reported separately since it " +
    "describes a different response field); and `byRefTruncated` (boolean — true " +
    "whenever `byRefValues`' node budget or its share of the shared character budget was " +
    "exhausted, reported separately from " +
    "`truncated` since they describe different response fields). None of these ceilings " +
    "are protection against the target's own execution time, resource usage, or a Web " +
    "Gateway timeout — the target has already fully run by the time these caps are " +
    "applied to the response payload.",
  inputSchema: z.object({
    className: z
      .string()
      .describe("Fully qualified class name (e.g., 'MyPackage.MyClass')"),
    methodName: z
      .string()
      .describe("Name of the class method to invoke"),
    args: z
      .array(z.any())
      .max(20)
      .optional()
      .describe(
        "Positional arguments as a JSON array (max 20). Each entry is either a plain " +
          "scalar — string, number, or boolean, passed by value (e.g. [\"hello\", 42, " +
          "true]) — or a {byRef: true, value?} marker object for a ByRef/Output " +
          "parameter, whose post-call value is returned in the response's byRefValues " +
          "(e.g. [{\"byRef\": true}, {\"byRef\": true, \"value\": \"start\"}]). A " +
          "marker's value may be omitted (undefined-in, the Output pattern) but not " +
          "JSON null, and must be a scalar, not an object or array.",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { className, methodName, args: methodArgs, namespace } = args as {
      className: string;
      methodName: string;
      args?: unknown[];
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    const body: Record<string, unknown> = {
      className,
      methodName,
      namespace: ns,
    };
    if (methodArgs && methodArgs.length > 0) {
      body.args = methodArgs;
    }

    const path = `${BASE_URL}/classmethod`;

    try {
      const response = await ctx.http.post(path, body);
      const result = response.result;
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        // AC 34.5.1 (34-4-R4): same additive surfacing as `iris_execute_command`.
        const truncated = extractTruncated(error.result);
        return {
          content: [
            {
              type: "text",
              text: `Error executing class method '${className}.${methodName}': ${error.message}`,
            },
          ],
          ...(truncated !== undefined ? { structuredContent: { truncated } } : {}),
          isError: true,
        };
      }
      throw error;
    }
  },
};
