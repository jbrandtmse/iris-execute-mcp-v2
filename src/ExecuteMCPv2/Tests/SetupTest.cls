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
