/**
 * Story 40.2 (QA) live gate: what the implement stage's gate leaves open, on the BUILT dev server, in the default suite
 * (Rules #34, #36, #54, #58, #59).
 *
 * Path: the BUILT iris-dev-mcp and iris-admin-mcp dists, each spawned as its own child process and driven by the MCP SDK `Client`
 * over stdio -> `iris_test_coverage` / `iris_test_status` -> the coverage routes of the ExecuteMCPv2 service -> a supervisor job and a
 * runner job under an instance-wide Line-by-Line session; the Cobertura file is written by the spawned server process to the real
 * file system. The oracles are the stored class documents read by raw Atelier `GET /doc`, hand-written statement tables, the raw
 * coverage Status record, a regular-expression XML reader and (when the host has it) `xmllint`, the file system read with `node:fs`,
 * and the monitor read through the fixture class; never the tools under test.
 *
 * What it adds to the Story 40.2 gate (`story-40-2-coverage-reports-live-gate.test.ts`):
 *  - The class-source mapping against fixtures the implement stage did not use (Rule #58): a multi-line expression method, `_` line
 *    continuation, macros defined mid-body and used on several lines, a cursor over single-line `&sql`, an object generator, Try/Catch,
 *    loops with by-construction hit counts, a persistent class (property, index, trigger and computed code are generated), a call-mode
 *    method, and ratios that are not round. Three constructs have blocks of their own: a preprocessor line before a method's first
 *    statement, an embedded SQL statement over several lines, and a class whose line map a documentation edit removed.
 *  - `minCoverage` at its edges against a class at exactly the minimum (29 of 50 is 58 percent, which float division misses by one ulp),
 *    0, 100, a value one ulp above a class's ratio, and values between a class's unrounded and rounded percent.
 *  - The export on the real file system: path forms the guard accepts and refuses, a parent that is a file, a target that is a
 *    directory, a symlinked parent, a symlink as the target, a read-only file and a read-only directory, and that a refused export
 *    (running, cancelled, failed, unknown or mismatched run) leaves an existing file as it was.
 *  - The Cobertura file read back by a reader that shares no code with the implementation, against the summary, the raw Status record
 *    and counts known by construction.
 *  - A second namespace whose class of the same name has a different layout.
 *
 * This gate starts Line-by-Line sessions too (the package runs its files serially) and starts every row with the monitor idle: when a
 * session it did not start is active, an armed gate fails and names it, an unarmed one skips, and the session is left alone. It
 * terminates no process. Every row that starts a run ends by asserting the monitor is idle and the ownership node is unset.
 *
 * Fixtures: the disposable namespaces `EXECMCPTMP40U` (the `Story402.Qa*` classes and one routine) and `EXECMCPTMP40V` (a second
 * `Story402.QaFull`), without Interoperability, their database files, the HSCUSTOM class `ExecuteMCPv2.Temp.Story391Fixture`, and the
 * gate's own temporary directory, all removed in `afterAll`, which also asserts nothing is left and the monitor is idle. The only
 * global written outside them is the coverage service's own `^IRIS.TempExecuteMCPv2Coverage`.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773, `_SYSTEM`, HSCUSTOM). A
 * missing or stale dist, an unresolvable SDK or an unreachable IRIS skips each row with the reason, or fails with "may not be
 * skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierDocument,
  distEntry,
  docFixtures,
  fixtureDocumentNames,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  rawIrisRequest,
  resolveSdkEsmDir,
  skipTest,
  staleDistReason,
  teardownRecorder,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  FIXTURE_CLASS,
  FIXTURE_DOC,
  createInteropNamespace,
  leftovers,
  putCompileSeed,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
} from "./interop-namespace-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-2-qa-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The two scratch namespaces: the Story402 classes of U, and a second `Story402.QaFull` of a different layout in V. */
const NS_U = "EXECMCPTMP40U";
const NS_V = "EXECMCPTMP40V";
const NAMESPACES = [NS_U, NS_V];

/** The operator enables the coverage tool and the companion's cancel and export; nothing else. */
const ENABLED_GOVERNANCE = JSON.stringify({
  global: { iris_test_coverage: true, "iris_test_status:cancel": true, "iris_test_status:export": true },
});

/** The route below the web port, for raw HTTP. */
const COVERAGE_ROUTE = "/api/executemcp/v2/dev/test/coverage";

const POSIX = process.platform !== "win32";
/** A process with the privilege to ignore file modes cannot be refused by them. */
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

// -- Fixture sources ----------------------------------------------------------------------

/** Seeds the hang of `Story402.QaSlowTest` (read from `^Story402QaHang`); refuses any namespace but `EXECMCPTMP40` and one capital letter. */
const QA_SEED_SOURCE = String.raw`/// Seed of the Story 40.2 QA fixture namespaces.
Class Story402.QaSeed
{

/// Set the hang of Story402.QaSlowTest to its default of 3 seconds; returns the JSON map of what was set.
ClassMethod Seed() As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP40"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP40 followed by one capital letter" }
    Set ^Story402QaHang = 3
    Quit "{""hang"":""3""}"
}

/// Set how long Story402.QaSlowTest hangs, in seconds.
ClassMethod SetHang(pSeconds As %Integer) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP40"1U { Quit "REFUSED: SetHang runs only in a namespace named EXECMCPTMP40 followed by one capital letter" }
    Set ^Story402QaHang = +pSeconds
    Quit +pSeconds
}

}
`;

/** Constructs the implement stage's fixture did not use; every method here maps correctly (the directive and embedded SQL constructs have a block of their own). */
const DIVERSE_SOURCE = String.raw`/// Synthetic diverse coverage fixture (Story 40.2 QA).
Class Story402.QaDiverse Extends %RegisteredObject
{

/// A multi-line expression method.
ClassMethod Pick(pA As %Integer) As %String [ CodeMode = expression ]
{
$Select(pA > 0: "pos",
        pA < 0: "neg",
        1: "zero")
}

ClassMethod Text(pA As %String) As %String
{
    Set tText = "alpha"_
        pA_
        "omega"
    Set tText = tText_";//" ; trailing
    Quit tText
}

ClassMethod Macros(pN As %Integer) As %Integer
{
    Set tN = pN
    #define Inc(%v) Set %v = %v + 1
    #define Limit 3
    $$$Inc(tN)
    #dim tM As %Integer
    If tN > $$$Limit {
        $$$Inc(tN)
        $$$Inc(tN)
    }
    Set tM = tN
    Quit tM
}

ClassMethod Cursor(pName As %String) As %String
{
    Set tFound = ""
    &sql(DECLARE QaC CURSOR FOR SELECT Name FROM %Dictionary.ClassDefinition WHERE Name = :pName)
    &sql(OPEN QaC)
    &sql(FETCH QaC INTO :tName)
    If SQLCODE = 0 {
        Set tFound = tName
    }
    &sql(CLOSE QaC)
    Quit tFound
}

ClassMethod Gen() As %Integer [ CodeMode = objectgenerator ]
{
    Do %code.WriteLine(" Set tG = 1")
    If %class.Name '= "" {
        Do %code.WriteLine(" Set tG = tG + 1")
    }
    Do %code.WriteLine(" Quit tG")
    Quit $$$OK
}

ClassMethod Guard(pFail As %Boolean) As %String
{
    Set tOut = "start"
    Try {
        If pFail {
            Throw ##class(%Exception.General).%New("QaFail")
        }
        Set tOut = "ok"
    } Catch ex {
        Set tOut = "caught"
    }
    Quit tOut
}

ClassMethod Loop(pN As %Integer) As %Integer
{
    Set tSum = 0
    For tI = 1:1:pN {
        Set tSum = tSum + tI
    }
    Quit tSum
}

ClassMethod Post(pN As %Integer) As %String
{
    Quit:(pN > 5) "big"
    Quit "small"
}

ClassMethod Never(pN As %Integer) As %Integer
{
    Set tX = pN
    Set tX = tX * 2
    Quit tX
}

}
`;

/** The two constructs `INTLine` maps off the statement: a preprocessor line before a method's first statement, and an embedded SQL statement over several lines. */
const DIRECTIVES_SOURCE = String.raw`/// Synthetic directive coverage fixture (Story 40.2 QA): leading preprocessor lines and an embedded SQL statement over several lines.
Class Story402.QaDirectives Extends %RegisteredObject
{

ClassMethod Alpha(pN As %Integer) As %Integer
{
    Set tA = pN
    Quit tA
}

ClassMethod Beta(pN As %Integer) As %Integer
{
    #dim tX As %Integer
    #define Twice(%x) (%x * 2)
    Set tX = $$$Twice(pN)
    Quit tX
}

ClassMethod Gamma(pName As %String) As %Integer
{
    Set tCount = 0
    &sql(SELECT COUNT(*)
         INTO :tCount
         FROM %Dictionary.ClassDefinition
         WHERE Name = :pName)
    Quit tCount
}

ClassMethod Zeta(pN As %Integer) As %Integer
{
    #dim tOne As %Integer
    #dim tTwo As %Integer
    #dim tThree As %Integer
    #dim tFour As %Integer
    #dim tFive As %Integer
    Set tA = pN
    Set tB = tA
    Quit tB
}

}
`;

/** Property, index, trigger and computed code are generated; `Called` is a call-mode method that maps to its routine call. */
const STORE_SOURCE = String.raw`/// Synthetic persistent coverage fixture (Story 40.2 QA): the property, index, trigger and computed code are generated; Called is a call-mode method.
Class Story402.QaStore Extends %Persistent
{

Property Name As %String;

Property Upper As %String [ SqlComputeCode = {Set {Upper} = $ZConvert({Name}, "U")}, SqlComputed, Transient ];

Index NameIdx On Name;

Trigger AfterIn [ Event = INSERT, Time = AFTER ]
{
    Set tX = 1
}

ClassMethod Create(pName As %String) As %Status
{
    Set tObj = ..%New()
    Set tObj.Name = pName
    Quit tObj.%Save()
}

ClassMethod Called(pN As %Integer) As %Integer [ CodeMode = call ]
{
Called^Story402QaRtn(pN)
}

}
`;

const STORE_ROUTINE_SOURCE = `ROUTINE Story402QaRtn
Story402QaRtn ; Synthetic routine of the call-mode method (Story 40.2 QA)
 Quit
Called(n) Quit n * 2
`;

/** `count` statements `Set tN = tN + <i>`, one per line. */
function setLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `    Set tN = tN + ${index + 1}`).join("\n");
}

/** 29 of 50 executable class lines run when only `Hit` is called: exactly 58 percent, which `29 / 50 * 100` misses by one ulp (57.99999999999999). */
const RATIO_SOURCE = `/// Synthetic ratio fixture (Story 40.2 QA): Hit has 29 executable lines, Miss has 21.
Class Story402.QaRatio
{

ClassMethod Hit() As %Integer
{
    Set tN = 0
${setLines(27)}
    Quit tN
}

ClassMethod Miss() As %Integer
{
    Set tN = 0
${setLines(19)}
    Quit tN
}

}
`;

/** 2 of 3 executable class lines run when only `Hit` is called: 66.666... percent, displayed as 66.67. */
const THIRD_SOURCE = String.raw`/// Synthetic ratio fixture (Story 40.2 QA): two executable lines run, one does not.
Class Story402.QaThird
{

ClassMethod Hit() As %Integer
{
    Set tX = 1
    Quit tX
}

ClassMethod Miss(pN As %Integer) As %Integer
{
    Set tY = pN
}

}
`;

