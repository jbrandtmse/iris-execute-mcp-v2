/**
 * The disposable Interoperability namespaces that live gates search message headers in.
 *
 * A fixture namespace is a scratch database and namespace named `EXECMCPTMP<digits><capital letter>`.
 * An interop-enabled one maps the `Ens` and `EnsLib` packages and the `Ens*` routines to ENSLIB, the
 * mappings HSCUSTOM has, which is all `Ens.MessageHeader` needs to be saved to and queried; it never
 * calls `%Library.EnsembleMgr.EnableNamespace`, which also installs a portal application, grants SQL
 * privileges and edits a shared REST application. A plain one has no mappings, so it is the
 * "interoperability not configured" case.
 *
 * The functions drive the BUILT admin server (database, namespace and mapping lifecycle) and dev server
 * (the fixture class), so a gate uses the tools it ships. Neither tool removes a database file, so the
 * fixture class `ExecuteMCPv2.Temp.Story391Fixture`, which a gate puts into HSCUSTOM, does that, and
 * reports what is left of every name.
 *
 * Seeded data is synthetic: `Story391` item names and message times on 2001-02-03 UTC, so a query that
 * is misrouted to a real namespace cannot match real traffic.
 *
 * Shared by Stories 39.1 to 39.6.
 */

import { docFixtures, type WireSession } from "./process-gate-helpers.js";

/** The fixture class, in HSCUSTOM. */
export const FIXTURE_CLASS = "ExecuteMCPv2.Temp.Story391Fixture";

/** The fixture class as a document name. */
export const FIXTURE_DOC = `${FIXTURE_CLASS}.cls`;

/** The namespace that holds the fixture class; the `%ALL` package mapping makes it resolve in every other one. */
export const FIXTURE_HOME_NAMESPACE = "HSCUSTOM";

/** The synthetic header sets `seedHeaders` can seed. */
export type SeedSet = "alpha" | "beta";

/** The IDs a seed returns, in order: a fresh namespace numbers its headers from 1. */
export const SEEDED_IDS: Record<SeedSet, string> = {
  alpha: "1,2,3,4,5,6,7,8,9,10,11,12,13",
  beta: "1,2,3",
};

/** The packages and the routine mask an interop-enabled namespace maps to ENSLIB. */
const INTEROP_PACKAGE_MAPPINGS = ["Ens", "EnsLib"] as const;
const INTEROP_ROUTINE_MAPPING = "Ens*";
const MAPPING_DATABASE = "ENSLIB";

/** A scratch name this fixture manages. */
const FIXTURE_NAME = /^EXECMCPTMP\d+[A-Z]$/;

