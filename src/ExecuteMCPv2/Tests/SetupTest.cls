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

/// 1 while <method>RemoveMapping</method> has removed an <code>ExecuteMCPv2</code> mapping that
/// <method>RestoreMapping</method> has not put back yet.
Property MappingRemoved As %Boolean [ InitialExpression = 0 ];

/// The database the removed mapping pointed to.
Property SavedMappingDB As %String;

/// 1 while <method>RemoveALL</method> has removed the <code>%ALL</code> namespace that
/// <method>RestoreALL</method> has not put back yet.
Property ALLRemoved As %Boolean [ InitialExpression = 0 ];

/// The <code>Globals</code>, <code>Routines</code>, <code>Library</code> and <code>TempGlobals</code>
/// databases of the removed <code>%ALL</code>, as a list.
Property SavedALL As %String;

/// The disposable namespace a guard test creates when the instance has no second namespace (IRIS Community has
/// <code>USER</code> only), over a database of its own.
Parameter SCRATCHNS = "SETUPTESTNS";

/// The configuration name of the disposable namespace's database.
Parameter SCRATCHDB = "SETUPTESTDB";

/// 1 while <method>CreateScratchNamespace</method> has made the disposable namespace that
/// <method>DropScratchNamespace</method> has not removed yet.
Property ScratchCreated As %Boolean [ InitialExpression = 0 ];

/// The web application's namespace before a test that may target the disposable namespace.
Property WebAppNSBefore As %String;

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
    ; A test that stopped between RemoveALL/RemoveMapping and their restore still gets %ALL and the mapping back
    Do ..RestoreALL()
    Do ..RestoreMapping()
    Do ..ActivateAll()
    If ..ScratchCreated {
        ; The web application never stays on the namespace that is about to be removed
        If (..WebAppNSBefore '= "") && (..WebAppNamespace() = ..#SCRATCHNS) Do ##class(ExecuteMCPv2.Setup).Configure(..WebAppNSBefore)
        Do ..DropScratchNamespace()
    }
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

/// Whether the <code>%ALL</code> namespace exists in the configuration.
Method ALLExists() As %Boolean
{
    Set tExists = 0
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Set tExists = +##class(Config.Namespaces).Exists("%ALL")
    } Catch ex {
        Set tExists = 0
    }
    Quit tExists
}

/// Remove the <code>ExecuteMCPv2</code> package mapping from <code>%ALL</code> (a no-op when absent),
/// saving the database it pointed to for <method>RestoreMapping</method>.
Method RemoveMapping()
{
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Kill tProps
        If '..MappingRemoved && ##class(Config.MapPackages).Exists("%ALL", "ExecuteMCPv2") && $$$ISOK(##class(Config.MapPackages).Get("%ALL", "ExecuteMCPv2", .tProps)) {
            Set ..SavedMappingDB = $Get(tProps("Database"))
            If $$$ISOK(##class(Config.MapPackages).Delete("%ALL", "ExecuteMCPv2")) Set ..MappingRemoved = 1
        }
    } Catch ex {
    }
}

/// Put back the mapping <method>RemoveMapping</method> removed, pointing to the database it pointed
/// to (a no-op when nothing was removed or it is already back).
Method RestoreMapping() As %Status
{
    Set tSC = $$$OK
    If '..MappingRemoved Quit tSC
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        ; A mapping a test's own call created points where that call chose: put back the one that was found
        If ##class(Config.MapPackages).Exists("%ALL", "ExecuteMCPv2") {
            Kill tFound
            If $$$ISOK(##class(Config.MapPackages).Get("%ALL", "ExecuteMCPv2", .tFound)) && ($Get(tFound("Database")) '= ..SavedMappingDB) {
                Set tSC = ##class(Config.MapPackages).Delete("%ALL", "ExecuteMCPv2")
            }
        }
        If $$$ISOK(tSC) && '##class(Config.MapPackages).Exists("%ALL", "ExecuteMCPv2") {
            Kill tProps
            Set tProps("Database") = ..SavedMappingDB
            Set tSC = ##class(Config.MapPackages).Create("%ALL", "ExecuteMCPv2", .tProps)
        }
        If $$$ISOK(tSC) Set ..MappingRemoved = 0
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// The number of mappings in <code>%ALL</code> other than the <code>ExecuteMCPv2</code> package mapping
/// (package, global and routine mappings together). <code>%ALL</code> is removed by a test only when
/// this is 0, so no one else's mapping is ever lost.
Method ForeignALLMappings() As %Integer
{
    Set tCount = 0
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        If '##class(Config.Namespaces).Exists("%ALL") Quit
        For tQuery = "Config.MapPackages:List", "Config.MapGlobals:List", "Config.MapRoutines:List" {
            Set tRS = ##class(%ResultSet).%New(tQuery)
            If $$$ISERR(tRS.Execute("%ALL")) Set tCount = tCount + 1000 Continue
            While tRS.Next() {
                If (tQuery '= "Config.MapPackages:List") || (tRS.GetData(2) '= "ExecuteMCPv2") Set tCount = tCount + 1
            }
            Do tRS.Close()
        }
    } Catch ex {
        Set tCount = tCount + 1000
    }
    Quit tCount
}

