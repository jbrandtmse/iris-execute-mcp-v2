/**
 * Story 40.2 -- the class-source coverage summary, the verdict and their text (`coverage-report.ts`).
 *
 * Oracles (Rule #36): `STORY402_RUN` is the Status record the live route returned for the Story 40.2 oracle run (IRIS 2026.2
 * build 221U, 2026-10-18), and the expected class-source values and text below are the live gate's captured result for it
 * (`story-40-2-coverage-reports-live-gate.test.ts`, matrix rows 1, 2 and 4). The synthetic runs below it change one thing of
 * that record at a time and say which.
 */

import { describe, it, expect } from "vitest";
import {
  classSourceCoverage,
  coverageTotals,
  coverageVerdict,
  hasSourceResult,
  mapSources,
  meetsMinimum,
  sourceTextLines,
  verdictTextLine,
  type ClassSource,
} from "../tools/coverage-report.js";
import { buildCoverageSection, coverageRunEnvelope, type CoverageRun, type SourceClassRaw } from "../tools/test-coverage.js";
import { STORY402_FIXTURE_SOURCE_VALUES, STORY402_LAYOUT_SOURCE_VALUES, STORY402_RUN } from "./story402-run.js";

const ONE_PASSED = { total: 1, passed: 1, failed: 0, skipped: 0, details: [] };

/** A copy of the oracle run with `overrides`, so that each test names the one thing it changes. */
function runWith(overrides: Partial<CoverageRun>): CoverageRun {
  return { ...STORY402_RUN, ...overrides };
}

/** A copy of the oracle run without the named optional fields (what an older IRIS-side class returns). */
function without(run: CoverageRun, ...keys: Array<"minCoverage" | "sources">): CoverageRun {
  const copy = { ...run };
  for (const key of keys) delete copy[key];
  return copy;
}

/** The oracle run's class-source summaries by class name. */
function summaries(run: CoverageRun): Map<string, ClassSource> {
  return new Map(mapSources(run).map((mapped) => [mapped.class, classSourceCoverage(mapped)] as const));
}

