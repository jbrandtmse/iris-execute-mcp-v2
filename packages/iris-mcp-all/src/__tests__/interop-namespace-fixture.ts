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
 * Story 39.3 adds the `STORY393_*` class sources, which `seedBodySearch` compiles INSIDE a scratch namespace
 * (a body class, a second body class for the other namespace, and the seed), plus `sideCount`, `resetSide` and
 * `sideDefined` for the injection fuzz's side-effect oracle.
 *
 * Story 39.4 adds the `STORY394_*` class sources (an HL7 Search Table subclass, a second one for the other
 * namespace and the seed that indexes six messages with `IndexDoc`), which `seedSearchTable` compiles
 * INSIDE a scratch namespace.
 *
 * Story 39.5 adds the `STORY395_*` class sources (a body with a JSON adaptor, a plain persistent body and the
 * seed that saves seventeen bodies of every kind with their headers), which `seedBodyReader` compiles INSIDE a
 * scratch namespace; the seed class also measures `Hl7Size` against the serialization.
 *
 * Story 39.6 adds the `STORY396_*` seed source (`Story396.Seed`: three indexed HL7 v2 messages and four
 * Completed Request headers over three sessions, fixture mu), which `seedCapstone` compiles INSIDE a scratch
 * namespace together with the `Story394.SearchTable` class it indexes with. Every identifying value contains
 * `SYNTHPHI396` and appears only in PID-3 and OBX-5; the values that must survive redaction contain
 * `KEEPME396`.
 *
 * Story 39.7 adds the `hsLib` option of `createInteropNamespace` (the `HS` package mapped to HSLIB, so
 * `HS.Message.XMLMessage` resolves), and the `STORY397_*` sources (`Story397.StreamBody` and `Story397.Seed`:
 * four headers, an XML message, two stream bodies and two Event Log rows, fixture nu), which `seedBurnDown`
 * compiles INSIDE a scratch namespace.
 *
 * Story 40.0 adds the `STORY400_*` seed source (`Story400.Seed`: ten Event Log rows and three headers placed
 * relative to the moment the seed runs, fixture xi), which `seedEventLogCounts` compiles INSIDE a scratch
 * namespace.
 *
 * Story 40.2 adds the coverage-report helpers to the fixture class: `HoldRunnerLock`, `RunnerLockHeld` and
 * `ReleaseRunnerLock` (hold the runner owner lock of the next coverage run, so its runner starts late),
 * `DeleteObjectCode` (delete the object code of a `Story402` class's routine in a scratch namespace), and
 * `SeedLargeRun`, `ClearLargeRun` and `MeasureStatus` (a synthetic 200,000-line run record at the largest size a run can
 * hold, removed afterwards, and its measured Status read).
 *
 * Shared by Stories 39.1 to 40.2.
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

/** The package an `hsLib` namespace maps to HSLIB, so `HS.Message.XMLMessage` resolves in it. */
const HS_PACKAGE_MAPPING = "HS";
const HS_MAPPING_DATABASE = "HSLIB";

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
/// MSH-1 is the field separator, so the numbering is the HL7 one. Runs only in an EXECMCPTMP392 or
/// EXECMCPTMP395 namespace.
ClassMethod Hl7Fields(pText As %String) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP39"1(1"2",1"5")1U { Quit "REFUSED: Hl7Fields runs only in a namespace named EXECMCPTMP392 or EXECMCPTMP395 followed by one capital letter" }
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
            If ##class(Config.MapPackages).Exists(tName, "HS") { Do tList.%Push("package mapping "_tName_" HS") }
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

/// The Line-by-Line monitor as this process reads it (Story 40.1), as JSON: active (0 or 1), count (the monitored
/// routines), pids (the process ids the session is scoped to, space separated) and routines (their names). Read only.
/// A process that is not in the session's process list reads each routine name as an empty string.
ClassMethod MonitorState() As %String
{
    Set tState = {}
    Set tActive = ##class(ExecuteMCPv2.Coverage.Job).MonitorActive(.tPids)
    Do tState.%Set("active", +tActive, "number")
    Do tState.%Set("count", +##class(%Monitor.System.LineByLine).GetRoutineCount(), "number")
    Do tState.%Set("pids", tPids, "string")
    Set tRoutines = []
    Set tList = ##class(ExecuteMCPv2.Coverage.Job).ActiveRoutines()
    For tI = 1:1:$ListLength(tList) { Do tRoutines.%Push($List(tList, tI)) }
    Do tState.%Set("routines", tRoutines)
    Quit tState.%ToJSON()
}

/// Start a Line-by-Line session on this class's routine, scoped to this process: a session the suite did not start.
/// Refuses unless the monitor is idle. Returns started:<pid>, or refused: <why>.
ClassMethod StartForeign() As %String
{
    If ##class(ExecuteMCPv2.Coverage.Job).MonitorActive() { Quit "refused: a monitor session is already active" }
    Set tSC = ##class(%Monitor.System.LineByLine).Start($ListBuild("ExecuteMCPv2.Temp.Story391Fixture.1"), $ListBuild("RtnLine"), $ListBuild($Job))
    If $System.Status.IsError(tSC) { Quit "refused: "_$System.Status.GetErrorText(tSC) }
    Set ^IRIS.TempStory391Fixture("foreign") = $Job
    Quit "started:"_$Job
}

/// Start a Line-by-Line session of ALL processes on this class's routine: a session the suite did not start, whose
/// process list is not a scope. Test-only (decision #49): it refuses unless the monitor is idle, it starts only on this
/// class's own routine, which nobody else runs, and the row that calls it stops the session in its own cleanup
/// (StopIfList) and asserts the monitor idle. Returns started:<pid>, or refused: <why>.
ClassMethod StartForeignAll() As %String
{
    If ##class(ExecuteMCPv2.Coverage.Job).MonitorActive() { Quit "refused: a monitor session is already active" }
    Set tSC = ##class(%Monitor.System.LineByLine).Start($ListBuild("ExecuteMCPv2.Temp.Story391Fixture.1"), $ListBuild("RtnLine"), "")
    If $System.Status.IsError(tSC) { Quit "refused: "_$System.Status.GetErrorText(tSC) }
    Set ^IRIS.TempStory391Fixture("foreignAll") = $Job
    Quit "started:"_$Job
}

/// Stop the active session only when it is provably the one pRoutines names (routine names, comma separated).
/// A process that can read the session's routine names proves it by name equality. A process that cannot (it is not
/// in the session's process list) proves it as a reclaiming request does: this fixture's foreign session is scoped
/// to exactly the process id the fixture recorded (or to nothing alive, which reads 0 once that process has ended,
/// while the fixture's own record of the start is still there) and monitors as many routines as pRoutines names, or
/// is the fixture's all-processes session (recorded by StartForeignAll, with no scoped list) and monitors as many
/// routines as pRoutines names, or
/// the coverage session node's process list (only the node's runner and supervisor, still alive, or 0) and routine
/// count match the active session and the node's routine list equals pRoutines. When the node is gone, the newest
/// run record stands in for it: its session was started and not released. Returns idle, stopped, or refused: <why>.
ClassMethod StopIfList(pRoutines As %String) As %String
{
    If '##class(ExecuteMCPv2.Coverage.Job).MonitorActive(.tPids) {
        Kill ^IRIS.TempStory391Fixture("foreign"), ^IRIS.TempStory391Fixture("foreignAll")
        Quit "idle"
    }
    Set tWanted = $ListFromString(pRoutines, ",")
    Set tProven = 0
    If ##class(ExecuteMCPv2.Coverage.Job).NamesReadable() {
        Set tProven = ##class(ExecuteMCPv2.Coverage.Job).ListsEqual(tWanted, ##class(ExecuteMCPv2.Coverage.Job).ActiveRoutines())
    } Else {
        Set tForeign = $Get(^IRIS.TempStory391Fixture("foreign"))
        Set tCount = ##class(%Monitor.System.LineByLine).GetRoutineCount()
        If (tForeign '= "") && ((tPids = tForeign) || (tPids = 0)) && (tCount = $ListLength(tWanted)) && (pRoutines = "ExecuteMCPv2.Temp.Story391Fixture.1") { Set tProven = 1 }
        If ($Get(^IRIS.TempStory391Fixture("foreignAll")) '= "") && (tPids = "") && (tCount = $ListLength(tWanted)) && (pRoutines = "ExecuteMCPv2.Temp.Story391Fixture.1") { Set tProven = 1 }
        Set tSession = $Get(^IRIS.TempExecuteMCPv2Coverage("session"))
        If tSession = "" {
            Set tJob = "ExecuteMCPv2.Coverage.Job"
            Set tId = $Get(^IRIS.TempExecuteMCPv2Coverage("seq"))
            If (tId '= "") && $ClassMethod(tJob, "RunExists", tId) && $ClassMethod(tJob, "RunGet", tId, "sessionStarted") && '$ClassMethod(tJob, "RunGet", tId, "sessionReleased") {
                Set tSession = $ListBuild(tId, $ClassMethod(tJob, "RunGet", tId, "pid"), $ClassMethod(tJob, "RunGet", tId, "runnerPid"), "", $ClassMethod(tJob, "RunGet", tId, "routineList"))
            }
        }
        If 'tProven && ##class(ExecuteMCPv2.Coverage.Job).SessionMatches(tSession) {
            Set tProven = ##class(ExecuteMCPv2.Coverage.Job).ListsEqual($ListGet(tSession, 5), tWanted)
        }
    }
    If 'tProven { Quit "refused: the active session is not the one named" }
    Set tSC = ##class(%Monitor.System.LineByLine).Stop()
    If $System.Status.IsError(tSC) { Quit "refused: "_$System.Status.GetErrorText(tSC) }
    Kill ^IRIS.TempStory391Fixture("foreign"), ^IRIS.TempStory391Fixture("foreignAll")
    Quit "stopped"
}

/// Start a decoy process: a job of this class that holds a lock and waits until it is asked to end. The coverage
/// gate points a run record at it to prove that the supervisor terminates nothing MayTerminate has not approved.
/// The decoy ends by itself (StopDecoy asks it to; it also ends after 120 seconds), so nothing ever terminates it.
/// Returns started:<pid>, or refused: <why>.
ClassMethod StartDecoy() As %String
{
    Kill ^IRIS.TempStory391Fixture("decoyStop")
    Job ##class(ExecuteMCPv2.Temp.Story391Fixture).DecoyRun()::10
    If '$Test { Quit "refused: the decoy did not start" }
    Set tPid = $ZChild
    For tI = 1:1:50 {
        If ..DecoyAlive() { Quit }
        Hang 0.1
    }
    If '..DecoyAlive() { Quit "refused: the decoy did not take its lock" }
    Set ^IRIS.TempStory391Fixture("decoy") = tPid
    Quit "started:"_tPid
}

/// The decoy's job: hold the decoy lock until StopDecoy sets the stop flag, for 120 seconds at most.
ClassMethod DecoyRun()
{
    Lock +^IRIS.TempStory391Fixture("decoyLock"):5
    If '$Test { Quit }
    For tI = 1:1:1200 {
        If $Get(^IRIS.TempStory391Fixture("decoyStop")) { Quit }
        Hang 0.1
    }
    Lock -^IRIS.TempStory391Fixture("decoyLock")
}

/// Is the decoy alive? Its lock is held for its whole life, so a lock that cannot be taken belongs to it.
ClassMethod DecoyAlive() As %Boolean
{
    Lock +^IRIS.TempStory391Fixture("decoyLock"):0
    If $Test {
        Lock -^IRIS.TempStory391Fixture("decoyLock")
        Quit 0
    }
    Quit 1
}

/// Ask the decoy to end and wait for it to do so. Returns stopped, or refused: <why>.
ClassMethod StopDecoy() As %String
{
    Set ^IRIS.TempStory391Fixture("decoyStop") = 1
    For tI = 1:1:50 {
        If '..DecoyAlive() { Quit }
        Hang 0.1
    }
    If ..DecoyAlive() { Quit "refused: the decoy is still running" }
    Kill ^IRIS.TempStory391Fixture("decoy"), ^IRIS.TempStory391Fixture("decoyStop")
    Quit "stopped"
}

/// Hold the monitor's own lock, ^%SYS("MON-HOLD"), from a job of this class, so that a Stop of the Line-by-Line session
/// fails with MonitorInUse (the monitor takes that lock with a 3 second wait). Only while the suite's own session is
/// active: refuses unless the active session has a coverage session node. The job releases the lock when
/// ReleaseMonitorLock is called, and in any case after pSeconds (at most 30). Returns held, or refused: <why>.
ClassMethod HoldMonitorLock(pSeconds As %Integer = 20) As %String
{
    If $Get(^IRIS.TempExecuteMCPv2Coverage("session")) = "" { Quit "refused: no coverage session is active" }
    If '##class(ExecuteMCPv2.Coverage.Job).MonitorActive() { Quit "refused: the monitor is idle" }
    Kill ^IRIS.TempStory391Fixture("monHoldStop")
    Job ##class(ExecuteMCPv2.Temp.Story391Fixture).MonitorLockRun($Select(pSeconds > 30: 30, pSeconds < 1: 1, 1: pSeconds))::10
    If '$Test { Quit "refused: the lock holder did not start" }
    Set tHeld = 0
    For tI = 1:1:50 {
        If ..MonitorLockHeld() {
            Set tHeld = 1
            Quit
        }
        Hang 0.1
    }
    Quit $Select(tHeld: "held", 1: "refused: the lock holder did not take the lock")
}

/// The lock holder's job: hold ^%SYS("MON-HOLD") until ReleaseMonitorLock sets the stop flag, for pSeconds at most.
ClassMethod MonitorLockRun(pSeconds As %Integer)
{
    Lock +^%SYS("MON-HOLD"):10
    If '$Test { Quit }
    For tI = 1:1:(pSeconds * 10) {
        If $Get(^IRIS.TempStory391Fixture("monHoldStop")) { Quit }
        Hang 0.1
    }
    Lock -^%SYS("MON-HOLD")
}

/// Is ^%SYS("MON-HOLD") held by another process? A lock this call can take is released at once.
ClassMethod MonitorLockHeld() As %Boolean
{
    Lock +^%SYS("MON-HOLD"):0
    If $Test {
        Lock -^%SYS("MON-HOLD")
        Quit 0
    }
    Quit 1
}

/// Ask the lock holder to release ^%SYS("MON-HOLD") and wait for it to do so. Returns released, or refused: <why>.
ClassMethod ReleaseMonitorLock() As %String
{
    Set ^IRIS.TempStory391Fixture("monHoldStop") = 1
    For tI = 1:1:50 {
        If '..MonitorLockHeld() { Quit }
        Hang 0.1
    }
    If ..MonitorLockHeld() { Quit "refused: the lock is still held" }
    Kill ^IRIS.TempStory391Fixture("monHoldStop")
    Quit "released"
}

/// Write pCount fake finished run records, with negative ids so that they are older than every real run. Returns pCount.
ClassMethod SeedRunRecords(pCount As %Integer) As %String
{
    For tI = 1:1:pCount { Set ^IRIS.TempExecuteMCPv2Coverage("run", -1000 - tI, "status") = "completed" }
    Quit pCount
}

/// How many run records the coverage service holds, real and fake.
ClassMethod RunRecordCount() As %Integer
{
    Set tCount = 0
    Set tId = ""
    For {
        Set tId = $Order(^IRIS.TempExecuteMCPv2Coverage("run", tId))
        If tId = "" { Quit }
        Set tCount = tCount + 1
    }
    Quit tCount
}

/// Remove the fake run records SeedRunRecords wrote (up to 200 of them).
ClassMethod ClearFakeRuns() As %String
{
    For tI = 1:1:200 { Kill ^IRIS.TempExecuteMCPv2Coverage("run", -1000 - tI) }
    Quit "cleared"
}

/// Make the line counts of coverage run pId unreadable: replace the routine list its runner reads them for with text
/// that is not a list. Refuses unless the run is not finished and its session has started. Returns corrupted, or
/// refused: <why>.
ClassMethod CorruptRoutines(pId As %Integer) As %String
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    If '$ClassMethod(tJob, "RunExists", pId) { Quit "refused: no such run" }
    If $ClassMethod(tJob, "IsTerminal", $ClassMethod(tJob, "RunGet", pId, "status")) { Quit "refused: the run has finished" }
    If '$ClassMethod(tJob, "RunGet", pId, "sessionStarted") { Quit "refused: the run has no session yet" }
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "routines") = "not a routine list"
    Quit "corrupted"
}

