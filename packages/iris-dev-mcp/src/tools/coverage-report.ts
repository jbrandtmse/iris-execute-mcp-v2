/**
 * The class-source side of a coverage result (Story 40.2): per class and per method, over the lines of the class
 * document, with a pass/fail verdict against a minimum.
 *
 * The IRIS side records raw data only (AD-12): for each method that a class defines, the class-document line that
 * declares it and the INT line of each of its body lines (`ExecuteMCPv2.Coverage.Job:SourceMap`). Every judgment is made
 * here, over that map and the per-routine INT data 40.1 already reads:
 *
 *  - A class line is *executable* when its INT line's skeleton is executable under {@link isExecutableSkeleton}, and
 *    *covered* when that INT line's count is above 0.
 *  - A method's body lines map to INT lines inside the method's own INT block, which starts at its label line. A body line
 *    the compiler maps to an INT line at or before the label line (a `#dim` or `#define` line before the first statement) is
 *    mapped to the code of the method before it, and is not a class line.
 *  - An INT line is reported once per method, at the first class line that maps to it. A statement that spans several lines
 *    but compiles to one INT line (a multi-line embedded SQL statement) is one class line: its first line maps to a comment
 *    line of the INT routine, so the class line is the first continuation line, the one after the `&sql(` line.
 *  - An executable INT line that no class line maps to is *generated* (the compiler's own code): it is counted per class,
 *    never reported as source lines.
 *  - A class whose line map is gone is `not-up-to-date`: IRIS still calls it up to date after a documentation-only edit
 *    saved since the compile, but the edit removed the class's line map, which a default compile does not rebuild. It shows
 *    as a method that has an INT label and body lines, with no body line of any method mapped. A class whose methods compile
 *    to no INT code at all (constant returns, generators, methods not written in ObjectScript) maps nothing too, and is not
 *    stale: it has no label to show.
 *  - A percentage and a range list are 40.1's {@link percentOf} and {@link toRanges}.
 *  - The verdict compares the unrounded ratio with the minimum, in exact integer arithmetic.
 *
 * Everything here is a pure function of the run record, so `iris_test_coverage` and the companion `iris_test_status`
 * produce the same result for the same run (AD-16), and the Cobertura document ({@link ./cobertura.ts}) is deterministic.
 */

import {
  isExecutableSkeleton,
  percentOf,
  toRanges,
  type CoverageRun,
  type SourceClassRaw,
} from "./test-coverage.js";

type Range = [number, number];

// -- The mapped lines of a class ---------------------------------------------------

/** An executable class line and the number of times its INT line ran. */
export interface MappedLine {
  line: number;
  hits: number;
}

/** A method of a class with its executable class lines. A method with a `reason` has none. */
export interface MappedMethod {
  name: string;
  /** The class-document line that declares the method; `null` when it cannot be found. */
  line: number | null;
  reason?: string;
  lines: MappedLine[];
}

export interface GeneratedSummary {
  executableLines: number;
  coveredLines: number;
}

/** A class's methods with their executable lines, and the count of generated lines. */
export interface MappedClass {
  class: string;
  reason?: string;
  methods: MappedMethod[];
  generated: GeneratedSummary;
}

interface RoutineIndex {
  skeleton: Map<number, string>;
  hits: Map<number, number>;
}

/**
 * Map the class lines of every class in the run's source map onto its INT lines. Returns one entry per
 * `run.sources` entry, in order; a run without a source map has none.
 *
 * Body line k of a method (k = 1 to n) is class-document line D+1+k, where D is the method's declaration line.
 *
 * @param run - The run record.
 */
export function mapSources(run: CoverageRun): MappedClass[] {
  const sources = run.sources ?? [];
  const index = new Map<string, RoutineIndex>();
  for (const routine of run.routines ?? []) {
    index.set(routine.routine, { skeleton: new Map(routine.skeleton), hits: new Map(routine.hits) });
  }
  return sources.map((source) => mapClass(run, source, index));
}

