/**
 * `iris_test_coverage` -- line coverage of unit test runs (Story 40.1).
 *
 * Runs the tests of a `target` while an IRIS Line-by-Line session measures the INT routines of the listed
 * `classes`, then reports per-routine coverage. The run is owned by two IRIS-side jobs (a runner that runs the
 * tests and a supervisor that enforces cancel and the time limit and releases the monitor, AD-27); this module
 * only starts it, polls it and turns the raw data the IRIS side records into coverage (AD-12): the IRIS side
 * returns each routine's line counts and a token skeleton per INT line, and {@link isExecutableSkeleton} decides
 * which lines count as executable.
 *
 * The tool follows AD-16: when the wait budget expires while the run is still executing it returns
 * `status: "running"` with every handle it holds, and the companion `iris_test_status` re-attaches through
 * `coverageRunId` ({@link pollCoverageRun}, {@link cancelCoverageRun}); {@link coverageRunEnvelope} builds every
 * result both tools return, so a poll reproduces the primary call's result.
 *
 * It is a governed write (`mutates: "write"`, default-DISABLED, Rule #28): it starts an instance-wide monitor
 * session, runs test code and prunes its own older run records. Test counts come from `%UnitTest_Result` by
 * `runIndex` in the run's namespace, through the helpers of `unit-test-results.ts` that `iris_test_status` uses.
 */

import {
  IrisApiError,
  IrisConnectionError,
  REFUSAL_CODES,
  refusalResult,
  type ToolDefinition,
  type ToolResult,
  type ToolContext,
} from "@iris-mcp/shared";
import { createRequire } from "node:module";
import { z } from "zod";
import { buildCoberturaXml, validateOutputPath, writeCoberturaFile } from "./cobertura.js";
import {
  TEST_POLL_INTERVAL,
  realClock,
  resolveTestTimeout,
  type PartialSnapshot,
  type TestClock,
} from "./execute.js";
import {
  buildCompletedSummaryFromSql,
  buildInterimPartialFromSql,
  readClassLevelErrors,
  type SqlCtx,
} from "./unit-test-results.js";
import {
  classSourceCoverage,
  coverageTotals,
  coverageVerdict,
  formatRanges,
  mapSources,
  sourceTextLines,
  verdictTextLine,
  type ClassSource,
  type CoverageVerdict,
  type SourceTotals,
} from "./coverage-report.js";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";
const COVERAGE_ROUTE = `${BASE_URL}/dev/test/coverage`;

/** Sent on every start (Rule #10): the IRIS side requires both and has no default of its own. */
const MAX_RUN_SECONDS = 3600;
const MAX_MEASURED_LINES = 200000;

/** A class name the IRIS side accepts: no wildcards, no commas. */
export const CLASS_NAME_PATTERN = /^%?[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;
const RUN_ID_PATTERN = /^\d+$/;

/** How many times `cancel` reads the run after signalling it, and the gap between reads (milliseconds). */
const CANCEL_OBSERVATIONS = 10;
const CANCEL_OBSERVATION_GAP = 500;

// -- Raw data from the IRIS side -------------------------------------------------

export type CoverageStatus = "starting" | "running" | "completed" | "cancelled" | "failed" | "abandoned";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled", "failed", "abandoned"]);

/** One measured INT routine of a terminal run: its length, its lines with a count above 0, and its token skeleton. */
export interface CoverageRoutine {
  class: string;
  routine: string;
  lines: number;
  /** `[line, count]` for every line whose count is above 0. */
  hits: Array<[number, number]>;
  /** `[line, skeleton]` for every line that has a command; the other lines have no entry. */
  skeleton: Array<[number, string]>;
}

/** One method of a class in the class-source map: its declaration line and the INT line of each body line. */
export interface SourceMethodRaw {
  name: string;
  /** The class-document line that declares the method; `null` when it cannot be found. */
  line: number | null;
  /** The INT routine of the method's mapped lines; empty when none maps. Absent when the method has a `reason`. */
  routine?: string;
  /** `intLines[k-1]` is the INT line of body line k, or 0 when that line has none. Absent when the method has a `reason`. */
  intLines?: number[];
  /**
   * The INT line of the method's label, which is the first line of its INT block: its body maps to lines after it. 0 (or
   * absent, from an older IRIS-side class) when it is not known: the method compiled to no INT code, or its label cannot be
   * told from another method's. Absent when the method has a `reason`.
   */
  labelLine?: number;
  /** Why the method has no body map: `generator`, `not-objectscript` or `layout`. */
  reason?: string;
}

/** The class-source map of one measured class, as the IRIS side's Status route returns it. */
export interface SourceClassRaw {
  class: string;
  /**
   * Why the class has no map: `not-up-to-date` (its definition changed after it was compiled), `not-compiled` (it has no
   * compiled definition at the end of the run), or `unavailable` (its map could not be built). A class recorded without a
   * reason whose compiled line map is gone is reported as `not-up-to-date` too (`mapSources` in `coverage-report.ts`).
   */
  reason?: string;
  methods: SourceMethodRaw[];
}

/** A coverage run record, as the IRIS side's Status route returns it. */
export interface CoverageRun {
  coverageRunId: number;
  status: CoverageStatus;
  namespace: string;
  target: string;
  level: string;
  pid: number | null;
  runnerPid: number | null;
  startedAt: string;
  finishedAt: string | null;
  runIndex: number | null;
  reason?: string;
  error?: string;
  /** IRIS's text when the run's line counts could not be read. */
  readError?: string;
  releasedBy?: "runner" | "supervisor";
  cancelRequested: boolean;
  supervisorAlive: boolean;
  runnerAlive: boolean;
  unmeasured: Array<{ class: string; reason: string }>;
  reclaimed?: { coverageRunId: number; pid: number | null };
  routines?: CoverageRoutine[];
  /** The minimum the run was started with (0 to 100). */
  minCoverage?: number;
  /** The class-source map of each measured class; present exactly when `routines` is. */
  sources?: SourceClassRaw[];
}

/** The result of the Start route: a run record plus the outcome, or a refusal that holds no run. */
type StartResult = Partial<CoverageRun> & {
  outcome: "started" | "busy" | "failed";
  owner?: "suite" | "foreign";
  error?: string;
};

// -- Coverage arithmetic (AD-12: the rule and the arithmetic live here) ----------

/** Commands right after a label that are part of the label line, not code. */
const LABEL_KEYWORDS: ReadonlySet<string> = new Set(["methodimpl", "public", "private"]);

/** Commands the monitor never counts. */
const NEVER_COUNTED: ReadonlySet<string> = new Set(["try", "catch", "else", "e"]);

/**
 * Is an INT line executable, from its token skeleton? The skeleton is the line's tokens joined by single spaces:
 * `L` for a label, `C:<command in lower case>`, and `{` or `}`. A line with no skeleton (a comment, a blank line, a
 * lone brace) is not executable. Otherwise the first command that counts decides, and it is executable when found.
 * Never counted: the label keywords `methodimpl`, `public` and `private` right after the label, and the commands
 * `try`, `catch`, `else` and `e` (an `elseif` counts), and `do`/`d` followed by `{`. So `L C:methodimpl {` is not
 * executable, `L C:methodimpl { C:new` is, `} C:else {` is not, `} C:elseif {` is, and `C:e C:s` (a legacy
 * `e  s x=0` line) is.
 *
 * @param skeleton - The line's skeleton, or nothing for a line with no entry.
 */
export function isExecutableSkeleton(skeleton: string | undefined | null): boolean {
  if (!skeleton) return false;
  const tokens = skeleton.split(" ");
  let inLabelHeader = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] as string;
    if (token === "L") {
      inLabelHeader = true;
      continue;
    }
    if (!token.startsWith("C:")) continue;
    const command = token.slice(2);
    if (inLabelHeader && LABEL_KEYWORDS.has(command)) continue;
    inLabelHeader = false;
    if (NEVER_COUNTED.has(command)) continue;
    if ((command === "do" || command === "d") && tokens[index + 1] === "{") continue;
    return true;
  }
  return false;
}

