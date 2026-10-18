/**
 * The Story 40.3 TestProduction fixture: the `Story403` classes of the disposable namespace `EXECMCPTMP403A`, the plain test of
 * the bare namespace `EXECMCPTMP403B`, and the helpers the live gate (`story-40-3-testproduction-live-gate.test.ts`) uses to seed
 * and remove them.
 *
 * `EXECMCPTMP403A` is an interop-mapped scratch namespace made able to compile `%UnitTest.TestProduction` subclasses by the one node
 * `^%SYS("Ensemble","InstalledNamespace","EXECMCPTMP403A")` (`SetInstalledNamespace` of the fixture class; `EnableNamespace` is
 * never called). It holds:
 *
 *  - `Story392.Operation` (reused verbatim from Story 39.2) and two productions, `Story403.Production` (item `Story403.Target`) and
 *    `Story403.Other` (item `Story403.OtherTarget`), the foreign stand-in;
 *  - the TestProduction tests, each with `MAXWAIT = 3` and `MINRUN = 1`: `PassTest` (asserts true), `FailTest` (asserts false,
 *    "fail fixture"), `ErrorTest` (`CheckResults` divides by zero, which leaves its production running), `OtherTest`
 *    (`PRODUCTION` = `Story403.Other`), `BadTest` (`PRODUCTION` = `Story403.Missing`) and `Mixed.ProdTest`; every one but
 *    `OtherTest` and `BadTest` uses `Story403.Production`;
 *  - the plain tests `PlainTest`, `Plain.OneTest` and `Mixed.PlainTest`.
 *
 * `FreshTest` (a TestProduction test the gate puts without compiling) is `STORY403_FRESH_SOURCE`.
 *
 * No TestProduction subclass is ever defined in HSCUSTOM or in any `ExecuteMCPv2.*` package: all of these classes are put into
 * the scratch namespace, and the database file that `removeInteropNamespace` deletes takes them away.
 */

import {
  FIXTURE_CLASS,
  FIXTURE_HOME_NAMESPACE,
  STORY392_OPERATION_SOURCE,
  createInteropNamespace,
  leftovers,
  removeInteropNamespace,
} from "./interop-namespace-fixture.js";
import { docFixtures, type WireSession } from "./process-gate-helpers.js";

type ToolSession = Pick<WireSession, "call">;

/** The only names this fixture seeds into: `EXECMCPTMP403` and one capital letter. */
const TESTPRODUCTION_FIXTURE_NAME = /^EXECMCPTMP403[A-Z]$/;

function assertTestProductionName(name: string): void {
  if (!TESTPRODUCTION_FIXTURE_NAME.test(name)) {
    throw new Error(`"${name}" is not a fixture namespace name (EXECMCPTMP403 and one capital letter).`);
  }
}

/** The production the fixture tests declare, and the one that stands in for another user's production. */
export const STORY403_PRODUCTION = "Story403.Production";
export const STORY403_OTHER = "Story403.Other";

function productionSource(className: string, itemName: string): string {
  return `Class ${className} Extends Ens.Production
{

XData ProductionDefinition
{
<Production Name="${className}" LogGeneralTraceEvents="false">
  <Description></Description>
  <ActorPoolSize>1</ActorPoolSize>
  <Item Name="${itemName}" Category="" ClassName="Story392.Operation" PoolSize="1" Enabled="true" Foreground="false" Comment="" LogTraceEvents="false" Schedule="">
  </Item>
</Production>
}

}
`;
}

/** What `CheckResults` of a fixture test does. */
type CheckKind = "pass" | "fail" | "error";

const CHECK_BODIES: Record<CheckKind, string> = {
  pass: '    Do $$$AssertTrue(1, "pass fixture")\n    Quit $$$OK',
  fail: '    Do $$$AssertTrue(0, "fail fixture")\n    Quit $$$OK',
  error: "    Set tZero = 0, tBad = 1 / tZero\n    Quit $$$OK",
};

/** The source of a TestProduction test of `production`, whose `CheckResults` does `kind`. */
export function testProductionSource(className: string, production: string, kind: CheckKind = "pass"): string {
  return `Class ${className} Extends %UnitTest.TestProduction
{

Parameter PRODUCTION = "${production}";

Parameter MAXWAIT = 3;

Parameter MINRUN = 1;

Method CheckResults(ByRef Log As %String, New As %String) As %Status
{
${CHECK_BODIES[kind]}
}

}
`;
}