const FULL_SOURCE = String.raw`/// Synthetic fully covered fixture (Story 40.2 QA).
Class Story402.QaFull
{

ClassMethod Go() As %Integer
{
    Set tX = 1
    Quit tX
}

}
`;

/** The same class name as FULL_SOURCE with another layout and one more executable line, for the second namespace. */
const FULL_V_SOURCE = String.raw`/// Synthetic fully covered fixture of the second namespace (Story 40.2 QA).
Class Story402.QaFull
{

Parameter QA = 1;

ClassMethod Go() As %Integer
{
    Set tX = 1
    Set tY = tX + 1
    Quit tY
}

}
`;

const NEVER_SOURCE = String.raw`/// Synthetic never covered fixture (Story 40.2 QA).
Class Story402.QaNever
{

ClassMethod Skip() As %Integer
{
    Set tX = 1
    Quit tX
}

}
`;

const GONE_SOURCE = String.raw`/// Synthetic class whose routine is deleted (Story 40.2 QA).
Class Story402.QaGone
{

ClassMethod One() As %Integer
{
    Set tX = 1
    Quit tX
}

}
`;

/** Calls every method of the main run's classes once, except `Never`, `Beta`, `Miss` and `Skip`; `Pick` three times, `Loop(3)`. */
const TEST_SOURCE = String.raw`/// Synthetic coverage test that runs the Story402.Qa* fixtures once (Story 40.2 QA).
Class Story402.QaTest Extends %UnitTest.TestCase
{

Method TestEveryMethod()
{
    Do $$$AssertEquals(##class(Story402.QaDiverse).Pick(1), "pos", "Pick(1)")
    Do $$$AssertEquals(##class(Story402.QaDiverse).Pick(-1), "neg", "Pick(-1)")
    Do $$$AssertEquals(##class(Story402.QaDiverse).Pick(0), "zero", "Pick(0)")
    Do $$$AssertEquals(##class(Story402.QaDiverse).Text("-"), "alpha-omega;//", "Text")
    Do $$$AssertEquals(##class(Story402.QaDiverse).Macros(0), 1, "Macros(0)")
    Do $$$AssertEquals(##class(Story402.QaDiverse).Cursor("Story402.QaDiverse"), "Story402.QaDiverse", "Cursor")
    Do $$$AssertEquals(##class(Story402.QaDiverse).Gen(), 2, "Gen")
    Do $$$AssertEquals(##class(Story402.QaDiverse).Guard(0), "ok", "Guard(0)")
    Do $$$AssertEquals(##class(Story402.QaDiverse).Loop(3), 6, "Loop(3)")
    Do $$$AssertEquals(##class(Story402.QaDiverse).Post(1), "small", "Post(1)")
    Do $$$AssertEquals(##class(Story402.QaDirectives).Alpha(2), 2, "Alpha(2)")
    Do $$$AssertEquals(##class(Story402.QaDirectives).Gamma("Story402.QaDirectives"), 1, "Gamma")
    Do $$$AssertStatusOK(##class(Story402.QaStore).Create("qa"), "Create")
    Do $$$AssertEquals(##class(Story402.QaStore).Called(4), 8, "Called(4)")
    Do $$$AssertEquals(##class(Story402.QaRatio).Hit(), 378, "Hit")
    Do $$$AssertEquals(##class(Story402.QaThird).Hit(), 1, "Hit")
    Do $$$AssertEquals(##class(Story402.QaFull).Go(), 1, "Go")
}

}
`;

/** The light test of the verdict rows: Full runs, Ratio and Third run `Hit`, Never does not run. */
const LIGHT_TEST_SOURCE = String.raw`/// Synthetic light coverage test (Story 40.2 QA).
Class Story402.QaLightTest Extends %UnitTest.TestCase
{

Method TestLight()
{
    Do $$$AssertEquals(##class(Story402.QaFull).Go(), 1, "Go")
    Do $$$AssertEquals(##class(Story402.QaRatio).Hit(), 378, "Hit")
    Do $$$AssertEquals(##class(Story402.QaThird).Hit(), 1, "Hit")
}

}
`;

const SLOW_TEST_SOURCE = String.raw`/// Synthetic slow coverage test: runs Full, then hangs for ^Story402QaHang seconds (Story 40.2 QA).
Class Story402.QaSlowTest Extends %UnitTest.TestCase
{

Method TestSlow()
{
    Do $$$AssertEquals(##class(Story402.QaFull).Go(), 1, "Go")
    Hang +$Get(^Story402QaHang, 3)
    Do $$$AssertTrue(1, "after the hang")
}

}
`;

/** A class compiled, then changed without being compiled again (QA-14 puts it that way). */
const UTD_SOURCE = String.raw`/// Synthetic class that is compiled and then changed (Story 40.2 QA).
Class Story402.QaUtd
{

ClassMethod Go() As %Integer
{
    Set tX = 1
    Quit tX
}

}
`;

const UTD_TEST_SOURCE = String.raw`/// Synthetic test that runs Story402.QaUtd and Story402.QaFull (Story 40.2 QA).
Class Story402.QaUtdTest Extends %UnitTest.TestCase
{

Method TestBoth()
{
    Do $$$AssertEquals(##class(Story402.QaUtd).Go(), 1, "Go")
    Do $$$AssertEquals(##class(Story402.QaFull).Go(), 1, "Go")
}

}
`;

/** A class compiled, then documented without being compiled again (QA-15). */
const STALE_SOURCE = String.raw`/// Synthetic class that is documented after it is compiled (Story 40.2 QA).
Class Story402.QaStale
{

ClassMethod Go() As %Integer
{
    Set tX = 1
    Quit tX
}

}
`;

/** The same class with a documentation comment above its method: one line more, nothing else. */
const STALE_DOCUMENTED_SOURCE = STALE_SOURCE.replace("ClassMethod Go()", "/// What Go returns.\nClassMethod Go()");

const STALE_TEST_SOURCE = String.raw`/// Synthetic test that runs Story402.QaStale (Story 40.2 QA).
Class Story402.QaStaleTest Extends %UnitTest.TestCase
{

Method TestGo()
{
    Do $$$AssertEquals(##class(Story402.QaStale).Go(), 1, "Go")
}

}
`;

const V_TEST_SOURCE = String.raw`/// Synthetic coverage test of the second namespace (Story 40.2 QA).
Class Story402.QaTest Extends %UnitTest.TestCase
{

Method TestFull()
{
    Do $$$AssertEquals(##class(Story402.QaFull).Go(), 2, "Go")
}

}
`;

const U_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story402QaRtn.mac", STORE_ROUTINE_SOURCE],
  ["Story402.QaDiverse.cls", DIVERSE_SOURCE],
  ["Story402.QaDirectives.cls", DIRECTIVES_SOURCE],
  ["Story402.QaStore.cls", STORE_SOURCE],
  ["Story402.QaRatio.cls", RATIO_SOURCE],
  ["Story402.QaThird.cls", THIRD_SOURCE],
  ["Story402.QaFull.cls", FULL_SOURCE],
  ["Story402.QaNever.cls", NEVER_SOURCE],
  ["Story402.QaGone.cls", GONE_SOURCE],
  ["Story402.QaTest.cls", TEST_SOURCE],
  ["Story402.QaLightTest.cls", LIGHT_TEST_SOURCE],
  ["Story402.QaSlowTest.cls", SLOW_TEST_SOURCE],
  ["Story402.QaSeed.cls", QA_SEED_SOURCE],
];
const V_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story402.QaFull.cls", FULL_V_SOURCE],
  ["Story402.QaTest.cls", V_TEST_SOURCE],
  ["Story402.QaSeed.cls", QA_SEED_SOURCE],
];

/** The classes of the main run, in the order the result lists them. */
const MAIN_CLASSES = [
  "Story402.QaDiverse",
  "Story402.QaDirectives",
  "Story402.QaStore",
  "Story402.QaRatio",
  "Story402.QaThird",
  "Story402.QaFull",
  "Story402.QaNever",
];

/** The classes of the verdict rows: 100, 58, 66.67 and 0 percent. */
const VERDICT_CLASSES = ["Story402.QaFull", "Story402.QaRatio", "Story402.QaThird", "Story402.QaNever"];

/** Every class list a run of this gate may measure, as the routine sets the safety net may have to stop. */
const SAFETY_NET_SETS = [
  MAIN_CLASSES,
  VERDICT_CLASSES,
  ["Story402.QaFull"],
  ["Story402.QaFull", "Story402.QaGone"],
  ["Story402.QaUtd", "Story402.QaFull"],
  ["Story402.QaUtd"],
  ["Story402.QaStale"],
].map((classes) => classes.map((name) => `${name}.1`).join(","));

// -- What the stored class documents say, written by hand --------------------------------------

type Range = [number, number];

/**
 * The statement at each executable class line of `Story402.QaDiverse` as the stored document shows it, written by hand from the
 * source: the first line of a multi-line statement, never a continuation line, a preprocessor line, a lone brace, a `Try {` or
 * `} Catch ex {` line, a comment, or the `DECLARE` of a cursor (declarative); the body of the object generator runs at compile time.
 */
const DIVERSE_STATEMENTS: Readonly<Record<number, string>> = {
  8: '$Select(pA > 0: "pos",',
  15: 'Set tText = "alpha"_',
  18: 'Set tText = tText_";//" ; trailing',
  19: "Quit tText",
  24: "Set tN = pN",
  27: "$$$Inc(tN)",
  29: "If tN > $$$Limit {",
  30: "$$$Inc(tN)",
  31: "$$$Inc(tN)",
  33: "Set tM = tN",
  34: "Quit tM",
  39: 'Set tFound = ""',
  41: "&sql(OPEN QaC)",
  42: "&sql(FETCH QaC INTO :tName)",
  43: "If SQLCODE = 0 {",
  44: "Set tFound = tName",
  46: "&sql(CLOSE QaC)",
  47: "Quit tFound",
  62: 'Set tOut = "start"',
  64: "If pFail {",
  65: 'Throw ##class(%Exception.General).%New("QaFail")',
  67: 'Set tOut = "ok"',
  69: 'Set tOut = "caught"',
  71: "Quit tOut",
  76: "Set tSum = 0",
  77: "For tI = 1:1:pN {",
  78: "Set tSum = tSum + tI",
  80: "Quit tSum",
  85: 'Quit:(pN > 5) "big"',
  86: 'Quit "small"',
  91: "Set tX = pN",
  92: "Set tX = tX * 2",
  93: "Quit tX",
};

/** The lines of that document that are never class lines, by their text. */
const DIVERSE_NEVER_EXECUTABLE: readonly string[] = [
  'pA < 0: "neg",',
  '1: "zero")',
  "pA_",
  '"omega"',
  "#define Inc(%v) Set %v = %v + 1",
  "#define Limit 3",
  "#dim tM As %Integer",
  "&sql(DECLARE QaC CURSOR FOR SELECT Name FROM %Dictionary.ClassDefinition WHERE Name = :pName)",
  "Try {",
  "} Catch ex {",
  "}",
  "{",
];

/** What `Story402.QaTest` leaves uncovered in `Story402.QaDiverse`, by construction: the `If` body of `Macros(0)`, `Guard(0)`'s `Throw` and `Catch` body, and `Never`. */
const DIVERSE_UNCOVERED: Range[] = [[30, 31], [65, 65], [69, 69], [91, 93]];

