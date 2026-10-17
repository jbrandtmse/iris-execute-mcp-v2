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
 * Story 39.2 adds `SeedBodies` (headers whose bodies are of every kind: HL7 v2, stream, string,
 * stream container, a missing class and a literal), `Hl7Fields` (what IRIS's own HL7 parser reads in
 * a text), the production fixture sources `STORY392_*` (an operation and a production, started only in a
 * disposable namespace), and a `Leftovers` that also reports any `^%SYS("Ensemble",*,<ns>)` subscript and
 * any process running in a scratch namespace.
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

/// Seed the Story 39.2 body set pSet ("story392") into the current namespace, which must be an empty
/// EXECMCPTMP392 scratch namespace: fixture pi (headers 1 to 9, one body of every kind) and fixture rho
/// (headers 10 to 12, three string bodies). Returns the JSON ID map {"pi":"1,...,9","rho":"10,11,12"}.
ClassMethod SeedBodies(pSet As %String) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP392"1U { Quit "REFUSED: SeedBodies runs only in a namespace named EXECMCPTMP392 followed by one capital letter" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    If pSet '= "story392" { Quit "REFUSED: the set must be story392" }
    Set tBodies = ""
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7(..Hl7Text("adt"))))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7(..Hl7Text("ack"))))
    Set tBodies = tBodies_$ListBuild($ListBuild("%Stream.GlobalCharacter", ..SaveStream(..StreamText())))
    Set tBodies = tBodies_$ListBuild($ListBuild("Ens.StringRequest", ..SaveString("SYNTHPHI-STRING")))
    Set tBodies = tBodies_$ListBuild($ListBuild("Ens.StreamContainer", ..SaveContainer("SYNTHPHI-CONTAINER")))
    Set tBodies = tBodies_$ListBuild($ListBuild("Story392.Body.Missing", "1"))
    Set tBodies = tBodies_$ListBuild($ListBuild("", "SYNTHPHI-LITERAL"))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7(..Hl7Text("alt"))))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7(..Hl7Text("big"))))
    Set tPi = ""
    For tI = 1:1:9 {
        Set tBody = $List(tBodies, tI)
        If $Extract($List(tBody, 2), 1, 6) = "ERROR:" { Quit }
        Set tId = ..Add(392000 + tI, 1, 8, 1, "Story392.Source", "Story392.Hl7Target", $List(tBody, 1), $List(tBody, 2), "2001-02-03 09:00:0"_tI)
        If $Extract(tId, 1, 6) = "ERROR:" { Quit }
        Set tPi = tPi_$Select(tPi = "": "", 1: ",")_tId
    }
    If $Length(tPi, ",") '= 9 { Quit "FAILED: pi bodies: "_tPi_" "_$Get(tBody)_" "_$Get(tId) }
    Set tRho = ""
    For tI = 1:1:3 {
        Set tBodyId = ..SaveString("SYNTHPHI-RHO-"_tI)
        If $Extract(tBodyId, 1, 6) = "ERROR:" { Quit }
        Set tId = ..Add(392100 + tI, 1, 8, 1, "Story392.Source", "Story392.Target", "Ens.StringRequest", tBodyId, "2001-02-03 10:00:0"_tI)
        If $Extract(tId, 1, 6) = "ERROR:" { Quit }
        Set tRho = tRho_$Select(tRho = "": "", 1: ",")_tId
    }
    If $Length(tRho, ",") '= 3 { Quit "FAILED: rho bodies: "_tRho_" "_$Get(tBodyId)_" "_$Get(tId) }
    Quit {"pi":(tPi),"rho":(tRho)}.%ToJSON()
}

/// The segments of the ER7 text pText, parsed in memory by EnsLib.HL7.Message (nothing is saved), as
/// JSON [{"name":"PID","fields":["1","",...]}]. Field k of a segment is element k of "fields", and
/// MSH-1 is the field separator, so the numbering is the HL7 one. Runs only in an EXECMCPTMP392 namespace.
ClassMethod Hl7Fields(pText As %String) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP392"1U { Quit "REFUSED: Hl7Fields runs only in a namespace named EXECMCPTMP392 followed by one capital letter" }
    Set tMsg = ##class(EnsLib.HL7.Message).ImportFromString(pText, .tSC)
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Set tList = []
    For tI = 1:1:tMsg.SegCount {
        Set tSeg = tMsg.GetSegmentAt(tI)
        Set tFields = []
        For tN = 1:1:tSeg.Count { Do tFields.%Push(tSeg.GetValueAt(tN)) }
        Do tList.%Push({"name":(tSeg.Name),"fields":(tFields)})
    }
    Quit tList.%ToJSON()
}