/// Make the routine list of coverage run pId name a routine its session does not monitor, so that the supervisor's
/// routine-name proof fails: the session stays the one the session node names, with its own routines. Refuses unless
/// the run is not finished and its session has started. Returns renamed, or refused: <why>.
ClassMethod RenameRoutineList(pId As %Integer) As %String
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    If '$ClassMethod(tJob, "RunExists", pId) { Quit "refused: no such run" }
    If $ClassMethod(tJob, "IsTerminal", $ClassMethod(tJob, "RunGet", pId, "status")) { Quit "refused: the run has finished" }
    If '$ClassMethod(tJob, "RunGet", pId, "sessionStarted") { Quit "refused: the run has no session yet" }
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "routineList") = $ListBuild("Story401.NotMonitored.1")
    Quit "renamed"
}

/// Point the runnerPid of coverage run pId at the decoy pPid, as a PID that was reused would be. Refuses unless pPid
/// is the decoy this fixture started and the run is not finished. Returns pointed, or refused: <why>.
ClassMethod PointRunnerAtDecoy(pId As %Integer, pPid As %Integer) As %String
{
    If (pPid = "") || (pPid '= $Get(^IRIS.TempStory391Fixture("decoy"))) { Quit "refused: "_pPid_" is not the decoy" }
    If '..DecoyAlive() { Quit "refused: the decoy is not running" }
    If ##class(ExecuteMCPv2.Coverage.Job).IsTerminal(##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "status")) { Quit "refused: the run has finished" }
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "runnerPid") = pPid
    Quit "pointed"
}

/// Terminate process pPid only when it is the supervisor or the runner the coverage session node names and
/// ExecuteMCPv2.Coverage.Job:MayTerminate approves it, checked immediately before the call (a process id can be
/// reused once its process has ended). Returns terminated:<result>, or refused: <why>.
ClassMethod TerminateCoverageProcess(pPid As %Integer) As %String
{
    Set tSession = $Get(^IRIS.TempExecuteMCPv2Coverage("session"))
    Set tId = $ListGet(tSession, 1)
    If tId = "" { Quit "refused: no coverage session node" }
    Set tRole = $Select(pPid = $ListGet(tSession, 2): "supervisor", pPid = $ListGet(tSession, 3): "runner", 1: "")
    If tRole = "" { Quit "refused: "_pPid_" is neither the supervisor nor the runner of the session node" }
    If '##class(ExecuteMCPv2.Coverage.Job).MayTerminate(tId, tRole, pPid) { Quit "refused: MayTerminate is false for the "_tRole }
    Quit "terminated:"_$System.Process.Terminate(pPid)
}

/// Hold the runner owner lock of coverage run pId from a job of this class, so that the runner of that run (it waits up to
/// 10 seconds for the lock) starts late (Story 40.2). Refuses unless pId is the next id the coverage service will allocate and
/// no run has it. The job releases the lock when ReleaseRunnerLock is called, and in any case after pSeconds (at most 8).
/// Returns held, or refused: <why>.
ClassMethod HoldRunnerLock(pId As %Integer, pSeconds As %Integer = 5) As %String
{
    If pId '= ($Get(^IRIS.TempExecuteMCPv2Coverage("seq")) + 1) { Quit "refused: "_pId_" is not the next coverage run id" }
    If ##class(ExecuteMCPv2.Coverage.Job).RunExists(pId) { Quit "refused: coverage run "_pId_" exists" }
    Kill ^IRIS.TempStory391Fixture("runnerHoldStop")
    Job ##class(ExecuteMCPv2.Temp.Story391Fixture).RunnerLockRun(pId, $Select(pSeconds > 8: 8, pSeconds < 1: 1, 1: pSeconds))::10
    If '$Test { Quit "refused: the lock holder did not start" }
    Set tHeld = 0
    For tI = 1:1:50 {
        If ..RunnerLockHeld(pId) {
            Set tHeld = 1
            Quit
        }
        Hang 0.1
    }
    Quit $Select(tHeld: "held", 1: "refused: the lock holder did not take the lock")
}

/// The lock holder's job: hold the runner owner lock of run pId until ReleaseRunnerLock sets the stop flag, for pSeconds at most.
ClassMethod RunnerLockRun(pId As %Integer, pSeconds As %Integer)
{
    Lock +^IRIS.TempExecuteMCPv2Coverage("owner", pId, "runner"):10
    If '$Test { Quit }
    For tI = 1:1:(pSeconds * 10) {
        If $Get(^IRIS.TempStory391Fixture("runnerHoldStop")) { Quit }
        Hang 0.1
    }
    Lock -^IRIS.TempExecuteMCPv2Coverage("owner", pId, "runner")
}

/// Is the runner owner lock of run pId held by another process? A lock this call can take is released at once.
ClassMethod RunnerLockHeld(pId As %Integer) As %Boolean
{
    Lock +^IRIS.TempExecuteMCPv2Coverage("owner", pId, "runner"):0
    If $Test {
        Lock -^IRIS.TempExecuteMCPv2Coverage("owner", pId, "runner")
        Quit 0
    }
    Quit 1
}

/// Ask the lock holder to release the runner owner lock of run pId and wait for it to do so. Returns released, or refused: <why>.
ClassMethod ReleaseRunnerLock(pId As %Integer) As %String
{
    Set ^IRIS.TempStory391Fixture("runnerHoldStop") = 1
    For tI = 1:1:50 {
        If '..RunnerLockHeld(pId) { Quit }
        Hang 0.1
    }
    If ..RunnerLockHeld(pId) { Quit "refused: the lock is still held" }
    Kill ^IRIS.TempStory391Fixture("runnerHoldStop")
    Quit "released"
}

/// Delete the object code (the OBJ routine) of routine pRoutine in the scratch namespace pNamespace, so that a Line-by-Line
/// session cannot load it (Story 40.2). Refuses any namespace but EXECMCPTMP<digits><capital letter> and any routine but a
/// Story402 class's first. Returns deleted, or refused: <why>.
ClassMethod DeleteObjectCode(pNamespace As %String, pRoutine As %String) As %String
{
    If pNamespace '? 1"EXECMCPTMP"1.N1U { Quit "refused: the namespace must be EXECMCPTMP, digits and one capital letter" }
    If pRoutine '? 1"Story402."1.AN1".1" { Quit "refused: the routine must be the first routine of a Story402 class" }
    Set tOrig = $NAMESPACE
    Set tResult = "deleted"
    Try {
        Set $NAMESPACE = pNamespace
        If '$Data(^rOBJ(pRoutine)) { Set tResult = "refused: "_pRoutine_" has no object code in "_pNamespace }
        Else {
            Set tSC = ##class(%Routine).Delete(pRoutine_".OBJ", 1)
            If $System.Status.IsError(tSC) { Set tResult = "refused: "_$System.Status.GetErrorText(tSC) }
            ElseIf $Data(^rOBJ(pRoutine)) { Set tResult = "refused: the object code of "_pRoutine_" is still there" }
        }
    } Catch ex {
        Set tResult = "refused: "_ex.DisplayString()
    }
    Set $NAMESPACE = tOrig
    Quit tResult
}