/** The methods of `Story402.QaDiverse` in document order, with the numbers the statements above give. */
const DIVERSE_METHODS = [
  { method: "Pick", line: 6, executableLines: 1, coveredLines: 1, percent: 100, uncoveredRanges: [] },
  { method: "Text", line: 13, executableLines: 3, coveredLines: 3, percent: 100, uncoveredRanges: [] },
  { method: "Macros", line: 22, executableLines: 7, coveredLines: 5, percent: 71.43, uncoveredRanges: [[30, 31]] },
  { method: "Cursor", line: 37, executableLines: 7, coveredLines: 7, percent: 100, uncoveredRanges: [] },
  { method: "Gen", line: 50, executableLines: 0, coveredLines: 0, percent: null, uncoveredRanges: [], reason: "generator" },
  { method: "Guard", line: 60, executableLines: 6, coveredLines: 4, percent: 66.67, uncoveredRanges: [[65, 65], [69, 69]] },
  { method: "Loop", line: 74, executableLines: 4, coveredLines: 4, percent: 100, uncoveredRanges: [] },
  { method: "Post", line: 83, executableLines: 2, coveredLines: 2, percent: 100, uncoveredRanges: [] },
  { method: "Never", line: 89, executableLines: 3, coveredLines: 0, percent: 0, uncoveredRanges: [[91, 93]] },
] as const;

/** `Story402.QaStore`: `Create` has three lines, `Called` one (its routine call); the trigger, the computed code and the property methods are generated. */
const STORE_STATEMENTS: Readonly<Record<number, string>> = {
  18: "Set tObj = ..%New()",
  19: "Set tObj.Name = pName",
  20: "Quit tObj.%Save()",
  25: "Called^Story402QaRtn(pN)",
};

/**
 * What `Story402.QaDirectives` reports: statement lines only. The multi-line `&sql(` statement is one class line, the first line
 * that maps to its code, which is the line after the `&sql(` line (line 22 maps to a comment-only INT line).
 */
const DIRECTIVES_STATEMENTS_BY_CONTRACT: Readonly<Record<number, string>> = {
  7: "Set tA = pN",
  8: "Quit tA",
  15: "Set tX = $$$Twice(pN)",
  16: "Quit tX",
  21: "Set tCount = 0",
  23: "INTO :tCount",
  26: "Quit tCount",
  36: "Set tA = pN",
  37: "Set tB = tA",
  38: "Quit tB",
};

// -- The run, the result and the files ----------------------------------------------------------

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
let tempDir = "";

function wireOptions(pkg: string): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: distEntry(REPO_ROOT, pkg), target: TARGET, clientName: "story-40-2-qa-live-gate" };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The raw Atelier oracle for the documents of namespace `namespace`. */
const oracleTarget = (namespace: string): typeof TARGET => ({ ...TARGET, namespace });

interface MonitorStateJson {
  active: number;
  count: number;
  pids: string;
  routines: string[];
}

interface MethodSummary {
  method: string;
  line: number | null;
  executableLines: number;
  coveredLines: number;
  percent: number | null;
  uncoveredRanges: Range[];
  reason?: string;
}

interface ClassSourceContent {
  executableLines: number;
  coveredLines: number;
  percent: number | null;
  executableRanges: Range[];
  coveredRanges: Range[];
  uncoveredRanges: Range[];
  methods: MethodSummary[];
  generated: { executableLines: number; coveredLines: number };
  reason?: string;
}

interface Verdict {
  minCoverage: number;
  overall: string;
  percent: number | null;
  classes: Array<{ class: string; verdict: string; percent: number | null; reason?: string }>;
}

interface CoverageContent {
  status: string;
  total?: number;
  passed?: number;
  coverageRunId: number;
  runIndex: number | null;
  namespace: string;
  error?: string;
  cobertura?: { outputPath: string; bytes: number; classes: number; lines: number };
  coverage?: {
    complete: boolean;
    classes: Array<{ class: string; source?: ClassSourceContent }>;
    unmeasured: Array<{ class: string; reason: string }>;
    source?: { executableLines: number; coveredLines: number; percent: number | null };
    verdict?: Verdict;
  };
}

/** The Status record of a run as the raw route returns it: the INT counts and skeletons and the class-source map. */
interface RawRun {
  status: string;
  namespace: string;
  finishedAt: string;
  minCoverage?: number;
  routines: Array<{ class: string; routine: string; hits: Array<[number, number]>; skeleton: Array<[number, string]> }>;
  sources: Array<{
    class: string;
    reason?: string;
    methods: Array<{ name: string; line: number | null; reason?: string; routine?: string; intLines?: number[]; labelLine?: number }>;
  }>;
}

async function fixtureCall(methodName: string, args: unknown[] = []): Promise<string> {
  const result = await dev.call("iris_execute_classmethod", { namespace: "HSCUSTOM", className: FIXTURE_CLASS, methodName, args });
  expect(result.isError, allText(result)).toBeFalsy();
  return String(result.structuredContent?.["returnValue"] ?? "");
}

/** `$System.OBJ.IsUpToDate(className)` in U, as the string `1` or `0`: whether IRIS thinks the compiled class matches its definition. */
async function objIsUpToDate(className: string): Promise<string> {
  const result = await dev.call("iris_execute_classmethod", { namespace: NS_U, className: "%SYSTEM.OBJ", methodName: "IsUpToDate", args: [className] });
  expect(result.isError, allText(result)).toBeFalsy();
  return String(result.structuredContent?.["returnValue"] ?? "");
}

async function monitorState(): Promise<MonitorStateJson> {
  return JSON.parse(await fixtureCall("MonitorState")) as MonitorStateJson;
}

/** A node of the coverage service's IRISTEMP global, as `{value, defined}`. */
async function coverageGlobal(subscripts: string): Promise<{ value: unknown; defined: boolean }> {
  const result = await dev.call("iris_global_get", { namespace: "HSCUSTOM", global: "IRIS.TempExecuteMCPv2Coverage", subscripts });
  expect(result.isError, allText(result)).toBeFalsy();
  const content = result.structuredContent as { value?: unknown; defined?: boolean } | undefined;
  return { value: content?.value, defined: content?.defined === true };
}

async function runCounter(): Promise<number> {
  return Number((await coverageGlobal('"seq"')).value ?? 0);
}

/** The monitor is idle and no coverage ownership node is left: the end of every row that starts a run. */
async function expectIdle(row: string): Promise<void> {
  const state = await monitorState();
  expect(state.active, `${row}: the monitor is idle afterwards (process list "${state.pids}")`).toBe(0);
  expect((await coverageGlobal('"session"')).defined, `${row}: no ownership node is left`).toBe(false);
}

/** Stop a session a failed row left behind: the fixture stops it only when it is provably one of the candidate routine sets. */
async function releaseLeftover(): Promise<void> {
  for (const routines of SAFETY_NET_SETS) {
    if ((await monitorState()).active === 0) return;
    await fixtureCall("StopIfList", [routines]);
  }
}

function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

/** `iris_test_coverage` over U for the main run, with `overrides`. */
function coverage(overrides: Record<string, unknown> = {}): Promise<WireToolResult> {
  return dev.call("iris_test_coverage", {
    target: "Story402.QaTest",
    level: "class",
    classes: MAIN_CLASSES,
    namespace: NS_U,
    ...overrides,
  });
}

/** The verdict rows' run: the four ratio classes under the light test, with `minCoverage`. */
function verdictRun(minCoverage: number, overrides: Record<string, unknown> = {}): Promise<WireToolResult> {
  return coverage({ target: "Story402.QaLightTest", classes: VERDICT_CLASSES, minCoverage, ...overrides });
}

/** The companion's poll by the handle alone: through the session's `raw` call, so no namespace is sent. */
function poll(coverageRunId: number | string): Promise<WireToolResult> {
  return dev.raw("iris_test_status", { server: "default", action: "poll", coverageRunId: String(coverageRunId) });
}

/** The companion's export. */
function exportRun(coverageRunId: number | string, outputPath: string, extra: Record<string, unknown> = {}): Promise<WireToolResult> {
  return dev.raw("iris_test_status", { server: "default", action: "export", coverageRunId: String(coverageRunId), outputPath, ...extra });
}

/** The Status route of the service, raw: the run record. */
async function rawStatus(coverageRunId: number): Promise<RawRun> {
  const answer = await rawIrisRequest(TARGET, `${COVERAGE_ROUTE}?id=${coverageRunId}`, { method: "GET" });
  expect(answer.status).toBe(200);
  return ((answer.json as { result?: unknown } | undefined)?.result ?? {}) as RawRun;
}

/** The class source of one class of a coverage result. */
function sourceOf(content: CoverageContent, className: string): ClassSourceContent {
  const entry = content.coverage?.classes.find((candidate) => candidate.class === className);
  expect(entry?.source, `${className} has a class-source result`).toBeDefined();
  return entry?.source as ClassSourceContent;
}

const expand = (ranges: Range[]): number[] => ranges.flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, index) => start + index));

/** The stored class document of `className` in `namespace`, one string per line, read by raw Atelier `GET /doc`. */
async function storedDocument(namespace: string, className: string): Promise<string[]> {
  return (await atelierDocument(oracleTarget(namespace), `${className}.cls`)).content;
}

/** The trimmed text of class line `line` of a stored document. */
const textAt = (stored: string[], line: number): string => (stored[line - 1] ?? "").trim();

/** The main run, started once by the first row that needs it and shared read-only: every row that uses it asserts the monitor idle itself. */
interface MainRun {
  content: CoverageContent;
  result: WireToolResult;
  raw: RawRun;
}
let mainRunPromise: Promise<MainRun> | undefined;
function mainRun(): Promise<MainRun> {
  mainRunPromise ??= (async () => {
    const result = await coverage();
    const content = succeeded<CoverageContent>(result);
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 1, namespace: NS_U });
    expect(content.coverage?.complete).toBe(true);
    expect(content.coverage?.unmeasured, "every class of the main run was measured").toEqual([]);
    return { content, result, raw: await rawStatus(content.coverageRunId) };
  })();
  return mainRunPromise;
}

