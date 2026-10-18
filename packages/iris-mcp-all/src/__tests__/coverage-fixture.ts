/**
 * The Story 40.1 coverage fixture: the `Story401` classes of the disposable namespace `EXECMCPTMP401A`, and the helpers
 * the live gate (`story-40-1-coverage-live-gate.test.ts`) and, later, the Epic 40 capstone use to seed them.
 *
 *  - `Story401.Fixture` is the oracle: its INT routine `Story401.Fixture.1` has 48 lines, of which 28 are executable.
 *    The source is used verbatim, because the INT line numbers every expected value names depend on it.
 *  - `Story401.FixtureTest` has four tests (`TestClassify`, `TestSumTo`, `TestGuarded`, `TestLoop`), all of which pass.
 *  - `Story401.SlowTest` has one test that calls `SumTo(3)`, then hangs for `^Story401Hang` seconds (3 by default).
 *  - `Story401.Seed` refuses any namespace but `EXECMCPTMP401<letter>`, sets and returns the hang.
 *
 * The expected coverage values below were captured live (IRIS 2026.2 build 221U, 2026-10-18) by running
 * `Story401.FixtureTest` and `Story401.SlowTest` in `EXECMCPTMP401A` (Rule #36), and are the matrix values of the
 * Story 40.1 spec.
 */

import type { WireSession } from "./process-gate-helpers.js";
import { putCompileSeed } from "./interop-namespace-fixture.js";

type ToolSession = Pick<WireSession, "call">;

/** The only names the coverage fixtures seed into: `EXECMCPTMP401` or `EXECMCPTMP402` and one capital letter. */
const COVERAGE_FIXTURE_NAME = /^EXECMCPTMP40[12][A-Z]$/;

function assertCoverageFixtureName(name: string): void {
  if (!COVERAGE_FIXTURE_NAME.test(name)) {
    throw new Error(`"${name}" is not a fixture namespace name (EXECMCPTMP401 or EXECMCPTMP402, and one capital letter).`);
  }
}

/** The oracle class. Its INT line numbers depend on this exact source. */
export const STORY401_FIXTURE_SOURCE = String.raw`/// Synthetic coverage oracle fixture (Story 40.1).
Class Story401.Fixture
{

ClassMethod Classify(pN As %Integer) As %String
{
    Set tResult = ""
    If pN < 0 {
        Set tResult = "negative"
    } ElseIf pN = 0 {
        Set tResult = "zero"
    } Else {
        Set tResult = "positive"
    }
    Quit tResult
}

ClassMethod SumTo(pN As %Integer) As %Integer
{
    Set tSum = 0
    For tI = 1:1:pN {
        Set tSum = tSum + tI
    }
    Quit tSum
}

ClassMethod Guarded(pFail As %Boolean) As %String
{
    Set tOut = "start"
    Try {
        If pFail {
            Throw ##class(%Exception.General).%New("ProbeFail")
        }
        Set tOut = "ok"
    } Catch ex {
        Set tOut = "caught"
    }
    Quit tOut
}

ClassMethod Unused() As %String
{
    // a comment line
    Set tX = 1
    Quit tX
}

ClassMethod Loop(pN As %Integer) As %Integer
{
    Set tI = 0
    While tI < pN {
        Set tI = tI + 1
    }
    Do {
        Set tI = tI - 1
    } While tI > 0
    Quit tI
}

ClassMethod OneLine() As %Integer
{
    Quit 42
}

ClassMethod Exercise() As %Status
{
    Do ..Classify(5)
    Do ..SumTo(3)
    Quit $$$OK
}

}
`;

/** Four tests, all passing: they cover most of the oracle routine except `Unused`, `OneLine`, `Exercise` and the failure branches. */
export const STORY401_FIXTURE_TEST_SOURCE = String.raw`/// Synthetic coverage oracle test (Story 40.1).
Class Story401.FixtureTest Extends %UnitTest.TestCase
{

Method TestClassify()
{
    Do $$$AssertEquals(##class(Story401.Fixture).Classify(5), "positive", "Classify(5)")
    Do $$$AssertEquals(##class(Story401.Fixture).Classify(0), "zero", "Classify(0)")
}

Method TestSumTo()
{
    Do $$$AssertEquals(##class(Story401.Fixture).SumTo(3), 6, "SumTo(3)")
}

Method TestGuarded()
{
    Do $$$AssertEquals(##class(Story401.Fixture).Guarded(0), "ok", "Guarded(0)")
}

Method TestLoop()
{
    Do $$$AssertEquals(##class(Story401.Fixture).Loop(2), 0, "Loop(2)")
}

}
`;

