/// Unit tests for <class>ExecuteMCPv2.Setup</class>: Configure, IsConfigured, the install
/// record and the back-compat of the install methods.
/// <p>No test calls the destructive <method>ExecuteMCPv2.Setup.Uninstall</method>: a run on
/// a shared instance would remove the suite. The uninstall decisions are pinned in
/// <class>ExecuteMCPv2.Tests.SetupUninstallTest</class>, and the uninstall itself is proven
/// on a throwaway instance by the round-trip gate (Story 45.3).</p>
/// <p><b>Note:</b> These tests require <code>%Admin_Manage</code> privileges
/// since they create web applications in the <code>%SYS</code> namespace.</p>
Class ExecuteMCPv2.Tests.SetupTest Extends %UnitTest.TestCase
{

/// The install record of the test namespace, saved before each test and restored after it.
Property SavedRecord As %String [ MultiDimensional ];

/// 1 when the namespace had an install record before the test.
Property HadRecord As %Boolean;

Method OnBeforeOneTest(testname As %String) As %Status
{
    Kill i%SavedRecord
    Set ..HadRecord = ($Data(^ExecuteMCPv2.InstallRecord) > 0)
    If ..HadRecord Merge i%SavedRecord = ^ExecuteMCPv2.InstallRecord
    Kill ^ExecuteMCPv2.InstallRecord
    Quit $$$OK
}

Method OnAfterOneTest(testname As %String) As %Status
{
    Kill ^ExecuteMCPv2.InstallRecord
    If ..HadRecord Merge ^ExecuteMCPv2.InstallRecord = i%SavedRecord
    Kill i%SavedRecord
    Quit $$$OK
}

/// Test that Configure creates (or updates) the web application successfully.
Method TestConfigureCreatesWebApp() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Do $$$AssertStatusOK(tSC, "Configure should succeed")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).IsConfigured(), 1, "Web app should exist after Configure")

    Quit $$$OK
}

/// Test that Configure is idempotent: calling it twice succeeds.
Method TestConfigureIdempotent() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Do $$$AssertStatusOK(tSC, "First Configure should succeed")

    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Do $$$AssertStatusOK(tSC, "Second Configure should succeed (idempotent)")

    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).IsConfigured(), 1, "Web app should exist after double Configure")

    Quit $$$OK
}

/// Test IsConfigured returns a true boolean once configured.
Method TestIsConfigured() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Do $$$AssertStatusOK(tSC, "Configure should succeed")
    Do $$$AssertTrue(##class(ExecuteMCPv2.Setup).IsConfigured(), "IsConfigured should return true when configured")

    Quit $$$OK
}

/// Configure records the namespace it deployed to, with the class marker, in that namespace.
Method TestConfigureWritesDeployedRecord() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Setup).Configure($NAMESPACE)
    Do $$$AssertStatusOK(tSC, "Configure should succeed")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("format")), 1, "the record carries its format version")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("deployed")), ##class(ExecuteMCPv2.Setup).#BOOTSTRAPVERSION, "the deployed node holds this class's marker")
    Do $$$AssertEquals($Data(^ExecuteMCPv2.InstallRecord("all")), 0, "Configure writes no %ALL node")
    Do $$$AssertEquals($Data(^ExecuteMCPv2.InstallRecord("unitTestRoot")), 0, "Configure writes no unitTestRoot node")

    Quit $$$OK
}

/// WriteRecord writes the nodes with the documented values and merges created over found.
Method TestWriteRecordNodes() As %Status
{
    Set tNS = $NAMESPACE
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).WriteRecord(tNS, "all", "found"), 1, "a found node is written")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("all")), "found", "all is found")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).WriteRecord(tNS, "all", "created"), 1, "a created node is written")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("all")), "created", "created replaces found")
    Do ##class(ExecuteMCPv2.Setup).WriteRecord(tNS, "all", "found")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("all")), "created", "a later found never overwrites created")

    Do ##class(ExecuteMCPv2.Setup).WriteRecord(tNS, "mapping", "created", "SOMEDB")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("mapping")), "created", "mapping is created")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("mapping", "database")), "SOMEDB", "the mapping's database is recorded")
    Do ##class(ExecuteMCPv2.Setup).WriteRecord(tNS, "mapping", "found", "OTHERDB")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("mapping")), "created", "found never overwrites a created mapping")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("mapping", "database")), "SOMEDB", "found never overwrites the recorded database")

    Do ##class(ExecuteMCPv2.Setup).WriteRecord(tNS, "unitTestRoot", "/some/dir/")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("unitTestRoot")), "/some/dir/", "the unitTestRoot value is recorded")
    Do $$$AssertEquals($Get(^ExecuteMCPv2.InstallRecord("format")), 1, "every write sets the format version")

    Quit $$$OK
}