describe("the mapping rule (AC 40.2.1)", () => {
  const sources = summaries(STORY402_RUN);

  it("maps Story402.Fixture to the live oracle: 22 of 23 class lines covered, only line 31 uncovered", () => {
    expect(sources.get("Story402.Fixture")).toMatchObject(STORY402_FIXTURE_SOURCE_VALUES);
  });

  it("maps Story402.Layout to the stored document's numbering (Spaced is lines 9 and 11), 2 of 4 covered", () => {
    expect(sources.get("Story402.Layout")).toMatchObject(STORY402_LAYOUT_SOURCE_VALUES);
  });

  it("body line k of a method declared at line D is class line D+1+k, and only executable INT lines are class lines", () => {
    const fixture = mapSources(STORY402_RUN)[0];
    const macro = fixture?.methods.find((method) => method.name === "Macro");
    // Macro is declared at 28: its 7 body lines are 30-36; body line 5 (the #define, return type 1) has no INT line, and
    // the INT lines 28 and 31 etc. are counted only where the skeleton is executable.
    expect(macro?.lines).toEqual([
      { line: 30, hits: 1 },
      { line: 31, hits: 0 },
      { line: 33, hits: 1 },
      { line: 35, hits: 1 },
      { line: 36, hits: 1 },
    ]);
    const multi = fixture?.methods.find((method) => method.name === "MultiLine");
    expect(multi?.lines.map((entry) => entry.line), "the continuation lines of a statement are never executable").toEqual([41, 44, 46, 48]);
  });

  it("lists the methods in the order of the map, with the reason of each that has none: generator, not-objectscript", () => {
    const fixture = sources.get("Story402.Fixture");
    expect(hasSourceResult(fixture) && fixture.methods.map((method) => method.method)).toEqual([
      "ScoreSet", "LabelGet", "Plain", "Macro", "MultiLine", "Sql", "Generated", "Expr", "Constant", "Comments", "TwoOnOne",
    ]);
    expect(hasSourceResult(fixture) && fixture.methods.find((method) => method.method === "Generated")).toEqual({
      method: "Generated", line: 59, executableLines: 0, coveredLines: 0, percent: null, uncoveredRanges: [], reason: "generator",
    });
    expect(hasSourceResult(fixture) && fixture.methods.find((method) => method.method === "Constant")).toEqual({
      method: "Constant", line: 71, executableLines: 0, coveredLines: 0, percent: null, uncoveredRanges: [],
    });
    const layout = sources.get("Story402.Layout");
    expect(hasSourceResult(layout) && layout.methods.find((method) => method.method === "Py")).toMatchObject({
      reason: "not-objectscript", executableLines: 0,
    });
    expect(hasSourceResult(layout) && layout.methods.find((method) => method.method === "NoBlank")).toMatchObject({
      executableLines: 0, percent: null,
    });
  });

  it("counts the executable INT lines no class line maps to as generated, per class, never as source lines", () => {
    const fixture = sources.get("Story402.Fixture");
    // The fixture routine has 46 executable INT lines; 23 map to class lines, so 23 are generated (11 of them ran).
    expect(hasSourceResult(fixture) && fixture.generated).toEqual({ executableLines: 23, coveredLines: 11 });
    const layout = sources.get("Story402.Layout");
    expect(hasSourceResult(layout) && layout.generated).toEqual({ executableLines: 0, coveredLines: 0 });
  });

  it("returns the reason of a class that has no map instead of a summary", () => {
    const run = runWith({
      sources: [
        { class: "Story402.Fixture", reason: "not-up-to-date", methods: [] },
        { class: "Story402.Layout", reason: "unavailable", methods: [] },
      ],
    });
    expect(summaries(run).get("Story402.Fixture")).toEqual({ reason: "not-up-to-date" });
    expect(summaries(run).get("Story402.Layout")).toEqual({ reason: "unavailable" });
  });

  it("a method whose layout was not as expected has a reason and no lines", () => {
    const run = runWith({
      sources: [
        {
          class: "Story402.Layout",
          methods: [{ name: "Spaced", line: 7, reason: "layout" }, { name: "Gone", line: null, reason: "layout" }],
        },
      ],
    });
    const layout = summaries(run).get("Story402.Layout");
    expect(layout).toMatchObject({ executableLines: 0, coveredLines: 0, percent: null });
    expect(hasSourceResult(layout) && layout.methods).toEqual([
      { method: "Spaced", line: 7, executableLines: 0, coveredLines: 0, percent: null, uncoveredRanges: [], reason: "layout" },
      { method: "Gone", line: null, executableLines: 0, coveredLines: 0, percent: null, uncoveredRanges: [], reason: "layout" },
    ]);
  });

  it("a method that maps like a call method (INT lines of a plain quit) and a method of a routine the run did not measure", () => {
    const run = runWith({
      sources: [
        {
          class: "Story402.Layout",
          methods: [
            { name: "Callish", line: 40, routine: "Story402.Layout.1", intLines: [6] },
            { name: "Elsewhere", line: 50, routine: "Story402.Layout.2", intLines: [6] },
          ],
        },
      ],
    });
    const layout = summaries(run).get("Story402.Layout");
    expect(layout).toMatchObject({ executableLines: 1, coveredLines: 0, executableRanges: [[42, 42]], uncoveredRanges: [[42, 42]] });
  });

  it("two body lines that map to one INT line are one class line, the first of them", () => {
    const run = runWith({
      sources: [{ class: "Story402.Layout", methods: [{ name: "Twice", line: 3, routine: "Story402.Layout.1", intLines: [10, 10] }] }],
    });
    expect(summaries(run).get("Story402.Layout")).toMatchObject({ executableLines: 1, coveredLines: 1, executableRanges: [[5, 5]] });
  });

  it("totals only the classes that have a result", () => {
    const totals = coverageTotals([...summaries(STORY402_RUN).values(), { reason: "not-up-to-date" }, undefined]);
    expect(totals).toEqual({ executableLines: 27, coveredLines: 24, percent: 88.89 });
    expect(coverageTotals([{ reason: "x" }])).toEqual({ executableLines: 0, coveredLines: 0, percent: null });
  });
});