/** The fixture class source (ObjectScript). Its methods are named in the module banner. */
export const FIXTURE_CLASS_SOURCE = String.raw`Class ExecuteMCPv2.Temp.Story391Fixture Extends %RegisteredObject
{

/// The instance manager directory, with its trailing separator.
ClassMethod ManagerDirectory() As %String
{
    Quit $System.Util.ManagerDirectory()
}

/// Save one synthetic message header and return its ID, or the error text.
ClassMethod Add(pSession As %Integer, pType As %Integer, pStatus As %Integer, pIsError As %Boolean, pSource As %String, pTarget As %String, pBodyClass As %String, pBodyId As %String, pTime As %String, pProcessed As %String = "", pCorresponding As %String = "") As %String
{
    Set tHeader = ##class(Ens.MessageHeader).%New()
    Set tHeader.SessionId = pSession
    Set tHeader.Type = pType
    Set tHeader.Status = pStatus
    Set tHeader.IsError = pIsError
    Set tHeader.SourceConfigName = pSource
    Set tHeader.TargetConfigName = pTarget
    Set tHeader.MessageBodyClassName = pBodyClass
    Set tHeader.MessageBodyId = pBodyId
    Set tHeader.Priority = 1
    Set tHeader.TimeCreated = pTime
    If pProcessed '= "" { Set tHeader.TimeProcessed = pProcessed }
    If pCorresponding '= "" { Set tHeader.CorrespondingMessageId = pCorresponding }
    Set tSC = tHeader.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tHeader.%Id()
}

/// Seed the synthetic header set pSet ("alpha" or "beta") into the current namespace, which must be
/// an empty EXECMCPTMP391 scratch namespace. Returns the new IDs, comma separated.
ClassMethod Seed(pSet As %String) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP391"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP391 followed by one capital letter" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    If pSet = "alpha" { Quit ..SeedAlpha() }
    If pSet = "beta" { Quit ..SeedBeta() }
    Quit "REFUSED: the set must be alpha or beta"
}

ClassMethod SeedAlpha() As %String
{
    Set tOdd = "Story391.Odd'%_ OR 1=1--"
    Set tIds = ""
    Set tIds = tIds_..Add(100, 1, 3, 0, "Story391.Alpha", "Story391.Beta", "Story391.Body.A", "1001", "2001-02-03 05:59:59", "2001-02-03 06:00:00")_","
    Set tIds = tIds_..Add(100, 2, 9, 0, "Story391.Beta", "Story391.Alpha", "Story391.Body.A", "1002", "2001-02-03 06:00:00", "2001-02-03 06:00:01", 1)_","
    Set tIds = tIds_..Add(200, 1, 8, 1, "Story391.Alpha", "Story391.Gamma", "Story391.Body.B", "1003", "2001-02-03 07:30:00")_","
    Set tIds = tIds_..Add(200, 1, 8, 1, "Story391.Alpha", "Story391.Delta", "Story391.Body.B", "1004", "2001-02-03 07:30:00")_","
    Set tIds = tIds_..Add(300, 1, 3, 0, tOdd, "Story391.Beta", "Story391.Body.A", "1005", "2001-02-03 08:00:00.5", "2001-02-03 08:00:01")_","
    Set tIds = tIds_..Add(300, 2, 9, 0, "Story391.Beta", tOdd, "Story391.Body.A", "1006", "2001-02-03 09:15:30.123", "2001-02-03 09:15:30.456", 5)_","
    Set tIds = tIds_..Add(400, 1, 2, 0, "Story391.Gamma", "Story391.Alpha", "Story391.Body.C", "1007", "2001-02-03 10:00:00")_","
    Set tIds = tIds_..Add(400, 3, 5, 1, "Story391.Gamma", "Story391.Delta", "Story391.Body.C", "1008", "2001-02-03 11:45:00")_","
    Set tIds = tIds_..Add(500, 1, 8, 1, "Story391.Delta", "Story391.Alpha", "Story391.Body.A", "1009", "2001-02-03 13:00:00")_","
    Set tIds = tIds_..Add(500, 2, 8, 1, "Story391.Alpha", "Story391.Delta", "Story391.Body.B", "1010", "2001-02-03 15:20:00", "", 9)_","
    Set tIds = tIds_..Add(600, 1, 9, 0, "Story391.Alpha", "Story391.Gamma", "Story391.Body.C", "1011", "2001-02-03 18:00:00", "2001-02-03 18:00:02")_","
    Set tIds = tIds_..Add(600, 1, 3, 0, "Story391.Alpha", "Story391.Beta", "Story391.Body.A", "1012", "2001-02-03 18:00:01")_","
    Set tIds = tIds_..Add(700, 1, 3, 0, "Story391.Alpha", "Story391.Beta", "Story391.Body.A", "1013", "2001-02-03 14:00:00.300")
    Quit tIds
}

ClassMethod SeedBeta() As %String
{
    Set tIds = ""
    Set tIds = tIds_..Add(7001, 1, 8, 1, "Story391.Alpha", "Story391.Omega", "Story391.Body.Z", "2001", "2001-02-03 06:30:00")_","
    Set tIds = tIds_..Add(7001, 2, 9, 0, "Story391.Omega", "Story391.Alpha", "Story391.Body.Z", "2002", "2001-02-03 06:30:05", "2001-02-03 06:30:06", 1)_","
    Set tIds = tIds_..Add(7002, 1, 3, 0, "Story391.Sigma", "Story391.Omega", "Story391.Body.Y", "2003", "2001-02-03 17:59:59")
    Quit tIds
}

/// Delete the database file and directory of the scratch database pName, after its configuration
/// entry is gone. Refuses any name that is not EXECMCPTMP<digits><capital letter>.
ClassMethod RemoveDatabaseFiles(pName As %String) As %String
{
    If pName '? 1"EXECMCPTMP"1.N1U { Quit "REFUSED: the name must be EXECMCPTMP followed by digits and one capital letter" }
    Set tOrig = $NAMESPACE
    Set tResult = ""
    Try {
        Set tDir = ..ManagerDirectory()_$ZConvert(pName, "L")_"/"
        Set $NAMESPACE = "%SYS"
        If $IsObject(##class(SYS.Database).%OpenId(tDir)) {
            Set tSC = ##class(SYS.Database).DeleteDatabase(tDir)
            If $System.Status.IsError(tSC) { Set tResult = tResult_"DeleteDatabase: "_$System.Status.GetErrorText(tSC)_"; " }
        }
        If ##class(%File).DirectoryExists(tDir) {
            If '##class(%File).RemoveDirectoryTree(tDir) { Set tResult = tResult_"RemoveDirectoryTree failed; " }
        }
    } Catch ex {
        Set tResult = tResult_"EXCEPTION: "_ex.DisplayString()
    }
    Set $NAMESPACE = tOrig
    Quit $Select(tResult = "": "removed", 1: tResult)
}

/// A JSON array naming everything that remains of the scratch namespaces in pNames (comma separated):
/// namespace, database configuration, mappings, SYS.Database, directory, /csp application, %DB resource.
ClassMethod Leftovers(pNames As %String) As %String
{
    Set tList = []
    Set tOrig = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        For tI = 1:1:$Length(pNames, ",") {
            Set tName = $Piece(pNames, ",", tI)
            If tName '? 1"EXECMCPTMP"1.N1U { Do tList.%Push("REFUSED name "_tName) Continue }
            Set tDir = ..ManagerDirectory()_$ZConvert(tName, "L")_"/"
            If ##class(Config.Namespaces).Exists(tName) { Do tList.%Push("namespace "_tName) }
            If ##class(Config.Databases).Exists(tName) { Do tList.%Push("database configuration "_tName) }
            If ##class(Config.MapPackages).Exists(tName, "Ens") { Do tList.%Push("package mapping "_tName_" Ens") }
            If ##class(Config.MapPackages).Exists(tName, "EnsLib") { Do tList.%Push("package mapping "_tName_" EnsLib") }
            If ##class(Config.MapRoutines).Exists(tName, "Ens*") { Do tList.%Push("routine mapping "_tName_" Ens*") }
            If $IsObject(##class(SYS.Database).%OpenId(tDir)) { Do tList.%Push("SYS.Database "_tDir) }
            If ##class(%File).DirectoryExists(tDir) { Do tList.%Push("directory "_tDir) }
            If ##class(Security.Applications).Exists("/csp/"_$ZConvert(tName, "L")) { Do tList.%Push("application /csp/"_$ZConvert(tName, "L")) }
            If ##class(Security.Resources).Exists("%DB_"_tName) { Do tList.%Push("resource %DB_"_tName) }
        }
    } Catch ex {
        Do tList.%Push("EXCEPTION "_ex.DisplayString())
    }
    Set $NAMESPACE = tOrig
    Quit tList.%ToJSON()
}

}
`;