/** One test that runs `SumTo(3)` and then hangs for `^Story401Hang` seconds (default 3). */
export const STORY401_SLOW_TEST_SOURCE = String.raw`/// Synthetic slow coverage test (Story 40.1).
Class Story401.SlowTest Extends %UnitTest.TestCase
{

Method TestSlow()
{
    Do $$$AssertEquals(##class(Story401.Fixture).SumTo(3), 6, "SumTo(3)")
    Hang +$Get(^Story401Hang, 3)
    Do $$$AssertTrue(1, "after the hang")
}

}
`;

/** Sets and returns the hang of `Story401.SlowTest`; refuses any namespace but `EXECMCPTMP401<letter>`. */
export const STORY401_SEED_SOURCE = String.raw`Class Story401.Seed
{

/// Set the hang of Story401.SlowTest to its default of 3 seconds; returns the JSON map of what was set.
ClassMethod Seed() As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP401"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP401 followed by one capital letter" }
    Set ^Story401Hang = 3
    Quit "{""hang"":""3""}"
}

/// Set how long Story401.SlowTest hangs, in seconds.
ClassMethod SetHang(pSeconds As %Integer) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP401"1U { Quit "REFUSED: SetHang runs only in a namespace named EXECMCPTMP401 followed by one capital letter" }
    Set ^Story401Hang = +pSeconds
    Quit +pSeconds
}

}
`;

/** The documents compiled into the fixture namespace, in order. */
export const STORY401_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story401.Fixture.cls", STORY401_FIXTURE_SOURCE],
  ["Story401.FixtureTest.cls", STORY401_FIXTURE_TEST_SOURCE],
  ["Story401.SlowTest.cls", STORY401_SLOW_TEST_SOURCE],
  ["Story401.Seed.cls", STORY401_SEED_SOURCE],
];

/** What `Story401.Seed.Seed` returns. */
export const STORY401_IDS = { hang: "3" } as const;

/**
 * Put and compile the `Story401` classes into the scratch namespace `name`, and seed the default hang.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP401<capital letter>`.
 */
export async function seedCoverageFixture(dev: WireSession, name: string): Promise<void> {
  assertCoverageFixtureName(name);
  await putCompileSeed(dev, name, STORY401_DOCUMENTS, { className: "Story401.Seed", args: [] }, STORY401_IDS, "the coverage fixture");
}

/**
 * Set how long `Story401.SlowTest` hangs in the scratch namespace `name`.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP401<capital letter>`.
 * @param seconds - The hang, in seconds.
 */
export async function setSlowTestHang(dev: ToolSession, name: string, seconds: number): Promise<void> {
  assertCoverageFixtureName(name);
  const story = name.startsWith("EXECMCPTMP402") ? "Story402" : "Story401";
  const result = await dev.call("iris_execute_classmethod", {
    namespace: name,
    className: `${story}.Seed`,
    methodName: "SetHang",
    args: [seconds],
  });
  const returned = String((result.structuredContent as { returnValue?: unknown } | undefined)?.returnValue ?? "");
  if (result.isError || returned !== String(seconds)) {
    throw new Error(`setting the hang of ${story}.SlowTest to ${seconds} in ${name} returned ${JSON.stringify(returned)}`);
  }
}

/** The routine of the oracle class, with the values of matrix row 1 (the four tests of `Story401.FixtureTest`). */
export const STORY401_ORACLE_ROUTINE = {
  routine: "Story401.Fixture.1",
  lines: 48,
  executableLines: 28,
  coveredLines: 20,
  percent: 71.43,
  executableRanges: [[6, 10], [12, 12], [14, 14], [16, 18], [20, 20], [22, 23], [25, 25], [27, 27], [29, 29], [31, 33], [36, 38], [40, 42], [44, 44], [47, 48]],
  coveredRanges: [[6, 7], [9, 10], [12, 12], [14, 14], [20, 20], [22, 22], [25, 25], [29, 29], [31, 33], [36, 38], [40, 42], [44, 44]],
} as const;