/**
 * The raw data of a class with leading preprocessor lines and a multi-line embedded SQL statement, as `Job:SourceMap` and
 * `Job:Skeleton` returned it for a disposable class with the text of the QA gate's `Story402.QaDirectives` (IRIS 2026.2 build
 * 221U, 2026-10-18, Rule #36; the class lines are D+1+k for the declaration lines 5, 11 and 19), from a `SourceMap` that still
 * recorded what `INTLine` answers for a preprocessor line: Beta's `#dim` and `#define` lines map onto Alpha's INT lines 6 and
 * 7. The current `SourceMap` records a preprocessor line as 0 (Beta `[0, 0, 9, 10]`, pinned live by QA-3a); a current record
 * that still reaches the label-line bound is `CONTINUE_RUN`. Gamma's `&sql(` line maps to the comment-only INT line 13 and its
 * three continuation lines to the one code line 18. Alpha and Gamma ran once, Beta did not.
 */
const DIRECTIVES_CLASS = "Story402.QaDirectives";
const DIRECTIVES_ROUTINE = "Story402.QaDirectives.1";
const DIRECTIVES_RUN = runWith({
  unmeasured: [],
  routines: [
    {
      class: DIRECTIVES_CLASS,
      routine: DIRECTIVES_ROUTINE,
      lines: 29,
      hits: [[6, 1], [7, 1], [11, 1], [12, 1], [18, 1], [19, 1]],
      skeleton: [
        [5, "L C:methodimpl {"], [6, "C:set"], [7, "C:quit }"], [8, "L C:methodimpl {"], [9, "C:set"], [10, "C:quit }"],
        [11, "L C:methodimpl { C:new"], [12, "C:set"], [18, "C:try { C:d } C:catch { C:if { C:d L } C:else { C:throw } }"],
        [19, "C:quit }"], [20, "C:q"], [21, "L C:n"], [22, "C:s"], [23, "C:s"], [24, "C:do L"], [25, "C:return"],
        [26, "C:if { C:try { C:set } C:catch { } }"], [27, "C:return"], [28, "L C:public {"], [29, "C:s"],
      ],
    },
  ],
  sources: [
    {
      class: DIRECTIVES_CLASS,
      methods: [
        { name: "Alpha", line: 5, routine: DIRECTIVES_ROUTINE, intLines: [6, 7], labelLine: 5 },
        { name: "Beta", line: 11, routine: DIRECTIVES_ROUTINE, intLines: [6, 7, 9, 10], labelLine: 8 },
        { name: "Gamma", line: 19, routine: DIRECTIVES_ROUTINE, intLines: [12, 13, 18, 18, 18, 19], labelLine: 11 },
      ],
    },
  ],
});

/**
 * The raw data `Job:SourceMap` and `Job:Skeleton` returned for a disposable class whose second method opens with a
 * `#define Two(%a) %a ##continue` line and its continuation line `+1` (`ExecuteMCPv2.Temp.CR402Bound`, IRIS 2026.2 build
 * 221U, 2026-10-18, compiled `ck`; declaration lines 4 and 10). The `#define` line is recorded as 0, but the continuation line
 * is no preprocessor line, and the compiler maps it onto INT 7, Alpha's `Quit tA }`, before Beta's label line 8. The counts
 * are added here: Alpha ran once, Beta did not.
 */
const CONTINUE_CLASS = "ExecuteMCPv2.Temp.CR402Bound";
const CONTINUE_RUN = runWith({
  unmeasured: [],
  routines: [
    {
      class: CONTINUE_CLASS,
      routine: `${CONTINUE_CLASS}.1`,
      lines: 10,
      hits: [[6, 1], [7, 1]],
      skeleton: [[5, "L C:methodimpl {"], [6, "C:set"], [7, "C:quit }"], [8, "L C:methodimpl {"], [9, "C:set"], [10, "C:quit }"]],
    },
  ],
  sources: [
    {
      class: CONTINUE_CLASS,
      methods: [
        { name: "Alpha", line: 4, routine: `${CONTINUE_CLASS}.1`, intLines: [6, 7], labelLine: 5 },
        { name: "Beta", line: 10, routine: `${CONTINUE_CLASS}.1`, intLines: [0, 7, 9, 10], labelLine: 8 },
      ],
    },
  ],
});

/** The same run from an IRIS-side class that records no label lines. */
function withoutLabelLines(run: CoverageRun): CoverageRun {
  return {
    ...run,
    sources: (run.sources ?? []).map((source) => ({
      ...source,
      methods: source.methods.map((method) => {
        const copy = { ...method };
        delete copy.labelLine;
        return copy;
      }),
    })),
  };
}