/// Write a synthetic terminal coverage run record, id pId (above 990000000, so no real run has it): four routines of 50000
/// INT lines each, 180000 skeleton entries and 100000 counted lines between them, and a class-source map of 180000 body lines
/// (the largest a run can hold is 200000 INT lines). Returns the number of INT lines, or refused: <why>.
ClassMethod SeedLargeRun(pId As %Integer) As %String
{
    If (pId < 990000000) || (pId '= (pId \ 1)) { Quit "refused: the id must be a whole number above 990000000" }
    Kill ^IRIS.TempExecuteMCPv2Coverage("run", pId)
    Set tRoutines = ""
    For tN = 1:1:4 {
        Set tClass = "Story402.Large"_tN
        Set tRoutine = tClass_".1"
        Set tRoutines = tRoutines_$ListBuild($ListBuild(tClass, tRoutine, 50000))
        For tLine = 1:1:45000 {
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "skeleton", tN, tLine) = "C:set"
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tN, "m", 1, tLine) = tLine
        }
        For tLine = 1:1:25000 {
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "hits", tN, tLine) = (tLine # 7) + 1
        }
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tN) = $ListBuild(tClass, "")
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tN, "m", 1) = $ListBuild("Run", 10, tRoutine, "")
    }
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "namespace") = "HSCUSTOM"
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "target") = "Story402.Large"
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "level") = "class"
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "minCoverage") = 50
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "routines") = tRoutines
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "unmeasured") = ""
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "startedAt") = "2026-10-18T00:00:00.000Z"
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "finishedAt") = "2026-10-18T00:00:01.000Z"
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "hasCounts") = 1
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "releasedBy") = "runner"
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "testsDone") = 1
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "status") = "completed"
    Quit 200000
}