/** A directory below the gate's temporary directory, created for one row. */
function freshDirectory(name: string): string {
  const directory = path.join(tempDir, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

/** The names in a directory, sorted; `[]` for one that is not there. */
function listing(directory: string): string[] {
  return existsSync(directory) ? readdirSync(directory).sort() : [];
}

/** Temporary files the export leaves beside its target (`.<name>.<pid>.<time>.tmp`). */
function strayTemporaries(directory: string): string[] {
  return listing(directory).filter((name) => name.endsWith(".tmp"));
}

// -- A reader of the Cobertura text that shares no code with the implementation ------------------

interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

/**
 * Read an XML document whose attributes are double-quoted, as the export writes it, with a tokenizer of its own: the prolog and the
 * DOCTYPE are skipped, every tag is matched, and the document is rejected unless the tags and the text between them cover it exactly.
 */
function readXml(xml: string): XmlElement {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "").replace(/^<!DOCTYPE[^>]*>\s*/, "");
  const token = /<(\/?)([A-Za-z][A-Za-z0-9_-]*)((?:\s+[A-Za-z][A-Za-z0-9_-]*="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let consumed = 0;
  for (const match of body.matchAll(token)) {
    consumed += match[0].length;
    const [, closing, name, attributeText, selfClosing, text] = match;
    const top = stack[stack.length - 1] as XmlElement;
    if (text !== undefined) {
      top.text += text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] as string);
      continue;
    }
    if (closing === "/") {
      expect(top.name, `the closing tag </${name}> closes ${top.name}`).toBe(name);
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const attribute of (attributeText ?? "").matchAll(/([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g)) {
      attrs[attribute[1] as string] = (attribute[2] as string).replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] as string);
    }
    const element: XmlElement = { name: name as string, attrs, children: [], text: "" };
    top.children.push(element);
    if (selfClosing !== "/") stack.push(element);
  }
  expect(consumed, "the tokenizer covers the whole document").toBe(body.length);
  expect(stack.length, "every tag is closed").toBe(1);
  expect(root.children.length, "one root element").toBe(1);
  return root.children[0] as XmlElement;
}

const childrenNamed = (element: XmlElement, name: string): XmlElement[] => element.children.filter((child) => child.name === name);
const pairsOf = (lines: XmlElement | undefined): Array<[number, number]> =>
  (lines?.children ?? []).map((line) => [Number(line.attrs["number"]), Number(line.attrs["hits"])] as [number, number]);

/** `covered / valid` as the contract writes a rate: 4 decimal places, no trailing zeros, `1` when nothing is valid. */
const rateOf = (covered: number, valid: number): string => (valid === 0 ? "1" : String(Math.round((covered / valid) * 10000) / 10000));

interface ReadClass {
  package: string;
  name: string;
  filename: string;
  rate: string;
  methods: Array<{ name: string; rate: string; lines: Array<[number, number]> }>;
  lines: Array<[number, number]>;
}

function readCobertura(xml: string): { root: XmlElement; classes: ReadClass[]; packages: XmlElement[] } {
  const root = readXml(xml);
  expect(root.name).toBe("coverage");
  const packages = childrenNamed(childrenNamed(root, "packages")[0] as XmlElement, "package");
  const classes: ReadClass[] = [];
  for (const pack of packages) {
    for (const klass of childrenNamed(childrenNamed(pack, "classes")[0] as XmlElement, "class")) {
      const methods = childrenNamed(childrenNamed(klass, "methods")[0] as XmlElement, "method");
      classes.push({
        package: pack.attrs["name"] as string,
        name: klass.attrs["name"] as string,
        filename: klass.attrs["filename"] as string,
        rate: klass.attrs["line-rate"] as string,
        methods: methods.map((method) => ({
          name: method.attrs["name"] as string,
          rate: method.attrs["line-rate"] as string,
          lines: pairsOf(childrenNamed(method, "lines")[0]),
        })),
        lines: pairsOf(childrenNamed(klass, "lines")[0]),
      });
    }
  }
  return { root, classes, packages };
}

/** The hits of every class line of `className`, derived from the raw Status record: INT line of body line k, then that INT line's count. */
function rawHitsByClassLine(raw: RawRun, className: string): Map<number, { method: string; hits: number }> {
  const source = raw.sources.find((candidate) => candidate.class === className);
  const hits = new Map<string, number>();
  for (const routine of raw.routines.filter((candidate) => candidate.class === className)) {
    for (const [line, count] of routine.hits) hits.set(`${routine.routine}:${line}`, count);
  }
  const lines = new Map<number, { method: string; hits: number }>();
  for (const method of source?.methods ?? []) {
    (method.intLines ?? []).forEach((intLine, index) => {
      if (intLine > 0 && method.line !== null) {
        lines.set(method.line + 2 + index, { method: method.name, hits: hits.get(`${method.routine}:${intLine}`) ?? 0 });
      }
    });
  }
  return lines;
}

/** Is `xmllint` on this host? The file is cross-checked with it when it is. */
const XMLLINT = spawnSync("xmllint", ["--version"], { encoding: "utf8" }).error === undefined;

// -- Setup and teardown ------------------------------------------------

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else if (!(await isIrisReachable(TARGET.host, TARGET.port))) {
      skipReason = `IRIS is not reachable at http://${TARGET.host}:${TARGET.port}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.2 QA live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  dev = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_GOVERNANCE: ENABLED_GOVERNANCE });
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  await putFixtureClass(dev);

  // Every row starts with the monitor idle. A session this gate did not start is named and left alone.
  const initial = await monitorState();
  if (initial.active !== 0) {
    const named = `a Line-by-Line or PERFMON session this gate did not start is active (process list "${initial.pids}", ${initial.count} routine(s): ${JSON.stringify(initial.routines)}); it was left untouched`;
    await admin.close();
    await removeFixtureClass(dev);
    await dev.close();
    if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.2 QA live gate may not be skipped: ${named}`);
    skipReason = named;
    return;
  }

  tempDir = mkdtempSync(path.join(tmpdir(), "story-40-2-qa-"));
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);
  for (const name of NAMESPACES) await createInteropNamespace(admin, dev, name, { interop: false });
  await putCompileSeed(dev, NS_U, U_DOCUMENTS, { className: "Story402.QaSeed", args: [] }, { hang: "3" }, "the QA coverage-report fixture");
  await putCompileSeed(dev, NS_V, V_DOCUMENTS, { className: "Story402.QaSeed", args: [] }, { hang: "3" }, "the QA second-namespace fixture");

  // A positive control: the same check that must read empty after the run sees both namespaces now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees both namespaces while they exist").toEqual(
    expect.arrayContaining([`namespace ${NS_U}`, `database configuration ${NS_U}`, `namespace ${NS_V}`, `database configuration ${NS_V}`]),
  );
}, 300000);

afterEach(async () => {
  if (skipReason) return;
  // A row that fails must not leave its session behind for the rows after it.
  await releaseLeftover();
});

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
    await attempt("stopping a coverage session left behind", releaseLeftover);
    await attempt("letting go of a runner lock left behind", async () => {
      await fixtureCall("ReleaseRunnerLock", [(await runCounter()) + 1]);
    });
    await attempt("the monitor is idle", async () => {
      expect((await monitorState()).active, "the monitor is idle after the run").toBe(0);
    });
    await attempt("no coverage ownership node is left", async () => {
      expect((await coverageGlobal('"session"')).defined, "no suite session node after the run").toBe(false);
    });
    for (const name of NAMESPACES) await attempt(`removing ${name}`, () => removeInteropNamespace(admin, dev, name));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, NAMESPACES), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the temporary directory", async () => {
      if (tempDir) {
        // A directory a row made read-only is made writable again so that it can go.
        for (const name of ["rodir"]) if (existsSync(path.join(tempDir, name))) chmodSync(path.join(tempDir, name), 0o755);
        rmSync(tempDir, { recursive: true, force: true });
      }
      expect(tempDir !== "" && existsSync(tempDir), "the temporary directory is gone").toBe(false);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story402", "Story391Fixture"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- The mapping against fixtures the implement stage did not use (Rule #58) ----------------------

describe("Story 40.2 QA: the class-source mapping against unseen fixtures (AC-1, matrix rows 1 and 2)", () => {
  it("QA-1: Story402.QaDiverse reports exactly the statements its stored document shows, never a continuation, a preprocessor line, a brace, a Try or Catch line or a cursor DECLARE, with the uncovered lines the test leaves by construction", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await mainRun();
    const stored = await storedDocument(NS_U, "Story402.QaDiverse");
    expect(stored.join("\n"), "IRIS stored the class in the layout it was uploaded in, so the hand-counted lines are the stored ones").toBe(DIVERSE_SOURCE);

    const source = sourceOf(content, "Story402.QaDiverse");
    const executable = expand(source.executableRanges);
    expect(executable, "exactly the hand-listed statements are executable").toEqual(Object.keys(DIVERSE_STATEMENTS).map(Number));
    for (const line of executable) expect(textAt(stored, line), `Story402.QaDiverse line ${line}`).toBe(DIVERSE_STATEMENTS[line]);

    const never = stored.map((text, index) => ({ line: index + 1, text: text.trim() })).filter((entry) => DIVERSE_NEVER_EXECUTABLE.includes(entry.text) || entry.text.startsWith("///"));
    expect(never.length, "the document has many such lines").toBeGreaterThanOrEqual(25);
    for (const entry of never) expect(executable, `line ${entry.line} (${entry.text}) is not executable`).not.toContain(entry.line);

    expect(source).toMatchObject({ executableLines: 33, coveredLines: 26, percent: 78.79 });
    expect(source.uncoveredRanges).toEqual(DIVERSE_UNCOVERED);
    expect(expand(source.coveredRanges), "covered and uncovered partition the executable lines").toEqual(executable.filter((line) => !expand(DIVERSE_UNCOVERED).includes(line)));
    expect(source.methods).toEqual(DIVERSE_METHODS);
    expect(source.generated.executableLines, "the compiler's own code (the cursor helper and the rest) is counted per class").toBeGreaterThan(0);
    expect(source.generated.coveredLines).toBeLessThanOrEqual(source.generated.executableLines);
    await expectIdle("QA-1");
  }, 300000);

  it("QA-2: the persistent Story402.QaStore reports Create and the call-mode Called as class lines and its trigger, computed code and property methods only as generated code", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await mainRun();
    const stored = await storedDocument(NS_U, "Story402.QaStore");
    const source = sourceOf(content, "Story402.QaStore");
    const executable = expand(source.executableRanges);
    expect(executable).toEqual(Object.keys(STORE_STATEMENTS).map(Number));
    for (const line of executable) expect(textAt(stored, line), `Story402.QaStore line ${line}`).toBe(STORE_STATEMENTS[line]);
    // The trigger's `Set tX = 1` (line 13) and the Storage definition the compiler appended are never class lines.
    expect(textAt(stored, 13)).toBe("Set tX = 1");
    expect(executable).not.toContain(13);
    expect(stored.findIndex((text) => text === "Storage Default") + 1, "the compiler appended a Storage definition after the last member").toBeGreaterThan(26);
    expect(source).toMatchObject({ executableLines: 4, coveredLines: 4, percent: 100, uncoveredRanges: [] });
    expect(source.methods).toEqual([
      { method: "Create", line: 16, executableLines: 3, coveredLines: 3, percent: 100, uncoveredRanges: [] },
      { method: "Called", line: 23, executableLines: 1, coveredLines: 1, percent: 100, uncoveredRanges: [] },
    ]);
    expect(source.generated.executableLines, "a persistent class's property, index, trigger and computed code is generated").toBeGreaterThan(100);
    expect(source.generated.coveredLines).toBeGreaterThan(0);
    await expectIdle("QA-2");
  }, 300000);

  it("QA-3: counts known by construction: Pick ran three times, the loop body three times and its For line once, and the Cobertura hits are the INT counts of the raw record for every class line", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content, raw } = await mainRun();
    const byLine = rawHitsByClassLine(raw, "Story402.QaDiverse");
    expect(byLine.get(8), "Pick's one line ran for Pick(1), Pick(-1) and Pick(0)").toEqual({ method: "Pick", hits: 3 });
    expect(byLine.get(78), "Loop(3) runs its body three times").toEqual({ method: "Loop", hits: 3 });
    expect(byLine.get(77), "and its For line once").toEqual({ method: "Loop", hits: 1 });
    expect(byLine.get(76)).toEqual({ method: "Loop", hits: 1 });
    expect(byLine.get(91), "Never never ran").toEqual({ method: "Never", hits: 0 });
    const source = sourceOf(content, "Story402.QaDiverse");
    for (const line of expand(source.executableRanges)) {
      expect(byLine.has(line), `class line ${line} has a mapped INT line in the raw record`).toBe(true);
      expect(expand(source.coveredRanges).includes(line), `line ${line}: covered exactly when its INT count is above 0`).toBe((byLine.get(line)?.hits ?? 0) > 0);
    }
    await expectIdle("QA-3");
  }, 300000);
});