/** The source of a plain test with one passing method. */
export function plainTestSource(className: string): string {
  return `Class ${className} Extends %UnitTest.TestCase
{

Method TestPlain()
{
    Do $$$AssertTrue(1, "plain fixture")
    Quit
}

}
`;
}

/** The TestProduction test the gate puts into the scratch namespace without compiling it (matrix row 14). */
export const STORY403_FRESH_SOURCE = testProductionSource("Story403.FreshTest", STORY403_PRODUCTION);

/**
 * `Story403.StaleTest` as it is compiled (it declares `Story403.Other`) and as it is saved afterwards without a compile (it declares
 * `Story403.Production`): the compiled class and the definition disagree, so only the definition names the production the work queue
 * will start (matrix row 14b).
 */
export const STORY403_STALE_COMPILED_SOURCE = testProductionSource("Story403.StaleTest", STORY403_OTHER);
export const STORY403_STALE_EDITED_SOURCE = testProductionSource("Story403.StaleTest", STORY403_PRODUCTION);

/** An abstract TestProduction base that declares `Story403.Production`, compiled by the gate row that needs it (matrix row 14c). */
export const STORY403_BASE_SOURCE = `Class Story403.BaseTest Extends %UnitTest.TestProduction [ Abstract ]
{

Parameter PRODUCTION = "${STORY403_PRODUCTION}";

Parameter MAXWAIT = 3;

Parameter MINRUN = 1;

}
`;

/** A test that only extends the base: its production is the one it inherits, and it is put without a compile (matrix row 14c). */
export const STORY403_INHERIT_SOURCE = `Class Story403.InheritTest Extends Story403.BaseTest
{

}
`;

/** The classes the extra rows put into the scratch namespace, children first, for the cleanup after every row. */
export const STORY403_ROW_DOCUMENTS: readonly string[] = [
  "Story403.FreshTest.cls",
  "Story403.StaleTest.cls",
  "Story403.InheritTest.cls",
  "Story403.BaseTest.cls",
];

/**
 * The documents `seedTestProductionFixture` puts and compiles into `EXECMCPTMP403A`, in compile order: the operation, the two
 * productions, the TestProduction tests, then the plain tests.
 */
export const STORY403_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story392.Operation.cls", STORY392_OPERATION_SOURCE],
  ["Story403.Production.cls", productionSource(STORY403_PRODUCTION, "Story403.Target")],
  ["Story403.Other.cls", productionSource(STORY403_OTHER, "Story403.OtherTarget")],
  ["Story403.PassTest.cls", testProductionSource("Story403.PassTest", STORY403_PRODUCTION, "pass")],
  ["Story403.FailTest.cls", testProductionSource("Story403.FailTest", STORY403_PRODUCTION, "fail")],
  ["Story403.ErrorTest.cls", testProductionSource("Story403.ErrorTest", STORY403_PRODUCTION, "error")],
  ["Story403.OtherTest.cls", testProductionSource("Story403.OtherTest", STORY403_OTHER, "pass")],
  ["Story403.BadTest.cls", testProductionSource("Story403.BadTest", "Story403.Missing", "pass")],
  ["Story403.Mixed.ProdTest.cls", testProductionSource("Story403.Mixed.ProdTest", STORY403_PRODUCTION, "pass")],
  ["Story403.PlainTest.cls", plainTestSource("Story403.PlainTest")],
  ["Story403.Plain.OneTest.cls", plainTestSource("Story403.Plain.OneTest")],
  ["Story403.Mixed.PlainTest.cls", plainTestSource("Story403.Mixed.PlainTest")],
];

/** The documents `seedPlainFixture` puts and compiles into the bare namespace `EXECMCPTMP403B`. */
export const STORY403_PLAIN_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story403.PlainTest.cls", plainTestSource("Story403.PlainTest")],
];

/** Call a class method of the fixture class in HSCUSTOM and return its string result. */
async function fixtureCall(dev: ToolSession, methodName: string, args: unknown[]): Promise<string> {
  const result = await dev.call("iris_execute_classmethod", {
    namespace: FIXTURE_HOME_NAMESPACE,
    className: FIXTURE_CLASS,
    methodName,
    args,
  });
  if (result.isError) {
    throw new Error(`${FIXTURE_CLASS}.${methodName}: ${result.content?.[0]?.text ?? "no content"}`);
  }
  return String(result.structuredContent?.["returnValue"] ?? "");
}

