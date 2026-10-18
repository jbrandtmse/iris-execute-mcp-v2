/**
 * The Status record of the Story 40.2 oracle run, as the live route returned it (IRIS 2026.2 build 221U, 2026-10-18,
 * Rule #36): `Story402.FixtureTest` (one test that calls every `Story402.Fixture` method once and `Story402.Layout.Spaced`)
 * over `Story402.Fixture`, `Story402.Layout` and `Story402.Missing` in the scratch namespace EXECMCPTMP402A, started with
 * `minCoverage` 90. The skeletons, the counts and the source maps are the route's, value for value; nothing is edited to
 * match the implementation.
 *
 * The class documents the map refers to are the stored ones (`iris_doc_get` of `Story402.Fixture.cls`): for example class
 * line 31 is `        Quit "error"` (the one line of the fixture the test does not reach), 54 is the `&sql` line, 68 is
 * the expression method's `pN * 3`, and in `Story402.Layout` the lines 9 and 11 are the body of `Spaced` (the uploaded text
 * numbers them 8 and 10).
 */

import type { CoverageRun } from "../tools/test-coverage.js";

export const STORY402_RUN: CoverageRun = {
  coverageRunId: 645,
  status: "completed",
  namespace: "EXECMCPTMP402A",
  target: "Story402.FixtureTest",
  level: "class",
  pid: 1150120,
  runnerPid: 1150121,
  startedAt: "2026-10-18T08:31:16.788Z",
  finishedAt: "2026-10-18T08:31:17.953Z",
  runIndex: 1,
  releasedBy: "runner",
  cancelRequested: false,
  supervisorAlive: false,
  runnerAlive: false,
  unmeasured: [{ class: "Story402.Missing", reason: "not-compiled" }],
  minCoverage: 90,
  routines: [
    {
      class: "Story402.Fixture",
      routine: "Story402.Fixture.1",
      lines: 76,
      hits: [
        [18, 1], [19, 1], [21, 1], [23, 1], [24, 1], [26, 1], [28, 1], [31, 1], [32, 1], [33, 1], [35, 1], [38, 1],
        [40, 1], [42, 1], [44, 1], [45, 1], [47, 1], [48, 1], [49, 1], [50, 1], [53, 1], [54, 1], [55, 1], [57, 1],
        [58, 1], [59, 1], [60, 1], [61, 1], [62, 1], [63, 1], [64, 1], [66, 1], [67, 1],
      ],
      skeleton: [
        [5, "L C:methodimpl {"], [6, "C:if C:quit"], [7, "C:if C:set"], [8, "C:quit }"], [9, "L C:methodimpl {"],
        [10, "C:set"], [11, "C:if C:quit"], [12, "C:if C:set C:if C:set C:if C:set L"], [13, "C:quit }"],
        [14, "L C:methodimpl {"], [18, "C:set"], [19, "C:quit }"], [20, "L C:methodimpl {"], [21, "C:quit }"],
        [22, "L C:methodimpl {"], [23, "C:set"], [24, "C:quit }"], [25, "L C:methodimpl {"], [26, "C:quit }"],
        [27, "L C:methodimpl {"], [28, "C:if {"], [29, "C:quit"], [31, "C:set C:throw"], [32, "C:set"],
        [33, "C:quit }"], [34, "L C:methodimpl {"], [35, "C:set"], [38, "C:if"], [40, "C:set"], [42, "C:quit }"],
        [43, "L C:methodimpl {"], [44, "C:set"], [45, "C:quit }"], [46, "L C:methodimpl {"], [47, "C:set"],
        [48, "C:quit }"], [49, "L C:methodimpl { C:new"], [50, "C:set"],
        [53, "C:try { C:d } C:catch { C:if { C:d L } C:else { C:throw } }"], [54, "C:if C:quit"], [55, "C:quit }"],
        [56, "C:q"], [57, "L C:n"], [58, "C:s"], [59, "C:s"], [60, "C:s"], [61, "C:do L"], [62, "C:return"],
        [63, "C:if { C:try { C:set } C:catch { } }"], [64, "C:return"], [65, "L C:methodimpl {"],
        [66, "C:set C:set"], [67, "C:quit }"], [68, "L C:methodimpl {"], [69, "C:q }"], [70, "L C:methodimpl {"],
        [71, "C:quit L }"], [72, "L C:methodimpl {"], [73, "C:quit }"], [74, "L C:public {"], [75, "C:s"],
      ],
    },
    {
      class: "Story402.Layout",
      routine: "Story402.Layout.1",
      lines: 11,
      hits: [[10, 1], [11, 1]],
      skeleton: [
        [5, "L C:methodimpl {"], [6, "C:quit }"], [7, "L C:methodimpl {"], [8, "C:quit }"], [9, "L C:methodimpl {"],
        [10, "C:set"], [11, "C:quit }"],
      ],
    },
  ],
  sources: [
    {
      class: "Story402.Fixture",
      methods: [
        { name: "ScoreSet", line: 11, routine: "Story402.Fixture.1", intLines: [47, 48] },
        { name: "LabelGet", line: 17, routine: "Story402.Fixture.1", intLines: [26] },
        { name: "Plain", line: 22, routine: "Story402.Fixture.1", intLines: [44, 45] },
        { name: "Macro", line: 28, routine: "Story402.Fixture.1", intLines: [28, 29, 30, 31, 0, 32, 33] },
        { name: "MultiLine", line: 39, routine: "Story402.Fixture.1", intLines: [35, 36, 37, 38, 39, 40, 41, 42] },
        { name: "Sql", line: 51, routine: "Story402.Fixture.1", intLines: [50, 53, 54, 55] },
        { name: "Generated", line: 59, reason: "generator" },
        { name: "Expr", line: 66, routine: "Story402.Fixture.1", intLines: [21] },
        { name: "Constant", line: 71, routine: "", intLines: [0] },
        { name: "Comments", line: 76, routine: "Story402.Fixture.1", intLines: [15, 16, 17, 18, 19] },
        { name: "TwoOnOne", line: 85, routine: "Story402.Fixture.1", intLines: [66, 67] },
      ],
    },
    {
      class: "Story402.Layout",
      methods: [
        { name: "Spaced", line: 7, routine: "Story402.Layout.1", intLines: [10, 0, 11] },
        { name: "NoBlank", line: 14, routine: "", intLines: [0] },
        { name: "Gap", line: 19, routine: "Story402.Layout.1", intLines: [6] },
        { name: "Inst", line: 24, routine: "Story402.Layout.1", intLines: [8] },
        { name: "Py", line: 29, reason: "not-objectscript" },
      ],
    },
  ],
};

/** The class-source coverage of `Story402.Fixture` in that run, as the live gate captured it (the generated count is not pinned). */
export const STORY402_FIXTURE_SOURCE_VALUES = {
  executableLines: 23,
  coveredLines: 22,
  percent: 95.65,
  executableRanges: [[13, 14], [19, 19], [24, 25], [30, 31], [33, 33], [35, 36], [41, 41], [44, 44], [46, 46], [48, 48], [53, 56], [68, 68], [81, 82], [87, 88]],
  coveredRanges: [[13, 14], [19, 19], [24, 25], [30, 30], [33, 33], [35, 36], [41, 41], [44, 44], [46, 46], [48, 48], [53, 56], [68, 68], [81, 82], [87, 88]],
  uncoveredRanges: [[31, 31]],
} as const;

/** The class-source coverage of `Story402.Layout` in that run (only `Spaced` was called). */
export const STORY402_LAYOUT_SOURCE_VALUES = {
  executableLines: 4,
  coveredLines: 2,
  percent: 50,
  executableRanges: [[9, 9], [11, 11], [21, 21], [26, 26]],
  coveredRanges: [[9, 9], [11, 11]],
  uncoveredRanges: [[21, 21], [26, 26]],
} as const;