describe("Story 40.2 QA: the INT block of a method and one class line per statement (AC-1: a preprocessor line and a continuation line are never executable)", () => {
  let run: MainRun;
  beforeAll(async () => {
    if (!skipReason) run = await mainRun();
  }, 300000);

  it("QA-3a: the raw map has no INT line for a preprocessor line and maps a multi-line &sql statement onto its one code line, with each method's label line", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const methods = (name: string) => run.raw.sources.find((entry) => entry.class === "Story402.QaDirectives")?.methods.find((method) => method.name === name);
    const skeleton = new Map(run.raw.routines.find((routine) => routine.class === "Story402.QaDirectives")?.skeleton ?? []);
    // Beta's body is `#dim`, `#define`, `Set`, `Quit`. The compiler maps its first two lines onto Alpha's own INT lines 6 and 7, before
    // Beta's label line (8); the IRIS side gives a preprocessor line no INT line.
    expect(methods("Alpha")).toMatchObject({ intLines: [6, 7], labelLine: 5 });
    expect(methods("Beta"), "Beta's leading #dim and #define have no INT line; its statements keep theirs").toMatchObject({ intLines: [0, 0, 9, 10], labelLine: 8 });
    expect(skeleton.get(6), "Alpha's lines are executable lines").toBe("C:set");
    expect(skeleton.get(7)).toBe("C:quit }");
    // Gamma's &sql statement spans four lines: its first line maps to a comment-only INT line (no skeleton entry), the other three to the one code line.
    expect(methods("Gamma")).toMatchObject({ intLines: [12, 13, 18, 18, 18, 19], labelLine: 11 });
    expect(skeleton.has(13), "the first &sql line maps to a comment-only INT line").toBe(false);
    expect(skeleton.get(18), "the continuation lines map to the executable try line").toMatch(/^C:try \{/);

    // What the summary reports (the statement lines are in DIRECTIVES_STATEMENTS_BY_CONTRACT).
    const source = sourceOf(run.content, "Story402.QaDirectives");
    expect(source.executableRanges).toEqual([[7, 8], [15, 16], [21, 21], [23, 23], [26, 26], [36, 38]]);
    expect(source.coveredRanges, "Beta and Zeta never ran, and their directive lines carry nobody's counts").toEqual([[7, 8], [21, 21], [23, 23], [26, 26]]);
    expect(source.uncoveredRanges).toEqual([[15, 16], [36, 38]]);
    expect(source).toMatchObject({ executableLines: 10, coveredLines: 5, percent: 50 });
    expect(source.methods.map((method) => [method.method, method.executableLines, method.coveredLines])).toEqual([
      ["Alpha", 2, 2],
      ["Beta", 2, 0],
      ["Gamma", 3, 3],
      ["Zeta", 3, 0],
    ]);
    await expectIdle("QA-3a");
  }, 300000);

  it("QA-3d: Zeta has five leading #dim lines, and the summary reports its three statements and none of the #dim lines", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const zeta = run.raw.sources.find((entry) => entry.class === "Story402.QaDirectives")?.methods.find((method) => method.name === "Zeta");
    const labelLine = zeta?.labelLine ?? 0;
    expect(labelLine, "Zeta compiled to INT code").toBeGreaterThan(0);
    expect(zeta?.intLines?.slice(0, 5), "no #dim line has an INT line").toEqual([0, 0, 0, 0, 0]);
    expect((zeta?.intLines ?? []).slice(5).every((intLine) => intLine > labelLine), "its statements are in its own INT block").toBe(true);
    const stored = await storedDocument(NS_U, "Story402.QaDirectives");
    for (const line of [31, 32, 33, 34, 35]) expect(textAt(stored, line), `line ${line} is a #dim line`).toMatch(/^#dim /);
    const source = sourceOf(run.content, "Story402.QaDirectives");
    expect(source.methods.find((method) => method.method === "Zeta")).toMatchObject({ line: 29, executableLines: 3, coveredLines: 0, uncoveredRanges: [[36, 38]] });
    for (const [line, text] of [[36, "Set tA = pN"], [37, "Set tB = tA"], [38, "Quit tB"]] as const) expect(textAt(stored, line)).toBe(text);
    await expectIdle("QA-3d");
  }, 300000);

  it("QA-3b: Beta reports only its two statements, so a method that never ran has no covered line", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const source = sourceOf(run.content, "Story402.QaDirectives");
    const beta = source.methods.find((method) => method.method === "Beta");
    expect(beta).toMatchObject({ executableLines: 2, coveredLines: 0, percent: 0, uncoveredRanges: [[15, 16]] });
  }, 300000);

  it("QA-3c: Gamma reports its &sql statement once, at the first line that maps to its code (the line after the &sql( line), and no other continuation line", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const source = sourceOf(run.content, "Story402.QaDirectives");
    expect(expand(source.executableRanges)).toEqual(Object.keys(DIRECTIVES_STATEMENTS_BY_CONTRACT).map(Number));
    const stored = await storedDocument(NS_U, "Story402.QaDirectives");
    expect(textAt(stored, 22), "the &sql( line is not a class line").toBe("&sql(SELECT COUNT(*)");
    expect(textAt(stored, 23), "the line after it is the statement's class line").toBe("INTO :tCount");
    expect(source.methods.find((method) => method.method === "Gamma")).toMatchObject({ executableLines: 3, coveredLines: 3, percent: 100 });
  }, 300000);
});

// -- minCoverage at its edges -----------------------------------------------------------------------------

/** The verdict of each class of the verdict rows, in the order the classes were listed. */
function verdictsOf(verdict: Verdict | undefined): string[] {
  return (verdict?.classes ?? []).map((entry) => `${entry.class.replace("Story402.Qa", "")}:${entry.verdict}`);
}

describe("Story 40.2 QA: minCoverage at its edges (AC-2, matrix rows 4 to 6) against classes at 100, 58, 66.67 and 0 percent", () => {
  const cases: Array<{ min: number; classes: string[]; overall: string; text: string; note: string }> = [
    {
      min: 0,
      classes: ["Full:pass", "Ratio:pass", "Third:pass", "Never:pass"],
      overall: "pass",
      text: "Coverage target 0%: PASS (57.89% overall)",
      note: "a class at 0 percent meets a minimum of 0",
    },
    {
      min: 100,
      classes: ["Full:pass", "Ratio:fail", "Third:fail", "Never:fail"],
      overall: "fail",
      text: "Coverage target 100%: FAIL (57.89% overall); failing: Story402.QaRatio 58%, Story402.QaThird 66.67%, Story402.QaNever 0%",
      note: "only the fully covered class meets 100",
    },
    {
      min: 58,
      classes: ["Full:pass", "Ratio:pass", "Third:pass", "Never:fail"],
      overall: "fail",
      text: "Coverage target 58%: FAIL (57.89% overall); failing: Story402.QaNever 0%",
      note: "29 of 50 meets 58 exactly (29 / 50 * 100 is 57.99999999999999 in floating point), while the 33 of 57 aggregate does not",
    },
    {
      min: 58.00000000000001,
      classes: ["Full:pass", "Ratio:fail", "Third:pass", "Never:fail"],
      overall: "fail",
      text: "Coverage target 58.00000000000001%: FAIL (57.89% overall); failing: Story402.QaRatio 58%, Story402.QaNever 0%",
      note: "one ulp above the class's ratio fails it, and the minimum survives the trip through IRIS",
    },
    {
      min: 66.6666,
      classes: ["Full:pass", "Ratio:fail", "Third:pass", "Never:fail"],
      overall: "fail",
      text: "Coverage target 66.6666%: FAIL (57.89% overall); failing: Story402.QaRatio 58%, Story402.QaNever 0%",
      note: "below the unrounded 66.6666... percent",
    },
    {
      min: 66.668,
      classes: ["Full:pass", "Ratio:fail", "Third:fail", "Never:fail"],
      overall: "fail",
      text: "Coverage target 66.668%: FAIL (57.89% overall); failing: Story402.QaRatio 58%, Story402.QaThird 66.67%, Story402.QaNever 0%",
      note: "between the unrounded 66.6666... and the displayed 66.67 percent",
    },
  ];

  for (const entry of cases) {
    it(`QA-4: minCoverage ${entry.min} -> ${entry.classes.join(", ")}, overall ${entry.overall}: ${entry.note}; isError stays false, the stored minimum round-trips, and the companion reproduces the result`, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const result = await verdictRun(entry.min);
      expect(result.isError, allText(result)).toBeFalsy();
      const content = result.structuredContent as unknown as CoverageContent;
      expect(content.status).toBe("completed");
      expect(content.coverage?.source, "the aggregate over the four classes").toEqual({ executableLines: 57, coveredLines: 33, percent: 57.89 });
      expect(content.coverage?.classes.map((klass) => [klass.class, (klass.source as ClassSourceContent).percent])).toEqual([
        ["Story402.QaFull", 100],
        ["Story402.QaRatio", 58],
        ["Story402.QaThird", 66.67],
        ["Story402.QaNever", 0],
      ]);
      expect(content.coverage?.verdict?.minCoverage, "the verdict carries the minimum exactly").toBe(entry.min);
      expect(verdictsOf(content.coverage?.verdict)).toEqual(entry.classes);
      expect(content.coverage?.verdict?.overall).toBe(entry.overall);
      expect(allText(result).split("\n")[1]).toBe(entry.text);
      expect((await rawStatus(content.coverageRunId)).minCoverage, "IRIS stores the minimum without losing a digit").toBe(entry.min);

      const polled = await poll(content.coverageRunId);
      expect(polled.structuredContent, "the companion reproduces the primary result from the handle alone").toEqual(result.structuredContent);
      await expectIdle(`QA-4 (${entry.min})`);
    }, 300000);
  }

  it("QA-4b: a class list that is all fully covered passes overall at exactly 100, and a one-class list at its own percent passes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const full = await verdictRun(100, { classes: ["Story402.QaFull"] });
    expect(full.isError, allText(full)).toBeFalsy();
    const fullVerdict = (full.structuredContent as unknown as CoverageContent).coverage?.verdict;
    expect(fullVerdict).toEqual({ minCoverage: 100, overall: "pass", percent: 100, classes: [{ class: "Story402.QaFull", verdict: "pass", percent: 100 }] });
    expect(allText(full).split("\n")[1]).toBe("Coverage target 100%: PASS (100% overall)");

    const third = await verdictRun(66.67, { classes: ["Story402.QaThird"] });
    const thirdVerdict = (third.structuredContent as unknown as CoverageContent).coverage?.verdict;
    expect(thirdVerdict, "the displayed 66.67 is above the unrounded ratio, so the class fails although it shows the minimum").toMatchObject({ overall: "fail", percent: 66.67 });
    await expectIdle("QA-4b");
  }, 300000);
});

// -- A second namespace ----------------------------------------------------------------------------