/**
 * Inclusive `[start, end]` ranges, in ascending order, of the distinct line numbers in `lines`.
 *
 * @param lines - Line numbers, in any order, repeats allowed.
 */
export function toRanges(lines: Iterable<number>): Array<[number, number]> {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const line of sorted) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && line === last[1] + 1) {
      last[1] = line;
    } else {
      ranges.push([line, line]);
    }
  }
  return ranges;
}

/**
 * Covered share of executable lines: `round(covered / executable * 10000) / 100`, or `null` when there are none.
 *
 * @param covered - Executable lines with a count above 0.
 * @param executable - Executable lines.
 */
export function percentOf(covered: number, executable: number): number | null {
  if (executable === 0) return null;
  return Math.round((covered / executable) * 10000) / 100;
}

/** The coverage of one routine. Range lists are inclusive `[start, end]` pairs in ascending order. */
export interface RoutineCoverage {
  routine: string;
  lines: number;
  executableLines: number;
  coveredLines: number;
  percent: number | null;
  executableRanges: Array<[number, number]>;
  coveredRanges: Array<[number, number]>;
}

/**
 * Coverage of one routine: the executable lines are those whose skeleton {@link isExecutableSkeleton} accepts;
 * the covered lines are the executable lines with a count above 0. A line the monitor counts that is not
 * executable (such as a loop's closing brace) is ignored.
 *
 * @param routine - The routine's raw data.
 */
export function routineCoverage(routine: CoverageRoutine): RoutineCoverage {
  const counted = new Set<number>();
  for (const [line, count] of routine.hits) {
    if (count > 0) counted.add(line);
  }
  const executable: number[] = [];
  const covered: number[] = [];
  for (const [line, skeleton] of routine.skeleton) {
    if (!isExecutableSkeleton(skeleton)) continue;
    executable.push(line);
    if (counted.has(line)) covered.push(line);
  }
  return {
    routine: routine.routine,
    lines: routine.lines,
    executableLines: executable.length,
    coveredLines: covered.length,
    percent: percentOf(covered.length, executable.length),
    executableRanges: toRanges(executable),
    coveredRanges: toRanges(covered),
  };
}

/** Routines grouped by class, in the order the run listed them. */
export interface ClassCoverage {
  class: string;
  routines: RoutineCoverage[];
  /** The class-source coverage over the class document's lines (Story 40.2); present when the run has a source map. */
  source?: ClassSource;
}

export interface CoverageSection {
  /** True only for a completed run that recorded its counts. */
  complete: boolean;
  classes: ClassCoverage[];
  unmeasured: Array<{ class: string; reason: string }>;
  /** The class-source totals over the classes that have a result; present when the run has a source map. */
  source?: SourceTotals;
  /** The verdict against `minCoverage`; present on a completed run started with one. */
  verdict?: CoverageVerdict;
}

/**
 * The `coverage` object of a run: its measured routines grouped by class, and the classes it could not measure. When the
 * run has a class-source map it also carries each class's `source`, the totals as `source`, and, for a completed run
 * started with `minCoverage`, the `verdict`; a run without a map has exactly the 40.1 shape.
 */
