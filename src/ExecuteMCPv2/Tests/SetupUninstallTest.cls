/// Unit tests for the decisions of <method>ExecuteMCPv2.Setup.Uninstall</method>, the report
/// text and the back-compat of the install methods (Story 45.3).
/// <p>Every decision lives in a class method over plain arguments, so nothing here changes
/// an instance: no test calls <method>Uninstall</method>. The uninstall itself is proven on a
/// throwaway instance by the round-trip gate.</p>
Class ExecuteMCPv2.Tests.SetupUninstallTest Extends %UnitTest.TestCase
{

/// The SqlProc methods of Setup, read from the compiled class, are exactly the five the
/// bootstrap calls through SQL. Uninstall and every helper stay out of the SQL surface.
Method TestSqlProcSetIsExactlyTheFive() As %Status
{
    Set tStmt = ##class(%SQL.Statement).%New()
    Set tSC = tStmt.%Prepare("SELECT Name FROM %Dictionary.CompiledMethod WHERE parent = 'ExecuteMCPv2.Setup' AND SqlProc = 1 ORDER BY Name")
    Do $$$AssertStatusOK(tSC, "the dictionary query prepares")
    Set tRS = tStmt.%Execute()
    Set tNames = ""
    While tRS.%Next() {
        Set tNames = tNames _ $Select(tNames = "": "", 1: ",") _ tRS.%Get("Name")
    }
    Do $$$AssertEquals(tNames, "Configure,ConfigureMapping,EnsureUnitTestRoot,GetBootstrapVersion,IsConfigured", "exactly the five pre-story SqlProc methods")
    Do $$$AssertEquals(##class(%Dictionary.CompiledMethod).%OpenId("ExecuteMCPv2.Setup||Uninstall").SqlProc, 0, "Uninstall is not an SQL procedure")

    Quit $$$OK
}

/// The five install methods keep their signature, return type and SqlProc flag.
/// Values read from the class at the story's baseline revision.
Method TestInstallMethodSignaturesUnchanged() As %Status
{
    Do ..AssertSignature("Configure", "pNamespace:%String=""""", "%Library.Status", 1)
    Do ..AssertSignature("ConfigureMapping", "pNamespace:%String=""""", "%Library.Status", 1)
    Do ..AssertSignature("IsConfigured", "", "%Library.Boolean", 1)
    Do ..AssertSignature("EnsureUnitTestRoot", "", "%Library.String", 1)
    Do ..AssertSignature("GetBootstrapVersion", "", "%Library.String", 1)

    Quit $$$OK
}

/// Assert one method's compiled signature.
Method AssertSignature(pMethod As %String, pFormalSpec As %String, pReturnType As %String, pSqlProc As %Boolean)
{
    Set tM = ##class(%Dictionary.CompiledMethod).%OpenId("ExecuteMCPv2.Setup||" _ pMethod)
    Do $$$AssertTrue($IsObject(tM), pMethod _ " exists")
    If '$IsObject(tM) Quit
    Do $$$AssertEquals(tM.FormalSpec, pFormalSpec, pMethod _ " FormalSpec")
    Do $$$AssertEquals(tM.ReturnType, pReturnType, pMethod _ " ReturnType")
    Do $$$AssertEquals(+tM.SqlProc, pSqlProc, pMethod _ " SqlProc")
    Quit
}

/// GetBootstrapVersion returns the class parameter.
Method TestGetBootstrapVersionIsTheParameter() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).GetBootstrapVersion(), ##class(ExecuteMCPv2.Setup).#BOOTSTRAPVERSION, "GetBootstrapVersion returns BOOTSTRAPVERSION")

    Quit $$$OK
}