/** The coverage of the oracle routine from `Story401.SlowTest` alone: only `SumTo(3)` ran (matrix rows 5 and 7). */
export const STORY401_SLOW_ROUTINE = {
  routine: "Story401.Fixture.1",
  lines: 48,
  executableLines: 28,
  coveredLines: 4,
  percent: 14.29,
  executableRanges: STORY401_ORACLE_ROUTINE.executableRanges,
  coveredRanges: [[40, 42], [44, 44]],
} as const;

// -- Story 40.2: the class-source fixture ------------------------------------------------------------------------------
//
// The `Story402` classes of the disposable namespace `EXECMCPTMP402A`. The class line numbers every expected value names
// depend on the exact text of `Story402.Fixture` (and the `Story402.Layout` numbering on how IRIS stores it), so the sources
// are used verbatim. The expected values below are captured live (Rule #36); the same run is the dev package's
// `src/__tests__/story402-run.ts` (its Status record) and `src/__tests__/fixtures/cobertura/story402-oracle.xml` (its Cobertura
// document).

/** The class-source oracle: every executable construct the mapping rule distinguishes. Its text is IRIS's own stored layout. */
export const STORY402_FIXTURE_SOURCE = String.raw`Include %occStatus

/// Synthetic coverage-report fixture (Story 40.2).
Class Story402.Fixture Extends %RegisteredObject
{

Property Score As %Integer;

Property Label As %String [ Calculated ];

Method ScoreSet(pValue As %Integer) As %Status
{
    Set i%Score = pValue * 2
    Quit $$$OK
}

Method LabelGet() As %String
{
    Quit "L"_..Score
}

ClassMethod Plain(pN As %Integer) As %Integer
{
    Set tX = pN + 1
    Quit tX
}

ClassMethod Macro(pSC As %Status) As %String
{
    If $$$ISERR(pSC) {
        Quit "error"
    }
    $$$ThrowOnError(pSC)
    #define Twice(%x) ((%x)*2)
    Set tY = $$$Twice(3)
    Quit "ok"
}

ClassMethod MultiLine(pA As %Integer) As %List
{
    Set tList = $ListBuild(pA,
        pA + 1,
        pA + 2)
    If (pA > 0) &&
        (pA < 10) {
        Set tList = tList_$ListBuild(0)
    }
    Quit tList
}

ClassMethod Sql(pName As %String) As %Integer
{
    Set tCount = 0
    &sql(SELECT COUNT(*) INTO :tCount FROM %Dictionary.ClassDefinition WHERE Name = :pName)
    If SQLCODE < 0 Quit -1
    Quit tCount
}

ClassMethod Generated() As %Integer [ CodeMode = objectgenerator ]
{
    Do %code.WriteLine(" Set tGen = 1")
    Do %code.WriteLine(" Quit tGen")
    Quit $$$OK
}

ClassMethod Expr(pN As %Integer) As %Integer [ CodeMode = expression ]
{
pN * 3
}

ClassMethod Constant() As %Integer
{
    Quit 42
}

ClassMethod Comments() As %Integer
{
    // a comment
    /* block
       comment */
    Set tY = 1 ; trailing
    Quit tY
}

ClassMethod TwoOnOne(pN As %Integer) As %Integer
{
    Set tA = 1  Set tB = 2
    Quit tA + tB + pN
}

}
`;

/**
 * A class uploaded in a non-canonical layout (Rule #58): a doc comment directly after `{`, extra spaces, a tab-indented
 * body, no blank line between members, a two-line signature and a Python method. IRIS stores it in its own layout, so the
 * class line numbers are those of the stored document, not of this text.
 */
