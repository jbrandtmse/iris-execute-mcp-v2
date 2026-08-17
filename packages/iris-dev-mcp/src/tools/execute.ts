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

/** Maximum time to wait for test results (ms). */
const TEST_POLL_TIMEOUT = 120_000;
/** Delay between poll requests (ms). */
const TEST_POLL_INTERVAL = 200;

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
 */
function zeroResultGuardResponse(error: string): ToolResult {
  const structured = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    details: [] as { class: string; method: string; status: string; duration: number; message: string }[],
    error,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
    isError: true,
  };
}

export const executeTestsTool: ToolDefinition = {
  name: "iris_execute_tests",
  title: "Execute Tests",
  description:
    "Run ObjectScript unit tests at package, class, or method level with structured results. " +
    "Uses the Atelier async work queue for reliable execution. " +
    "Returns total, passed, failed, skipped counts and per-test details.",
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
  handler: async (args, ctx) => {
    const { target, level, namespace } = args as {
      target: string;
      level: "package" | "class" | "method";
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

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
        // method level: "ClassName:MethodName"
        const [className, methodName] = target.split(":");
        const testEntry: { class: string; methods?: string[] } = { class: className! };
        if (methodName) testEntry.methods = [toAtelierMethodFilter(methodName)];
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

      // Queue the async unittest request via Atelier work endpoint
      const workPath = atelierPath(ctx.atelierVersion, ns, "work");
      const queueResp = await ctx.http.post<Record<string, unknown>>(workPath, {
        request: "unittest",
        tests,
        console: false,
      });

      const queueResult = queueResp.result as Record<string, unknown>;
      const jobId = (queueResult?.location ?? (queueResult?.content as Record<string, unknown>)?.location) as string | undefined;
      if (!jobId) {
        return {
          content: [{ type: "text", text: "Error: Failed to queue test execution — no job ID returned" }],
          isError: true,
        };
      }

      // Poll for results with timeout
      const pollPath = atelierPath(ctx.atelierVersion, ns, `work/${jobId}`);
      const deadline = Date.now() + TEST_POLL_TIMEOUT;
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
      const accumulated = new Map<string, AtelierTestResult>();
      const resultKey = (r: AtelierTestResult): string =>
        r.method ? `${r.class}::${r.method}` : `class-summary::${r.class}`;

      while (Date.now() < deadline) {
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

        // Job still running — wait and re-poll for the next drain.
        await new Promise((resolve) => setTimeout(resolve, TEST_POLL_INTERVAL));
      }

      if (!testResults) {
        return {
          content: [{ type: "text", text: "Error: Test execution timed out" }],
          isError: true,
        };
      }

      // Transform Atelier results into our structured format
      const statusMap: Record<number, string> = { 0: "failed", 1: "passed", 2: "skipped" };
      let total = 0, passed = 0, failed = 0, skipped = 0;
      const details: { class: string; method: string; status: string; duration: number; message: string }[] = [];
      // Diagnostics carried by class-level (summary) rows — rows with no
      // `method`. Normally these are a harmless per-class roll-up and are
      // dropped, but the runner ALSO uses them to report a failure that
      // prevented any method from running at all (verified live on HSCUSTOM
      // 2026.1 Build 235U: a `%UnitTest.TestCase` subclass whose
      // `OnBeforeAllTests` returns an error drains exactly one row —
      // `{class, status: 0, failures: [], error: "OnBeforeAllTests: ERROR
      // #5001: ..."}` — and no method rows at all). Capturing them here lets
      // the zero-result guard below report WHY nothing ran instead of
      // blaming the caller's target name for a run that failed in setup.
      const classLevelErrors: string[] = [];

      for (const r of testResults) {
        if (r.method) {
          // Method-level result
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
        return zeroResultGuardResponse(reason);
      }

      const result = { total, passed, failed, skipped, details };
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing tests for '${target}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
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