type ToolSession = Pick<WireSession, "call">;

/** The first text block of a tool result, or a placeholder. */
function textOf(result: { content?: Array<{ text?: string }> }): string {
  return result.content?.[0]?.text ?? "no content";
}

/** Call `tool` and throw when it reports an error. */
async function callChecked(
  session: ToolSession,
  tool: string,
  args: Record<string, unknown>,
  what: string,
): Promise<Record<string, unknown>> {
  const result = await session.call(tool, args);
  if (result.isError) throw new Error(`${what}: ${textOf(result)}`);
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

/** Call a class method of the fixture class in HSCUSTOM and return its string result. */
async function fixtureMethod(dev: ToolSession, methodName: string, args: unknown[]): Promise<string> {
  const content = await callChecked(
    dev,
    "iris_execute_classmethod",
    { namespace: FIXTURE_HOME_NAMESPACE, className: FIXTURE_CLASS, methodName, args },
    `${FIXTURE_CLASS}.${methodName}`,
  );
  return String(content.returnValue ?? "");
}

function assertFixtureName(name: string): void {
  if (!FIXTURE_NAME.test(name)) {
    throw new Error(`"${name}" is not a fixture namespace name (EXECMCPTMP, digits, one capital letter).`);
  }
}

/**
 * Put and compile the fixture class into HSCUSTOM, replacing any earlier copy.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 */
export async function putFixtureClass(dev: WireSession): Promise<void> {
  const docs = docFixtures(dev, FIXTURE_HOME_NAMESPACE);
  await docs.putDoc(FIXTURE_DOC, FIXTURE_CLASS_SOURCE);
  await docs.compileDoc(FIXTURE_DOC);
}

/**
 * Remove the fixture class from HSCUSTOM; a class that is not there is not an error.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 */
export async function removeFixtureClass(dev: WireSession): Promise<void> {
  await docFixtures(dev, FIXTURE_HOME_NAMESPACE).removeDoc(FIXTURE_DOC);
}

/**
 * Create the database and namespace `name`, and, when `interop` is true, map the Interoperability
 * packages and routines to ENSLIB. The fixture class must be compiled in HSCUSTOM.
 *
 * @param admin - A session on a built iris-admin-mcp server.
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP<digits><capital letter>`.
 * @param options - `interop`: whether `Ens.MessageHeader` is visible in the namespace.
 */
export async function createInteropNamespace(
  admin: ToolSession,
  dev: ToolSession,
  name: string,
  options: { interop: boolean },
): Promise<void> {
  assertFixtureName(name);
  const directory = `${await fixtureMethod(dev, "ManagerDirectory", [])}${name.toLowerCase()}/`;
  await callChecked(admin, "iris_database_manage", { action: "create", name, directory }, `creating database ${name}`);
  await callChecked(
    admin,
    "iris_namespace_manage",
    { action: "create", name, codeDatabase: name, dataDatabase: name },
    `creating namespace ${name}`,
  );
  if (!options.interop) return;
  for (const mapped of INTEROP_PACKAGE_MAPPINGS) {
    await callChecked(
      admin,
      "iris_mapping_manage",
      { action: "create", type: "package", namespace: name, name: mapped, database: MAPPING_DATABASE },
      `mapping package ${mapped} in ${name}`,
    );
  }
  await callChecked(
    admin,
    "iris_mapping_manage",
    { action: "create", type: "routine", namespace: name, name: INTEROP_ROUTINE_MAPPING, database: MAPPING_DATABASE },
    `mapping routines ${INTEROP_ROUTINE_MAPPING} in ${name}`,
  );
}

/**
 * Remove everything `createInteropNamespace` made for `name`, in teardown order: the mappings, the
 * namespace, the database configuration, then the database file and directory. Idempotent: a step whose
 * target is already gone is ignored. The fixture class must be compiled in HSCUSTOM.
 *
 * @param admin - A session on a built iris-admin-mcp server.
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - `EXECMCPTMP<digits><capital letter>`.
 */
export async function removeInteropNamespace(admin: ToolSession, dev: ToolSession, name: string): Promise<void> {
  assertFixtureName(name);
  for (const mapped of INTEROP_PACKAGE_MAPPINGS) {
    await admin.call("iris_mapping_manage", { action: "delete", type: "package", namespace: name, name: mapped });
  }
  await admin.call("iris_mapping_manage", {
    action: "delete",
    type: "routine",
    namespace: name,
    name: INTEROP_ROUTINE_MAPPING,
  });
  await admin.call("iris_namespace_manage", { action: "delete", name });
  await admin.call("iris_database_manage", { action: "delete", name });
  const removed = await fixtureMethod(dev, "RemoveDatabaseFiles", [name]);
  if (removed !== "removed") throw new Error(`removing the database files of ${name}: ${removed}`);
}

/**
 * Seed a synthetic header set into the empty namespace `name`, and check the IDs it received.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - An interop-enabled `EXECMCPTMP391<capital letter>` namespace.
 * @param set - `alpha` (13 headers) or `beta` (3 headers).
 */
export async function seedHeaders(dev: ToolSession, name: string, set: SeedSet): Promise<void> {
  assertFixtureName(name);
  const content = await callChecked(
    dev,
    "iris_execute_classmethod",
    { namespace: name, className: FIXTURE_CLASS, methodName: "Seed", args: [set] },
    `seeding ${set} into ${name}`,
  );
  if (content.returnValue !== SEEDED_IDS[set]) {
    throw new Error(`seeding ${set} into ${name} returned ${JSON.stringify(content.returnValue)}`);
  }
}

/**
 * Everything that remains of the namespaces in `names`: the namespace, database configuration,
 * mappings, database, directory, `/csp/<ns>` application and `%DB_<ns>` resource. Empty when nothing
 * is left. The fixture class must be compiled in HSCUSTOM.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param names - Fixture namespace names.
 */
export async function leftovers(dev: ToolSession, names: readonly string[]): Promise<string[]> {
  for (const name of names) assertFixtureName(name);
  const listed = JSON.parse(await fixtureMethod(dev, "Leftovers", [names.join(",")])) as unknown;
  if (!Array.isArray(listed)) throw new Error(`Leftovers returned ${JSON.stringify(listed)}`);
  return listed.map(String);
}