describe("the INT block of a method and one class line per statement (AC 40.2.1)", () => {
  const directives = (run: CoverageRun) => {
    const summary = summaries(run).get(DIRECTIVES_CLASS);
    return hasSourceResult(summary) ? summary : undefined;
  };

  it("a body line the compiler maps at or before the method's label line belongs to the method before it, so it is no class line", () => {
    const summary = directives(DIRECTIVES_RUN);
    const beta = summary?.methods.find((method) => method.method === "Beta");
    expect(beta, "Beta's #dim and #define lines (INT 6 and 7, Alpha's) are dropped; its statements remain, and it never ran").toEqual({
      method: "Beta", line: 11, executableLines: 2, coveredLines: 0, percent: 0, uncoveredRanges: [[15, 16]],
    });
    const alpha = summary?.methods.find((method) => method.method === "Alpha");
    expect(alpha).toEqual({ method: "Alpha", line: 5, executableLines: 2, coveredLines: 2, percent: 100, uncoveredRanges: [] });
  });

  it("the continuation line of a leading #define, which the compiler maps onto the method before it, is no class line (a current record)", () => {
    const summary = summaries(CONTINUE_RUN).get(CONTINUE_CLASS);
    const beta = hasSourceResult(summary) ? summary.methods.find((method) => method.method === "Beta") : undefined;
    expect(beta, "Beta's `+1` line (INT 7, Alpha's) is dropped; its statements 14 and 15 remain, and it never ran").toEqual({
      method: "Beta", line: 10, executableLines: 2, coveredLines: 0, percent: 0, uncoveredRanges: [[14, 15]],
    });
  });

  it("a record without label lines (an older IRIS-side class) keeps the unbounded mapping: Beta then reads Alpha's counts", () => {
    const beta = directives(withoutLabelLines(DIRECTIVES_RUN))?.methods.find((method) => method.method === "Beta");
    expect(beta).toMatchObject({ executableLines: 4, coveredLines: 2, uncoveredRanges: [[15, 16]] });
  });

  it("a multi-line embedded SQL statement is one class line, the first line that maps to its code line (the line after the &sql( line)", () => {
    const gamma = directives(DIRECTIVES_RUN)?.methods.find((method) => method.method === "Gamma");
    // Gamma is declared at 19: `Set` is line 21, `&sql(` line 22 maps to a comment-only INT line, its continuation lines 23 to 25 map to INT 18.
    expect(gamma).toEqual({ method: "Gamma", line: 19, executableLines: 3, coveredLines: 3, percent: 100, uncoveredRanges: [] });
    expect(directives(DIRECTIVES_RUN)).toMatchObject({
      executableLines: 7,
      coveredLines: 5,
      percent: 71.43,
      executableRanges: [[7, 8], [15, 16], [21, 21], [23, 23], [26, 26]],
      coveredRanges: [[7, 8], [21, 21], [23, 23], [26, 26]],
      uncoveredRanges: [[15, 16]],
    });
  });

  it("a body line mapped at or before the label line is no class line, and an executable INT line it maps that no method claims stays generated", () => {
    const withLead = (intLines: number[]): CoverageRun => ({
      ...DIRECTIVES_RUN,
      sources: [
        {
          class: DIRECTIVES_CLASS,
          methods: [
            ...(DIRECTIVES_RUN.sources?.[0]?.methods ?? []),
            { name: "Lead", line: 31, routine: DIRECTIVES_ROUTINE, intLines, labelLine: 21 },
          ],
        },
      ],
    });
    const mapped = directives(withLead([20, 22]));
    const unmapped = directives(withLead([0, 22]));
    expect(mapped?.generated, "INT 20 (the unreached quit) is the compiler's own code whether or not a body line points at it").toEqual(unmapped?.generated);
    expect(mapped?.methods.find((method) => method.method === "Lead")).toMatchObject({ executableLines: 1, coveredLines: 0, uncoveredRanges: [[34, 34]] });
  });

  it("an INT line that two different methods each map is reported by each: only one method's repeats are folded", () => {
    const run = runWith({
      sources: [
        {
          class: "Story402.Layout",
          methods: [
            { name: "One", line: 3, routine: "Story402.Layout.1", intLines: [10, 10] },
            { name: "Two", line: 9, routine: "Story402.Layout.1", intLines: [10] },
          ],
        },
      ],
    });
    expect(summaries(run).get("Story402.Layout")).toMatchObject({ executableLines: 2, executableRanges: [[5, 5], [11, 11]] });
  });
});