describe("Story 40.2 QA: a second namespace with a class of the same name and a different layout (Rule #34)", () => {
  it("QA-5: Story402.QaFull in V reports its own lines, its export carries them, and the run is exported only under its own namespace", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const inU = sourceOf((await mainRun()).content, "Story402.QaFull");
    const result = await coverage({ target: "Story402.QaTest", classes: ["Story402.QaFull"], namespace: NS_V });
    const content = succeeded<CoverageContent>(result);
    expect(content).toMatchObject({ status: "completed", namespace: NS_V });
    const inV = sourceOf(content, "Story402.QaFull");
    const stored = await storedDocument(NS_V, "Story402.QaFull");
    expect(inU.executableRanges, "U's class has two lines").toEqual([[7, 8]]);
    expect(inV.executableRanges, "V's class of the same name has three, further down").toEqual([[9, 11]]);
    for (const line of [9, 10, 11]) expect(textAt(stored, line)).toBe(["Set tX = 1", "Set tY = tX + 1", "Quit tY"][line - 9]);
    expect(inV).toMatchObject({ executableLines: 3, coveredLines: 3, percent: 100 });

    const directory = freshDirectory("second-namespace");
    const refused = await exportRun(content.coverageRunId, path.join(directory, "wrong.xml"), { namespace: NS_U });
    expect(refused.isError, allText(refused)).toBe(true);
    expect(allText(refused)).toContain(NS_V);
    expect(listing(directory), "a mismatched namespace writes nothing").toEqual([]);

    const exported = await exportRun(content.coverageRunId, path.join(directory, "right.xml"), { namespace: NS_V });
    expect(exported.isError, allText(exported)).toBeFalsy();
    const read = readCobertura(readFileSync(path.join(directory, "right.xml"), "utf8"));
    expect(read.classes.map((klass) => [klass.name, klass.filename, klass.lines])).toEqual([["Story402.QaFull", "Story402/QaFull.cls", [[9, 1], [10, 1], [11, 1]]]]);

    // IRIS namespace names are not case sensitive, so the check against the run's namespace is not either.
    const lower = await exportRun(content.coverageRunId, path.join(directory, "lower.xml"), { namespace: NS_V.toLowerCase() });
    expect(lower.isError, allText(lower)).toBeFalsy();
    expect(readFileSync(path.join(directory, "lower.xml"), "utf8")).toBe(readFileSync(path.join(directory, "right.xml"), "utf8"));
    await expectIdle("QA-5");
  }, 300000);
});

// -- The Cobertura file read back by an independent reader ---------------------------------------------

describe("Story 40.2 QA: the exported Cobertura file against the summary, the raw record and the stored documents (AC-4)", () => {
  it("QA-6: the file, read by a reader that shares no code with the writer, equals the summary class by class, method by method and line by line, with the rates, totals, timestamp and file names the contract gives, and xmllint agrees when the host has it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content, raw } = await mainRun();
    const directory = freshDirectory("independent");
    const target = path.join(directory, "main.xml");
    const exported = await exportRun(content.coverageRunId, target, { sourceRoot: "src & <more>" });
    expect(exported.isError, allText(exported)).toBeFalsy();
    const xml = readFileSync(target, "utf8");
    const { root, classes, packages } = readCobertura(xml);

    // Packages and classes: one package, the classes in the order of the request, each with its path below an iris_doc_export destination.
    expect(packages.map((pack) => pack.attrs["name"])).toEqual(["Story402"]);
    expect(classes.map((klass) => [klass.name, klass.filename])).toEqual(MAIN_CLASSES.map((name) => [name, `Story402/${name.slice("Story402.".length)}.cls`]));

    // Every class: the file's lines are the summary's executable lines, with hits above 0 exactly on the covered ones.
    let totalValid = 0;
    let totalCovered = 0;
    for (const klass of classes) {
      const source = sourceOf(content, klass.name);
      expect(klass.lines.map(([line]) => line), `${klass.name}: the file's lines are the summary's executable lines`).toEqual(expand(source.executableRanges));
      const covered = new Set(expand(source.coveredRanges));
      for (const [line, hits] of klass.lines) expect(hits > 0, `${klass.name} line ${line}`).toBe(covered.has(line));
      // The hits are the INT counts of the raw record, derived here from the class-source map and the hits table.
      const derived = rawHitsByClassLine(raw, klass.name);
      for (const [line, hits] of klass.lines) expect({ line, hits }, `${klass.name} line ${line}: the hits are the raw INT count`).toEqual({ line, hits: derived.get(line)?.hits });
      // The methods: one per mapped method with a class line, in document order, holding exactly its lines.
      expect(klass.methods.map((method) => method.name)).toEqual(source.methods.filter((method) => method.executableLines > 0).map((method) => method.method));
      expect(klass.methods.flatMap((method) => method.lines).sort((a, b) => a[0] - b[0])).toEqual(klass.lines);
      for (const method of klass.methods) {
        const mine = method.lines.filter(([, hits]) => hits > 0).length;
        expect(method.rate, `${klass.name}.${method.name}: the line rate`).toBe(rateOf(mine, method.lines.length));
      }
      expect(klass.rate, `${klass.name}: the line rate`).toBe(rateOf(covered.size, klass.lines.length));
      totalValid += klass.lines.length;
      totalCovered += klass.lines.filter(([, hits]) => hits > 0).length;
    }

    // Counts known by construction survive into the file.
    const diverse = classes.find((klass) => klass.name === "Story402.QaDiverse") as ReadClass;
    const hitsAt = (line: number): number | undefined => diverse.lines.find(([number]) => number === line)?.[1];
    expect([hitsAt(8), hitsAt(76), hitsAt(77), hitsAt(78), hitsAt(91)], "Pick x3, the loop's init once, its For line once, its body x3, Never none").toEqual([3, 1, 1, 3, 0]);
    expect(diverse.methods.find((method) => method.name === "Loop")?.lines).toEqual([[76, 1], [77, 1], [78, 3], [80, 1]]);

    // The document element: totals, rates, branch fields, the producer and the finish time of the run.
    expect(root.attrs).toMatchObject({
      "lines-valid": String(totalValid),
      "lines-covered": String(totalCovered),
      "line-rate": rateOf(totalCovered, totalValid),
      "branch-rate": "0",
      "branches-covered": "0",
      "branches-valid": "0",
      complexity: "0",
      timestamp: String(Date.parse(raw.finishedAt)),
    });
    expect(root.attrs["version"]).toMatch(/^iris-mcp-dev \d+\.\d+\.\d+/);
    expect(totalValid, "the totals are the summary's over the classes with a result").toBe(content.coverage?.source?.executableLines);
    expect(totalCovered).toBe(content.coverage?.source?.coveredLines);
    for (const pack of packages) {
      expect(pack.attrs["line-rate"]).toBe(rateOf(totalCovered, totalValid));
    }
    // The one <source> holds the XML-escaped root and reads back as given.
    expect(xml).toContain("<source>src &amp; &lt;more&gt;</source>");
    expect(childrenNamed(childrenNamed(root, "sources")[0] as XmlElement, "source").map((source) => source.text)).toEqual(["src & <more>"]);
    expect(exported.structuredContent?.["cobertura"]).toEqual({ outputPath: path.resolve(target), bytes: Buffer.byteLength(xml), classes: MAIN_CLASSES.length, lines: totalValid });

    // A second reader: the host's xmllint, when there is one.
    if (XMLLINT) {
      const parsed = spawnSync("xmllint", ["--noout", "--nonet", target], { encoding: "utf8" });
      expect(parsed.status, `xmllint: ${parsed.stderr}`).toBe(0);
      const count = spawnSync("xmllint", ["--nonet", "--xpath", "count(//class/lines/line)", target], { encoding: "utf8" });
      expect(Number(count.stdout), "xmllint counts the same class lines").toBe(totalValid);
      const names = spawnSync("xmllint", ["--nonet", "--xpath", "string(//class[3]/@name)", target], { encoding: "utf8" });
      expect(names.stdout.trim(), "xmllint reads the third class").toBe("Story402.QaStore");
    }
    await expectIdle("QA-6");
  }, 300000);
});

// -- The path guard and the file system -------------------------------------------------------------------