export function buildCoverageSection(run: CoverageRun): CoverageSection {
  const byClass = new Map<string, RoutineCoverage[]>();
  for (const routine of run.routines ?? []) {
    const list = byClass.get(routine.class) ?? [];
    list.push(routineCoverage(routine));
    byClass.set(routine.class, list);
  }
  const classes: ClassCoverage[] = [...byClass.entries()].map(([className, routines]) => ({ class: className, routines }));
  const section: CoverageSection = {
    complete: run.status === "completed" && run.routines !== undefined,
    classes,
    unmeasured: run.unmeasured ?? [],
  };
  if (run.sources === undefined) return section;

  const sources = new Map(mapSources(run).map((mapped) => [mapped.class, classSourceCoverage(mapped)] as const));
  for (const entry of classes) entry.source = sources.get(entry.class) ?? { reason: "unavailable" };
  section.source = coverageTotals(classes.map((entry) => entry.source));
  if (run.status === "completed" && run.minCoverage !== undefined) {
    section.verdict = coverageVerdict(run.minCoverage, classes, section.unmeasured);
  }
  return section;
}

// -- Result envelopes --------------------------------------------------------------

const EM_DASH = "\u2014";

/** Executable lines that are not covered, as ranges. */
function uncoveredRanges(routine: RoutineCoverage): Array<[number, number]> {
  const covered = new Set<number>();
  for (const [start, end] of routine.coveredRanges) {
    for (let line = start; line <= end; line++) covered.add(line);
  }
  const uncovered: number[] = [];
  for (const [start, end] of routine.executableRanges) {
    for (let line = start; line <= end; line++) {
      if (!covered.has(line)) uncovered.push(line);
    }
  }
  return toRanges(uncovered);
}

/**
 * The compact text lines of the coverage: the verdict line when there is a verdict, one line per class over the class
 * document (and one indented line per method with an uncovered line), then one per routine and the classes that were
 * not measured. A run without a source map has only the last two kinds.
 */
function coverageTextLines(coverage: CoverageSection): string[] {
  const lines: string[] = [];
  if (coverage.verdict) lines.push(verdictTextLine(coverage.verdict));
  lines.push(...sourceTextLines(coverage.classes));
  for (const classCoverage of coverage.classes) {
    for (const routine of classCoverage.routines) {
      if (routine.executableLines === 0) {
        lines.push(`${routine.routine}: no executable INT lines`);
        continue;
      }
      const uncovered = uncoveredRanges(routine);
      lines.push(
        `${routine.routine}: ${routine.coveredLines} of ${routine.executableLines} executable INT lines covered ` +
          `(${routine.percent}%)${uncovered.length > 0 ? `; uncovered ${formatRanges(uncovered)}` : ""}`,
      );
    }
  }
  if (coverage.unmeasured.length > 0) {
    lines.push(`Not measured: ${coverage.unmeasured.map((entry) => `${entry.class} (${entry.reason})`).join(", ")}`);
  }
  return lines;
}

/**
 * The hint of a `running` result: do not re-submit, re-attach through the companion. It names tools and
 * arguments, never a route.
 *
 * @param coverageRunId - The run's handle.
 */
export function buildCoverageRunningHint(coverageRunId: number): string {
  return (
    `Still executing server-side. Do NOT re-submit - re-submitting is refused while this run holds the monitor, and ` +
    `would start a second run once it ends. Re-attach instead: call iris_test_status with action "poll" and ` +
    `coverageRunId "${coverageRunId}" (the run's own namespace is used, so no namespace is needed); it returns the ` +
    `same result this tool returns once the run is finished. Its "cancel" action (write, default-DISABLED by ` +
    `governance, enable it with IRIS_GOVERNANCE) stops the run and releases the monitor. If your tool-visibility ` +
    `preset hides iris_test_status, have the operator re-show it with IRIS_TOOLS_ENABLE=iris_test_status.`
  );
}

export interface CoverageEnvelopeInput {
  /** The run record (from the Status route). */
  run: CoverageRun;
  /**
   * The test summary read from `%UnitTest_Result` by `runIndex`: the final one for a completed run, an interim
   * snapshot for every other status.
   */
  summary: PartialSnapshot;
  /** The wait budget context only the primary call has. */
  elapsedMs?: number;
  timeoutMs?: number;
  /** True only when the primary call's `timeout` was clamped to the cap. */
  timeoutCapped?: boolean;
  /** Set for a completed run in which no test method ran: the reason, and the result is an error. */
  zeroResultError?: string;
  /** Free text about how this result was reached (for example, what a cancel observed). */
  note?: string;
}

function handleFields(run: CoverageRun): Record<string, unknown> {
  return { coverageRunId: run.coverageRunId, runIndex: run.runIndex ?? null };
}

function baseFields(run: CoverageRun): Record<string, unknown> {
  return {
    ...handleFields(run),
    namespace: run.namespace,
    target: run.target,
    level: run.level,
    pid: run.pid ?? null,
    runnerPid: run.runnerPid ?? null,
    startedAt: run.startedAt,
  };
}

/**
 * Every result `iris_test_coverage` and the coverage side of `iris_test_status` return, built from the run record
 * and the test summary. A sibling of `testRunEnvelope` (which is keyed by the Atelier `jobId`), not an extension
 * of it. The status decides the shape: `completed`, `running` (also `starting`), `cancelled`, `failed` and
 * `abandoned`. The text is compact: a status line, one line per routine, then the classes that were not measured.
 */