describe("a class whose line map is gone is not-up-to-date (AC 40.2.1, AC 40.2.4)", () => {
  /** What `Job:SourceMap` returned live for a class compiled, then documented through the UDL text service and compiled the default way (IRIS says up to date): INT label on 5, no body line mapped. */
  const GONE: SourceClassRaw = {
    class: "Story402.QaStale",
    methods: [{ name: "Go", line: 6, routine: "", intLines: [0, 0], labelLine: 5 }],
  };

  /** The routine of that class: `Go() methodimpl {` on INT line 5, its two statements on 6 and 7, both executed. */
  const GONE_ROUTINE = {
    class: "Story402.QaStale",
    routine: "Story402.QaStale.1",
    lines: 7,
    hits: [[6, 1], [7, 1]] as Array<[number, number]>,
    skeleton: [[5, "L C:methodimpl {"], [6, "C:set"], [7, "C:quit }"]] as Array<[number, string]>,
  };

  it("is reported as source.reason not-up-to-date, not as a class with no executable line", () => {
    const summary = summaries(runWith({ sources: [GONE] })).get("Story402.QaStale") as ClassSource;
    expect(summary).toEqual({ reason: "not-up-to-date" });
    expect(sourceTextLines([{ class: "Story402.QaStale", source: summary }])).toEqual([
      "Story402.QaStale: no class-source coverage (not-up-to-date)",
    ]);
  });

  it("fails the verdict with that reason, and in a multi-class run keeps overall from passing on code it never measured", () => {
    const alone = buildCoverageSection(runWith({ sources: [GONE], routines: [GONE_ROUTINE], unmeasured: [] }));
    expect(alone.verdict).toEqual({
      minCoverage: 90,
      overall: "fail",
      percent: null,
      classes: [{ class: "Story402.QaStale", verdict: "fail", percent: null, reason: "not-up-to-date" }],
    });
    const both = buildCoverageSection(
      runWith({
        minCoverage: 50,
        sources: [...(DIRECTIVES_RUN.sources ?? []), GONE],
        routines: [...(DIRECTIVES_RUN.routines ?? []), GONE_ROUTINE],
        unmeasured: [],
      }),
    );
    expect(both.verdict?.overall, "the other class passes, the stale one was never measured").toBe("fail");
    expect(both.verdict?.classes.map((entry) => [entry.class, entry.verdict])).toEqual([[DIRECTIVES_CLASS, "pass"], ["Story402.QaStale", "fail"]]);
    expect(both.source, "the total is the other class's own 7 executable and 5 covered lines").toEqual({ executableLines: 7, coveredLines: 5, percent: 71.43 });
  });

  it("is not a class whose methods compile to no INT code: those have no label line, and stay a class with no executable line", () => {
    const constants: SourceClassRaw = {
      class: "Story402.QaConstants",
      methods: [{ name: "Constant", line: 5, routine: "", intLines: [0], labelLine: 0 }, { name: "Py", line: 10, reason: "not-objectscript" }],
    };
    expect(summaries(runWith({ sources: [constants] })).get("Story402.QaConstants")).toMatchObject({ executableLines: 0, percent: null });
    const section = buildCoverageSection(
      runWith({
        sources: [constants],
        routines: [{ class: "Story402.QaConstants", routine: "Story402.QaConstants.1", lines: 4, hits: [], skeleton: [] }],
        unmeasured: [],
      }),
    );
    expect(section.verdict?.classes).toEqual([{ class: "Story402.QaConstants", verdict: "notApplicable", percent: null }]);
  });

  it("is not a class of empty stubs (a label line, no body line), nor one where any method maps a body line", () => {
    const stubs: SourceClassRaw = {
      class: "Story402.QaStubs",
      methods: [{ name: "Empty", line: 5, routine: "", intLines: [], labelLine: 7 }],
    };
    expect(summaries(runWith({ sources: [stubs] })).get("Story402.QaStubs")).toMatchObject({ executableLines: 0, percent: null });
    const partly: SourceClassRaw = {
      class: "Story402.QaPartly",
      methods: [
        { name: "Todo", line: 5, routine: "", intLines: [0], labelLine: 5 },
        { name: "Done", line: 10, routine: DIRECTIVES_ROUTINE, intLines: [6], labelLine: 5 },
      ],
    };
    expect(summaries(runWith({ sources: [partly] })).get("Story402.QaPartly")).not.toHaveProperty("reason");
  });

  it("is not decided for a record without label lines (an older IRIS-side class)", () => {
    const old: SourceClassRaw = { class: "Story402.QaStale", methods: [{ name: "Go", line: 6, routine: "", intLines: [0, 0] }] };
    expect(summaries(runWith({ sources: [old] })).get("Story402.QaStale")).toMatchObject({ executableLines: 0, percent: null });
  });

  it("keeps the class-level reason the IRIS side recorded", () => {
    const summary = summaries(runWith({ sources: [{ class: "Story402.QaStale", reason: "not-compiled", methods: [] }] })).get("Story402.QaStale");
    expect(summary).toEqual({ reason: "not-compiled" });
  });
});