/// A record write that cannot happen never raises and reports 0.
Method TestWriteRecordNeverThrows() As %Status
{
    Set tOK = ##class(ExecuteMCPv2.Setup).WriteRecord("NOSUCHNAMESPACE", "deployed", "x")
    Do $$$AssertEquals(tOK, 0, "a write into a namespace that does not exist returns 0 and does not raise")
    Do $$$AssertEquals($Data(^ExecuteMCPv2.InstallRecord), 0, "nothing was written here")

    Quit $$$OK
}

/// The namespace the <code>/api/executemcp/v2</code> web application points to ("" when absent).
Method WebAppNamespace() As %String
{
    Set tNS = ""
    Try {
        ; Read the name before the switch: %SYS sees ExecuteMCPv2 only through the %ALL mapping, which a test may have removed
        Set tApp = ##class(ExecuteMCPv2.Setup).#WEBAPP
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        If ##class(Security.Applications).Get(tApp, .tProps) = 1 Set tNS = $Get(tProps("NameSpace"))
    } Catch ex {
        Set tNS = "ERROR " _ ex.DisplayString()
    }
    Quit tNS
}

/// Whether the <code>ExecuteMCPv2</code> package mapping exists in <code>%ALL</code>.
Method MappingExists() As %Boolean
{
    Set tExists = 0
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Set tExists = +##class(Config.MapPackages).Exists("%ALL", "ExecuteMCPv2")
    } Catch ex {
        Set tExists = 0
    }
    Quit tExists
}

/// Remove the <code>ExecuteMCPv2</code> package mapping from <code>%ALL</code> (a no-op when absent).
Method RemoveMapping()
{
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.MapPackages).Delete("%ALL", "ExecuteMCPv2")
    } Catch ex {
    }
}