export function coverageRunEnvelope(input: CoverageEnvelopeInput): ToolResult {
  const { run, summary, note } = input;
  const id = run.coverageRunId;

  if (run.status === "running" || run.status === "starting") {
    const structured: Record<string, unknown> = {
      status: "running",
      ...baseFields(run),
      ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.timeoutCapped ? { timeoutCapped: true } : {}),
      ...(note ? { note } : {}),
      partial: summary,
      hint: buildCoverageRunningHint(id),
    };
    const firstLine = `COVERAGE RUN STILL EXECUTING ${EM_DASH} not finished, not failed. coverageRunId=${id}. Do NOT re-submit.`;
    return {
      content: [{ type: "text", text: `${firstLine}\n${structured.hint as string}` }],
      structuredContent: structured,
      isError: false,
    };
  }

  if (run.status === "abandoned") {
    const abandonedNote =
      note ??
      `Both processes of this run (the test process and its supervisor) are gone and the run never finished, so ` +
        `it will not complete. A monitor session it left behind is released when the next coverage run starts.`;
    const structured: Record<string, unknown> = {
      status: "abandoned",
      ...handleFields(run),
      namespace: run.namespace,
      note: abandonedNote,
    };
    return {
      content: [{ type: "text", text: `Coverage run ${id} abandoned. ${abandonedNote}` }],
      structuredContent: structured,
      isError: false,
    };
  }

  const coverage = buildCoverageSection(run);
  const coverageLines = coverageTextLines(coverage);

  if (run.status === "completed") {
    const structured: Record<string, unknown> = {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      details: summary.details,
      status: "completed",
      ...baseFields(run),
      finishedAt: run.finishedAt ?? null,
      coverage,
      ...(run.reclaimed ? { reclaimed: run.reclaimed } : {}),
      ...(input.timeoutCapped ? { timeoutCapped: true } : {}),
      ...(note ? { note } : {}),
      ...(input.zeroResultError ? { error: input.zeroResultError } : {}),
    };
    const firstLine = input.zeroResultError
      ? `Coverage run ${id} completed, but no test method ran: ${input.zeroResultError}`
      : `Coverage run ${id} completed: ${summary.total} tests, ${summary.passed} passed, ${summary.failed} failed, ` +
        `${summary.skipped} skipped.`;
    return {
      content: [{ type: "text", text: [firstLine, ...coverageLines].join("\n") }],
      structuredContent: structured,
      ...(input.zeroResultError ? { isError: true } : {}),
    };
  }

  if (run.status === "cancelled") {
    const structured: Record<string, unknown> = {
      status: "cancelled",
      ...baseFields(run),
      finishedAt: run.finishedAt ?? null,
      reason: run.reason ?? null,
      ...(run.error ? { error: run.error } : {}),
      ...(note ? { note } : {}),
      partial: summary,
      coverage,
      ...(run.reclaimed ? { reclaimed: run.reclaimed } : {}),
    };
    const firstLine =
      `Coverage run ${id} cancelled (${run.reason ?? "no reason recorded"}). The counts below are what the run ` +
      `reached; they are partial, not a result.`;
    return {
      content: [{ type: "text", text: [firstLine, ...coverageLines].join("\n") }],
      structuredContent: structured,
      isError: false,
    };
  }

  // failed: the test summary and any coverage that was read are still returned. `reason` is set when the run's
  // counts could not be read (`counts-unreadable`) or its monitor session could not be released (`release-failed`).
  const error = run.error ?? "The coverage run failed.";
  const structured: Record<string, unknown> = {
    status: "failed",
    ...handleFields(run),
    namespace: run.namespace,
    pid: run.pid ?? null,
    runnerPid: run.runnerPid ?? null,
    error,
    ...(run.reason ? { reason: run.reason } : {}),
    ...(run.readError ? { readError: run.readError } : {}),
    ...(run.runIndex !== null && run.runIndex !== undefined ? { partial: summary } : {}),
    ...(run.routines !== undefined ? { coverage } : {}),
  };
  return {
    content: [{ type: "text", text: [`Coverage run ${id} failed: ${error}`, ...coverageLines].join("\n") }],
    structuredContent: structured,
    isError: true,
  };
}

/** An error result that holds no run: a failed start, a bad handle, a bad argument, a transport failure. */
export function coverageErrorResult(text: string, fields: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: { error: text, ...fields },
    isError: true,
  };
}

// -- Reading a run --------------------------------------------------------------------

const EMPTY_SUMMARY: PartialSnapshot = { total: 0, passed: 0, failed: 0, skipped: 0, details: [] };

/** `GET` the run record. */
async function readRun(ctx: ToolContext, coverageRunId: string): Promise<CoverageRun> {
  const response = await ctx.http.get<CoverageRun>(`${COVERAGE_ROUTE}?id=${encodeURIComponent(coverageRunId)}`);
  return response.result;
}

function isTerminal(run: CoverageRun): boolean {
  return TERMINAL_STATUSES.has(run.status);
}

/** The error for a `coverageRunId` that is not all digits (the IRIS side allocates it with `$Increment`), or `undefined`. Nothing is sent. */
function invalidRunId(coverageRunId: string): ToolResult | undefined {
  if (RUN_ID_PATTERN.test(coverageRunId)) return undefined;
  return coverageErrorResult(
    `coverageRunId ${JSON.stringify(coverageRunId)} is not a coverage handle: it must be the all-digits id ` +
      `iris_test_coverage returned. Nothing was sent to IRIS.`,
  );
}

/**
 * Build the result for a run record: read its test summary from `%UnitTest_Result` by `runIndex` in the run's own
 * namespace (the final summary for a completed run, an interim one otherwise, zeros when no `runIndex` was
 * recorded), and apply the zero-result rule of `iris_execute_tests` to a completed run.
 */