describe("meetsMinimum: the comparison is exact, never rounded (AC 40.2.4)", () => {
  it("compares covered * 100 with minimum * executable in exact arithmetic", () => {
    expect(meetsMinimum(1, 2, 50)).toBe(true);
    expect(meetsMinimum(1, 3, 33.3)).toBe(true);
    expect(meetsMinimum(1, 3, 33.34)).toBe(false);
    expect(meetsMinimum(24, 27, 88.88)).toBe(true);
    expect(meetsMinimum(24, 27, 88.89)).toBe(false);
    expect(meetsMinimum(0, 5, 0)).toBe(true);
    expect(meetsMinimum(5, 5, 100)).toBe(true);
    expect(meetsMinimum(4999, 5000, 99.98)).toBe(true);
    expect(meetsMinimum(4999, 5000, 99.99)).toBe(false);
    // 79.995 is below 80 and meets 79.995 only when the ratio is not rounded up to it.
    expect(meetsMinimum(15999, 20000, 79.995)).toBe(true);
    expect(meetsMinimum(15998, 20000, 79.995)).toBe(false);
    expect(meetsMinimum(1, 1000000, 1e-7)).toBe(true);
    expect(meetsMinimum(0, 1000000, 1e-7)).toBe(false);
  });
});

describe("the verdict (matrix rows 4 to 6, by hand values)", () => {
  const section = buildCoverageSection(STORY402_RUN);
  const classes = section.classes;

  it("row 4: minCoverage 90 fails: Fixture passes (95.65), Layout fails (50), Missing fails for want of a result", () => {
    expect(coverageVerdict(90, classes, section.unmeasured)).toEqual({
      minCoverage: 90,
      overall: "fail",
      percent: 88.89,
      classes: [
        { class: "Story402.Fixture", verdict: "pass", percent: 95.65 },
        { class: "Story402.Layout", verdict: "fail", percent: 50 },
        { class: "Story402.Missing", verdict: "fail", percent: null, reason: "not-compiled" },
      ],
    });
  });

  it("row 5: a class at exactly the minimum passes (the ratio is equal), and so does overall", () => {
    const measured = classes.filter((entry) => entry.class !== "Story402.Missing");
    const verdict = coverageVerdict(50, measured, []);
    expect(verdict.classes.map((entry) => [entry.class, entry.verdict])).toEqual([
      ["Story402.Fixture", "pass"],
      ["Story402.Layout", "pass"],
    ]);
    expect(verdict.overall).toBe("pass");
  });

  it("row 6: the aggregate is compared unrounded, so a minimum that equals its rounded percent fails", () => {
    const measured = classes.filter((entry) => entry.class !== "Story402.Missing");
    // 24 of 27 is 88.8888...%: it displays as 88.89 and is below 88.89.
    const failing = coverageVerdict(88.89, measured, []);
    expect(failing.percent).toBe(88.89);
    expect(failing.overall).toBe("fail");
    expect(coverageVerdict(88.88, measured, []).overall).toBe("pass");
  });

  it("an unmeasured or source-less class fails overall even when every measured class passes", () => {
    const fixtureOnly = classes.filter((entry) => entry.class === "Story402.Fixture");
    expect(coverageVerdict(10, fixtureOnly, []).overall).toBe("pass");
    expect(coverageVerdict(10, fixtureOnly, [{ class: "Story402.Missing", reason: "no-routines" }]).overall).toBe("fail");
    const stale = [{ class: "Story402.Fixture", source: { reason: "not-up-to-date" } }];
    expect(coverageVerdict(0, stale, [])).toEqual({
      minCoverage: 0,
      overall: "fail",
      percent: null,
      classes: [{ class: "Story402.Fixture", verdict: "fail", percent: null, reason: "not-up-to-date" }],
    });
  });

  it("a class with no executable class line is notApplicable, and overall is notApplicable when no class has one", () => {
    const run = runWith({
      sources: [
        { class: "Story402.Fixture", methods: [{ name: "Constant", line: 71, routine: "", intLines: [0] }] },
        { class: "Story402.Layout", methods: [{ name: "Py", line: 29, reason: "not-objectscript" }] },
      ],
    });
    const none = buildCoverageSection(run);
    expect(none.verdict).toEqual({
      minCoverage: 90,
      overall: "fail",
      percent: null,
      classes: [
        { class: "Story402.Fixture", verdict: "notApplicable", percent: null },
        { class: "Story402.Layout", verdict: "notApplicable", percent: null },
        { class: "Story402.Missing", verdict: "fail", percent: null, reason: "not-compiled" },
      ],
    });
    // The unmeasured class still fails overall; without it nothing is applicable.
    expect(coverageVerdict(90, none.classes, []).overall).toBe("notApplicable");
    expect(none.verdict?.overall).toBe("fail");
  });

  it("is on completed results only and only when the run has a minimum and a source map", () => {
    expect(buildCoverageSection(STORY402_RUN).verdict).toBeDefined();
    expect(buildCoverageSection(runWith({ status: "cancelled" })).verdict, "a cancelled run").toBeUndefined();
    expect(buildCoverageSection(runWith({ status: "failed" })).verdict, "a failed run").toBeUndefined();
    expect(buildCoverageSection(without(STORY402_RUN, "minCoverage")).verdict, "no minimum").toBeUndefined();
    expect(buildCoverageSection(without(STORY402_RUN, "sources")).verdict, "no source map").toBeUndefined();
  });
});