export const STORY402_LAYOUT_SOURCE = [
  "/// Synthetic non-canonical layout (Story 40.2).",
  "Class Story402.Layout",
  "{",
  "/// doc one",
  "/// doc two",
  "ClassMethod   Spaced(pN As %Integer) As %Integer",
  "{",
  "\tSet tX = pN\t; tab indented",
  "",
  "\tQuit tX",
  "}",
  "ClassMethod NoBlank() As %Integer",
  "{",
  " Quit 1",
  "}",
  "",
  "",
  "",
  "ClassMethod Gap(pA As %Integer,",
  "    pB As %Integer) As %Integer",
  "{",
  "    Quit pA + pB",
  "}",
  "",
  "Method Inst() As %Integer [ Private ]",
  "{",
  "    Quit ..Gap(1, 2)",
  "}",
  "",
  "ClassMethod Py() As %Integer [ Language = python ]",
  "{",
  "    return 7",
  "}",
  "}",
  "",
].join("\n");

/** A class with one method, whose compiled routine a gate row deletes while a run waits to start. */
export const STORY402_GONE_SOURCE = String.raw`/// Synthetic class whose routine is deleted (Story 40.2).
Class Story402.Gone
{

ClassMethod One() As %Integer
{
    Set tX = 1
    Quit tX
}

}
`;

/** One test that calls every `Story402.Fixture` method once, with the arguments the plan-stage probe used, and `Story402.Layout.Spaced(1)`. */
export const STORY402_FIXTURE_TEST_SOURCE = String.raw`/// Synthetic coverage-report test (Story 40.2).
Class Story402.FixtureTest Extends %UnitTest.TestCase
{

Method TestEveryMethod()
{
    Set tObject = ##class(Story402.Fixture).%New()
    Set tObject.Score = 3
    Do $$$AssertEquals(tObject.Label, "L6", "Label reads Score")
    Do $$$AssertEquals(##class(Story402.Fixture).Plain(1), 2, "Plain(1)")
    Do $$$AssertEquals(##class(Story402.Fixture).Macro(1), "ok", "Macro(1)")
    Do $$$AssertEquals($ListLength(##class(Story402.Fixture).MultiLine(5)), 4, "MultiLine(5)")
    Do $$$AssertEquals(##class(Story402.Fixture).Sql("Story402.Fixture"), 1, "Sql")
    Do $$$AssertEquals(##class(Story402.Fixture).Generated(), 1, "Generated")
    Do $$$AssertEquals(##class(Story402.Fixture).Expr(2), 6, "Expr(2)")
    Do $$$AssertEquals(##class(Story402.Fixture).Constant(), 42, "Constant")
    Do $$$AssertEquals(##class(Story402.Fixture).Comments(), 1, "Comments")
    Do $$$AssertEquals(##class(Story402.Fixture).TwoOnOne(1), 4, "TwoOnOne(1)")
    Do $$$AssertEquals(##class(Story402.Layout).Spaced(1), 1, "Spaced(1)")
}

}
`;

/** One test that calls `Plain(1)` once and then hangs for `^Story402Hang` seconds (default 3). */
export const STORY402_SLOW_TEST_SOURCE = String.raw`/// Synthetic slow coverage-report test (Story 40.2).
Class Story402.SlowTest Extends %UnitTest.TestCase
{

Method TestSlow()
{
    Do $$$AssertEquals(##class(Story402.Fixture).Plain(1), 2, "Plain(1)")
    Hang +$Get(^Story402Hang, 3)
    Do $$$AssertTrue(1, "after the hang")
}

}
`;

/** Sets and returns the hang of `Story402.SlowTest`; refuses any namespace but `EXECMCPTMP402<letter>`. */
export const STORY402_SEED_SOURCE = String.raw`Class Story402.Seed
{

/// Set the hang of Story402.SlowTest to its default of 3 seconds; returns the JSON map of what was set.
ClassMethod Seed() As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP402"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP402 followed by one capital letter" }
    Set ^Story402Hang = 3
    Quit "{""hang"":""3""}"
}

/// Set how long Story402.SlowTest hangs, in seconds.
ClassMethod SetHang(pSeconds As %Integer) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP402"1U { Quit "REFUSED: SetHang runs only in a namespace named EXECMCPTMP402 followed by one capital letter" }
    Set ^Story402Hang = +pSeconds
    Quit +pSeconds
}

}
`;