async function resultForRun(
  ctx: SqlCtx,
  run: CoverageRun,
  context: Omit<CoverageEnvelopeInput, "run" | "summary" | "zeroResultError"> = {},
): Promise<ToolResult> {
  if (run.status === "abandoned") return coverageRunEnvelope({ run, summary: EMPTY_SUMMARY, ...context });
  const runIndex = run.runIndex;
  if (runIndex === null || runIndex === undefined) {
    if (run.status === "completed") {
      return coverageRunEnvelope({
        run,
        summary: EMPTY_SUMMARY,
        zeroResultError: `Coverage run ${run.coverageRunId} completed without recording a test run, so no test method ran.`,
        ...context,
      });
    }
    return coverageRunEnvelope({ run, summary: EMPTY_SUMMARY, ...context });
  }
  if (run.status !== "completed") {
    const partial = await buildInterimPartialFromSql(ctx, run.namespace, runIndex);
    return coverageRunEnvelope({ run, summary: partial, ...context });
  }
  const summary = await buildCompletedSummaryFromSql(ctx, run.namespace, runIndex);
  if (summary.total === 0) {
    const classLevelErrors = await readClassLevelErrors(ctx, run.namespace, runIndex);
    const zeroResultError =
      classLevelErrors.length > 0
        ? `Test run at runIndex ${runIndex} produced no method-level results ${EM_DASH} ${classLevelErrors.join("; ")}`
        : `Test run at runIndex ${runIndex} recorded no method-level results (no test method ran).`;
    return coverageRunEnvelope({ run, summary, zeroResultError, ...context });
  }
  return coverageRunEnvelope({ run, summary, ...context });
}

function isIrisError(error: unknown): error is IrisApiError | IrisConnectionError {
  return error instanceof IrisApiError || error instanceof IrisConnectionError;
}

/**
 * The error for a `namespace` that differs from the run's own, or `undefined` when they agree (or none was passed).
 * A coverage handle names the run's namespace itself, so the argument is only ever a cross-check.
 */
function namespaceMismatch(run: CoverageRun, namespace: string | undefined): ToolResult | undefined {
  if (namespace === undefined || namespace.toUpperCase() === run.namespace.toUpperCase()) return undefined;
  return coverageErrorResult(
    `coverageRunId ${run.coverageRunId} belongs to namespace ${run.namespace}, but namespace ${namespace} was passed. ` +
      `Omit namespace (the run's own is used), or pass ${run.namespace}.`,
    { coverageRunId: run.coverageRunId, namespace: run.namespace, requestedNamespace: namespace },
  );
}

/**
 * `iris_test_status` `poll` for a coverage run: read the run record by its handle alone and return the same result
 * `iris_test_coverage` returns for it. The test summary is read in the run's own namespace, whatever namespace the
 * caller's profile defaults to.
 *
 * @param ctx - The tool context.
 * @param args - `coverageRunId`, and a `namespace` that must agree with the run's when given.
 */
export async function pollCoverageRun(
  ctx: ToolContext,
  args: { coverageRunId: string; namespace?: string },
): Promise<ToolResult> {
  const invalid = invalidRunId(args.coverageRunId);
  if (invalid) return invalid;
  try {
    const run = await readRun(ctx, args.coverageRunId);
    const mismatch = namespaceMismatch(run, args.namespace);
    if (mismatch) return mismatch;
    return await resultForRun(ctx, run);
  } catch (error: unknown) {
    if (isIrisError(error)) {
      return coverageErrorResult(`Error reading coverage run ${args.coverageRunId}: ${error.message}`, {
        coverageRunId: Number(args.coverageRunId),
      });
    }
    throw error;
  }
}

/**
 * `iris_test_status` `cancel` for a coverage run: signal the run's supervisor, then read the run up to 10 times,
 * 500 ms apart, and report what was observed. Nothing here stops anything: the supervisor job terminates the test
 * process and releases the monitor. A run that is already finished is reported as it is.
 *
 * @param ctx - The tool context.
 * @param args - `coverageRunId`, and a `namespace` that must agree with the run's when given.
 * @param clock - The sleep seam (tests inject a fake).
 */
export async function cancelCoverageRun(
  ctx: ToolContext,
  args: { coverageRunId: string; namespace?: string },
  clock: TestClock = realClock,
): Promise<ToolResult> {
  const invalid = invalidRunId(args.coverageRunId);
  if (invalid) return invalid;
  try {
    let run = await readRun(ctx, args.coverageRunId);
    const mismatch = namespaceMismatch(run, args.namespace);
    if (mismatch) return mismatch;
    if (isTerminal(run)) {
      return await resultForRun(ctx, run, {
        note: `The run had already finished (${run.status}); there was nothing to cancel.`,
      });
    }
    await ctx.http.post(`${COVERAGE_ROUTE}/cancel`, { id: Number(args.coverageRunId) });
    let observations = 0;
    while (observations < CANCEL_OBSERVATIONS) {
      await clock.sleep(CANCEL_OBSERVATION_GAP);
      observations++;
      run = await readRun(ctx, args.coverageRunId);
      if (isTerminal(run)) break;
    }
    const note = isTerminal(run)
      ? `Cancel signalled; observed ${run.status} after ${observations} read(s).`
      : `Cancel signalled; the run was still ${run.status} after ${observations} reads ` +
        `${(observations * CANCEL_OBSERVATION_GAP) / 1000} s apart. Poll again with iris_test_status.`;
    return await resultForRun(ctx, run, { note });
  } catch (error: unknown) {
    if (isIrisError(error)) {
      return coverageErrorResult(
        `Error cancelling coverage run ${args.coverageRunId}: ${error.message} ${EM_DASH} whether the cancel took ` +
          `effect is unknown; poll the run with iris_test_status.`,
        { coverageRunId: Number(args.coverageRunId) },
      );
    }
    throw error;
  }
}