describe("the text (AC 40.2.2)", () => {
  /** The text the live gate captured for the oracle run, from the status line on (minCoverage 90). */
  const CAPTURED_TEXT = [
    "Coverage run 645 completed: 1 tests, 1 passed, 0 failed, 0 skipped.",
    "Coverage target 90%: FAIL (88.89% overall); failing: Story402.Layout 50%, Story402.Missing (not-compiled)",
    "Story402.Fixture: 22 of 23 class lines covered (95.65%); uncovered 31",
    "  Macro: 4 of 5 (80%); uncovered 31",
    "Story402.Layout: 2 of 4 class lines covered (50%); uncovered 21, 26",
    "  Gap: 0 of 1 (0%); uncovered 21",
    "  Inst: 0 of 1 (0%); uncovered 26",
    "Story402.Fixture.1: 33 of 46 executable INT lines covered (71.74%); uncovered 6-8, 10-13, 29, 56, 69, 71, 73, 75",
    "Story402.Layout.1: 2 of 4 executable INT lines covered (50%); uncovered 6, 8",
    "Not measured: Story402.Missing (not-compiled)",
  ];

  it("reproduces the text the live gate captured: status line, target line, class and method lines, routine lines, Not measured", () => {
    const result = coverageRunEnvelope({ run: STORY402_RUN, summary: ONE_PASSED });
    expect((result.content[0] as { text: string }).text.split("\n")).toEqual(CAPTURED_TEXT);
    expect(result.isError, "a failing verdict is not a tool error").toBeUndefined();
  });

  it("puts the verdict and the source in structuredContent, coverage.source being the totals", () => {
    const result = coverageRunEnvelope({ run: STORY402_RUN, summary: ONE_PASSED });
    const coverage = (result.structuredContent as { coverage: ReturnType<typeof buildCoverageSection> }).coverage;
    expect(coverage.source).toEqual({ executableLines: 27, coveredLines: 24, percent: 88.89 });
    expect(coverage.verdict?.overall).toBe("fail");
    expect(coverage.classes.map((entry) => hasSourceResult(entry.source))).toEqual([true, true]);
  });

  it("without a minimum there is no target line; a passing run says PASS; a class with no result is named", () => {
    const withoutMinimum = without(STORY402_RUN, "minCoverage");
    const text = (coverageRunEnvelope({ run: withoutMinimum, summary: ONE_PASSED }).content[0] as { text: string }).text.split("\n");
    expect(text).toEqual([CAPTURED_TEXT[0], ...CAPTURED_TEXT.slice(2)]);

    const passing = coverageVerdict(50, buildCoverageSection(STORY402_RUN).classes, []);
    expect(verdictTextLine(passing)).toBe("Coverage target 50%: PASS (88.89% overall)");
  });

  it("source lines for a class with no result, and for a class with no executable class line", () => {
    expect(sourceTextLines([{ class: "A.B", source: { reason: "not-up-to-date" } }])).toEqual([
      "A.B: no class-source coverage (not-up-to-date)",
    ]);
    const empty = classSourceCoverage({ class: "A.B", methods: [{ name: "M", line: 3, lines: [] }], generated: { executableLines: 0, coveredLines: 0 } });
    expect(sourceTextLines([{ class: "A.B", source: empty }])).toEqual(["A.B: no executable class lines"]);
    expect(verdictTextLine({ minCoverage: 80, overall: "notApplicable", percent: null, classes: [] })).toBe(
      "Coverage target 80%: NOT APPLICABLE (no executable class lines)",
    );
  });

  it("a record with an empty class-source map gives each measured class the reason unavailable, totals of nothing and a FAIL target line that says so", () => {
    const run = runWith({ sources: [] });
    const section = buildCoverageSection(run);
    expect(section.classes.map((entry) => entry.source)).toEqual([{ reason: "unavailable" }, { reason: "unavailable" }]);
    expect(section.source).toEqual({ executableLines: 0, coveredLines: 0, percent: null });
    const text = (coverageRunEnvelope({ run, summary: ONE_PASSED }).content[0] as { text: string }).text.split("\n");
    expect(text.slice(1, 4)).toEqual([
      "Coverage target 90%: FAIL (no class-source coverage); failing: Story402.Fixture (unavailable), Story402.Layout (unavailable), Story402.Missing (not-compiled)",
      "Story402.Fixture: no class-source coverage (unavailable)",
      "Story402.Layout: no class-source coverage (unavailable)",
    ]);
  });

  it("a cancelled run has the class-source lines but no target line", () => {
    const text = (coverageRunEnvelope({ run: runWith({ status: "cancelled", reason: "cancel" }), summary: ONE_PASSED }).content[0] as {
      text: string;
    }).text.split("\n");
    expect(text[0]).toMatch(/^Coverage run 645 cancelled \(cancel\)/);
    expect(text.slice(1)).toEqual(CAPTURED_TEXT.slice(2));
  });
});