/**
 * Is the line map of this class gone? A method that compiled to INT code (it has a label line) and has body lines, while no
 * body line of any method maps to an INT line, is how a class shows whose map was removed by a documentation-only edit.
 */
function lineMapIsGone(source: SourceClassRaw): boolean {
  let hasCode = false;
  for (const method of source.methods) {
    if (method.reason || method.intLines === undefined) continue;
    if (method.intLines.some((intLine) => intLine > 0)) return false;
    if ((method.labelLine ?? 0) > 0 && method.intLines.length > 0) hasCode = true;
  }
  return hasCode;
}

function mapClass(run: CoverageRun, source: SourceClassRaw, index: Map<string, RoutineIndex>): MappedClass {
  const mappedInt = new Map<string, Set<number>>();
  const methods: MappedMethod[] = [];
  for (const method of source.methods) {
    const mapped: MappedMethod = {
      name: method.name,
      line: method.line,
      ...(method.reason ? { reason: method.reason } : {}),
      lines: [],
    };
    methods.push(mapped);
    if (method.reason || method.line === null || method.routine === undefined || method.intLines === undefined) continue;
    const routine = index.get(method.routine);
    if (routine === undefined) continue;
    const seen = mappedInt.get(method.routine) ?? new Set<number>();
    mappedInt.set(method.routine, seen);
    const labelLine = method.labelLine ?? 0;
    const reported = new Set<number>();
    method.intLines.forEach((intLine, offset) => {
      if (intLine <= labelLine) return;
      seen.add(intLine);
      if (!isExecutableSkeleton(routine.skeleton.get(intLine)) || reported.has(intLine)) return;
      reported.add(intLine);
      mapped.lines.push({ line: (method.line as number) + 2 + offset, hits: routine.hits.get(intLine) ?? 0 });
    });
  }

  const generated: GeneratedSummary = { executableLines: 0, coveredLines: 0 };
  for (const routine of run.routines ?? []) {
    if (routine.class !== source.class) continue;
    const seen = mappedInt.get(routine.routine);
    const hits = index.get(routine.routine)?.hits;
    for (const [line, skeleton] of routine.skeleton) {
      if (!isExecutableSkeleton(skeleton) || seen?.has(line)) continue;
      generated.executableLines++;
      if ((hits?.get(line) ?? 0) > 0) generated.coveredLines++;
    }
  }
  const reason = source.reason ?? (lineMapIsGone(source) ? "not-up-to-date" : undefined);
  return { class: source.class, ...(reason ? { reason } : {}), methods, generated };
}

// -- The summary ----------------------------------------------------------------------

export interface MethodSummary {
  method: string;
  line: number | null;
  executableLines: number;
  coveredLines: number;
  percent: number | null;
  uncoveredRanges: Range[];
  reason?: string;
}

/** The class-source coverage of a class that has a map. Range lists are class-document lines. */
export interface SourceSummary {
  executableLines: number;
  coveredLines: number;
  percent: number | null;
  executableRanges: Range[];
  coveredRanges: Range[];
  uncoveredRanges: Range[];
  methods: MethodSummary[];
  generated: GeneratedSummary;
}

/** A class's `source`: a summary, or the reason it has none. */
export type ClassSource = SourceSummary | { reason: string };

/** Does this class have a class-source result (a summary, not a reason)? */
export function hasSourceResult(source: ClassSource | undefined): source is SourceSummary {
  return source !== undefined && !("reason" in source);
}

function summarizeMethod(method: MappedMethod): MethodSummary {
  const covered = method.lines.filter((entry) => entry.hits > 0).length;
  return {
    method: method.name,
    line: method.line,
    executableLines: method.lines.length,
    coveredLines: covered,
    percent: percentOf(covered, method.lines.length),
    uncoveredRanges: toRanges(method.lines.filter((entry) => entry.hits === 0).map((entry) => entry.line)),
    ...(method.reason ? { reason: method.reason } : {}),
  };
}