/**
 * Make the scratch namespace `name` able to compile and run TestProduction tests: set the one node
 * `^%SYS("Ensemble","InstalledNamespace",<name>)`. It must be cleared before the namespace is removed
 * ({@link removeTestProductionNamespace} does).
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP403<capital letter>`.
 */
export async function setInstalledNamespace(dev: ToolSession, name: string): Promise<void> {
  assertTestProductionName(name);
  const answer = await fixtureCall(dev, "SetInstalledNamespace", [name]);
  if (answer !== "set") throw new Error(`setting the InstalledNamespace node of ${name}: ${answer}`);
}

/** Remove the node {@link setInstalledNamespace} set. */
export async function clearInstalledNamespace(dev: ToolSession, name: string): Promise<void> {
  assertTestProductionName(name);
  const answer = await fixtureCall(dev, "ClearInstalledNamespace", [name]);
  if (answer !== "cleared") throw new Error(`clearing the InstalledNamespace node of ${name}: ${answer}`);
}

/**
 * Hold Ens's production lifecycle lock `^Ens.Runtime` of `name` from a fixture job for at most `seconds` (matrix row 13).
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP403<capital letter>`.
 * @param seconds - How long the holder keeps it at most (1 to 30).
 */
export async function holdEnsRuntime(dev: ToolSession, name: string, seconds: number): Promise<void> {
  assertTestProductionName(name);
  const answer = await fixtureCall(dev, "HoldEnsRuntime", [name, seconds]);
  if (answer !== "held") throw new Error(`holding ^Ens.Runtime of ${name}: ${answer}`);
}

/** Ask the holder of {@link holdEnsRuntime} to release the lock and wait for it. */
export async function releaseEnsRuntime(dev: ToolSession, name: string): Promise<void> {
  assertTestProductionName(name);
  const answer = await fixtureCall(dev, "ReleaseEnsRuntime", [name]);
  if (answer !== "released") throw new Error(`releasing ^Ens.Runtime of ${name}: ${answer}`);
}

/**
 * Put and compile the `Story403` classes into the interop-mapped scratch namespace `name`, which must already have its
 * InstalledNamespace node ({@link setInstalledNamespace}), or the TestProduction subclasses do not compile.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP403<capital letter>`.
 */
export async function seedTestProductionFixture(dev: WireSession, name: string): Promise<void> {
  assertTestProductionName(name);
  const docs = docFixtures(dev, name);
  for (const [doc, source] of STORY403_DOCUMENTS) {
    await docs.putDoc(doc, source);
    await docs.compileDoc(doc);
  }
}

/**
 * Put and compile the plain test into the bare scratch namespace `name` (no mappings, no InstalledNamespace node).
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP403<capital letter>`.
 */
export async function seedPlainFixture(dev: WireSession, name: string): Promise<void> {
  assertTestProductionName(name);
  const docs = docFixtures(dev, name);
  for (const [doc, source] of STORY403_PLAIN_DOCUMENTS) {
    await docs.putDoc(doc, source);
    await docs.compileDoc(doc);
  }
}

/**
 * Create the interop-mapped namespace `name` with its InstalledNamespace node and the `Story403` classes.
 *
 * @param admin - A session on a built iris-admin-mcp server.
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP403<capital letter>`.
 */
export async function createTestProductionNamespace(admin: WireSession, dev: WireSession, name: string): Promise<void> {
  assertTestProductionName(name);
  await createInteropNamespace(admin, dev, name, { interop: true });
  await setInstalledNamespace(dev, name);
  await seedTestProductionFixture(dev, name);
}

/**
 * Remove everything {@link createTestProductionNamespace} made for `name`: when the namespace exists, stop its production
 * (forced: a production that never started only adds a note), clear its InstalledNamespace node, then remove the mappings,
 * the namespace and the database. Idempotent: a namespace that is already gone is left alone. Used before and after the run.
 *
 * @param admin - A session on a built iris-admin-mcp server.
 * @param interop - A session on a built iris-interop-mcp server.
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP403<capital letter>`.
 */
export async function removeTestProductionNamespace(
  admin: WireSession,
  interop: ToolSession,
  dev: WireSession,
  name: string,
): Promise<void> {
  assertTestProductionName(name);
  const present = (await leftovers(dev, [name])).includes(`namespace ${name}`);
  if (present) {
    await interop.call("iris_production_control", { action: "stop", force: true, namespace: name });
    await clearInstalledNamespace(dev, name);
  }
  await removeInteropNamespace(admin, dev, name);
}