describe("back-compatibility (AD-15, AD-33): a Status record without sources is exactly the 40.1 shape", () => {
  const legacy = without(STORY402_RUN, "sources", "minCoverage");

  it("has no source, no verdict and no extra key in the coverage object or in any class", () => {
    const section = buildCoverageSection(legacy);
    expect(Object.keys(section).sort()).toEqual(["classes", "complete", "unmeasured"]);
    for (const entry of section.classes) expect(Object.keys(entry).sort()).toEqual(["class", "routines"]);
  });

  it("has the 40.1 text: the status line, one line per routine, then Not measured", () => {
    const text = (coverageRunEnvelope({ run: legacy, summary: ONE_PASSED }).content[0] as { text: string }).text.split("\n");
    expect(text).toEqual([
      "Coverage run 645 completed: 1 tests, 1 passed, 0 failed, 0 skipped.",
      "Story402.Fixture.1: 33 of 46 executable INT lines covered (71.74%); uncovered 6-8, 10-13, 29, 56, 69, 71, 73, 75",
      "Story402.Layout.1: 2 of 4 executable INT lines covered (50%); uncovered 6, 8",
      "Not measured: Story402.Missing (not-compiled)",
    ]);
  });

  it("keeps every routine field the 40.1 result had, whether or not the run has sources", () => {
    const withSources = buildCoverageSection(STORY402_RUN);
    const without = buildCoverageSection(legacy);
    expect(withSources.classes.map((entry) => entry.routines)).toEqual(without.classes.map((entry) => entry.routines));
    expect(withSources.unmeasured).toEqual(without.unmeasured);
    expect(withSources.complete).toBe(without.complete);
  });
});