/// DW-786: inside a transaction during a web request (a <code>%request</code> object, as
/// <code>iris_sql_query</code> runs a SELECT) both install methods refuse and change nothing.
/// The state is read INSIDE the transaction, before the rollback that would hide it, and the
/// call targets a namespace other than the web application's and runs with the mapping absent,
/// so an unguarded call would change what is read. The transaction is rolled back and the mapping
/// is put back on every path.
Method TestGuardRefusesInTransactionDuringWebRequest() As %Status
{
    Do $$$AssertStatusOK(##class(ExecuteMCPv2.Setup).Configure(), "set up: Configure at transaction level 0")
    Kill ^ExecuteMCPv2.InstallRecord
    Set tNSBefore = ..WebAppNamespace()
    ; The first existing namespace other than the web application's: an unguarded Configure would move the web application there
    Set tOther = "", tCandidates = $ListBuild("USER", "HSCUSTOM", "SAMPLES", "DOCBOOK")
    For tI = 1:1:$ListLength(tCandidates) {
        Set tName = $List(tCandidates, tI)
        If (tName '= tNSBefore) && ##class(%SYS.Namespace).Exists(tName) Set tOther = tName Quit
    }
    Do $$$AssertTrue(tOther '= "", "set up: a namespace other than the web application's exists, so an unguarded Configure would move the web application")
    Do ..RemoveMapping()
    Set tMapBefore = ..MappingExists()
    Do $$$AssertEquals(tMapBefore, 0, "set up: the mapping is absent, so an unguarded ConfigureMapping would create it")
    Set tCaught = "", tCfg = "", tMap = "", tLevelBefore = $TLevel
    Set tNSIn = "<unread>", tMapIn = "<unread>", tRecIn = "<unread>"
    TSTART
    Try {
        New %request
        Set %request = ##class(%CSP.Request).%New()
        Set tCfg = ##class(ExecuteMCPv2.Setup).Configure(tOther)
        Set tMap = ##class(ExecuteMCPv2.Setup).ConfigureMapping(tOther)
        Set tNSIn = ..WebAppNamespace(), tMapIn = ..MappingExists(), tRecIn = $Data(^ExecuteMCPv2.InstallRecord)
    } Catch ex {
        Set tCaught = ex.DisplayString()
    }
    TROLLBACK 1
    Do ##class(ExecuteMCPv2.Setup).ConfigureMapping()
    Do $$$AssertEquals(tCaught, "", "neither call raised")
    Do $$$AssertStatusNotOK(tCfg, "Configure is refused")
    Do $$$AssertTrue($System.Status.GetErrorText(tCfg) [ "Configure changed nothing: it was called inside a transaction during a web request", "Configure names the refusal")
    Do $$$AssertStatusNotOK(tMap, "ConfigureMapping is refused")
    Do $$$AssertTrue($System.Status.GetErrorText(tMap) [ "ConfigureMapping changed nothing: it was called inside a transaction during a web request", "ConfigureMapping names the refusal")
    Do $$$AssertEquals(tNSIn, tNSBefore, "inside the transaction the web application's namespace is unchanged (before: " _ tNSBefore _ ", inside: " _ tNSIn _ ")")
    Do $$$AssertEquals(tMapIn, 0, "inside the transaction the package mapping was not created")
    Do $$$AssertEquals(tRecIn, 0, "inside the transaction a refused call wrote no install record")
    Do $$$AssertEquals($TLevel, tLevelBefore, "the test left no transaction open")

    Quit $$$OK
}

/// DW-786: inside a transaction WITHOUT a web request (how IPM runs its Configure phase) the
/// install methods run as before. A terminal call and the Atelier bootstrap run at level 0.
Method TestGuardPassesInTransactionWithoutWebRequest() As %Status
{
    Do $$$AssertStatusOK(##class(ExecuteMCPv2.Setup).ConfigureMapping(), "set up: the mapping exists")
    Set tCaught = "", tCfg = "", tMap = "", tLevelBefore = $TLevel, tHasRequest = -1, tLevelIn = -1
    ; No assertion runs inside the transaction: the rollback would take its result with it
    TSTART
    Try {
        New %request
        Set tHasRequest = $IsObject($Get(%request)), tLevelIn = $TLevel
        Set tMap = ##class(ExecuteMCPv2.Setup).ConfigureMapping()
        Set tCfg = ##class(ExecuteMCPv2.Setup).Configure()
    } Catch ex {
        Set tCaught = ex.DisplayString()
    }
    TROLLBACK 1
    Do $$$AssertEquals(tCaught, "", "neither call raised")
    Do $$$AssertEquals(tHasRequest, 0, "no %request object inside the transaction")
    Do $$$AssertEquals(tLevelIn, tLevelBefore + 1, "the calls ran inside a transaction")
    Do $$$AssertStatusOK(tMap, "ConfigureMapping on an existing mapping returns OK inside a transaction")
    Do $$$AssertStatusOK(tCfg, "Configure returns OK inside a transaction")
    Do $$$AssertEquals($TLevel, tLevelBefore, "the test left no transaction open")

    Quit $$$OK
}

/// DW-773: the CSP application lookup that IsConfigured falls back to agrees with it.
Method TestWebAppRegisteredMatchesIsConfigured() As %Status
{
    Do $$$AssertStatusOK(##class(ExecuteMCPv2.Setup).Configure(), "Configure should succeed")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).WebAppRegistered(), 1, "the lookup finds the web application")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).WebAppRegistered(), ##class(ExecuteMCPv2.Setup).IsConfigured(), "the lookup equals IsConfigured")

    Quit $$$OK
}

/// EnsureUnitTestRoot returns an already-set value unchanged and records nothing for it.
Method TestEnsureUnitTestRootKeepsPresetValue() As %Status
{
    Set tHad = ($Data(^UnitTestRoot) > 0)
    Set tSaved = $Get(^UnitTestRoot)
    Set ^UnitTestRoot = "/preset/by/someone/else/"
    Set tReturned = ##class(ExecuteMCPv2.Setup).EnsureUnitTestRoot()
    Set tAfter = $Get(^UnitTestRoot)
    Set tNode = $Data(^ExecuteMCPv2.InstallRecord("unitTestRoot"))
    If tHad {
        Set ^UnitTestRoot = tSaved
    } Else {
        Kill ^UnitTestRoot
    }

    Do $$$AssertEquals(tReturned, "/preset/by/someone/else/", "the preset value is returned")
    Do $$$AssertEquals(tAfter, "/preset/by/someone/else/", "the preset value is unchanged")
    Do $$$AssertEquals(tNode, 0, "no unitTestRoot node is written for a value the install did not set")

    Quit $$$OK
}

}