/// Remove the <code>%ALL</code> namespace (a no-op when absent), saving its databases for
/// <method>RestoreALL</method>. The caller has removed the <code>ExecuteMCPv2</code> mapping and
/// checked <method>ForeignALLMappings</method> is 0.
Method RemoveALL()
{
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Kill tProps
        If '..ALLRemoved && ##class(Config.Namespaces).Exists("%ALL") && $$$ISOK(##class(Config.Namespaces).Get("%ALL", .tProps)) {
            Set ..SavedALL = $ListBuild($Get(tProps("Globals")), $Get(tProps("Routines")), $Get(tProps("Library")), $Get(tProps("TempGlobals")))
            If $$$ISOK(##class(Config.Namespaces).Delete("%ALL")) Set ..ALLRemoved = 1
        }
    } Catch ex {
    }
}

/// Put back the <code>%ALL</code> namespace <method>RemoveALL</method> removed, with the databases it had (a
/// no-op when nothing was removed or it exists again).
Method RestoreALL() As %Status
{
    Set tSC = $$$OK
    If '..ALLRemoved Quit tSC
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Kill tProps
        Set tProps("Globals") = $List(..SavedALL, 1)
        Set tProps("Routines") = $List(..SavedALL, 2)
        Set tProps("Library") = $List(..SavedALL, 3)
        Set tProps("TempGlobals") = $List(..SavedALL, 4)
        If '##class(Config.Namespaces).Exists("%ALL") {
            Set tSC = ##class(Config.Namespaces).Create("%ALL", .tProps)
        } Else {
            ; A %ALL a test's own call created has the databases that call chose: put back the ones that were found
            Kill tFound
            If $$$ISOK(##class(Config.Namespaces).Get("%ALL", .tFound)) && ($ListBuild($Get(tFound("Globals")), $Get(tFound("Routines")), $Get(tFound("Library")), $Get(tFound("TempGlobals"))) '= ..SavedALL) {
                Set tSC = ##class(Config.Namespaces).Modify("%ALL", .tProps)
            }
        }
        If $$$ISOK(tSC) Set ..ALLRemoved = 0
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Activate every namespace mapping from the configuration, so a test that created or removed
/// <code>%ALL</code> leaves the live namespace table as the configuration says.
Method ActivateAll()
{
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Do ##class(Config.Namespaces).ActivateAll()
    } Catch ex {
    }
}

/// The directory of the disposable namespace's database, normalized.
ClassMethod ScratchDir() As %String
{
    Quit ##class(%Library.File).NormalizeDirectory($SYSTEM.Util.ManagerDirectory() _ "setuptestdb")
}

/// Create the disposable namespace <parameter>SCRATCHNS</parameter> over a database of its own (a directory,
/// <code>SYS.Database.CreateDatabase</code>, the <code>Config.Databases</code> entry, then the namespace), after removing
/// whatever an earlier run left. Runs in %SYS and restores the namespace.
Method CreateScratchNamespace() As %Status
{
    Do ..DropScratchNamespace()
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tDir = ..ScratchDir()
        If '##class(%Library.File).DirectoryExists(tDir) && '##class(%Library.File).CreateDirectoryChain(tDir) {
            Set tSC = $$$ERROR($$$GeneralError, "Failed to create directory: " _ tDir)
            Quit
        }
        Set tSC = ##class(SYS.Database).CreateDatabase(tDir, 1)
        If $$$ISERR(tSC) Quit
        Set ..ScratchCreated = 1
        Kill tProps
        Set tProps("Directory") = tDir
        Set tSC = ##class(Config.Databases).Create(..#SCRATCHDB, .tProps)
        If $$$ISERR(tSC) Quit
        Kill tProps
        Set tProps("Globals") = ..#SCRATCHDB, tProps("Routines") = ..#SCRATCHDB
        Set tSC = ##class(Config.Namespaces).Create(..#SCRATCHNS, .tProps)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrigNS
    Quit tSC
}

/// Remove the disposable namespace, its database entry, the database and its directory, whatever state a test left
/// (best effort; each step runs whether or not the one before it succeeded). Runs in %SYS and restores the namespace.
Method DropScratchNamespace()
{
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        If ##class(Config.Namespaces).Exists(..#SCRATCHNS) Do ##class(Config.Namespaces).Delete(..#SCRATCHNS)
        If ##class(Config.Databases).Exists(..#SCRATCHDB) Do ##class(Config.Databases).Delete(..#SCRATCHDB)
        Set tDir = ..ScratchDir()
        If ##class(SYS.Database).%ExistsId(tDir) Do ##class(SYS.Database).DeleteDatabase(tDir)
        If ##class(%Library.File).DirectoryExists(tDir) Do ##class(%Library.File).RemoveDirectoryTree(tDir)
        Set ..ScratchCreated = 0
    } Catch ex {
    }
    Set $NAMESPACE = tOrigNS
}

