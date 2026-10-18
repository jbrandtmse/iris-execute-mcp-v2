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

/** The only names the coverage fixture seeds into: `EXECMCPTMP401` and one capital letter. */
const COVERAGE_FIXTURE_NAME = /^EXECMCPTMP401[A-Z]$/;

function assertCoverageFixtureName(name: string): void {
  if (!COVERAGE_FIXTURE_NAME.test(name)) {
    throw new Error(`"${name}" is not a fixture namespace name (EXECMCPTMP401 and one capital letter).`);
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
  const result = await dev.call("iris_execute_classmethod", {
    namespace: name,
    className: "Story401.Seed",
    methodName: "SetHang",
    args: [seconds],
  });
  const returned = String((result.structuredContent as { returnValue?: unknown } | undefined)?.returnValue ?? "");
  if (result.isError || returned !== String(seconds)) {
    throw new Error(`setting the hang of Story401.SlowTest to ${seconds} in ${name} returned ${JSON.stringify(returned)}`);
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