/// Remove the synthetic run record SeedLargeRun wrote. Refuses an id of a real run.
ClassMethod ClearLargeRun(pId As %Integer) As %String
{
    If (pId < 990000000) || (pId '= (pId \ 1)) { Quit "refused: the id must be a whole number above 990000000" }
    Kill ^IRIS.TempExecuteMCPv2Coverage("run", pId)
    Quit "cleared"
}

/// Build the Status record of run pId the way the Status route does, and measure it inside IRIS: the seconds it took, the
/// bytes of its JSON and the growth of this process's memory in kilobytes. Returns the measurements as JSON.
ClassMethod MeasureStatus(pId As %Integer) As %String
{
    Set tBefore = $Storage
    Set tStart = $ZHorolog
    Set tRun = ##class(ExecuteMCPv2.REST.Coverage).BuildRun(pId, 1)
    Set tBuilt = $ZHorolog - tStart
    Set tStream = ##class(%Stream.TmpCharacter).%New()
    Do tRun.%ToJSON(tStream)
    Set tTotal = $ZHorolog - tStart
    Set tAfter = $Storage
    Set tResult = {}
    Do tResult.%Set("buildSeconds", +$FNumber(tBuilt, "", 3), "number")
    Do tResult.%Set("buildAndSerializeSeconds", +$FNumber(tTotal, "", 3), "number")
    Do tResult.%Set("bytes", tStream.Size, "number")
    Do tResult.%Set("memoryGrowthKB", (tBefore - tAfter) \ 1024, "number")
    Quit tResult.%ToJSON()
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
 * @param options - `interop`: whether `Ens.MessageHeader` is visible in the namespace. `hsLib` (default
 *   false): also map the `HS` package to HSLIB, so `HS.Message.XMLMessage` resolves; its data stays in the
 *   scratch database.
 */
export async function createInteropNamespace(
  admin: ToolSession,
  dev: ToolSession,
  name: string,
  options: { interop: boolean; hsLib?: boolean },
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
  if (options.interop) {
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
  if (options.hsLib) {
    await callChecked(
      admin,
      "iris_mapping_manage",
      { action: "create", type: "package", namespace: name, name: HS_PACKAGE_MAPPING, database: HS_MAPPING_DATABASE },
      `mapping package ${HS_PACKAGE_MAPPING} in ${name}`,
    );
  }
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
  for (const mapped of [...INTEROP_PACKAGE_MAPPINGS, HS_PACKAGE_MAPPING]) {
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
 * @param name - An interop-enabled `EXECMCPTMP392<capital letter>` or `EXECMCPTMP395<capital letter>` namespace.
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
 * Story 39.3 body-search fixture sources. They are compiled INSIDE the scratch namespace (set `a`:
 * Addr, Other, Body, Side, Seed; set `b`: Body, Seed), never in HSCUSTOM, so the database file that
 * `removeInteropNamespace` deletes takes them away. Every body value that must never appear in a
 * search result contains `SYNTHPHI393`.
 */
export const STORY393_ADDR_SOURCE = String.raw`Class Story393.Addr Extends %SerialObject
{

Property Street As %String;

}
`;

export const STORY393_OTHER_SOURCE = String.raw`Class Story393.Other Extends %Persistent
{

Property Code As %String;

}
`;

/** Namespace A's body class: one property of every kind the property-kind table decides. */
export const STORY393_BODY_A_SOURCE = String.raw`Class Story393.Body Extends Ens.Request
{

Property Code As %String(MAXLEN = 64);

Property Exact As %String(COLLATION = "EXACT", MAXLEN = 1024);

Property Amount As %Integer;

Property Flag As %Boolean;

Property Renamed As %String [ SqlFieldName = RenamedField ];

Property Group As %String;

Property Computed As %String [ Calculated, SqlComputeCode = { Set {*} = "C-"_{Code}}, SqlComputed ];

/// A SQL-computed property whose computation fails for every row: a search on it fails while it runs, not while it is prepared.
Property Boom As %String [ Calculated, SqlComputeCode = { Set {*} = {Amount}/0}, SqlComputed ];

Property Ref As Story393.Other;

Property OnlyInA As %String;

Property Note As %Stream.GlobalCharacter;

Property Secret As %String [ Transient ];

Property Shown As %String [ Calculated ];

Property Scratch [ MultiDimensional ];

Property Tags As list Of %String;

Property Props As array Of %String;

Property Addr As Story393.Addr;

Method ShownGet() As %String
{
    Quit "shown"
}

}
`;

/** Namespace B's body class: same name, a different column for Renamed, and a property A lacks. */
export const STORY393_BODY_B_SOURCE = String.raw`Class Story393.Body Extends Ens.Request
{

Property Code As %String(MAXLEN = 64);

Property Renamed As %String [ SqlFieldName = RenamedB ];

Property OnlyInB As %String;

}
`;

/** A stored procedure whose side effect the injection fuzz watches for, and its counter. */
export const STORY393_SIDE_SOURCE = String.raw`Class Story393.Side
{

ClassMethod Bump() As %Integer [ SqlProc ]
{
    Quit $Increment(^Story393Side)
}

ClassMethod Count() As %Integer
{
    Quit +$Get(^Story393Side)
}

ClassMethod Defined() As %Integer
{
    Quit $Data(^Story393Side)
}

ClassMethod Reset() As %Status
{
    Kill ^Story393Side
    Quit $$$OK
}

}
`;

/** Seeds fixture sigma (set a) or the second namespace's bodies (set b); uses only $Property and $ClassMethod, so it compiles in both. */
export const STORY393_SEED_SOURCE = String.raw`Class Story393.Seed
{

/// Seed set pSet ("a" or "b") into the current namespace, which must be an empty EXECMCPTMP393
/// scratch namespace. pExactJson is a JSON array of the six Exact values. Returns a JSON ID map.
ClassMethod Seed(pSet As %String, pExactJson As %String = "") As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP393"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP393 followed by one capital letter" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    If pSet = "a" { Quit ..SeedA(pExactJson) }
    If pSet = "b" { Quit ..SeedB() }
    Quit "REFUSED: the set must be a or b"
}

ClassMethod SeedA(pExactJson As %String) As %String
{
    Set tExact = ##class(%DynamicAbstractObject).%FromJSON(pExactJson)
    If tExact.%Size() '= 6 { Quit "REFUSED: six exact values are required" }
    Set tOther = ..NewObject("Story393.Other", $ListBuild("Code", "K1-alpha"))
    If $Extract(tOther, 1, 6) = "ERROR:" { Quit tOther }
    Set tBodies = ""
    Set tBodies = tBodies_$ListBuild(..NewObject("Story393.Body", $ListBuild("Code", "K1-alpha", "Exact", tExact.%Get(0), "Amount", 10, "Flag", 1, "Renamed", "R-one", "Group", "g1", "Ref", tOther, "OnlyInA", "a1", "Note", "SYNTHPHI393 note")))
    Set tBodies = tBodies_$ListBuild(..NewObject("Story393.Body", $ListBuild("Code", "k1-ALPHA", "Exact", tExact.%Get(1), "Amount", 20, "Flag", 0, "Renamed", "R-two")))
    Set tBodies = tBodies_$ListBuild(..NewObject("Story393.Body", $ListBuild("Code", "K2", "Exact", tExact.%Get(2), "Amount", -5, "Flag", 1, "Ref", tOther)))
    Set tBodies = tBodies_$ListBuild(..NewObject("Story393.Body", $ListBuild("Code", "K2", "Exact", tExact.%Get(3), "Amount", 0, "Note", "note 4")))
    Set tBodies = tBodies_$ListBuild(..NewObject("Story393.Body", $ListBuild("Exact", tExact.%Get(4), "Amount", 1000)))
    Set tBodies = tBodies_$ListBuild(..NewObject("Story393.Body", $ListBuild("Code", "K3", "Exact", tExact.%Get(5), "Amount", 15)))
    Set tError = ""
    For tI = 1:1:6 {
        If $Extract($List(tBodies, tI), 1, 6) = "ERROR:" { Set tError = $List(tBodies, tI) Quit }
    }
    If tError '= "" { Quit tError }
    Set tHl7 = ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveHl7(..Hl7Text())
    If $Extract(tHl7, 1, 6) = "ERROR:" { Quit tHl7 }
    Set tIds = ""
    Set tIds = tIds_..AddHeader(1, 1, 9, 0, "Story393.Target", "Story393.Body", $List(tBodies, 1), "2001-02-03 08:00:00")_","
    Set tIds = tIds_..AddHeader(2, 1, 9, 0, "Story393.Target", "Story393.Body", $List(tBodies, 2), "2001-02-03 08:00:01")_","
    Set tIds = tIds_..AddHeader(3, 1, 8, 1, "Story393.Other", "Story393.Body", $List(tBodies, 3), "2001-02-03 08:00:02")_","
    Set tIds = tIds_..AddHeader(4, 1, 9, 0, "Story393.Target", "Story393.Body", $List(tBodies, 4), "2001-02-03 08:00:03")_","
    Set tIds = tIds_..AddHeader(5, 1, 9, 0, "Story393.Target", "Story393.Body", $List(tBodies, 5), "2001-02-03 08:00:03")_","
    Set tIds = tIds_..AddHeader(6, 1, 9, 0, "Story393.Target", "Story393.Body", $List(tBodies, 6), "2001-02-03 08:00:05")_","
    Set tIds = tIds_..AddHeader(7, 1, 9, 0, "Story393.Target", "Story393.Other", tOther, "2001-02-03 08:00:06")_","
    Set tIds = tIds_..AddHeader(8, 1, 9, 0, "Story393.Target", "Story393.Body", "999", "2001-02-03 08:00:07")_","
    Set tIds = tIds_..AddHeader(9, 1, 9, 0, "Story393.Target", "", "1", "2001-02-03 08:00:08")_","
    Set tIds = tIds_..AddHeader(10, 2, 9, 0, "Story393.Target", "Story393.Body", $List(tBodies, 1), "2001-02-03 08:00:09", 1)_","
    Set tIds = tIds_..AddHeader(11, 1, 9, 0, "Story393.Target", "EnsLib.HL7.Message", tHl7, "2001-02-03 08:00:10")_","
    Set tIds = tIds_..AddHeader(12, 1, 9, 0, "Story393.Target", "Story393.Body", $List(tBodies, 6), "2001-02-04 09:00:00")
    Quit {"headers":(tIds),"body":($ListToString(tBodies)),"other":(tOther),"hl7":(tHl7)}.%ToJSON()
}

ClassMethod SeedB() As %String
{
    Set tOne = ..NewObject("Story393.Body", $ListBuild("Code", "B-alpha", "Renamed", "R-one", "OnlyInB", "b1"))
    If $Extract(tOne, 1, 6) = "ERROR:" { Quit tOne }
    Set tTwo = ..NewObject("Story393.Body", $ListBuild("Code", "B-beta", "Renamed", "R-two", "OnlyInB", "b2"))
    If $Extract(tTwo, 1, 6) = "ERROR:" { Quit tTwo }
    Set tIds = ..AddHeader(1, 1, 9, 0, "Story393.Target", "Story393.Body", tOne, "2001-02-03 08:00:00")_","
    Set tIds = tIds_..AddHeader(2, 1, 9, 0, "Story393.Target", "Story393.Body", tTwo, "2001-02-03 08:00:01")
    Quit {"headers":(tIds),"body":(tOne_","_tTwo)}.%ToJSON()
}

/// Save one header: session 393000 plus pN, a Request or Response, the source Story393.Source.
ClassMethod AddHeader(pN As %Integer, pType As %Integer, pStatus As %Integer, pIsError As %Boolean, pTarget As %String, pBodyClass As %String, pBodyId As %String, pTime As %String, pCorresponding As %String = "") As %String
{
    Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).Add(393000 + pN, pType, pStatus, pIsError, "Story393.Source", pTarget, pBodyClass, pBodyId, pTime, "", pCorresponding)
}

/// Save one pClass object with the property pairs in pPairs, a $ListBuild of name, value, name, value...
/// A value for Note is written into its stream, and a value for Ref is a Story393.Other ID. Returns the ID or the error text.
ClassMethod NewObject(pClass As %String, pPairs As %List) As %String
{
    Set tObj = $ClassMethod(pClass, "%New")
    Set tSC = $$$OK
    For tI = 1:2:$ListLength(pPairs) {
        Set tName = $List(pPairs, tI), tValue = $List(pPairs, tI + 1)
        If tName = "Note" {
            Set tStream = $Property(tObj, "Note")
            Set tSC = tStream.Write(tValue)
        }
        ElseIf tName = "Ref" {
            Set $Property(tObj, "Ref") = $ClassMethod("Story393.Other", "%OpenId", tValue)
        }
        Else {
            Set $Property(tObj, tName) = tValue
        }
        If $System.Status.IsError(tSC) { Quit }
    }
    If $System.Status.IsOK(tSC) { Set tSC = tObj.%Save() }
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tObj.%Id()
}

/// The ER7 text of the ADT message whose PID-3 is SYNTHPHI393-MRN, with CR segment terminators.
ClassMethod Hl7Text() As %String
{
    Set tCR = $Char(13)
    Set tText = "MSH|^~\&|SYNTHPHI393-APP|SYNTHPHI393-FAC|||20010203080010||ADT^A01^ADT_A01|SYNTHPHI393-CTL|P|2.5.1"_tCR
    Set tText = tText_"EVN|A01|20010203080010"_tCR
    Set tText = tText_"PID|1||SYNTHPHI393-MRN^^^SYNTHPHI393-AA||SYNTHPHI393-LAST^SYNTHPHI393-FIRST||19010101|F"_tCR
    Quit tText
}

}
`;

/** The six Exact values of namespace A's bodies 1 to 6, in order: one source for the seed and for the TypeScript oracle. */
export const STORY393_EXACT_VALUES: readonly string[] = [
  "SYNTHPHI393-E1",
  "synthphi393-e1",
  "x' OR '1'='1 SYNTHPHI393-E3",
  '50% _off [SYNTHPHI393] "q" \\ ?',
  "SYNTHPHI393-E5\ttab\r\nnl",
  `${String.fromCodePoint(0xe9, 0x4e2d)} SYNTHPHI393-E6`,
];

/** The Story393 documents compiled into a scratch namespace, in compile order, for each seed set. */
const STORY393_DOCUMENTS: Record<"a" | "b", ReadonlyArray<readonly [string, string]>> = {
  a: [
    ["Story393.Addr.cls", STORY393_ADDR_SOURCE],
    ["Story393.Other.cls", STORY393_OTHER_SOURCE],
    ["Story393.Body.cls", STORY393_BODY_A_SOURCE],
    ["Story393.Side.cls", STORY393_SIDE_SOURCE],
    ["Story393.Seed.cls", STORY393_SEED_SOURCE],
  ],
  b: [
    ["Story393.Body.cls", STORY393_BODY_B_SOURCE],
    ["Story393.Seed.cls", STORY393_SEED_SOURCE],
  ],
};

/**
 * What `Story393.Seed.Seed` returns: namespace A has twelve headers, six `Story393.Body` bodies, one
 * `Story393.Other` and one HL7 message; B has two headers and two bodies. The body IDs are those of a fresh
 * extent.
 */
export const STORY393_IDS: Record<"a" | "b", Record<string, string>> = {
  a: { headers: "1,2,3,4,5,6,7,8,9,10,11,12", body: "1,2,3,4,5,6", other: "1", hl7: "1" },
  b: { headers: "1,2", body: "1,2" },
};

/**
 * Story 39.4 Search Table fixture sources. They are compiled INSIDE a scratch namespace (set `a`:
 * `Story393.Side`, `Story394.SearchTable`, `Story394.SubMessage`, `Story394.Seed`; set `b`: `Story394.SearchTableB`,
 * `Story394.Seed`), never in HSCUSTOM, so the database file that `removeInteropNamespace` deletes takes
 * them away. Every identifying value contains `SYNTHPHI394`, and values that must survive a result
 * contain `KEEPME394`.
 *
 * Search Table PropIds are assigned in name order when the first Search Table class of a namespace is
 * compiled, so B compiles `Story394.SearchTableB` (which adds `AOnlyInB`) before any other Search Table
 * work and its `PatientID` PropId (5) differs from A's (4).
 */
export const STORY394_SEARCH_TABLE_SOURCE = String.raw`Class Story394.SearchTable Extends EnsLib.HL7.SearchTable
{

XData SearchSpec [ XMLNamespace = "http://www.intersystems.com/EnsSearchTable" ]
{
<Items>
<Item DocType="" PropName="Story394Int" PropType="Integer">[PID:1]</Item>
<Item DocType="" PropName="Story394Empty" StoreNulls="true">{2:6}</Item>
</Items>
}

}
`;

export const STORY394_SEARCH_TABLE_B_SOURCE = String.raw`Class Story394.SearchTableB Extends EnsLib.HL7.SearchTable
{

XData SearchSpec [ XMLNamespace = "http://www.intersystems.com/EnsSearchTable" ]
{
<Items>
<Item DocType="" PropName="AOnlyInB">{2:7}</Item>
</Items>
}

}
`;

/** A strict subclass of the HL7 document class that no header carries: `bodyClass` set to it replaces the document class in the lookup. */
export const STORY394_SUB_MESSAGE_SOURCE = String.raw`Class Story394.SubMessage Extends EnsLib.HL7.Message
{

}
`;

/** Seeds fixture tau (set a) or the second namespace's messages (set b); uses only $ClassMethod for the table, so it compiles in both. */
export const STORY394_SEED_SOURCE = String.raw`Class Story394.Seed
{

/// Seed set pSet ("a" or "b") into the current namespace, which must be an empty EXECMCPTMP394
/// scratch namespace. Returns a JSON ID map.
ClassMethod Seed(pSet As %String) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP394"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP394 followed by one capital letter" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    If pSet = "a" { Quit ..SeedA() }
    If pSet = "b" { Quit ..SeedB() }
    Quit "REFUSED: the set must be a or b"
}

ClassMethod SeedA() As %String
{
    Set tTable = "Story394.SearchTable"
    Set tM = ""
    Set tM = tM_$ListBuild(..Save(tTable, 1, "ADT^A01", "Story394-CTL-a", "0007", "SYNTHPHI394-ALT-1", "SYNTHPHI394-MRN-1", "SYNTHPHI394^ONE", ""))
    Set tM = tM_$ListBuild(..Save(tTable, 1, "ORU^R01", "Story394-CTL-A", "12", "", "SYNTHPHI394-MRN-2~SYNTHPHI394-MRN-1", "SYNTHPHI394^TWO", "KEEPME394-MOM"))
    Set tM = tM_$ListBuild(..Save(tTable, 1, "ADT^A08", "Story394-CTL-3", "3", "", "SYNTHPHI394-MRN-3", "", ""))
    Set tM = tM_$ListBuild(..Save(tTable, 1, "ADT^A01", "Story394-CTL-4", "", "", "SYNTHPHI394-MRN-4", "", ""))
    Set tM = tM_$ListBuild(..Save(tTable, 1, "ADT^A01", "Story394-CTL-5", "", "", "SYNTHPHI394-MRN-5", "", ""))
    Set tM = tM_$ListBuild(..Save(tTable, 0, "ADT^A01", "Story394-CTL-6", "", "", "SYNTHPHI394-MRN-6", "", ""))
    Set tError = ..FirstError(tM, 6)
    If tError '= "" { Quit tError }
    Set tString = ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveString("SYNTHPHI394-MRN-1")
    If $Extract(tString, 1, 6) = "ERROR:" { Quit tString }
    Set tH = ""
    Set tH = tH_$ListBuild(..AddHeader(1, 1, 9, 0, "Story394.Target", "EnsLib.HL7.Message", $List(tM, 1), "2001-02-03 08:00:00"))
    Set tH = tH_$ListBuild(..AddHeader(2, 1, 9, 0, "Story394.Target", "EnsLib.HL7.Message", $List(tM, 2), "2001-02-03 08:00:01"))
    Set tH = tH_$ListBuild(..AddHeader(3, 1, 8, 1, "Story394.Other", "EnsLib.HL7.Message", $List(tM, 3), "2001-02-03 08:00:02"))
    Set tH = tH_$ListBuild(..AddHeader(4, 1, 9, 0, "Story394.Target", "EnsLib.HL7.Message", $List(tM, 4), "2001-02-03 08:00:03"))
    Set tH = tH_$ListBuild(..AddHeader(5, 1, 9, 0, "Story394.Target", "EnsLib.HL7.Message", $List(tM, 5), "2001-02-03 08:00:03"))
    Set tH = tH_$ListBuild(..AddHeader(6, 1, 9, 0, "Story394.Target", "EnsLib.HL7.Message", $List(tM, 6), "2001-02-03 08:00:05"))
    Set tH = tH_$ListBuild(..AddHeader(7, 1, 9, 0, "Story394.Target", "Ens.StringRequest", tString, "2001-02-03 08:00:06"))
    Set tH = tH_$ListBuild(..AddHeader(8, 1, 9, 0, "Story394.Target", "EnsLib.HL7.Message", "999", "2001-02-03 08:00:07"))
    Set tH = tH_$ListBuild(..AddHeader(9, 1, 9, 0, "Story394.Target", "", "1", "2001-02-03 08:00:08"))
    Set tH = tH_$ListBuild(..AddHeader(10, 2, 9, 0, "Story394.Target", "EnsLib.HL7.Message", $List(tM, 1), "2001-02-03 08:00:09", 1))
    Set tH = tH_$ListBuild(..AddHeader(11, 1, 9, 0, "Story394.Target", "EnsLib.HL7.Message", $List(tM, 1), "2001-02-04 09:00:00"))
    Set tError = ..FirstError(tH, 11)
    If tError '= "" { Quit tError }
    Quit {"headers":($ListToString(tH)),"hl7":($ListToString(tM)),"string":(tString)}.%ToJSON()
}

ClassMethod SeedB() As %String
{
    Set tTable = "Story394.SearchTableB"
    Set tM = ""
    Set tM = tM_$ListBuild(..Save(tTable, 1, "ADT^A01", "Story394-CTL-B1", "", "", "SYNTHPHI394-MRN-1", "SYNTHPHI394^BONE", "", "SYNTHPHI394-AONLY-1"))
    Set tM = tM_$ListBuild(..Save(tTable, 1, "ADT^A01", "Story394-CTL-B2", "", "", "SYNTHPHI394-MRN-B2", "SYNTHPHI394^BTWO", ""))
    Set tError = ..FirstError(tM, 2)
    If tError '= "" { Quit tError }
    Set tH = ""
    Set tH = tH_$ListBuild(..AddHeader(1, 1, 9, 0, "Story394.Target", "EnsLib.HL7.Message", $List(tM, 1), "2001-02-03 08:00:00"))
    Set tH = tH_$ListBuild(..AddHeader(2, 1, 9, 0, "Story394.Target", "EnsLib.HL7.Message", $List(tM, 2), "2001-02-03 08:00:01"))
    Set tError = ..FirstError(tH, 2)
    If tError '= "" { Quit tError }
    Quit {"headers":($ListToString(tH)),"hl7":($ListToString(tM))}.%ToJSON()
}

/// The first ERROR: text among the first pCount items of the list pList, or "".
ClassMethod FirstError(pList As %List, pCount As %Integer) As %String
{
    Set tError = ""
    For tI = 1:1:pCount {
        If $Extract($List(pList, tI), 1, 6) = "ERROR:" {
            Set tError = $List(pList, tI)
            Quit
        }
    }
    Quit tError
}

/// Save one header: session 394000 plus pN, a Request or Response, the source Story394.Source.
ClassMethod AddHeader(pN As %Integer, pType As %Integer, pStatus As %Integer, pIsError As %Boolean, pTarget As %String, pBodyClass As %String, pBodyId As %String, pTime As %String, pCorresponding As %String = "") As %String
{
    Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).Add(394000 + pN, pType, pStatus, pIsError, "Story394.Source", pTarget, pBodyClass, pBodyId, pTime, "", pCorresponding)
}

/// Save one untyped HL7 message (segments MSH, PID, PV1, CR terminators) and, when pIndex is true,
/// index it with the Search Table class pTable. Returns the message ID or the error text.
ClassMethod Save(pTable As %String, pIndex As %Boolean, pType As %String, pControl As %String, pPid1 As %String, pPid2 As %String, pPid3 As %String, pPid5 As %String, pPid6 As %String, pPid7 As %String = "") As %String
{
    Set tCR = $Char(13)
    Set tText = "MSH|^~\&|SYNTHPHI394-APP|SYNTHPHI394-FAC|||20010203080000||"_pType_"|"_pControl_"|P|2.5.1"_tCR
    Set tText = tText_"PID|"_pPid1_"|"_pPid2_"|"_pPid3_"||"_pPid5_"|"_pPid6_"|"_pPid7_tCR
    Set tText = tText_"PV1|1|I"_tCR
    Set tId = ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveHl7(tText)
    If $Extract(tId, 1, 6) = "ERROR:" { Quit tId }
    If pIndex {
        Set tSC = $ClassMethod(pTable, "IndexDoc", ##class(EnsLib.HL7.Message).%OpenId(tId))
        If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    }
    Quit tId
}

}
`;

/** The Story394 documents compiled into a scratch namespace, in compile order, for each seed set. */
const STORY394_DOCUMENTS: Record<"a" | "b", ReadonlyArray<readonly [string, string]>> = {
  a: [
    ["Story393.Side.cls", STORY393_SIDE_SOURCE],
    ["Story394.SearchTable.cls", STORY394_SEARCH_TABLE_SOURCE],
    ["Story394.SubMessage.cls", STORY394_SUB_MESSAGE_SOURCE],
    ["Story394.Seed.cls", STORY394_SEED_SOURCE],
  ],
  b: [
    ["Story394.SearchTableB.cls", STORY394_SEARCH_TABLE_B_SOURCE],
    ["Story394.Seed.cls", STORY394_SEED_SOURCE],
  ],
};

/**
 * What `Story394.Seed.Seed` returns: namespace A has eleven headers over six HL7 messages (the sixth is
 * not indexed) and one `Ens.StringRequest` whose body ID equals the first message's; B has two headers
 * over two indexed messages.
 */
export const STORY394_IDS: Record<"a" | "b", Record<string, string>> = {
  a: { headers: "1,2,3,4,5,6,7,8,9,10,11", hl7: "1,2,3,4,5,6", string: "1" },
  b: { headers: "1,2", hl7: "1,2" },
};

/**
 * Put and compile `documents` into the scratch namespace `name`, run `className.Seed(args)` there, and
 * check the JSON ID map it returns against `expected`. `what` names the seed in error text.
 */
export async function putCompileSeed(
  dev: WireSession,
  name: string,
  documents: ReadonlyArray<readonly [string, string]>,
  seed: { className: string; args: unknown[] },
  expected: Record<string, string>,
  what: string,
): Promise<void> {
  const docs = docFixtures(dev, name);
  for (const [doc, source] of documents) {
    await docs.putDoc(doc, source);
    await docs.compileDoc(doc);
  }
  const content = await callChecked(
    dev,
    "iris_execute_classmethod",
    { namespace: name, className: seed.className, methodName: "Seed", args: seed.args },
    `seeding ${what} into ${name}`,
  );
  const returned = String(content.returnValue ?? "");
  let ids: unknown;
  try {
    ids = JSON.parse(returned);
  } catch {
    throw new Error(`seeding ${what} into ${name} returned ${JSON.stringify(returned.slice(0, 120))}`);
  }
  if (JSON.stringify(ids) !== JSON.stringify(expected)) {
    throw new Error(`seeding ${what} into ${name} returned ${JSON.stringify(returned.slice(0, 200))}`);
  }
}

/**
 * Put and compile the `Story393` classes of `set` into the scratch namespace `name`, then seed it and
 * check the IDs it received.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - An interop-enabled, empty `EXECMCPTMP393<capital letter>` namespace.
 * @param set - `a` (sigma: twelve headers) or `b` (two bodies and headers 1 and 2).
 */
export async function seedBodySearch(dev: WireSession, name: string, set: "a" | "b"): Promise<void> {
  assertFixtureName(name);
  await putCompileSeed(
    dev,
    name,
    STORY393_DOCUMENTS[set],
    { className: "Story393.Seed", args: [set, JSON.stringify(STORY393_EXACT_VALUES)] },
    STORY393_IDS[set],
    `the body-search set ${set}`,
  );
}

/**
 * Put and compile the `Story394` classes of `set` into the scratch namespace `name`, then seed it (the
 * Search Table entries are made with `IndexDoc`; no production runs) and check the IDs it received.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - An interop-enabled, empty `EXECMCPTMP394<capital letter>` namespace.
 * @param set - `a` (tau: eleven headers over six messages and a string) or `b` (two indexed messages).
 */
export async function seedSearchTable(dev: WireSession, name: string, set: "a" | "b"): Promise<void> {
  assertFixtureName(name);
  await putCompileSeed(
    dev,
    name,
    STORY394_DOCUMENTS[set],
    { className: "Story394.Seed", args: [set] },
    STORY394_IDS[set],
    `the Search Table set ${set}`,
  );
}

/**
 * Story 39.5 body-reader fixture sources. They are compiled INSIDE a scratch namespace (set `a`: `JsonBody`,
 * `Plain`, `Seed`; set `b`: `Seed`), never in HSCUSTOM, so the database file that `removeInteropNamespace`
 * deletes takes them away. Every identifying value contains `SYNTHPHI`, and values that must survive a
 * result contain `KEEPME`.
 *
 * Fixture kappa (set `a`) has seventeen headers, one body of every shape the reader decides: HL7 v2 (an ADT, an
 * ACK, a message with other separators, a 70,180-character message, a 2.4-million-character message, a small
 * and a large batch, a dangling ID), a stream, a string, a stream container, an XML virtual document, a body
 * with a JSON adaptor, a plain persistent body, a missing class, a literal and a class that never opens.
 */
export const STORY395_JSON_BODY_SOURCE = String.raw`Class Story395.JsonBody Extends (%Persistent, %JSON.Adaptor)
{

Property Name As %String;

Property Code As %String;

}
`;

/**
 * A persistent body without a JSON adaptor: the dump rules skip `Secret` (private), `Temp` (transient), `Shown`
 * (calculated, not transient: its getter would return a value) and `Multi` (multidimensional, not transient: set
 * on every open), so each skip rule has a property only it removes.
 */
export const STORY395_PLAIN_SOURCE = String.raw`Class Story395.Plain Extends %Persistent
{

Property Name As %String;

Property Count As %Integer;

Property Tags As list Of %String;

Property Note As %Stream.GlobalCharacter;

Property Ref As Ens.StringRequest;

Property Secret As %String [ Private ];

Property Temp As %String [ Transient ];

Property Shown As %String [ Calculated ];

Property Multi [ MultiDimensional ];

/// The calculated value, which the dump never shows.
Method ShownGet() As %String
{
    Quit "SYNTHPHI-CALC"
}

/// Give the multidimensional property a value on every open, which the dump never shows.
Method %OnOpen() As %Status [ Private, ServerOnly = 1 ]
{
    Set ..Multi = "SYNTHPHI-MULTI"
    Quit $$$OK
}

/// Save one object whose Ref is the Ens.StringRequest pRefId. Returns its ID or the error text.
ClassMethod Make(pRefId As %String) As %String
{
    Set tObj = ..%New()
    Set tObj.Name = "SYNTHPHI-PLAIN"
    Set tObj.Count = 7
    Do tObj.Tags.Insert("SYNTHPHI-TAG")
    Do tObj.Note.Write("SYNTHPHI-NOTE")
    Set tObj.Ref = ##class(Ens.StringRequest).%OpenId(pRefId)
    Set tObj.Secret = "SYNTHPHI-PRIVATE"
    Set tObj.Temp = "SYNTHPHI-TEMP"
    Set tSC = tObj.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tObj.%Id()
}

}
`;

/** Seeds fixture kappa (set a) or the second namespace's bodies (set b); uses only $ClassMethod for the classes set b lacks, so it compiles in both. */
export const STORY395_SEED_SOURCE = String.raw`Class Story395.Seed
{

/// Seed set pSet ("a" or "b") into the current namespace, which must be an empty EXECMCPTMP395
/// scratch namespace. Returns a JSON ID map.
ClassMethod Seed(pSet As %String) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP395"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP395 followed by one capital letter" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    If pSet = "a" { Quit ..SeedA() }
    If pSet = "b" { Quit ..SeedB() }
    Quit "REFUSED: the set must be a or b"
}

ClassMethod SeedA() As %String
{
    Set tString = ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveString("SYNTHPHI-STRING")
    Set tBodies = ""
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7("adt")))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7("ack")))
    Set tBodies = tBodies_$ListBuild($ListBuild("%Stream.GlobalCharacter", ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveStream(##class(ExecuteMCPv2.Temp.Story391Fixture).StreamText())))
    Set tBodies = tBodies_$ListBuild($ListBuild("Ens.StringRequest", tString))
    Set tBodies = tBodies_$ListBuild($ListBuild("Ens.StreamContainer", ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveContainer("SYNTHPHI-CONTAINER")))
    Set tBodies = tBodies_$ListBuild($ListBuild("Story395.Body.Missing", "1"))
    Set tBodies = tBodies_$ListBuild($ListBuild("", "SYNTHPHI-LITERAL"))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7("alt")))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7("big")))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.EDI.XML.Document", ..SaveXml()))
    Set tBodies = tBodies_$ListBuild($ListBuild("Story395.JsonBody", ..SaveJson()))
    Set tBodies = tBodies_$ListBuild($ListBuild("Story395.Plain", $ClassMethod("Story395.Plain", "Make", tString)))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7("huge")))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", "999999"))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7("batchSmall")))
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ..SaveHl7("batchLarge")))
    Set tBodies = tBodies_$ListBuild($ListBuild("%Library.DynamicObject", "1"))
    Quit ..AddHeaders(tBodies, 17)
}

ClassMethod SeedB() As %String
{
    Set tCR = $Char(13)
    Set tText = "MSH|^~\&|SYNTHPHI-B-APP|SYNTHPHI-B-FAC|||20010203090001||ADT^A01^ADT_A01|SYNTHPHI-B-CTL|P|2.5.1"_tCR
    Set tText = tText_"PID|1||SYNTHPHI-B-MRN"_tCR
    Set tText = tText_"OBX|1|TX|B^KEEPME-B^L||SYNTHPHI-B-NOTE"_tCR
    Set tBodies = ""
    Set tBodies = tBodies_$ListBuild($ListBuild("EnsLib.HL7.Message", ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveHl7(tText)))
    Set tBodies = tBodies_$ListBuild($ListBuild("Ens.StringRequest", ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveString("SYNTHPHI-B-STRING")))
    Quit ..AddHeaders(tBodies, 2)
}

/// Save one Completed Request header for each of the first pCount (class, body ID) pairs of the list pBodies:
/// session 395000 plus n, from Story395.Source to Story395.Target, created 2001-02-03 11:00:00 plus n seconds.
/// Returns the JSON ID map {"headers":"1,2,..."}, or the first error text.
ClassMethod AddHeaders(pBodies As %List, pCount As %Integer) As %String
{
    Set tIds = ""
    For tI = 1:1:pCount {
        Set tBody = $List(pBodies, tI)
        If $Extract($List(tBody, 2), 1, 6) = "ERROR:" { Quit }
        Set tId = ##class(ExecuteMCPv2.Temp.Story391Fixture).Add(395000 + tI, 1, 9, 0, "Story395.Source", "Story395.Target", $List(tBody, 1), $List(tBody, 2), "2001-02-03 11:00:" _ $Extract(100 + tI, 2, 3))
        If $Extract(tId, 1, 6) = "ERROR:" { Quit }
        Set tIds = tIds_$Select(tIds = "": "", 1: ",")_tId
    }
    If $Length(tIds, ",") '= pCount { Quit "FAILED: headers: "_tIds_" "_$Get(tBody)_" "_$Get(tId) }
    Quit {"headers":(tIds)}.%ToJSON()
}

/// Save the ER7 text pName as an unsent EnsLib.HL7.Message and return its ID, or the error text.
ClassMethod SaveHl7(pName As %String) As %String
{
    Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveHl7(..Hl7Text(pName))
}

/// Save the XML virtual document and return its ID, or the error text.
ClassMethod SaveXml() As %String
{
    Set tDoc = ##class(EnsLib.EDI.XML.Document).ImportFromString("<Patient><Name>SYNTHPHI-XML-NAME</Name><Code>KEEPME-XML</Code></Patient>", .tSC)
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Set tSC = tDoc.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tDoc.%Id()
}

/// Save one Story395.JsonBody and return its ID, or the error text.
ClassMethod SaveJson() As %String
{
    Set tObj = $ClassMethod("Story395.JsonBody", "%New")
    Set $Property(tObj, "Name") = "SYNTHPHI-JSON-NAME"
    Set $Property(tObj, "Code") = "KEEPME-JSON"
    Set tSC = tObj.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tObj.%Id()
}

/// The text of length pChars made of repeats of pUnit.
ClassMethod Filler(pChars As %Integer, pUnit As %String) As %String
{
    Set tText = ""
    For { Quit:$Length(tText)>=pChars  Set tText = tText_pUnit }
    Quit $Extract(tText, 1, pChars)
}

/// The synthetic ER7 text pName ("adt", "ack", "alt", "big", "huge", "batchSmall" or "batchLarge"), with CR
/// segment terminators. The first four are the Story391Fixture texts.
ClassMethod Hl7Text(pName As %String) As %String
{
    Set tCR = $Char(13)
    If (pName = "adt") || (pName = "ack") || (pName = "alt") || (pName = "big") {
        Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).Hl7Text(pName)
    }
    If pName = "huge" {
        Set tText = "MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090013||ORU^R01^ORU_R01|SYNTHPHI-CTL13|P|2.5.1"_tCR
        Set tText = tText_"PID|1||SYNTHPHI-MRN13"_tCR
        Set tFiller = ..Filler(60000, "SYNTHPHI-HUGE ")
        For tI = 1:1:40 { Set tText = tText_"OBX|"_tI_"|TX|NOTE^KEEPME-NOTE^L||"_tFiller_"|||||F"_tCR }
        Quit tText
    }
    If (pName = "batchSmall") || (pName = "batchLarge") {
        Set tFiller = $Select(pName = "batchLarge": ..Filler(30000, "SYNTHPHI-BATCH "), 1: "")
        Set tCount = $Select(pName = "batchLarge": 3, 1: 2)
        Set tText = "FHS|^~\&|SYNTHPHI-FAPP"_tCR_"BHS|^~\&|SYNTHPHI-BAPP"_tCR
        For tI = 1:1:tCount {
            Set tText = tText_"MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||2001020309001"_tI_"||ADT^A01^ADT_A01|SYNTHPHI-CTL15"_tI_"|P|2.5.1"_tCR
            Set tText = tText_"PID|1||SYNTHPHI-MRN15"_$Char(64 + tI)_tCR
            If tFiller '= "" { Set tText = tText_"OBX|1|TX|NOTE^KEEPME-NOTE^L||"_tFiller_"|||||F"_tCR }
        }
        Quit tText_"BTS|"_tCount_tCR_"FTS|1"_tCR
    }
    Quit ""
}

/// For each header ID in the comma-separated list pIds: the JSON [{id, precheck, serialized}], where precheck is
/// ExecuteMCPv2.REST.MessageSearch.Hl7Size with the limit pLimit (by default one no body reaches), and serialized
/// is the length OutputToLibraryStream writes for the same body.
ClassMethod Sizes(pIds As %String, pLimit As %Integer = 1000000000) As %String
{
    Set tList = []
    For tI = 1:1:$Length(pIds, ",") {
        Set tHeaderId = +$Piece(pIds, ",", tI)
        Set tHeader = ##class(Ens.MessageHeader).%OpenId(tHeaderId)
        Set tClass = tHeader.MessageBodyClassName
        Set tBodyId = tHeader.MessageBodyId
        Set tObj = $ClassMethod(tClass, "%OpenId", tBodyId)
        Set tStream = ##class(%Stream.TmpCharacter).%New()
        Set tSC = tObj.OutputToLibraryStream(tStream)
        Do tList.%Push({"id":(tHeaderId),"precheck":(##class(ExecuteMCPv2.REST.MessageSearch).Hl7Size(tClass, tBodyId, pLimit)),"serialized":(tStream.Size)})
    }
    Quit tList.%ToJSON()
}

/// How long the HL7 text read of header pHeaderId takes under the limit pMax, against how long the body's
/// serialization takes: {"result", "hl7TextMs", "serializeMs"}, each time the minimum of three runs.
ClassMethod Timing(pHeaderId As %Integer, pMax As %Integer) As %String
{
    Set tHeader = ##class(Ens.MessageHeader).%OpenId(pHeaderId)
    Set tClass = tHeader.MessageBodyClassName
    Set tBodyId = tHeader.MessageBodyId
    Set tObj = $ClassMethod(tClass, "%OpenId", tBodyId)
    Set tSerializeMs = ""
    Set tTextMs = ""
    For tI = 1:1:3 {
        Set tStream = ##class(%Stream.TmpCharacter).%New()
        Set tStart = $ZH
        Set tSC = tObj.OutputToLibraryStream(tStream)
        Set tMs = ($ZH - tStart) * 1000
        If (tSerializeMs = "") || (tMs < tSerializeMs) { Set tSerializeMs = tMs }
        Set tStart = $ZH
        Set tResult = ##class(ExecuteMCPv2.REST.MessageSearch).Hl7Text(tClass, tBodyId, pMax, .tText)
        Set tMs = ($ZH - tStart) * 1000
        If (tTextMs = "") || (tMs < tTextMs) { Set tTextMs = tMs }
    }
    Quit {"result":(tResult),"hl7TextMs":(tTextMs),"serializeMs":(tSerializeMs)}.%ToJSON()
}

}
`;

/** The Story395 documents compiled into a scratch namespace, in compile order, for each seed set. */
export const STORY395_DOCUMENTS: Record<"a" | "b", ReadonlyArray<readonly [string, string]>> = {
  a: [
    ["Story395.JsonBody.cls", STORY395_JSON_BODY_SOURCE],
    ["Story395.Plain.cls", STORY395_PLAIN_SOURCE],
    ["Story395.Seed.cls", STORY395_SEED_SOURCE],
  ],
  b: [["Story395.Seed.cls", STORY395_SEED_SOURCE]],
};

/**
 * What `Story395.Seed.Seed` returns: namespace A has seventeen headers (fixture kappa), B has two (an HL7
 * message that holds `SYNTHPHI-B-MRN`, and a string).
 */
export const STORY395_IDS: Record<"a" | "b", Record<string, string>> = {
  a: { headers: "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17" },
  b: { headers: "1,2" },
};

/**
 * Put and compile the `Story395` classes of `set` into the scratch namespace `name`, then seed it and check
 * the IDs it received.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - An interop-enabled, empty `EXECMCPTMP395<capital letter>` namespace.
 * @param set - `a` (kappa: seventeen headers) or `b` (two headers).
 */
export async function seedBodyReader(dev: WireSession, name: string, set: "a" | "b"): Promise<void> {
  assertFixtureName(name);
  await putCompileSeed(
    dev,
    name,
    STORY395_DOCUMENTS[set],
    { className: "Story395.Seed", args: [set] },
    STORY395_IDS[set],
    `the body-reader set ${set}`,
  );
}

/**
 * Story 39.6 capstone fixture mu. It is compiled INSIDE a scratch namespace (never in HSCUSTOM) together with
 * `Story394.SearchTable`, which indexes each message, so the database file that `removeInteropNamespace`
 * deletes takes both away. Three untyped HL7 v2 messages (MSH, then `PID|1||<mrn>`, then an OBX whose code
 * `KEEPME396-CODE^KEEPME396-TEXT^L` survives redaction and whose value `SYNTHPHI396-NOTE` does not) and four
 * Completed Request headers, all created on 2001-02-03 UTC:
 *
 * | header | session | source to target | message | PID-3 | time |
 * |---|---|---|---|---|---|
 * | 1 | 396001 | Story396.Service to Story396.Router | 1 (ADT^A01) | SYNTHPHI396-MRN-P | 12:00:01 |
 * | 2 | 396001 | Story396.Router to Story396.Operation | 1 | SYNTHPHI396-MRN-P | 12:00:02 |
 * | 3 | 396002 | Story396.Service to Story396.Router | 2 (ADT^A08) | SYNTHPHI396-MRN-P | 12:00:03 |
 * | 4 | 396003 | Story396.Service to Story396.Router | 3 (ADT^A01) | SYNTHPHI396-MRN-Q | 12:00:04 |
 */
export const STORY396_SEED_SOURCE = String.raw`Class Story396.Seed
{

/// Seed fixture mu into the current namespace, which must be an empty EXECMCPTMP396 scratch namespace.
/// Returns the JSON ID map {"headers":"1,2,3,4","hl7":"1,2,3"}, or the first error text.
ClassMethod Seed() As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP396"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP396 followed by one capital letter" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    Set tM = ""
    Set tM = tM_$ListBuild(..Save("SYNTHPHI396-MRN-P", "ADT^A01", "Story396-CTL-1"))
    Set tM = tM_$ListBuild(..Save("SYNTHPHI396-MRN-P", "ADT^A08", "Story396-CTL-2"))
    Set tM = tM_$ListBuild(..Save("SYNTHPHI396-MRN-Q", "ADT^A01", "Story396-CTL-3"))
    Set tError = ..FirstError(tM, 3)
    If tError '= "" { Quit tError }
    Set tH = ""
    Set tH = tH_$ListBuild(..AddHeader(1, "Story396.Service", "Story396.Router", $List(tM, 1), "2001-02-03 12:00:01"))
    Set tH = tH_$ListBuild(..AddHeader(1, "Story396.Router", "Story396.Operation", $List(tM, 1), "2001-02-03 12:00:02"))
    Set tH = tH_$ListBuild(..AddHeader(2, "Story396.Service", "Story396.Router", $List(tM, 2), "2001-02-03 12:00:03"))
    Set tH = tH_$ListBuild(..AddHeader(3, "Story396.Service", "Story396.Router", $List(tM, 3), "2001-02-03 12:00:04"))
    Set tError = ..FirstError(tH, 4)
    If tError '= "" { Quit tError }
    Quit {"headers":($ListToString(tH)),"hl7":($ListToString(tM))}.%ToJSON()
}

/// The first ERROR: text among the first pCount items of the list pList, or "".
ClassMethod FirstError(pList As %List, pCount As %Integer) As %String
{
    Set tError = ""
    For tI = 1:1:pCount {
        If $Extract($List(pList, tI), 1, 6) = "ERROR:" {
            Set tError = $List(pList, tI)
            Quit
        }
    }
    Quit tError
}

/// Save one Completed Request header: session 396000 plus pSession, a body of class EnsLib.HL7.Message.
ClassMethod AddHeader(pSession As %Integer, pSource As %String, pTarget As %String, pBodyId As %String, pTime As %String) As %String
{
    Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).Add(396000 + pSession, 1, 9, 0, pSource, pTarget, "EnsLib.HL7.Message", pBodyId, pTime)
}

/// Save one untyped HL7 message (segments MSH, PID, OBX, CR terminators) and index it with
/// Story394.SearchTable. Returns the message ID or the error text.
ClassMethod Save(pMrn As %String, pType As %String, pControl As %String) As %String
{
    Set tCR = $Char(13)
    Set tText = "MSH|^~\&|Story396-APP|Story396-FAC|||20010203120000||"_pType_"|"_pControl_"|P|2.5.1"_tCR
    Set tText = tText_"PID|1||"_pMrn_tCR
    Set tText = tText_"OBX|1|TX|KEEPME396-CODE^KEEPME396-TEXT^L||SYNTHPHI396-NOTE"_tCR
    Set tId = ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveHl7(tText)
    If $Extract(tId, 1, 6) = "ERROR:" { Quit tId }
    Set tSC = $ClassMethod("Story394.SearchTable", "IndexDoc", ##class(EnsLib.HL7.Message).%OpenId(tId))
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tId
}

}
`;

/** The Story396 documents compiled into a scratch namespace, in compile order. */
export const STORY396_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story394.SearchTable.cls", STORY394_SEARCH_TABLE_SOURCE],
  ["Story396.Seed.cls", STORY396_SEED_SOURCE],
];

/** What `Story396.Seed.Seed` returns: four headers over three HL7 messages, numbered from 1 in a fresh namespace. */
export const STORY396_IDS = { headers: "1,2,3,4", hl7: "1,2,3" } as const;

/**
 * Put and compile the `Story396` seed and the `Story394.SearchTable` class into the scratch namespace
 * `name`, then seed fixture mu (the Search Table entries are made with `IndexDoc`; no production runs) and
 * check the IDs it received.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - An interop-enabled, empty `EXECMCPTMP396<capital letter>` namespace.
 */
export async function seedCapstone(dev: WireSession, name: string): Promise<void> {
  assertFixtureName(name);
  await putCompileSeed(
    dev,
    name,
    STORY396_DOCUMENTS,
    { className: "Story396.Seed", args: [] },
    STORY396_IDS,
    "the capstone fixture mu",
  );
}

/**
 * Story 39.7 burn-down fixture nu. It is compiled INSIDE a scratch namespace that maps `HS` to HSLIB (never in
 * HSCUSTOM), so the database file that `removeInteropNamespace` deletes takes it away. Four headers on
 * 2001-02-03 UTC (`Story391Fixture.Add`), three bodies and two Event Log rows. Every identifying value contains
 * `SYNTHPHI397` and every value that must survive contains `KEEPME397`.
 *
 * | header | session | type, status | source to target | body |
 * |---|---|---|---|---|
 * | 1 | 397001 | Request, Completed | Story397.Service to Story397.Router | X1, an `HS.Message.XMLMessage` |
 * | 2 | 397001 | Response, Completed | Story397.Router to Story397.Service | S1, a `Story397.StreamBody` |
 * | 3 | 397002 | Request, Completed | Story397.Service to Story397.Operation | S2, a `Story397.StreamBody` |
 * | 4 | 397002 | Response, Error (IsError) | Story397.Operation to Story397.Service | none (a literal with no value) |
 *
 * Times are 12:00:01 to 12:00:04. Header 4 answers header 3 and carries an `ErrorStatus` that names
 * `SYNTHPHI397-ERR`. The Event Log rows are saved directly: row 1 is an Error of `Story397.Operation` in session
 * 397002 and row 2 an Info of `Story397.Service` with no session.
 */
export const STORY397_STREAM_BODY_SOURCE = String.raw`Class Story397.StreamBody Extends %Persistent
{

Property Name As %String;

Property Content As %Stream.GlobalCharacter;

Property Blob As %Stream.GlobalBinary;

Property Second As %Stream.GlobalCharacter;

}
`;

/** Seeds fixture nu; refuses any namespace that is not an `EXECMCPTMP397<capital letter>` one or that holds headers. */
export const STORY397_SEED_SOURCE = String.raw`Class Story397.Seed
{

/// Seed fixture nu into the current namespace, which must be an empty EXECMCPTMP397 scratch namespace.
/// Returns the JSON ID map {"headers":"1,2,3,4","logs":"1,2","xml":"1","stream":"1,2"}, or the first error text.
ClassMethod Seed() As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP397"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP397 followed by one capital letter" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    Set tContent = "<a>SYNTHPHI397-STREAM</a>"_$Char(13, 10)_"line2"_$Char(1)_"KEEPME397-TAIL"
    Set tLong = $Translate($Justify("", 70000), " ", "x")_"SYNTHPHI397-LONG-END"
    Set tBodies = ""
    Set tBodies = tBodies_$ListBuild(..SaveXml())
    Set tBodies = tBodies_$ListBuild(..SaveStreamBody("KEEPME397-S1", tContent, "SYNTHPHI397-BLOB", "KEEPME397-SECOND"))
    Set tBodies = tBodies_$ListBuild(..SaveStreamBody("KEEPME397-S2", tLong, "", "SYNTHPHI397-SECOND-2"))
    Set tError = ..FirstError(tBodies, 3)
    If tError '= "" { Quit tError }
    Set tH = ""
    Set tH = tH_$ListBuild(##class(ExecuteMCPv2.Temp.Story391Fixture).Add(397001, 1, 9, 0, "Story397.Service", "Story397.Router", "HS.Message.XMLMessage", $List(tBodies, 1), "2001-02-03 12:00:01"))
    Set tH = tH_$ListBuild(##class(ExecuteMCPv2.Temp.Story391Fixture).Add(397001, 2, 9, 0, "Story397.Router", "Story397.Service", "Story397.StreamBody", $List(tBodies, 2), "2001-02-03 12:00:02"))
    Set tH = tH_$ListBuild(##class(ExecuteMCPv2.Temp.Story391Fixture).Add(397002, 1, 9, 0, "Story397.Service", "Story397.Operation", "Story397.StreamBody", $List(tBodies, 3), "2001-02-03 12:00:03"))
    Set tH = tH_$ListBuild(##class(ExecuteMCPv2.Temp.Story391Fixture).Add(397002, 2, 8, 1, "Story397.Operation", "Story397.Service", "", "", "2001-02-03 12:00:04", "", $List(tH, 3)))
    Set tError = ..FirstError(tH, 4)
    If tError '= "" { Quit tError }
    Set tStatus = ..SetErrorStatus($List(tH, 4), "SYNTHPHI397-ERR PID|1||SYNTHPHI397-MRN-D")
    If $Extract(tStatus, 1, 6) = "ERROR:" { Quit tStatus }
    Set tL = ""
    Set tL = tL_$ListBuild(..SaveLog(2, "Story397.Operation", 397002, "SYNTHPHI397-LOG-1 PID|1||SYNTHPHI397-MRN-D", "Story397.Seed", "Seed", "2001-02-03 12:00:05.000"))
    Set tL = tL_$ListBuild(..SaveLog(4, "Story397.Service", "", "KEEPME397-LOG-2 SYNTHPHI397-LOG-2", "", "", "2001-02-03 12:00:06.000"))
    Set tError = ..FirstError(tL, 2)
    If tError '= "" { Quit tError }
    Quit {"headers":($ListToString(tH)),"logs":($ListToString(tL)),"xml":($List(tBodies, 1)),"stream":($List(tBodies, 2)_","_$List(tBodies, 3))}.%ToJSON()
}

/// The first ERROR: text among the first pCount items of the list pList, or "".
ClassMethod FirstError(pList As %List, pCount As %Integer) As %String
{
    Set tError = ""
    For tI = 1:1:pCount {
        If $Extract($List(pList, tI), 1, 6) = "ERROR:" {
            Set tError = $List(pList, tI)
            Quit
        }
    }
    Quit tError
}

/// Save the XML message X1 and return its ID, or the error text.
ClassMethod SaveXml() As %String
{
    Set tObj = ##class(HS.Message.XMLMessage).%New()
    Set tObj.Name = "KEEPME397-XML"
    Do tObj.ContentStream.Write("<Patient><Name>SYNTHPHI397-XML</Name><Code>KEEPME397-CODE</Code></Patient>")
    Set tSC = tObj.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tObj.%Id()
}

/// Save one Story397.StreamBody and return its ID, or the error text. An empty pBlob leaves the binary stream empty.
ClassMethod SaveStreamBody(pName As %String, pContent As %String, pBlob As %String, pSecond As %String) As %String
{
    Set tObj = ##class(Story397.StreamBody).%New()
    Set tObj.Name = pName
    Do tObj.Content.Write(pContent)
    If pBlob '= "" { Do tObj.Blob.Write(pBlob) }
    Do tObj.Second.Write(pSecond)
    Set tSC = tObj.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tObj.%Id()
}

/// Give the header pHeaderId an ErrorStatus whose text is pText. Returns the header ID or the error text.
ClassMethod SetErrorStatus(pHeaderId As %Integer, pText As %String) As %String
{
    Set tHeader = ##class(Ens.MessageHeader).%OpenId(pHeaderId)
    If '$IsObject(tHeader) { Quit "ERROR: header "_pHeaderId_" does not open" }
    Set tHeader.ErrorStatus = $$$ERROR($$$GeneralError, pText)
    Set tSC = tHeader.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit pHeaderId
}

/// Save one Event Log row directly and return its ID, or the error text. An empty pSession, pClass or pMethod is left unset.
ClassMethod SaveLog(pType As %Integer, pItem As %String, pSession As %String, pText As %String, pClass As %String, pMethod As %String, pTime As %String) As %String
{
    Set tLog = ##class(Ens.Util.Log).%New()
    Set tLog.Type = pType
    Set tLog.ConfigName = pItem
    Set tLog.Text = pText
    Set tLog.TimeLogged = pTime
    If pSession '= "" { Set tLog.SessionId = pSession }
    If pClass '= "" { Set tLog.SourceClass = pClass }
    If pMethod '= "" { Set tLog.SourceMethod = pMethod }
    Set tSC = tLog.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tLog.%Id()
}

}
`;

/** The Story397 documents compiled into the scratch namespace, in compile order. */
export const STORY397_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story397.StreamBody.cls", STORY397_STREAM_BODY_SOURCE],
  ["Story397.Seed.cls", STORY397_SEED_SOURCE],
];

/**
 * What `Story397.Seed.Seed` returns: four headers, two Event Log rows, the XML message X1 and the stream bodies S1
 * and S2, numbered from 1 in a fresh namespace.
 */
export const STORY397_IDS = { headers: "1,2,3,4", logs: "1,2", xml: "1", stream: "1,2" } as const;

/**
 * Put and compile the `Story397` classes into the scratch namespace `name`, then seed fixture nu and check the
 * IDs it received.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - An interop-enabled, `HS`-mapped, empty `EXECMCPTMP397<capital letter>` namespace.
 */
export async function seedBurnDown(dev: WireSession, name: string): Promise<void> {
  assertFixtureName(name);
  await putCompileSeed(
    dev,
    name,
    STORY397_DOCUMENTS,
    { className: "Story397.Seed", args: [] },
    STORY397_IDS,
    "the burn-down fixture nu",
  );
}

/**
 * Story 40.0 fixture xi: Event Log rows and headers placed relative to the moment the seed runs (T0, its
 * `$ZTimeStamp`), so a 24-hour window can be asserted live. Each time is T0 plus an offset, written by the seed's own
 * `Shift` arithmetic, never by the code under test. Every log text is `SYNTHPHI400-L<n>`.
 *
 * | rows | kind | type | item | offset from T0 |
 * |---|---|---|---|---|
 * | L1 to L6 | Event Log | 1, 2, 3, 4, 5, 6 (Assert, Error, Warning, Info, Trace, Alert) | Story400.Item | -1 h |
 * | L7 | Event Log | 2 | Story400.Item | -23 h |
 * | L8 | Event Log | 2 | Story400.Item | -24 h 5 min |
 * | L9 | Event Log | 3 | Story400.Item | -24 h 5 min |
 * | L10 | Event Log | 2 | Story400.Other | -1 h |
 * | H1, H2, H3 | header, session 400001, Request, Story400.Service to Story400.Operation, Completed, no body | 1 | - | -1 h, -23 h, -24 h 5 min |
 *
 * The logs carry no session, source class or source method. The window rows (L2, L7, L10, H1, H2) sit well inside
 * 24 hours; L8, L9 and H3 sit 5 minutes outside it.
 *
 * `MetricsAtZone(zone)` returns, as JSON, the metrics `ExecuteMCPv2.REST.Monitor:CollectInteropMetrics` computes for
 * the scratch namespace while its own process runs at the time zone `zone`, and restores `$ZTimeZone` on every path.
 */
export const STORY400_SEED_SOURCE = String.raw`Class Story400.Seed
{

/// Seed fixture xi into the current namespace, which must be an empty EXECMCPTMP400 scratch namespace.
/// Returns the JSON ID map {"logs":"1,2,3,4,5,6,7,8,9,10","headers":"1,2,3"}, or the first error text.
ClassMethod Seed() As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP400"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP400 followed by one capital letter" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    If $Order(^Ens.Util.LogD("")) '= "" { Quit "REFUSED: the namespace already holds Event Log rows" }
    Set tNow = $ZTimeStamp
    Set tHour = ..Shift(tNow, -3600)
    Set tL = ""
    For tType = 1:1:6 {
        Set tL = tL_$ListBuild(..SaveLog(tType, "Story400.Item", tType, tHour))
    }
    Set tL = tL_$ListBuild(..SaveLog(2, "Story400.Item", 7, ..Shift(tNow, -82800)))
    Set tL = tL_$ListBuild(..SaveLog(2, "Story400.Item", 8, ..Shift(tNow, -86700)))
    Set tL = tL_$ListBuild(..SaveLog(3, "Story400.Item", 9, ..Shift(tNow, -86700)))
    Set tL = tL_$ListBuild(..SaveLog(2, "Story400.Other", 10, tHour))
    Set tError = ..FirstError(tL, 10)
    If tError '= "" { Quit tError }
    Set tH = ""
    Set tH = tH_$ListBuild(##class(ExecuteMCPv2.Temp.Story391Fixture).Add(400001, 1, 9, 0, "Story400.Service", "Story400.Operation", "", "", tHour))
    Set tH = tH_$ListBuild(##class(ExecuteMCPv2.Temp.Story391Fixture).Add(400001, 1, 9, 0, "Story400.Service", "Story400.Operation", "", "", ..Shift(tNow, -82800)))
    Set tH = tH_$ListBuild(##class(ExecuteMCPv2.Temp.Story391Fixture).Add(400001, 1, 9, 0, "Story400.Service", "Story400.Operation", "", "", ..Shift(tNow, -86700)))
    Set tError = ..FirstError(tH, 3)
    If tError '= "" { Quit tError }
    Quit {"logs":($ListToString(tL)),"headers":($ListToString(tH))}.%ToJSON()
}

/// The metrics ExecuteMCPv2.REST.Monitor:CollectInteropMetrics computes for the current scratch namespace while this
/// process runs at the time zone pZone (minutes west of Greenwich), as JSON, or the error text.
/// $ZTimeZone is per process; it is restored on every path.
ClassMethod MetricsAtZone(pZone As %Integer) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP400"1U { Quit "REFUSED: MetricsAtZone runs only in a namespace named EXECMCPTMP400 followed by one capital letter" }
    Set tSaved = $ZTimeZone
    Set tResult = ""
    Try {
        Set $ZTimeZone = pZone
        Set tResult = ##class(ExecuteMCPv2.REST.Monitor).CollectInteropMetrics($NAMESPACE).%ToJSON()
    }
    Catch ex {
        Set tResult = "ERROR: "_ex.DisplayString()
    }
    Set $ZTimeZone = tSaved
    Quit tResult
}

/// The UTC time pSeconds after the $ZTimeStamp value pStamp, as YYYY-MM-DD hh:mm:ss.nnn, by whole-second arithmetic on the day count.
ClassMethod Shift(pStamp As %String, pSeconds As %Integer) As %String
{
    Set tTotal = (+$Piece(pStamp, ",", 1) * 86400) + $Piece(pStamp, ",", 2) + pSeconds
    Set tDays = tTotal \ 86400
    Quit $ZDateTime(tDays_","_(tTotal - (tDays * 86400)), 3, 1, 3)
}

/// The first ERROR: text among the first pCount items of the list pList, or "".
ClassMethod FirstError(pList As %List, pCount As %Integer) As %String
{
    Set tError = ""
    For tI = 1:1:pCount {
        If $Extract($List(pList, tI), 1, 6) = "ERROR:" {
            Set tError = $List(pList, tI)
            Quit
        }
    }
    Quit tError
}

/// Save one Event Log row directly and return its ID, or the error text. The text is SYNTHPHI400-L followed by pNumber.
ClassMethod SaveLog(pType As %Integer, pItem As %String, pNumber As %Integer, pTime As %String) As %String
{
    Set tLog = ##class(Ens.Util.Log).%New()
    Set tLog.Type = pType
    Set tLog.ConfigName = pItem
    Set tLog.Text = "SYNTHPHI400-L"_pNumber
    Set tLog.TimeLogged = pTime
    Set tSC = tLog.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tLog.%Id()
}

}
`;

/** The Story400 documents compiled into the scratch namespace, in compile order. */
export const STORY400_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [["Story400.Seed.cls", STORY400_SEED_SOURCE]];

/** What `Story400.Seed.Seed` returns: ten Event Log rows and three headers, numbered from 1 in a fresh namespace. */
export const STORY400_IDS = { logs: "1,2,3,4,5,6,7,8,9,10", headers: "1,2,3" } as const;

/**
 * Put and compile the `Story400` seed into the scratch namespace `name`, then seed fixture xi and check the IDs it
 * received. The seed refuses a namespace that already holds Event Log rows or headers.
 *
 * @param dev - A session on a built iris-dev-mcp server.
 * @param name - An interop-enabled, empty `EXECMCPTMP400<capital letter>` namespace (a bare one has no
 *   `Ens.Util.Log`, so the seed cannot run there).
 */
export async function seedEventLogCounts(dev: WireSession, name: string): Promise<void> {
  assertFixtureName(name);
  await putCompileSeed(
    dev,
    name,
    STORY400_DOCUMENTS,
    { className: "Story400.Seed", args: [] },
    STORY400_IDS,
    "the Event Log counts fixture xi",
  );
}

/** Call a `Story393.Side` class method in the scratch namespace `name` and return its string result. */
async function sideMethod(dev: ToolSession, name: string, methodName: string): Promise<string> {
  assertFixtureName(name);
  const content = await callChecked(
    dev,
    "iris_execute_classmethod",
    { namespace: name, className: "Story393.Side", methodName, args: [] },
    `Story393.Side.${methodName} in ${name}`,
  );
  return String(content.returnValue ?? "");
}

/** How many times `Story393.Side.Bump` ran in `name` (`^Story393Side`); 0 when the global is undefined. */
export async function sideCount(dev: ToolSession, name: string): Promise<number> {
  return Number(await sideMethod(dev, name, "Count"));
}

/** Kill `^Story393Side` in `name`. */
export async function resetSide(dev: ToolSession, name: string): Promise<void> {
  await sideMethod(dev, name, "Reset");
}

/** Whether `^Story393Side` is defined in `name` (`$Data`: 0 means undefined). */
export async function sideDefined(dev: ToolSession, name: string): Promise<number> {
  return Number(await sideMethod(dev, name, "Defined"));
}

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