/// 1 when the live package map of <code>ExecuteMCPv2</code> disagrees with the configuration (the state a rolled-back
/// <code>%ALL</code> leaves): no mapping in <code>%ALL</code> in the configuration, while <code>%SYS</code> still
/// resolves <code>ExecuteMCPv2</code> outside the <code>%SYS</code> routines directory.
Method MapDisagrees() As %Boolean
{
    Set tBroken = 0
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Set tSysDir = $Piece(##class(%SYS.Namespace).GetRoutineDest("%SYS", ""), "^", *)
        Set tDest = $Piece(##class(%SYS.Namespace).GetPackageDest("%SYS", "ExecuteMCPv2"), "^", *)
        Set tBroken = ('##class(Config.MapPackages).Exists("%ALL", "ExecuteMCPv2")) && (tDest '= tSysDir)
    } Catch ex {
        Set tBroken = 1
    }
    Quit tBroken
}

/// The install record of namespace <var>pNamespace</var> as one string ("" when it has none).
Method RecordDump(pNamespace As %String) As %String
{
    Set tDump = ""
    Try {
        Set tRef = $Name(^|pNamespace|ExecuteMCPv2.InstallRecord)
        If $Data(@tRef) # 2 Set tDump = "=" _ @tRef _ ";"
        For {
            Set tRef = $Query(@tRef)
            If tRef = "" Quit
            Set tDump = tDump _ tRef _ "=" _ @tRef _ ";"
        }
    } Catch ex {
        Set tDump = "ERROR " _ ex.DisplayString()
    }
    Quit tDump
}

/// DW-786: inside a transaction during a web request (a <code>%request</code> object, as
/// <code>iris_sql_query</code> runs a SELECT) both install methods refuse and change nothing.
/// The state is read INSIDE the transaction, before the rollback that would hide it, and the
/// call targets a namespace other than the web application's and runs with the mapping absent,
/// so an unguarded call would change what is read. On an instance with no second namespace (IRIS
/// Community has <code>USER</code> only) that namespace is a disposable one over a database of its own,
/// removed in <method>OnAfterOneTest</method>. The transaction is rolled back and the mapping is put
/// back on every path.
Method TestGuardRefusesInTransactionDuringWebRequest() As %Status
{
    Do $$$AssertStatusOK(##class(ExecuteMCPv2.Setup).Configure(), "set up: Configure at transaction level 0")
    Kill ^ExecuteMCPv2.InstallRecord
    Set tNSBefore = ..WebAppNamespace()
    Set ..WebAppNSBefore = tNSBefore
    ; The first existing namespace other than the web application's: an unguarded Configure would move the web application there
    Set tOther = "", tCandidates = $ListBuild("USER", "HSCUSTOM", "SAMPLES", "DOCBOOK")
    For tI = 1:1:$ListLength(tCandidates) {
        Set tName = $List(tCandidates, tI)
        If (tName '= tNSBefore) && ##class(%SYS.Namespace).Exists(tName) Set tOther = tName Quit
    }
    If tOther = "" {
        Do $$$AssertStatusOK(..CreateScratchNamespace(), "set up: no second namespace exists, so a disposable one is created")
        If ##class(%SYS.Namespace).Exists(..#SCRATCHNS) Set tOther = ..#SCRATCHNS
    }
    Do $$$AssertTrue(tOther '= "", "set up: a namespace other than the web application's exists, so an unguarded Configure would move the web application")
    Do ..RemoveMapping()
    Set tMapBefore = ..MappingExists()
    Do $$$AssertEquals(tMapBefore, 0, "set up: the mapping is absent, so an unguarded ConfigureMapping would create it")
    Set tCaught = "", tCfg = "", tMap = "", tLevelBefore = $TLevel
    Set tNSIn = "<unread>", tMapIn = "<unread>", tRecIn = "<unread>"
    ; An unguarded call writes the record of the namespace it targets, tOther
    Set tRecBefore = ..RecordDump(tOther)
    TSTART
    Try {
        New %request
        Set %request = ##class(%CSP.Request).%New()
        Set tCfg = ##class(ExecuteMCPv2.Setup).Configure(tOther)
        Set tMap = ##class(ExecuteMCPv2.Setup).ConfigureMapping(tOther)
        Set tNSIn = ..WebAppNamespace(), tMapIn = ..MappingExists(), tRecIn = ..RecordDump(tOther)
    } Catch ex {
        Set tCaught = ex.DisplayString()
    }
    TROLLBACK 1
    Do $$$AssertStatusOK(..RestoreMapping(), "the mapping is put back, pointing to the database it pointed to")
    Do $$$AssertEquals(tCaught, "", "neither call raised")
    Do $$$AssertStatusNotOK(tCfg, "Configure is refused")
    Do $$$AssertTrue($System.Status.GetErrorText(tCfg) [ "Configure changed nothing: it was called inside a transaction during a web request", "Configure names the refusal")
    Do $$$AssertStatusNotOK(tMap, "ConfigureMapping is refused")
    Do $$$AssertTrue($System.Status.GetErrorText(tMap) [ "ConfigureMapping changed nothing: it was called inside a transaction during a web request", "ConfigureMapping names the refusal")
    Do $$$AssertEquals(tNSIn, tNSBefore, "inside the transaction the web application's namespace is unchanged (before: " _ tNSBefore _ ", inside: " _ tNSIn _ ")")
    Do $$$AssertEquals(tMapIn, 0, "inside the transaction the package mapping was not created")
    Do $$$AssertEquals(tRecIn, tRecBefore, "inside the transaction a refused call left the install record of " _ tOther _ " as it was")
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

/// DW-792: an IPM install runs <code>ConfigureMapping</code> inside a transaction (no <code>%request</code>)
/// and rolls it back when a later step fails. The creation of <code>%ALL</code>, of the mapping and their
/// install record must survive that rollback: a rolled-back <code>%ALL</code> leaves the namespace table
/// refusing every new namespace. The suspension of transactions that keeps them out of the rollback is
/// undone before the call returns. The state is read AFTER the rollback; <code>%ALL</code> and the
/// mapping are put back as found on every path (<code>OnAfterOneTest</code>).
Method TestMappingSurvivesRollbackOfOuterTransaction() As %Status
{
    ; The restore puts back what was found, so the test runs only where an install left %ALL and the mapping
    If '..ALLExists() || '..MappingExists() {
        Do $$$AssertSkipped("%ALL and the ExecuteMCPv2 mapping are not both here: this test removes and restores only what an install left")
        Quit $$$OK
    }
    Set tForeign = ..ForeignALLMappings()
    If tForeign '= 0 {
        Do $$$AssertSkipped("%ALL holds " _ tForeign _ " mapping(s) of other software: this test does not remove it")
        Quit $$$OK
    }
    Set tNS = $NAMESPACE
    Do ..RemoveMapping()
    Do ..RemoveALL()
    Kill ^ExecuteMCPv2.InstallRecord
    Set tCaught = "", tMap = "", tLevelBefore = $TLevel, tHasRequest = -1, tLevelIn = -1, tSuspendedBefore = -1, tSuspendedAfter = -1
    ; No assertion runs inside the transaction: the rollback would take its result with it
    TSTART
    Try {
        New %request
        Set tHasRequest = $IsObject($Get(%request)), tLevelIn = $TLevel
        Set tSuspendedBefore = ##class(%SYSTEM.Process).TransactionsSuspended()
        Set tMap = ##class(ExecuteMCPv2.Setup).ConfigureMapping(tNS)
        Set tSuspendedAfter = ##class(%SYSTEM.Process).TransactionsSuspended()
    } Catch ex {
        Set tCaught = ex.DisplayString()
    }
    TROLLBACK 1
    Set tALLExists = ..ALLExists(), tMapExists = ..MappingExists()
    Set tBroken = ..MapDisagrees()
    Set tRecAll = $Get(^ExecuteMCPv2.InstallRecord("all")), tRecMapping = $Get(^ExecuteMCPv2.InstallRecord("mapping"))
    Do $$$AssertEquals(tCaught, "", "nothing raised")
    Do $$$AssertEquals(tHasRequest, 0, "no %request object inside the transaction")
    Do $$$AssertEquals(tLevelIn, tLevelBefore + 1, "the call ran inside a transaction")
    Do $$$AssertStatusOK(tMap, "ConfigureMapping succeeds inside a transaction")
    Do $$$AssertEquals(tSuspendedAfter, tSuspendedBefore, "ConfigureMapping restored the transaction suspension it found")
    Do $$$AssertEquals(tSuspendedAfter, 0, "transactions are not suspended after ConfigureMapping returns")
    Do $$$AssertEquals(tALLExists, 1, "%ALL survives the rollback")
    Do $$$AssertEquals(tMapExists, 1, "the ExecuteMCPv2 mapping survives the rollback")
    Do $$$AssertEquals(tRecAll, "created", "the install record keeps %ALL as created")
    Do $$$AssertEquals(tRecMapping, "created", "the install record keeps the mapping as created")
    Do $$$AssertEquals(tBroken, 0, "the live package map agrees with the configuration")
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