/// The synthetic ER7 text pName ("adt", "ack", "alt" or "big"), with CR segment terminators.
ClassMethod Hl7Text(pName As %String) As %String
{
    Set tCR = $Char(13)
    If pName = "adt" {
        Set tText = "MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090001||ADT^A01^ADT_A01|SYNTHPHI-CTL1|P|2.5.1"_tCR
        Set tText = tText_"EVN|A01|20010203090001|||SYNTHPHI-OPERATOR"_tCR
        Set tText = tText_"PID|1||SYNTHPHI-MRN^^^SYNTHPHI-AA~SYNTHPHI-MRN2^^^SYNTHPHI-AB||SYNTHPHI-LAST^SYNTHPHI-FIRST\T\X&SYNTHPHI-SUB~SYNTHPHI-ALIAS^SYNTHPHI-A||19010101|F|||SYNTHPHI-STREET\S\1^^SYNTHPHI-CITY^ZZ^00000~SYNTHPHI-STREET2^^SYNTHPHI-CITY2^ZZ^00001||SYNTHPHI-PHONE"_tCR
        Set tText = tText_"NK1|1|SYNTHPHI-KIN^SYNTHPHI-KINF|SPO^Spouse|SYNTHPHI-NKADDR||SYNTHPHI-NKPHONE|C"_tCR
        Set tText = tText_"PV1|1|I|SYNTHPHI-WARD^101^A|R|||SYNTHPHI-DOC^SYNTHPHI-DOCF|||||||||||E|SYNTHPHI-VISIT"_tCR
        Set tText = tText_"GT1|1||SYNTHPHI-GUAR^SYNTHPHI-GUARF"_tCR
        Set tText = tText_"IN1|1||SYNTHPHI-PLAN|SYNTHPHI-INSCO"_tCR
        Set tText = tText_"OBX|1|TX|GLU^KEEPME-GLUCOSE^L||SYNTHPHI-free text \F\ with \T\ escapes|mg/dL|||||F"_tCR
        Set tText = tText_"NTE|1|L|SYNTHPHI-comment"_tCR
        Set tText = tText_"ZPI|SYNTHPHI-Z||x"_tCR
        Quit tText
    }
    If pName = "ack" {
        Set tText = "MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090002||ACK^A01^ACK|SYNTHPHI-CTL2|P|2.5.1"_tCR
        Set tText = tText_"MSA|AA|SYNTHPHI-CTL1"_tCR
        Set tText = tText_"ERR||PID^1|101^Required field missing^HL70357|E"_tCR
        Quit tText
    }
    If pName = "alt" {
        Set tText = "MSH#!@$%#SYNTHPHI-APP#SYNTHPHI-FAC###20010203090008##ADT!A01!ADT_A01#SYNTHPHI-CTL8#P#2.5.1"_tCR
        Set tText = tText_"PID#1##SYNTHPHI-MRN!!!SYNTHPHI-AA@SYNTHPHI-MRN2##SYNTHPHI-LAST!SYNTHPHI-FIRST%X##19010101#F"_tCR
        Quit tText
    }
    If pName = "big" {
        Set tBig = ""
        For tI = 1:1:5400 { Set tBig = tBig_"SYNTHPHI-BIG " }
        Set tText = "MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090009||ORU^R01^ORU_R01|SYNTHPHI-CTL9|P|2.5.1"_tCR
        Set tText = tText_"PID|1||SYNTHPHI-MRN9||SYNTHPHI-LAST9^SYNTHPHI-FIRST9"_tCR
        Set tText = tText_"OBX|1|TX|NOTE^KEEPME-NOTE^L||"_$Extract(tBig, 1, 70000)_"|||||F"_tCR
        Quit tText
    }
    Quit ""
}

/// The 1500-character stream text, with CR, LF and tab.
ClassMethod StreamText() As %String
{
    Set tText = ""
    For tI = 1:1:100 { Set tText = tText_"SYNTHPHI-S"_tI_$Char(13, 10, 9)_"x" }
    Quit $Extract(tText, 1, 1500)
}

/// Save pText as an unsent EnsLib.HL7.Message and return its ID, or the error text.
ClassMethod SaveHl7(pText As %String) As %String
{
    Set tMsg = ##class(EnsLib.HL7.Message).ImportFromString(pText, .tSC)
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Set tSC = tMsg.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tMsg.%Id()
}

/// Save pText as a %Stream.GlobalCharacter and return its ID, or the error text.
ClassMethod SaveStream(pText As %String) As %String
{
    Set tStream = ##class(%Stream.GlobalCharacter).%New()
    Set tSC = tStream.Write(pText)
    If $System.Status.IsOK(tSC) { Set tSC = tStream.%Save() }
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tStream.%Id()
}

/// Save pText as an Ens.StringRequest and return its ID, or the error text.
ClassMethod SaveString(pText As %String) As %String
{
    Set tBody = ##class(Ens.StringRequest).%New(pText)
    Set tSC = tBody.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tBody.%Id()
}