/** The documents compiled into the fixture namespace, in order. */
export const STORY402_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story402.Fixture.cls", STORY402_FIXTURE_SOURCE],
  ["Story402.Layout.cls", STORY402_LAYOUT_SOURCE],
  ["Story402.Gone.cls", STORY402_GONE_SOURCE],
  ["Story402.FixtureTest.cls", STORY402_FIXTURE_TEST_SOURCE],
  ["Story402.SlowTest.cls", STORY402_SLOW_TEST_SOURCE],
  ["Story402.Seed.cls", STORY402_SEED_SOURCE],
];

/** What `Story402.Seed.Seed` returns. */
export const STORY402_IDS = { hang: "3" } as const;

/**
 * The expected values of the oracle run (`Story402.FixtureTest`, which calls every method once and `Layout.Spaced(1)`), captured
 * live (IRIS 2026.2 build 221U, 2026-10-18; Rule #36) by running `iris_test_coverage` over `Story402.Fixture`, `Story402.Layout` and
 * `Story402.Missing` in `EXECMCPTMP402A`, and checked by hand against the stored class documents (matrix rows 1 to 3).
 *
 * The count of covered generated INT lines is not pinned: the embedded-SQL helper runs only on the first execution after a compile,
 * so the covered count of the routine's INT lines depends on whether the run is the first one. The class lines, the executable INT
 * lines and the INT ranges do not depend on it.
 */
export const STORY402_FIXTURE_SOURCE_VALUES = {
  executableLines: 23,
  coveredLines: 22,
  percent: 95.65,
  executableRanges: [[13, 14], [19, 19], [24, 25], [30, 31], [33, 33], [35, 36], [41, 41], [44, 44], [46, 46], [48, 48], [53, 56], [68, 68], [81, 82], [87, 88]],
  coveredRanges: [[13, 14], [19, 19], [24, 25], [30, 30], [33, 33], [35, 36], [41, 41], [44, 44], [46, 46], [48, 48], [53, 56], [68, 68], [81, 82], [87, 88]],
  uncoveredRanges: [[31, 31]],
  methods: [
    { method: "ScoreSet", line: 11, executableLines: 2, coveredLines: 2, percent: 100, uncoveredRanges: [] },
    { method: "LabelGet", line: 17, executableLines: 1, coveredLines: 1, percent: 100, uncoveredRanges: [] },
    { method: "Plain", line: 22, executableLines: 2, coveredLines: 2, percent: 100, uncoveredRanges: [] },
    { method: "Macro", line: 28, executableLines: 5, coveredLines: 4, percent: 80, uncoveredRanges: [[31, 31]] },
    { method: "MultiLine", line: 39, executableLines: 4, coveredLines: 4, percent: 100, uncoveredRanges: [] },
    { method: "Sql", line: 51, executableLines: 4, coveredLines: 4, percent: 100, uncoveredRanges: [] },
    { method: "Generated", line: 59, executableLines: 0, coveredLines: 0, percent: null, uncoveredRanges: [], reason: "generator" },
    { method: "Expr", line: 66, executableLines: 1, coveredLines: 1, percent: 100, uncoveredRanges: [] },
    { method: "Constant", line: 71, executableLines: 0, coveredLines: 0, percent: null, uncoveredRanges: [] },
    { method: "Comments", line: 76, executableLines: 2, coveredLines: 2, percent: 100, uncoveredRanges: [] },
    { method: "TwoOnOne", line: 85, executableLines: 2, coveredLines: 2, percent: 100, uncoveredRanges: [] },
  ],
} as const;