/**
 * The class-source coverage of a mapped class: executable, covered and uncovered class lines (as counts and ranges), the
 * methods in the order the class document declares them, and the generated-code count.
 *
 * @param mapped - The class as {@link mapSources} maps it.
 */
export function classSourceCoverage(mapped: MappedClass): ClassSource {
  if (mapped.reason) return { reason: mapped.reason };
  const lines = mapped.methods.flatMap((method) => method.lines);
  const covered = lines.filter((entry) => entry.hits > 0).map((entry) => entry.line);
  const uncovered = lines.filter((entry) => entry.hits === 0).map((entry) => entry.line);
  return {
    executableLines: lines.length,
    coveredLines: covered.length,
    percent: percentOf(covered.length, lines.length),
    executableRanges: toRanges(lines.map((entry) => entry.line)),
    coveredRanges: toRanges(covered),
    uncoveredRanges: toRanges(uncovered),
    methods: mapped.methods.map(summarizeMethod),
    generated: mapped.generated,
  };
}

/** The class-source totals over the classes that have a result. */
export interface SourceTotals {
  executableLines: number;
  coveredLines: number;
  percent: number | null;
}

/**
 * Total the classes that have a class-source result; a class with only a reason is not part of the total.
 *
 * @param sources - The classes' `source` values.
 */
export function coverageTotals(sources: ReadonlyArray<ClassSource | undefined>): SourceTotals {
  let executable = 0;
  let covered = 0;
  for (const source of sources) {
    if (!hasSourceResult(source)) continue;
    executable += source.executableLines;
    covered += source.coveredLines;
  }
  return { executableLines: executable, coveredLines: covered, percent: percentOf(covered, executable) };
}

// -- The verdict -------------------------------------------------------------------------

export type VerdictValue = "pass" | "fail" | "notApplicable";

export interface ClassVerdict {
  class: string;
  verdict: VerdictValue;
  percent: number | null;
  /** Why a class that has no class-source result fails. */
  reason?: string;
}

export interface CoverageVerdict {
  minCoverage: number;
  overall: VerdictValue;
  /** The aggregate percent over the classes that have a result, as displayed (rounded to 2 decimals). */
  percent: number | null;
  classes: ClassVerdict[];
}

/** A decimal number as an exact fraction of its shortest decimal form. */
function toFraction(value: number): { numerator: bigint; denominator: bigint } {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(Math.abs(value)));
  if (match === null) throw new Error(`minCoverage ${value} is not a finite decimal number`);
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  const digits = BigInt(`${match[1]}${fraction}`);
  const scale = fraction.length - exponent;
  return scale <= 0
    ? { numerator: digits * 10n ** BigInt(-scale), denominator: 1n }
    : { numerator: digits, denominator: 10n ** BigInt(scale) };
}

/**
 * Is `covered / executable` at least `minCoverage` percent? The comparison is exact: the ratio is not rounded, so a
 * class at 79.995% does not meet a minimum of 80.
 *
 * @param covered - Covered lines.
 * @param executable - Executable lines (above 0).
 * @param minCoverage - The minimum, 0 to 100.
 */
export function meetsMinimum(covered: number, executable: number, minCoverage: number): boolean {
  const { numerator, denominator } = toFraction(minCoverage);
  return BigInt(covered) * 100n * denominator >= numerator * BigInt(executable);
}

/**
 * The verdict of a run against its minimum.
 *
 *  - A class with a result is `pass` when its unrounded ratio meets the minimum, `fail` below it, and `notApplicable`
 *    with no executable class line.
 *  - A listed class with no result (it was not measured, or has no class-source result) is `fail` with its `reason`.
 *  - `overall` is `fail` when any class failed with a reason; otherwise `notApplicable` when no class has an executable
 *    line; otherwise `pass` when the unrounded aggregate over the classes with a result meets the minimum.
 *
 * @param minCoverage - The minimum, 0 to 100.
 * @param classes - The measured classes with their `source`.
 * @param unmeasured - The listed classes that were not measured, with their reasons.
 */