/// Save pText inside an Ens.StreamContainer and return its ID, or the error text.
ClassMethod SaveContainer(pText As %String) As %String
{
    Set tStream = ##class(%Stream.GlobalCharacter).%New()
    Set tSC = tStream.Write(pText)
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Set tBody = ##class(Ens.StreamContainer).%New(tStream)
    Set tSC = tBody.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tBody.%Id()
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
            Set tS1 = ""
            For {
                Set tS1 = $Order(^%SYS("Ensemble", tS1))
                Quit:tS1=""
                If $Data(^%SYS("Ensemble", tS1, tName)) { Do tList.%Push("^%SYS(""Ensemble"","""_tS1_""","""_tName_""")") }
            }
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT Pid FROM %SYS.ProcessQuery WHERE NameSpace = ?", tName)
            While tRS.%Next() { Do tList.%Push("process "_tRS.%Get("Pid")_" in "_tName) }
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

/** The header IDs `seedBodies` returns: fixture pi (nine bodies) and fixture rho (three string bodies). */
export const STORY392_IDS = { pi: "1,2,3,4,5,6,7,8,9", rho: "10,11,12" } as const;

/**
 * Seed the Story 39.2 body fixtures into the empty namespace `name`, and check the IDs they received.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - An interop-enabled `EXECMCPTMP392<capital letter>` namespace.
 */
export async function seedBodies(dev: ToolSession, name: string): Promise<void> {
  assertFixtureName(name);
  const content = await callChecked(
    dev,
    "iris_execute_classmethod",
    { namespace: name, className: FIXTURE_CLASS, methodName: "SeedBodies", args: ["story392"] },
    `seeding the body fixtures into ${name}`,
  );
  const returned = String(content.returnValue ?? "");
  let ids: unknown;
  try {
    ids = JSON.parse(returned);
  } catch {
    throw new Error(`seeding the body fixtures into ${name} returned ${JSON.stringify(returned)}`);
  }
  if (JSON.stringify(ids) !== JSON.stringify(STORY392_IDS)) {
    throw new Error(`seeding the body fixtures into ${name} returned ${JSON.stringify(returned)}`);
  }
}

/** One segment as IRIS's own HL7 parser reads it: `fields[k - 1]` is field `k`, and MSH-1 is the separator. */
export interface Hl7ParsedSegment {
  name: string;
  fields: string[];
}

/**
 * The segments of the ER7 `text` as `EnsLib.HL7.Message` parses them in namespace `name`: an oracle for
 * the redaction engine that does not share its code. Nothing is saved.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - An interop-enabled `EXECMCPTMP392<capital letter>` namespace.
 * @param text - Complete ER7 text.
 */
export async function hl7Fields(dev: ToolSession, name: string, text: string): Promise<Hl7ParsedSegment[]> {
  assertFixtureName(name);
  const content = await callChecked(
    dev,
    "iris_execute_classmethod",
    { namespace: name, className: FIXTURE_CLASS, methodName: "Hl7Fields", args: [text] },
    `parsing HL7 text in ${name}`,
  );
  const returned = String(content.returnValue ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(returned);
  } catch {
    throw new Error(`parsing HL7 text in ${name} returned ${JSON.stringify(returned.slice(0, 80))}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`parsing HL7 text in ${name} returned a non-array`);
  return parsed as Hl7ParsedSegment[];
}

/**
 * Production fixture sources (Story 39.2, DW-570): an operation that accepts every message, and a
 * production that runs it as the enabled item `Story392.Target` with one job. The gate puts them into its
 * own scratch namespace and starts the production there.
 */
export const STORY392_OPERATION_SOURCE = String.raw`Class Story392.Operation Extends Ens.BusinessOperation
{

Method OnMessage(pRequest As %Library.Persistent, Output pResponse As %Library.Persistent) As %Status
{
    Quit $$$OK
}

}
`;

export const STORY392_PRODUCTION_SOURCE = String.raw`Class Story392.Production Extends Ens.Production
{

XData ProductionDefinition
{
<Production Name="Story392.Production" LogGeneralTraceEvents="false">
  <Description></Description>
  <ActorPoolSize>1</ActorPoolSize>
  <Item Name="Story392.Target" Category="" ClassName="Story392.Operation" PoolSize="1" Enabled="true" Foreground="false" Comment="" LogTraceEvents="false" Schedule="">
  </Item>
</Production>
}

}
`;

/**
 * Everything that remains of the namespaces in `names`: the namespace, database configuration,
 * mappings, database, directory, `/csp/<ns>` application, `%DB_<ns>` resource, any
 * `^%SYS("Ensemble",*,<ns>)` subscript and any process running in the namespace. Empty when nothing
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