/** The `@iris-mcp/dev` version, for the Cobertura `version` attribute. */
function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("../../package.json") as { version: string }).version;
}

/** The error text for a `sourceRoot` that cannot be written into the document, or `undefined`. */
function invalidSourceRoot(sourceRoot: string | undefined): string | undefined {
  if (sourceRoot === undefined) return undefined;
  if (sourceRoot.length === 0) return "sourceRoot must not be empty";
  if ([...sourceRoot].some((character) => (character.codePointAt(0) as number) < 0x20 || character === "\u007F")) {
    return "sourceRoot must not contain control characters";
  }
  return undefined;
}

/**
 * `iris_test_status` `export` for a coverage run: write the run's Cobertura XML to `outputPath` and return the result
 * `poll` returns for it plus `cobertura: {outputPath, bytes, classes, lines}`. Only a completed run whose coverage is
 * complete, that ran at least one test and that has a class-source map with at least one class that has a class-source
 * result is written; for any other run, and for a path that is not acceptable, the result is an error and nothing is
 * written. A bad `outputPath` is refused before anything is sent
 * to IRIS. An existing file is overwritten.
 *
 * @param ctx - The tool context.
 * @param args - `coverageRunId`, an absolute `outputPath` ending in `.xml`, an optional `sourceRoot` (the document's one
 *   `<source>`), and a `namespace` that must agree with the run's when given.
 */
export async function exportCoverageRun(
  ctx: ToolContext,
  args: { coverageRunId: string; outputPath: string; sourceRoot?: string; namespace?: string },
): Promise<ToolResult> {
  const invalid = invalidRunId(args.coverageRunId);
  if (invalid) return invalid;
  const badPath = validateOutputPath(args.outputPath) ?? invalidSourceRoot(args.sourceRoot);
  if (badPath) return coverageErrorResult(`${badPath}. Nothing was sent to IRIS and nothing was written.`);
  const id = Number(args.coverageRunId);
  try {
    const run = await readRun(ctx, args.coverageRunId);
    const mismatch = namespaceMismatch(run, args.namespace);
    if (mismatch) return mismatch;
    const refuse = (why: string): ToolResult =>
      coverageErrorResult(`Coverage run ${id} cannot be exported: ${why} Nothing was written.`, {
        coverageRunId: id,
        status: run.status,
      });
    if (run.status !== "completed") {
      const advice =
        run.status === "starting" || run.status === "running"
          ? `Wait for it with iris_test_status (action "poll"), then export.`
          : "Run the tests again.";
      return refuse(`its status is ${run.status}, and only a completed run can be. ${advice}`);
    }
    const polled = await resultForRun(ctx, run);
    const coverage = buildCoverageSection(run);
    if (polled.isError) {
      return refuse(
        `it completed but no test method ran (status ${run.status}), so its coverage says nothing. Run the tests again.`,
      );
    }
    if (!coverage.complete) {
      return refuse(`its status is ${run.status} but its coverage is not complete. Run the tests again.`);
    }
    if (run.sources === undefined) {
      return refuse(
        `its status is ${run.status} but the instance returned no class-source data for it. Redeploy the IRIS-side ` +
          `classes (start any iris-mcp server against this instance) and run the tests again.`,
      );
    }

    const document = buildCoberturaXml(run, coverage, {
      version: packageVersion(),
      ...(args.sourceRoot !== undefined ? { sourceRoot: args.sourceRoot } : {}),
    });
    if (document.classes === 0) {
      return refuse(
        `no class has a class-source result, so the file would hold no lines and a CI tool would read it as fully covered. ` +
          `Recompile the classes (a forced compile when only comments changed) and run the tests again.`,
      );
    }
    if (document.lines === 0) {
      return refuse(
        `no class has an executable class line, so the file would hold no lines and a CI tool would read it as fully ` +
          `covered. List classes whose methods have ObjectScript code; if a class changed since it was compiled, recompile it ` +
          `(a forced compile when only comments changed) and run the tests again.`,
      );
    }
    let written: { outputPath: string; bytes: number };
    try {
      written = await writeCoberturaFile(args.outputPath, document.xml);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return coverageErrorResult(
        `The Cobertura file for coverage run ${id} could not be written: ${message}. Check that the path can be ` +
          `written. Nothing was written.`,
        { coverageRunId: id },
      );
    }
    const line = `Cobertura XML written to ${written.outputPath} (${written.bytes} bytes).`;
    const cobertura = { outputPath: written.outputPath, bytes: written.bytes, classes: document.classes, lines: document.lines };
    const [first, ...rest] = polled.content;
    return {
      ...polled,
      content: [{ type: "text", text: `${first?.text ?? ""}\n${line}` }, ...rest],
      structuredContent: { ...(polled.structuredContent ?? {}), cobertura },
    };
  } catch (error: unknown) {
    if (isIrisError(error)) {
      return coverageErrorResult(`Error reading coverage run ${args.coverageRunId}: ${error.message}`, { coverageRunId: id });
    }
    throw error;
  }
}

// -- The tool ------------------------------------------------------------------------