describe("Story 40.2 QA: the export's path guard and write on the real file system (AC-6)", () => {
  it("QA-7: every refused outputPath form is an error naming outputPath, is refused before any lookup (a handle that does not exist is never reported missing), and writes nothing, in the temporary directory or in the server's working directory", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const ghost = "999999999";
    const directory = freshDirectory("refused");
    const beforeTemp = listing(tempDir);
    const beforeCwd = listing(process.cwd());
    const cases: Array<[string, string, RegExp]> = [
      ["relative", "out/coverage.xml", /outputPath 'out\/coverage\.xml' must be an absolute path/],
      ["current-directory relative", "./coverage.xml", /outputPath '\.\/coverage\.xml' must be an absolute path/],
      ["tilde", "~/coverage.xml", /outputPath '~\/coverage\.xml' must be an absolute path/],
      ["bare file name", "coverage.xml", /outputPath 'coverage\.xml' must be an absolute path/],
      ["a URL", "file:///tmp/coverage.xml", /outputPath 'file:\/\/\/tmp\/coverage\.xml' must be an absolute path/],
      ["white space", " ", /outputPath ' ' must be an absolute path/],
      ["empty", "", /outputPath must be a non-empty string/],
      ["a .. segment", `${directory}/sub/../coverage.xml`, /must not contain '\.\.'/],
      ["a .. segment in the other separator style", `${directory}\\..\\coverage.xml`, /must not contain '\.\.'/],
      ["a trailing ..", `${directory}/..`, /must not contain '\.\.'/],
      ["a directory path", `${directory}/`, /must end in \.xml/],
      ["no extension", `${directory}/coverage`, /must end in \.xml/],
      ["another extension", `${directory}/coverage.txt`, /must end in \.xml/],
      ["xml as a name only", `${directory}/xml`, /must end in \.xml/],
      ["a longer extension", `${directory}/coverage.xmlx`, /must end in \.xml/],
      ["a second extension after it", `${directory}/coverage.xml.bak`, /must end in \.xml/],
    ];
    for (const [name, outputPath, expected] of cases) {
      const result = await exportRun(ghost, outputPath);
      expect(result.isError, `${name}: ${allText(result)}`).toBe(true);
      expect(allText(result), name).toMatch(expected);
      expect(allText(result), `${name}: validation comes before any lookup`).not.toContain("was not found");
      expect(allText(result), name).toContain("nothing was written");
    }
    // A source root that cannot be written into the document is refused the same way.
    for (const [name, sourceRoot, expected] of [
      ["an empty source root", "", /sourceRoot must not be empty/],
      ["a source root with a control character", "src\nmore", /sourceRoot must not contain control characters/],
    ] as const) {
      const result = await exportRun(ghost, `${directory}/root.xml`, { sourceRoot });
      expect(result.isError, `${name}: ${allText(result)}`).toBe(true);
      expect(allText(result), name).toMatch(expected);
      expect(allText(result), `${name}: validation comes before any lookup`).not.toContain("was not found");
    }
    expect(listing(directory), "nothing was written in the directory the paths named").toEqual([]);
    expect(listing(tempDir), "or beside it").toEqual(beforeTemp);
    expect(listing(process.cwd()), "or in the working directory of the test process (the server's)").toEqual(beforeCwd);

    // Control: a good path with the same handle IS looked up, so the validation above is what stopped the others.
    const control = await exportRun(ghost, `${directory}/control.xml`);
    expect(control.isError).toBe(true);
    expect(allText(control)).toContain("was not found");
    expect(listing(directory)).toEqual([]);
  }, 120000);

  it("QA-8: the accepted path forms: an upper-case extension, a . segment, spaces and non-ASCII names, missing parents, and the same bytes everywhere", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await mainRun();
    const directory = freshDirectory("accepted");
    const reference = path.join(directory, "reference.xml");
    expect((await exportRun(content.coverageRunId, reference)).isError).toBeFalsy();
    const bytes = readFileSync(reference);

    const forms: Array<[string, string, string]> = [
      ["an upper-case extension", path.join(directory, "UPPER.XML"), path.join(directory, "UPPER.XML")],
      ["a . segment", `${directory}/dot/./inside/dotted.xml`, path.join(directory, "dot", "inside", "dotted.xml")],
      ["spaces and non-ASCII names", path.join(directory, "with space", "d\u00efr \u00fcn\u00ef\u00e7\u00f6de", "c\u00f6verage.xml"), path.join(directory, "with space", "d\u00efr \u00fcn\u00ef\u00e7\u00f6de", "c\u00f6verage.xml")],
      ["several missing parents", path.join(directory, "a", "b", "c", "d", "deep.xml"), path.join(directory, "a", "b", "c", "d", "deep.xml")],
      ["a double separator", `${directory}//double.xml`, path.join(directory, "double.xml")],
    ];
    for (const [name, requested, resolved] of forms) {
      const result = await exportRun(content.coverageRunId, requested);
      expect(result.isError, `${name}: ${allText(result)}`).toBeFalsy();
      expect((result.structuredContent as unknown as CoverageContent).cobertura?.outputPath, `${name}: the result names the resolved absolute path`).toBe(resolved);
      expect(readFileSync(resolved).equals(bytes), `${name}: the same bytes as the reference export`).toBe(true);
      expect(strayTemporaries(path.dirname(resolved)), `${name}: no temporary file is left`).toEqual([]);
    }
    await expectIdle("QA-8");
  }, 300000);

  it("QA-9: a parent that is a file, a grandparent that is a file, a target that is a directory, a NUL in the path and a file name past the limit are errors that say the file could not be written, and leave every existing file as it was", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await mainRun();
    const directory = freshDirectory("unwritable");
    const afile = path.join(directory, "afile");
    writeFileSync(afile, "FILE");
    const adirectory = path.join(directory, "dirtarget.xml");
    mkdirSync(adirectory);
    writeFileSync(path.join(adirectory, "inside.txt"), "INSIDE");
    const before = listing(directory);

    const cases: Array<[string, string]> = [
      ["a parent that is a file", path.join(afile, "coverage.xml")],
      ["a grandparent that is a file", path.join(afile, "x", "y", "coverage.xml")],
      ["a target that is a directory", adirectory],
      ["a NUL in the path", path.join(directory, "nul\u0000.xml")],
      ["a file name past the limit", path.join(directory, `${"n".repeat(300)}.xml`)],
    ];
    for (const [name, outputPath] of cases) {
      const result = await exportRun(content.coverageRunId, outputPath);
      expect(result.isError, `${name}: ${allText(result)}`).toBe(true);
      expect(allText(result), name).toContain("could not be written");
      expect(allText(result), name).toContain("Nothing was written.");
    }
    expect(readFileSync(afile, "utf8"), "the file that was in the way is untouched").toBe("FILE");
    expect(statSync(adirectory).isDirectory()).toBe(true);
    expect(readFileSync(path.join(adirectory, "inside.txt"), "utf8")).toBe("INSIDE");
    expect(listing(directory), "no file or directory was added, no temporary file is left").toEqual(before);
    expect(strayTemporaries(directory)).toEqual([]);
    await expectIdle("QA-9");
  }, 300000);

  it.skipIf(!POSIX)("QA-10: a symlinked parent is followed (the file lands in the directory it points to and the result names the path as given), and a symlink as the target is replaced, never written through", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await mainRun();
    const directory = freshDirectory("symlinks");
    const reference = path.join(directory, "reference.xml");
    expect((await exportRun(content.coverageRunId, reference)).isError).toBeFalsy();
    const bytes = readFileSync(reference);

    // A symlinked parent inside the temporary directory.
    const real = path.join(directory, "real");
    mkdirSync(real);
    symlinkSync(real, path.join(directory, "link"));
    const viaLink = path.join(directory, "link", "coverage.xml");
    const followed = await exportRun(content.coverageRunId, viaLink);
    expect(followed.isError, allText(followed)).toBeFalsy();
    expect((followed.structuredContent as unknown as CoverageContent).cobertura?.outputPath, "the path is resolved, not realpath'ed").toBe(viaLink);
    expect(readFileSync(path.join(real, "coverage.xml")).equals(bytes), "the file is in the directory the link points to").toBe(true);

    // A symlink as the target: the file it points to is not written through.
    const victim = path.join(directory, "victim.xml");
    writeFileSync(victim, "KEEP");
    const target = path.join(directory, "target.xml");
    symlinkSync(victim, target);
    const replaced = await exportRun(content.coverageRunId, target);
    expect(replaced.isError, allText(replaced)).toBeFalsy();
    expect(readFileSync(victim, "utf8"), "the file the symlink pointed to is untouched").toBe("KEEP");
    expect(lstatSync(target).isSymbolicLink(), "the symlink itself was replaced by the file").toBe(false);
    expect(readFileSync(target).equals(bytes)).toBe(true);

    // A dangling symlink as the target is replaced too, and what it pointed at is not created.
    const missing = path.join(directory, "nowhere", "created.xml");
    const dangling = path.join(directory, "dangling.xml");
    symlinkSync(missing, dangling);
    const overDangling = await exportRun(content.coverageRunId, dangling);
    expect(overDangling.isError, allText(overDangling)).toBeFalsy();
    expect(existsSync(path.dirname(missing)), "nothing was created where the dangling link pointed").toBe(false);
    expect(lstatSync(dangling).isSymbolicLink()).toBe(false);
    expect(strayTemporaries(directory)).toEqual([]);
    await expectIdle("QA-10");
  }, 300000);

  it.skipIf(!POSIX || IS_ROOT)("QA-11: an existing read-only file is replaced, as the contract says an existing file is overwritten, and a read-only directory is an error that leaves it empty", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await mainRun();
    const directory = freshDirectory("modes");
    const reference = path.join(directory, "reference.xml");
    expect((await exportRun(content.coverageRunId, reference)).isError).toBeFalsy();
    const bytes = readFileSync(reference);

    const readOnlyFile = path.join(directory, "readonly.xml");
    writeFileSync(readOnlyFile, "OLD");
    chmodSync(readOnlyFile, 0o444);
    const replaced = await exportRun(content.coverageRunId, readOnlyFile);
    expect(replaced.isError, allText(replaced)).toBeFalsy();
    expect(readFileSync(readOnlyFile).equals(bytes), "the read-only file now holds the document (the write is a rename over it)").toBe(true);

    const readOnlyDirectory = path.join(tempDir, "rodir");
    mkdirSync(readOnlyDirectory);
    chmodSync(readOnlyDirectory, 0o555);
    try {
      const refused = await exportRun(content.coverageRunId, path.join(readOnlyDirectory, "coverage.xml"));
      expect(refused.isError, allText(refused)).toBe(true);
      expect(allText(refused)).toContain("could not be written");
      expect(listing(readOnlyDirectory), "nothing was written, not even a temporary file").toEqual([]);
    } finally {
      chmodSync(readOnlyDirectory, 0o755);
    }
    await expectIdle("QA-11");
  }, 300000);
});

// -- Refused exports leave an existing file as it was ------------------------------------------------------

/** Assert that `file` is exactly as `snapshot` recorded it. */
function expectUntouched(file: string, snapshot: { content: string; mtimeMs: number }, row: string): void {
  expect(readFileSync(file, "utf8"), `${row}: the existing file keeps its content`).toBe(snapshot.content);
  expect(statSync(file).mtimeMs, `${row}: and its modification time`).toBe(snapshot.mtimeMs);
}

describe("Story 40.2 QA: an export that is refused leaves an existing file at outputPath as it was (AC-6, matrix row 11)", () => {
  it("QA-12: a running run, the same run after a cancel, an unknown handle, a malformed handle and a mismatched namespace are each refused with the file untouched", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const completed = await mainRun();
    const directory = freshDirectory("untouched");
    const keep = path.join(directory, "keep.xml");
    writeFileSync(keep, "KEEP");
    // Backdated by hours, not years: the operating system's temp-directory cleaner removes files untouched for days.
    const past = new Date(Math.floor((Date.now() - 6 * 3600 * 1000) / 1000) * 1000);
    utimesSync(keep, past, past);
    const snapshot = { content: "KEEP", mtimeMs: statSync(keep).mtimeMs };

    // A run that is still executing.
    const setHang = async (seconds: number): Promise<void> => {
      const result = await dev.call("iris_execute_classmethod", { namespace: NS_U, className: "Story402.QaSeed", methodName: "SetHang", args: [seconds] });
      expect(String(result.structuredContent?.["returnValue"] ?? ""), allText(result)).toBe(String(seconds));
    };
    await setHang(20);
    try {
      const started = succeeded<CoverageContent>(await coverage({ target: "Story402.QaSlowTest", classes: ["Story402.QaFull"], timeout: 1 }));
      expect(started.status, "the budget expired with the run still executing").toBe("running");
      try {
        const running = await exportRun(started.coverageRunId, keep);
        expect(running.isError, allText(running)).toBe(true);
        expect(allText(running)).toContain("its status is running, and only a completed run can be");
        expect(allText(running), "advice for a run that will finish").toContain("Wait for it");
        expectUntouched(keep, snapshot, "a running run");
        expect(((await poll(started.coverageRunId)).structuredContent as unknown as CoverageContent).status, "the run is unaffected by the refused export").toBe("running");
      } finally {
        const cancelled = await dev.raw("iris_test_status", { server: "default", action: "cancel", coverageRunId: String(started.coverageRunId) });
        expect(cancelled.structuredContent).toMatchObject({ status: "cancelled" });
      }
      const afterCancel = await exportRun(started.coverageRunId, keep);
      expect(afterCancel.isError, allText(afterCancel)).toBe(true);
      expect(allText(afterCancel)).toContain("its status is cancelled, and only a completed run can be");
      expect(allText(afterCancel), "a cancelled run will not finish: no advice to wait").not.toContain("Wait for it");
      expect(allText(afterCancel)).toContain("Run the tests again.");
      expectUntouched(keep, snapshot, "a cancelled run");
    } finally {
      await setHang(3);
    }
    await expectIdle("QA-12, after the cancel");

    // A handle that names no run, malformed handles (the schema refuses them before the tool runs), and the wrong namespace.
    const unknown = await exportRun("999999998", keep);
    expect(unknown.isError, allText(unknown)).toBe(true);
    expect(allText(unknown)).toContain("was not found");
    expectUntouched(keep, snapshot, "an unknown handle");
    for (const handle of ["abc", "-1", "1.5", "0x10", " 12", "12 ", ""]) {
      let refused: { isError: boolean; text: string };
      try {
        const result = await exportRun(handle, keep);
        refused = { isError: result.isError === true, text: allText(result) };
      } catch (error) {
        refused = { isError: true, text: error instanceof Error ? error.message : String(error) };
      }
      expect(refused.isError, `handle ${JSON.stringify(handle)}: ${refused.text}`).toBe(true);
      expect(refused.text, `handle ${JSON.stringify(handle)}`).not.toContain("was not found");
      expectUntouched(keep, snapshot, `handle ${JSON.stringify(handle)}`);
    }
    const mismatch = await exportRun(completed.content.coverageRunId, keep, { namespace: NS_V });
    expect(mismatch.isError, allText(mismatch)).toBe(true);
    expect(allText(mismatch)).toContain(NS_U);
    expectUntouched(keep, snapshot, "a mismatched namespace");
  }, 300000);

  it("QA-13: a run that failed because a measured routine disappeared before its start is refused with no advice to wait, and an existing file is untouched", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const directory = freshDirectory("failed");
    const keep = path.join(directory, "keep.xml");
    writeFileSync(keep, "KEEP");
    const snapshot = { content: "KEEP", mtimeMs: statSync(keep).mtimeMs };

    // The class is compiled again, forced (an earlier row may have deleted its object code); the runner waits for its lock while
    // the routine is deleted, so its session cannot load it and the run ends failed with no test run.
    const compiled = await dev.call("iris_doc_compile", { namespace: NS_U, doc: "Story402.QaGone.cls", flags: "ck" });
    expect(compiled.isError, allText(compiled)).toBeFalsy();
    const next = (await runCounter()) + 1;
    expect(await fixtureCall("HoldRunnerLock", [next, 8])).toBe("held");
    let pending: Promise<WireToolResult> | undefined;
    let result: WireToolResult | undefined;
    try {
      pending = coverage({ target: "Story402.QaLightTest", classes: ["Story402.QaFull", "Story402.QaGone"] });
      pending.catch(() => undefined);
      const deadline = Date.now() + 15000;
      while (!(await coverageGlobal(`"run",${next},"status"`)).defined && Date.now() < deadline) await sleep(100);
      expect((await coverageGlobal(`"run",${next},"status"`)).value, "the run exists and its runner is still waiting for its lock").toBe("starting");
      expect(await fixtureCall("DeleteObjectCode", [NS_U, "Story402.QaGone.1"])).toBe("deleted");
    } finally {
      await fixtureCall("ReleaseRunnerLock", [next]);
      result = pending === undefined ? undefined : await pending;
    }
    expect(result?.isError, allText(result ?? {})).toBe(true);
    const failed = result?.structuredContent as unknown as CoverageContent;
    expect(failed).toMatchObject({ status: "failed", coverageRunId: next });
    expect(failed.error).toContain("Story402.QaGone.1");
    await expectIdle("QA-13, as soon as the run is terminal");

    const refused = await exportRun(next, keep);
    expect(refused.isError, allText(refused)).toBe(true);
    expect(allText(refused)).toContain("its status is failed, and only a completed run can be");
    expect(allText(refused), "a failed run will not finish: no advice to wait").not.toContain("Wait for it");
    expect(allText(refused)).toContain("Run the tests again.");
    expect(allText(refused)).toContain("Nothing was written.");
    expectUntouched(keep, snapshot, "a failed run");
    expect(listing(directory)).toEqual(["keep.xml"]);
    await expectIdle("QA-13");
  }, 300000);
});