export function coverageVerdict(
  minCoverage: number,
  classes: ReadonlyArray<{ class: string; source?: ClassSource }>,
  unmeasured: ReadonlyArray<{ class: string; reason: string }>,
): CoverageVerdict {
  const verdicts: ClassVerdict[] = [];
  for (const entry of classes) {
    const source = entry.source;
    if (hasSourceResult(source)) {
      if (source.executableLines === 0) {
        verdicts.push({ class: entry.class, verdict: "notApplicable", percent: null });
      } else {
        const pass = meetsMinimum(source.coveredLines, source.executableLines, minCoverage);
        verdicts.push({ class: entry.class, verdict: pass ? "pass" : "fail", percent: source.percent });
      }
    } else {
      verdicts.push({
        class: entry.class,
        verdict: "fail",
        percent: null,
        reason: source?.reason ?? "unavailable",
      });
    }
  }
  for (const entry of unmeasured) {
    verdicts.push({ class: entry.class, verdict: "fail", percent: null, reason: entry.reason });
  }

  const totals = coverageTotals(classes.map((entry) => entry.source));
  let overall: VerdictValue;
  if (verdicts.some((entry) => entry.verdict === "fail" && entry.reason !== undefined)) {
    overall = "fail";
  } else if (totals.executableLines === 0) {
    overall = "notApplicable";
  } else {
    overall = meetsMinimum(totals.coveredLines, totals.executableLines, minCoverage) ? "pass" : "fail";
  }
  return { minCoverage, overall, percent: totals.percent, classes: verdicts };
}

// -- The text ----------------------------------------------------------------------------------

/** `8, 16-18, 23` from inclusive ranges. */
export function formatRanges(ranges: Range[]): string {
  return ranges.map(([start, end]) => (start === end ? String(start) : `${start}-${end}`)).join(", ");
}

/**
 * The verdict line: `Coverage target 90%: FAIL (95.65% overall); failing: Pkg.A 50%, Pkg.B (not-compiled)`.
 *
 * @param verdict - The run's verdict.
 */
export function verdictTextLine(verdict: CoverageVerdict): string {
  const head = `Coverage target ${verdict.minCoverage}%: `;
  if (verdict.overall === "notApplicable") return `${head}NOT APPLICABLE (no executable class lines)`;
  const overall = verdict.percent === null ? "no class-source coverage" : `${verdict.percent}% overall`;
  const failing = verdict.classes
    .filter((entry) => entry.verdict === "fail")
    .map((entry) => (entry.reason !== undefined ? `${entry.class} (${entry.reason})` : `${entry.class} ${entry.percent}%`));
  return `${head}${verdict.overall === "pass" ? "PASS" : "FAIL"} (${overall})${failing.length > 0 ? `; failing: ${failing.join(", ")}` : ""}`;
}

/**
 * The class-source text lines: one per class, then one indented line per method that has an uncovered line.
 *
 * @param classes - The measured classes with their `source`.
 */
export function sourceTextLines(classes: ReadonlyArray<{ class: string; source?: ClassSource }>): string[] {
  const lines: string[] = [];
  for (const entry of classes) {
    const source = entry.source;
    if (source === undefined) continue;
    if (!hasSourceResult(source)) {
      lines.push(`${entry.class}: no class-source coverage (${source.reason})`);
      continue;
    }
    if (source.executableLines === 0) {
      lines.push(`${entry.class}: no executable class lines`);
      continue;
    }
    lines.push(
      `${entry.class}: ${source.coveredLines} of ${source.executableLines} class lines covered (${source.percent}%)` +
        `${source.uncoveredRanges.length > 0 ? `; uncovered ${formatRanges(source.uncoveredRanges)}` : ""}`,
    );
    for (const method of source.methods) {
      if (method.uncoveredRanges.length === 0) continue;
      lines.push(
        `  ${method.method}: ${method.coveredLines} of ${method.executableLines} (${method.percent}%); ` +
          `uncovered ${formatRanges(method.uncoveredRanges)}`,
      );
    }
  }
  return lines;
}