/** The refusal text for a start refused because the monitor is busy. */
function busyRefusal(start: StartResult): ToolResult {
  if (start.owner === "suite") {
    const text =
      start.coverageRunId !== undefined
        ? `A coverage run is already active on this instance (coverageRunId=${start.coverageRunId}, process ` +
          `${start.pid ?? "unknown"}, started ${start.startedAt ?? "unknown"}); nothing was started. Wait for it with ` +
          `iris_test_status (action "poll", coverageRunId "${start.coverageRunId}") and try again.`
        : `Another coverage run is being started on this instance right now; nothing was started. Try again in a moment.`;
    const fields: Record<string, unknown> = { owner: "suite" };
    if (start.coverageRunId !== undefined) fields.coverageRunId = start.coverageRunId;
    if (start.pid !== undefined) fields.pid = start.pid;
    if (start.startedAt !== undefined) fields.startedAt = start.startedAt;
    if (start.namespace !== undefined) fields.namespace = start.namespace;
    return refusalResult(REFUSAL_CODES.MONITOR_BUSY, text, fields);
  }
  return refusalResult(
    REFUSAL_CODES.MONITOR_BUSY,
    "Another Line-by-Line or PERFMON monitor session is active on this instance and was not started by this suite; " +
      "nothing was started and that session was left untouched. Try again once it has ended.",
    { owner: "foreign" },
  );
}

/**
 * Handler factory (the testability seam of `createExecuteTestsHandler`): {@link testCoverageTool}'s `handler` is
 * `createTestCoverageHandler()` with the real clock; tests inject a deterministic fake.
 *
 * @param clock - The clock and sleep the wait budget runs on.
 */
export function createTestCoverageHandler(clock: TestClock = realClock): ToolDefinition["handler"] {
  return async (args, ctx) => {
    const { target, level, classes, namespace, timeout, minCoverage } = args as {
      target: string;
      level: "package" | "class" | "method";
      classes: string[];
      namespace?: string;
      timeout?: number;
      minCoverage?: number;
    };

    const ns = ctx.resolveNamespace(namespace);
    const { timeoutMs, timeoutCapped } = resolveTestTimeout(timeout, ctx.config.testTimeoutMs);
    let coverageRunId: number | undefined;

    try {
      const startResponse = await ctx.http.post<StartResult>(COVERAGE_ROUTE, {
        target,
        level,
        classes,
        namespace: ns,
        maxSeconds: MAX_RUN_SECONDS,
        maxLines: MAX_MEASURED_LINES,
        ...(minCoverage !== undefined ? { minCoverage } : {}),
      });
      const start = startResponse.result;

      if (start.outcome === "busy") return busyRefusal(start);
      if (start.outcome === "failed") {
        const error = start.error ?? "The coverage run could not be started.";
        return start.coverageRunId !== undefined
          ? await resultForRun(ctx, { ...(start as CoverageRun), status: "failed", error })
          : coverageErrorResult(`${error}`, {});
      }

      coverageRunId = start.coverageRunId;
      if (coverageRunId === undefined) {
        return coverageErrorResult("The coverage run started but the service returned no coverageRunId.");
      }

      const startTime = clock.now();
      const deadline = startTime + timeoutMs;
      let run: CoverageRun | undefined;
      while (clock.now() < deadline) {
        run = await readRun(ctx, String(coverageRunId));
        if (isTerminal(run)) break;
        await clock.sleep(TEST_POLL_INTERVAL);
      }

      if (run === undefined) {
        // The budget was spent before the first read: read once, so the result carries the live record.
        run = await readRun(ctx, String(coverageRunId));
      }
      return await resultForRun(ctx, run, {
        ...(isTerminal(run) ? {} : { elapsedMs: clock.now() - startTime, timeoutMs }),
        ...(timeoutCapped ? { timeoutCapped: true } : {}),
      });
    } catch (error: unknown) {
      if (isIrisError(error)) {
        if (coverageRunId !== undefined) {
          return coverageErrorResult(
            `Error following coverage run ${coverageRunId} for '${target}': ${error.message} ${EM_DASH} the run may ` +
              `still be executing server-side. Do NOT re-submit; call iris_test_status with action "poll" and ` +
              `coverageRunId "${coverageRunId}".`,
            { coverageRunId },
          );
        }
        return coverageErrorResult(`Error starting the coverage run for '${target}': ${error.message}`);
      }
      throw error;
    }
  };
}