// -- A class changed after it was compiled ------------------------------------------------------------

describe("Story 40.2 QA: a class changed after it was compiled (AC-1, AC-2, AC-6: the not-up-to-date reason, end to end)", () => {
  it("QA-14: it has no class-source result (its source is the reason, its INT coverage is unchanged), its verdict fails with that reason, the file leaves it out, and a run with no class that has a result cannot be exported, leaving an existing file as it was", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // The class is compiled, then a method body is changed without compiling again: `iris_doc_put` on an existing document
    // updates it in place (a delete and put would leave a class with no compiled definition, which is the not-compiled reason).
    // The compiled code still runs; IRIS reports the class as not up to date.
    const docs = docFixtures(dev, NS_U);
    await docs.putDoc("Story402.QaUtd.cls", UTD_SOURCE);
    await docs.compileDoc("Story402.QaUtd.cls");
    await docs.putDoc("Story402.QaUtdTest.cls", UTD_TEST_SOURCE);
    await docs.compileDoc("Story402.QaUtdTest.cls");
    const changed = await dev.call("iris_doc_put", {
      namespace: NS_U,
      name: "Story402.QaUtd.cls",
      content: UTD_SOURCE.replace("Set tX = 1", "Set tX = 3"),
    });
    expect(changed.isError, allText(changed)).toBeFalsy();
    expect(await objIsUpToDate("Story402.QaUtd"), "IRIS says the class is not up to date").toBe("0");

    const result = await coverage({ target: "Story402.QaUtdTest", classes: ["Story402.QaUtd", "Story402.QaFull"], minCoverage: 50 });
    expect(result.isError, allText(result)).toBeFalsy();
    const content = result.structuredContent as unknown as CoverageContent;
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 1 });
    expect(content.coverage?.complete).toBe(true);
    const [utd, full] = content.coverage?.classes ?? [];
    expect(utd?.class).toBe("Story402.QaUtd");
    expect(utd?.source, "no class-source result, only the reason").toEqual({ reason: "not-up-to-date" });
    expect(full?.source).toMatchObject({ executableLines: 2, coveredLines: 2, percent: 100 });
    expect(content.coverage?.source, "the totals are over the classes that have a result").toEqual({ executableLines: 2, coveredLines: 2, percent: 100 });
    expect(content.coverage?.verdict).toEqual({
      minCoverage: 50,
      overall: "fail",
      percent: 100,
      classes: [
        { class: "Story402.QaUtd", verdict: "fail", percent: null, reason: "not-up-to-date" },
        { class: "Story402.QaFull", verdict: "pass", percent: 100 },
      ],
    });
    const lines = allText(result).split("\n");
    expect(lines[1]).toBe("Coverage target 50%: FAIL (100% overall); failing: Story402.QaUtd (not-up-to-date)");
    expect(lines, "the class line says why").toContain("Story402.QaUtd: no class-source coverage (not-up-to-date)");
    expect(lines.some((line) => /^Story402\.QaUtd\.1: 2 of 2 executable INT lines covered/.test(line)), "its INT coverage is measured as before").toBe(true);

    // The file holds the class that has a result and leaves the other out.
    const directory = freshDirectory("not-up-to-date");
    const target = path.join(directory, "one-class.xml");
    const exported = await exportRun(content.coverageRunId, target);
    expect(exported.isError, allText(exported)).toBeFalsy();
    expect((exported.structuredContent as unknown as CoverageContent).cobertura).toMatchObject({ classes: 1, lines: 2 });
    expect(readCobertura(readFileSync(target, "utf8")).classes.map((klass) => klass.name)).toEqual(["Story402.QaFull"]);

    // A run in which no class has a result would be an empty document that reads as fully covered: refused.
    const only = succeeded<CoverageContent>(await coverage({ target: "Story402.QaUtdTest", classes: ["Story402.QaUtd"] }));
    expect(only.coverage?.classes[0]?.source).toEqual({ reason: "not-up-to-date" });
    const keep = path.join(directory, "keep.xml");
    writeFileSync(keep, "KEEP");
    const snapshot = { content: "KEEP", mtimeMs: statSync(keep).mtimeMs };
    const refused = await exportRun(only.coverageRunId, keep);
    expect(refused.isError, allText(refused)).toBe(true);
    expect(allText(refused)).toContain("no class has a class-source result");
    expect(allText(refused)).toContain("Recompile the classes (a forced compile when only comments changed) and run the tests again.");
    expect(allText(refused)).toContain("Nothing was written.");
    expectUntouched(keep, snapshot, "a run with no class-source result");
    await expectIdle("QA-14");
  }, 300000);
});

describe("Story 40.2 QA: a class documented after it was compiled has no line map, and is reported as not-up-to-date (AC-1, AC-2)", () => {
  let before: CoverageContent;
  let after: CoverageContent;
  let afterResult: WireToolResult;
  let upToDate = "";

  // The class is compiled and run once. Then a documentation comment is added above its method (a change IRIS does not count as one
  // that needs a compile) and the class is compiled the default way, which says "up-to-date" and compiles nothing. IRIS still calls the
  // class up to date, but the line map of its compiled code no longer answers, so every body line is unmapped. A forced compile
  // (flags `ck`) maps it again; a change to a method body, or to white space, makes IRIS call the class not up to date instead.
  beforeAll(async () => {
    if (skipReason) return;
    const docs = docFixtures(dev, NS_U);
    await docs.putDoc("Story402.QaStale.cls", STALE_SOURCE);
    await docs.compileDoc("Story402.QaStale.cls");
    await docs.putDoc("Story402.QaStaleTest.cls", STALE_TEST_SOURCE);
    await docs.compileDoc("Story402.QaStaleTest.cls");
    before = succeeded<CoverageContent>(await coverage({ target: "Story402.QaStaleTest", classes: ["Story402.QaStale"] }));

    const saved = await dev.call("iris_doc_put", { namespace: NS_U, name: "Story402.QaStale.cls", content: STALE_DOCUMENTED_SOURCE });
    expect(saved.isError, allText(saved)).toBeFalsy();
    const compiled = await dev.call("iris_doc_compile", { namespace: NS_U, doc: "Story402.QaStale.cls" });
    expect(compiled.isError, allText(compiled)).toBeFalsy();
    expect(allText(compiled), "the default compile found nothing to do").toContain("is up-to-date");
    upToDate = await objIsUpToDate("Story402.QaStale");

    afterResult = await coverage({ target: "Story402.QaStaleTest", classes: ["Story402.QaStale"], minCoverage: 50 });
    after = succeeded<CoverageContent>(afterResult);
    await expectIdle("QA-15 setup");
  }, 300000);

  it("QA-15a: before the documentation comment the class maps (lines 7 and 8); after it IRIS still says up to date, the raw map has a label and no mapped line, the class has the reason not-up-to-date, the verdict fails with it, and the export is refused", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    expect(before.coverage?.classes[0]?.source).toMatchObject({ executableLines: 2, coveredLines: 2, percent: 100, executableRanges: [[7, 8]] });
    expect(upToDate, "IRIS still calls the class up to date").toBe("1");
    expect(await storedDocument(NS_U, "Story402.QaStale"), "the documentation comment is in the stored class").toContain("/// What Go returns.");

    const source = after.coverage?.classes[0]?.source;
    expect(source, "no class-source result: the compiled line map is gone").toEqual({ reason: "not-up-to-date" });
    const raw = await rawStatus(after.coverageRunId);
    expect(raw.sources[0], "the raw map: no class reason, and no INT line for either body line, while the method has an INT label (line 5)").toEqual({
      class: "Story402.QaStale",
      methods: [{ name: "Go", line: 6, routine: "", intLines: [0, 0], labelLine: 5 }],
    });
    expect(allText(afterResult), "the INT coverage is measured as before").toContain("Story402.QaStale.1: 2 of 2 executable INT lines covered");

    expect(after.coverage?.verdict, "a class that was not measured fails the verdict with its reason").toEqual({
      minCoverage: 50,
      overall: "fail",
      percent: null,
      classes: [{ class: "Story402.QaStale", verdict: "fail", percent: null, reason: "not-up-to-date" }],
    });
    const lines = allText(afterResult).split("\n");
    expect(lines[1]).toBe("Coverage target 50%: FAIL (no class-source coverage); failing: Story402.QaStale (not-up-to-date)");
    expect(lines[2]).toBe("Story402.QaStale: no class-source coverage (not-up-to-date)");
    expect(afterResult.isError, "a failing verdict is not a tool error").toBeFalsy();

    const directory = freshDirectory("stale");
    const target = path.join(directory, "stale.xml");
    const exported = await exportRun(after.coverageRunId, target);
    expect(exported.isError, "no class has a class-source result, so the export is refused").toBe(true);
    expect(allText(exported)).toContain("no class has a class-source result");
    expect(allText(exported)).toContain("Nothing was written.");
    expect(existsSync(target), "nothing was written").toBe(false);
    expect(listing(directory)).toEqual([]);
    await expectIdle("QA-15a");
  }, 300000);

  it("QA-15b: a class whose body lines cannot be mapped is reported with a reason, not as a class with no executable line", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    expect(after.coverage?.classes[0]?.source).toHaveProperty("reason", "not-up-to-date");
    expect(after.coverage?.source, "the run's total has no line: its one class has no result").toEqual({ executableLines: 0, coveredLines: 0, percent: null });
  }, 300000);
});