/// Release markers are the stamped form and the bare 12-hex form; nothing else proves ownership.
Method TestIsReleaseMarker() As %Status
{
    Do $$$AssertTrue(##class(ExecuteMCPv2.Setup).IsReleaseMarker("1.2.0+8.5cedcac20ae9"), "stamped marker")
    Do $$$AssertTrue(##class(ExecuteMCPv2.Setup).IsReleaseMarker("10.20.30+100.0123456789ab"), "stamped marker, multi-digit")
    Do $$$AssertTrue(##class(ExecuteMCPv2.Setup).IsReleaseMarker("5cedcac20ae9"), "bare 12-hex marker of a build before the sequence")
    Do $$$AssertNotTrue(##class(ExecuteMCPv2.Setup).IsReleaseMarker("dev"), "dev placeholder")
    Do $$$AssertNotTrue(##class(ExecuteMCPv2.Setup).IsReleaseMarker(""), "empty")
    Do $$$AssertNotTrue(##class(ExecuteMCPv2.Setup).IsReleaseMarker("1.2.0"), "semver alone")
    Do $$$AssertNotTrue(##class(ExecuteMCPv2.Setup).IsReleaseMarker("1.2.0+8.5CEDCAC20AE9"), "upper-case hash")
    Do $$$AssertNotTrue(##class(ExecuteMCPv2.Setup).IsReleaseMarker("1.2.0+8.5cedcac20ae"), "short hash")

    Quit $$$OK
}

/// Per-namespace class decision over every ownership row.
Method TestDecideClasses() As %Status
{
    Set tStamped = "1.2.0+8.5cedcac20ae9"
    Set tD = ##class(ExecuteMCPv2.Setup).DecideClasses(0, 0, "", .tWhy)
    Do $$$AssertEquals(tD, "none", "no classes, nothing to do")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideClasses(35, 0, tStamped, .tWhy)
    Do $$$AssertEquals(tD, "delete", "a stamped marker shows the copy is ours")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideClasses(35, 0, "5cedcac20ae9", .tWhy)
    Do $$$AssertEquals(tD, "delete", "a bare hash from a build that predates the sequence is a release marker too")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideClasses(35, 1, tStamped, .tWhy)
    Do $$$AssertEquals(tD, "ipm", "InstallGuard present: IPM owns the copy, even with a stamped marker")
    Do $$$AssertEquals(tWhy, "IPM owns them", "the IPM reason")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideClasses(35, 0, "dev", .tWhy)
    Do $$$AssertEquals(tD, "foreign", "dev marker: foreign")
    Do $$$AssertTrue(tWhy [ "dev marker", "the reason names the dev marker")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideClasses(3, 0, "", .tWhy)
    Do $$$AssertEquals(tD, "foreign", "no marker (no Setup class, or none on it): foreign")
    Do $$$AssertTrue(tWhy [ "no release marker", "the reason says there is no marker")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideClasses(3, 0, "weird", .tWhy)
    Do $$$AssertEquals(tD, "foreign", "an unparseable marker: foreign")
    Do $$$AssertTrue(tWhy [ "weird", "the reason names the marker")

    Quit $$$OK
}

/// The %ALL decision over every I/O matrix row.
Method TestDecideAll() As %Status
{
    Set tD = ##class(ExecuteMCPv2.Setup).DecideAll(0, 1, 1, 1, "", .tWhy, .tManual)
    Do $$$AssertEquals(tD, "none", "%ALL absent: nothing to do")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideAll(1, 1, 1, 1, "", .tWhy, .tManual)
    Do $$$AssertEquals(tD, "remove", "created by the install and empty: remove")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideAll(1, 1, 0, 1, "", .tWhy, .tManual)
    Do $$$AssertEquals(tD, "left", "found, not created: left")
    Do $$$AssertEquals(tWhy, "the install did not create it", "the foreign-%ALL reason")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideAll(1, 1, 0, 1, "global ForeignThing", .tWhy, .tManual)
    Do $$$AssertEquals(tD, "left", "found and holding a foreign mapping: left")
    Do $$$AssertEquals(tWhy, "the install did not create it", "the record decides before the mappings")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideAll(1, 1, 1, 1, "global ForeignThing, routine Other", .tWhy, .tManual)
    Do $$$AssertEquals(tD, "left", "created but a foreign mapping was added: left")
    Do $$$AssertEquals(tWhy, "it still holds mappings: global ForeignThing, routine Other", "the mappings are listed")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideAll(1, 0, 0, 1, "", .tWhy, .tManual)
    Do $$$AssertEquals(tD, "left", "no record: left, never removed")
    Do $$$AssertTrue(tManual [ "Do ##class(Config.Namespaces).Delete(""%ALL"")", "the manual command is given")
    Do $$$AssertTrue(tManual [ "every mapping", "the warning about every mapping is given")
    Set tD = ##class(ExecuteMCPv2.Setup).DecideAll(1, 1, 1, 0, "", .tWhy, .tManual)
    Do $$$AssertEquals(tD, "left", "the mapping step failed: left")
    Do $$$AssertEquals(tManual, "", "no manual command when the record exists")

    Quit $$$OK
}

/// The ^UnitTestRoot decision over every I/O matrix row.
Method TestDecideUnitTestRoot() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).DecideUnitTestRoot("/mgr/", "/mgr/", 1), "remove", "set by the install and unchanged: remove")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).DecideUnitTestRoot("/mgr/", "/other/", 1), "changed", "changed since the install: left")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).DecideUnitTestRoot("/mgr/", "", 1), "none", "recorded but already gone: nothing to remove")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).DecideUnitTestRoot("", "/preset/", 1), "none", "set before the install, a record exists: survives, not reported")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).DecideUnitTestRoot("", "/preset/", 0), "norecord", "no record anywhere and defined: left with the manual command")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).DecideUnitTestRoot("", "", 0), "none", "no record anywhere and undefined: nothing")

    Quit $$$OK
}