/** `Story402.Layout` in that run: only `Spaced` was called. */
export const STORY402_LAYOUT_SOURCE_VALUES = {
  executableLines: 4,
  coveredLines: 2,
  percent: 50,
  executableRanges: [[9, 9], [11, 11], [21, 21], [26, 26]],
  coveredRanges: [[9, 9], [11, 11]],
  uncoveredRanges: [[21, 21], [26, 26]],
  methods: [
    { method: "Spaced", line: 7, executableLines: 2, coveredLines: 2, percent: 100, uncoveredRanges: [] },
    { method: "NoBlank", line: 14, executableLines: 0, coveredLines: 0, percent: null, uncoveredRanges: [] },
    { method: "Gap", line: 19, executableLines: 1, coveredLines: 0, percent: 0, uncoveredRanges: [[21, 21]] },
    { method: "Inst", line: 24, executableLines: 1, coveredLines: 0, percent: 0, uncoveredRanges: [[26, 26]] },
    { method: "Py", line: 29, executableLines: 0, coveredLines: 0, percent: null, uncoveredRanges: [], reason: "not-objectscript" },
  ],
  generated: { executableLines: 0, coveredLines: 0 },
} as const;

/** The INT routine of `Story402.Fixture`: 76 lines, 46 executable (23 of them the class's own lines, the rest generated). */
export const STORY402_FIXTURE_ROUTINE_STABLE = {
  routine: "Story402.Fixture.1",
  lines: 76,
  executableLines: 46,
  executableRanges: [[6, 8], [10, 13], [18, 19], [21, 21], [23, 24], [26, 26], [28, 29], [31, 33], [35, 35], [38, 38], [40, 40], [42, 42], [44, 45], [47, 50], [53, 64], [66, 67], [69, 69], [71, 71], [73, 73], [75, 75]],
} as const;

/** The INT routine of `Story402.Layout`, all of it stable: 4 executable lines, 2 covered. */
export const STORY402_LAYOUT_ROUTINE = {
  routine: "Story402.Layout.1",
  lines: 11,
  executableLines: 4,
  coveredLines: 2,
  percent: 50,
  executableRanges: [[6, 6], [8, 8], [10, 11]],
  coveredRanges: [[10, 11]],
} as const;

/** What each executable class line of the oracle classes says in the stored class document (hand-written from the sources). */
export const STORY402_FIXTURE_STATEMENTS: Readonly<Record<number, string>> = {
  13: "Set i%Score = pValue * 2",
  14: "Quit $$$OK",
  19: 'Quit "L"_..Score',
  24: "Set tX = pN + 1",
  25: "Quit tX",
  30: "If $$$ISERR(pSC) {",
  31: 'Quit "error"',
  33: "$$$ThrowOnError(pSC)",
  35: "Set tY = $$$Twice(3)",
  36: 'Quit "ok"',
  41: "Set tList = $ListBuild(pA,",
  44: "If (pA > 0) &&",
  46: "Set tList = tList_$ListBuild(0)",
  48: "Quit tList",
  53: "Set tCount = 0",
  54: "&sql(SELECT COUNT(*) INTO :tCount FROM %Dictionary.ClassDefinition WHERE Name = :pName)",
  55: "If SQLCODE < 0 Quit -1",
  56: "Quit tCount",
  68: "pN * 3",
  81: "Set tY = 1 ; trailing",
  82: "Quit tY",
  87: "Set tA = 1  Set tB = 2",
  88: "Quit tA + tB + pN",
};

export const STORY402_LAYOUT_STATEMENTS: Readonly<Record<number, string>> = {
  9: "Set tX = pN\t; tab indented",
  11: "Quit tX",
  21: "Quit pA + pB",
  26: "Quit ..Gap(1, 2)",
};

/** Lines of the stored `Story402.Fixture` document that are never class lines: a `#define`, comments, continuation lines and lone braces. */
export const STORY402_FIXTURE_NEVER_EXECUTABLE: readonly string[] = [
  "#define Twice(%x) ((%x)*2)",
  "// a comment",
  "/* block",
  "comment */",
  "pA + 1,",
  "pA + 2)",
  "(pA < 10) {",
  "}",
];

/**
 * Put and compile the `Story402` classes into the scratch namespace `name`, and seed the default hang.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP402<capital letter>`.
 */
export async function seedReportFixture(dev: WireSession, name: string): Promise<void> {
  assertCoverageFixtureName(name);
  await putCompileSeed(dev, name, STORY402_DOCUMENTS, { className: "Story402.Seed", args: [] }, STORY402_IDS, "the coverage-report fixture");
}