export const testCoverageTool: ToolDefinition = {
  name: "iris_test_coverage",
  title: "Test Coverage",
  description:
    "Run ObjectScript unit tests and measure which lines of the listed classes they execute. Use it to " +
    "see how well a test target covers specific classes, and which lines of their source it misses. It returns the test " +
    "summary (total, passed, failed, skipped, details) and the coverage twice. Per class and per method, over the " +
    "class's own source lines (coverage.classes[].source): executable lines, covered lines, percent and the " +
    "uncovered line ranges, plus the count of lines the compiler generated in the class, which are never reported as " +
    "source lines; a method with a reason (generator, not-objectscript or layout) has no class-source lines, and neither " +
    "has a method that compiles to no INT code, which carries no reason; a statement that spans several lines is one " +
    "line, the first that maps to its code (for a multi-line &sql statement, the line after the &sql( line); a class " +
    "whose definition changed after it was compiled, or whose compiled line map is gone (a documentation-only edit saved " +
    "after the compile, which a default compile does not rebuild), has source.reason not-up-to-date. And per measured INT " +
    "routine (coverage.classes[].routines[]): its executable line count, covered line count, percent and the " +
    "executable and covered INT line ranges. A class that could not be measured is listed under coverage.unmeasured " +
    "with a reason (not-compiled, no-routines or no-int-source). The text result is compact: one status line, the " +
    "coverage target line when minCoverage was passed, one line per class with its uncovered ranges (and one indented " +
    "line per method with an uncovered line), one line per routine, then the classes that were not measured. " +
    "minCoverage (0 to 100) adds coverage.verdict to a completed result: a class passes when its unrounded ratio of " +
    "covered to executable class lines is at least the minimum, fails below it or when it was not measured, and is " +
    "notApplicable with no executable class line; overall passes when the unrounded total is at least the minimum and " +
    "no class failed for want of a result. A failing verdict is still isError false. " +
    "DEFAULT-DISABLED (it starts an instance-wide monitor session and runs test code): enable it with " +
    "IRIS_GOVERNANCE={\"global\":{\"iris_test_coverage\":true}}. " +
    "Operator control: IRIS_TEST_TIMEOUT (seconds) sets the default wait budget; the `timeout` argument overrides " +
    "it per call (default 120 s, hard-capped at 3600 s; a larger value is clamped and the result carries " +
    "timeoutCapped: true). " +
    "Shared-instance guard: one coverage run at a time instance-wide. While any Line-by-Line or PERFMON session is " +
    "running (this tool's own, or anyone else's), the call is refused with code MONITOR_BUSY and owner \"suite\" " +
    "or \"foreign\"; nothing is started and a foreign session is never touched. " +
    "Only the process that runs the tests is measured (and the suite's own supervisor process, which runs only " +
    "the suite's own classes, so they count only if you list them), so code that runs in processes the tests " +
    "start is not counted. Coverage is INT-line coverage of the listed classes' routines, including the code the compiler " +
    "generates in them (list 1 to 50 classes; the run is refused above 200,000 measured INT lines); a method that " +
    "compiles to no INT code has no lines to cover. " +
    "Class names are matched exactly as compiled, with the package and the letter case (for example MyApp.Orders). " +
    "Class line numbers are those of the class document that iris_doc_get returns for '<class>.cls', which IRIS " +
    "stores in its own layout (one blank line between members, each signature on one line): a file uploaded in " +
    "another layout can number its lines differently, so read the class with iris_doc_get before comparing. " +
    "INT line numbers (the routine lines) are different: INT line n is line n+1 of the document iris_doc_get returns for " +
    "'<routine>.int' (for example 'MyApp.Orders.1.int') and of the text iris_routine_intermediate returns, whose " +
    "line 1 is the ROUTINE header. " +
    "If the wait budget expires while the run is still executing, the result is isError false with " +
    "status \"running\", the run's coverageRunId and its handles: do NOT re-submit. Re-attach with " +
    "iris_test_status (action \"poll\", coverageRunId), which returns the same result once the run is finished; " +
    "its \"cancel\" action stops the run and is a key of its own, iris_test_status:cancel, also DEFAULT-DISABLED " +
    "(enable it with IRIS_GOVERNANCE={\"global\":{\"iris_test_status:cancel\":true}}). A coverage handle is kept " +
    "for the 20 most recent runs and does not survive an instance restart. " +
    "A Cobertura XML file for CI tools is written by iris_test_status action \"export\" (coverageRunId, an absolute " +
    "outputPath ending .xml), never by this tool; export is a write key of its own, also DEFAULT-DISABLED (enable it " +
    "with IRIS_GOVERNANCE={\"global\":{\"iris_test_status:export\":true}}).",
  inputSchema: z.object({
    target: z
      .string()
      .describe(
        "Test target: package name (e.g., 'MyApp.Tests'), class name (e.g., 'MyApp.Tests.UtilsTest'), " +
          "or class:method (e.g., 'MyApp.Tests.UtilsTest:TestSomething')",
      ),
    level: z.enum(["package", "class", "method"]).describe("Granularity of test execution"),
    classes: z
      .array(
        z
          .string()
          .regex(CLASS_NAME_PATTERN, "a class name such as 'MyApp.Orders' (no wildcards, no commas)"),
      )
      .min(1)
      .max(50)
      .describe(
        "The classes whose INT routines are measured: 1 to 50 class names, with no wildcards, written exactly as " +
          "compiled (package-qualified, same letter case). A class that is not compiled in the namespace under " +
          "that name is reported under coverage.unmeasured.",
      ),
    timeout: z
      .coerce.number()
      .positive()
      .optional()
      .describe(
        "Maximum time to wait for the run, in SECONDS, before returning a 'running' result instead of blocking " +
          "further (default: 120, or IRIS_TEST_TIMEOUT if set; hard-capped at 3600s - a larger value is clamped " +
          "and the response carries timeoutCapped:true). MCP clients impose their own tools/call ceiling " +
          "independently of this value (commonly 60s) - treat the running-result-plus-re-attach contract as the " +
          "robust path for a slow suite.",
      ),
    namespace: z.string().optional().describe("Target namespace (default: configured)"),
    minCoverage: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe(
        "A coverage target, a number from 0 to 100. The run is stored with it, and a completed result carries " +
          "coverage.verdict: each class is pass when its unrounded class-line ratio is at least the target, fail " +
          "below it or when it was not measured, and notApplicable with no executable class line. The verdict never " +
          "makes the result an error. Omit it for no verdict.",
      ),
  }),
  annotations: {
    // It prunes its own older run records and runs arbitrary test code.
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  // Governance (Rule #28): a new post-foundation key, truthfully a write (an instance-wide monitor session and
  // test code); no `defaultEnabled`, so it ships DISABLED and an operator enables it. Not in the frozen baseline.
  mutates: "write",
  handler: createTestCoverageHandler(),
};