/// The records go only when no step failed.
Method TestDecideRecords() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).DecideRecords(0), "remove", "no failed step: the records go")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).DecideRecords(1), "keep", "one failed step: the records stay")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).DecideRecords(3), "keep", "several failed steps: the records stay")

    Quit $$$OK
}

/// A record node written twice keeps "created".
Method TestMergeRecordValue() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).MergeRecordValue("", "found"), "found", "undefined then found")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).MergeRecordValue("", "created"), "created", "undefined then created")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).MergeRecordValue("created", "found"), "created", "created is never overwritten by found")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).MergeRecordValue("found", "created"), "created", "found becomes created when a later step creates it")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).MergeRecordValue("found", "found"), "found", "found stays found")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).MergeRecordValue("created", "created"), "created", "created stays created")

    Quit $$$OK
}

/// The text of each kind of entry.
Method TestFormatEntry() As %Status
{
    Set tRemoved = {"item": "classes", "namespace": "USER", "detail": "35 classes"}
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).FormatEntry("removed", tRemoved), "Removed: classes (USER): 35 classes", "removed with namespace and detail")
    Set tRemovedBare = {"item": "%ALL"}
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).FormatEntry("removed", tRemovedBare), "Removed: %ALL", "removed without detail")
    Set tLeft = {"item": "^UnitTestRoot", "namespace": "USER", "reason": "it changed since the install set it", "manual": "in USER: Kill ^UnitTestRoot"}
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).FormatEntry("left", tLeft), "Left: ^UnitTestRoot (USER) (it changed since the install set it). To remove it by hand: in USER: Kill ^UnitTestRoot", "left with the manual command")
    Set tLeftBare = {"item": "%ALL", "reason": "the install did not create it"}
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).FormatEntry("left", tLeftBare), "Left: %ALL (the install did not create it)", "left without a manual command")
    Set tFailed = {"item": "web application /api/executemcp/v2", "error": "ERROR #822: Access Denied"}
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).FormatEntry("failed", tFailed), "Failed: web application /api/executemcp/v2: ERROR #822: Access Denied", "failed carries IRIS's text")

    Quit $$$OK
}

/// An empty report prints the nothing-found line then the server line; a report with
/// entries prints the entries, the namespaces line for more than one namespace, and the
/// server line last.
Method TestReportLines() As %Status
{
    Set tEmpty = {"removed": [], "left": [], "failed": [], "namespaces": []}
    Set tLines = ##class(ExecuteMCPv2.Setup).ReportLines(tEmpty)
    Do $$$AssertEquals(tLines.%Size(), 2, "an empty report has two lines")
    Do $$$AssertEquals(tLines.%Get(0), "Nothing was removed: no part of the IRIS side was found.", "the nothing-removed line")
    Do $$$AssertEquals(tLines.%Get(1), ##class(ExecuteMCPv2.Setup).ServerLine(), "the server line is last")

    Set tTwo = {"removed": [{"item": "%ALL"}, {"item": "classes", "namespace": "USER", "detail": "35 classes"}], "left": [{"item": "classes", "namespace": "HSCUSTOM", "reason": "IPM owns them"}], "failed": [{"item": "classes", "namespace": "APP", "error": "2 classes could not be deleted"}], "namespaces": ["USER", "HSCUSTOM", "APP", "SAMPLES"]}
    Set tLines = ##class(ExecuteMCPv2.Setup).ReportLines(tTwo)
    Do $$$AssertEquals(tLines.%Size(), 6, "four entries, the namespaces line and the server line")
    Do $$$AssertEquals(tLines.%Get(0), "Removed: %ALL", "the entry")
    Do $$$AssertEquals(tLines.%Get(4),"Namespaces USER, HSCUSTOM, APP, SAMPLES used the suite: the instance has one web application and one %ALL mapping, so none of them has either now; USER lost its classes; HSCUSTOM kept its classes (see its Left: line); APP still holds classes that could not be removed (see its Failed: line); SAMPLES held no classes of its own.", "the namespaces line words each namespace's own outcome")

    Set tOne = {"removed": [], "left": [{"item": "classes", "namespace": "HSCUSTOM", "reason": "IPM owns them"}], "failed": [], "namespaces": ["HSCUSTOM"]}
    Set tLines = ##class(ExecuteMCPv2.Setup).ReportLines(tOne)
    Do $$$AssertEquals(tLines.%Size(), 2, "a left entry and the server line: no nothing-removed line, no namespaces line")

    Quit $$$OK
}

/// The server line says what a running server does and how to stop it.
Method TestServerLine() As %Status
{
    Set tLine = ##class(ExecuteMCPv2.Setup).ServerLine()
    Do $$$AssertTrue(tLine [ "IRIS_AUTO_INSTALL=false", "names the variable")
    Do $$$AssertTrue(tLine [ "starts or first uses this instance", "names when it comes back")

    Quit $$$OK
}

}
