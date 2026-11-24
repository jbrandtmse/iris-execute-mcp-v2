/// Story 44.7 (DW-757): <method>ExecuteMCPv2.REST.Config:DeleteDatabaseEntry</method> deletes a database's configuration entry
/// and dismounts the database, keeping <code>IRIS.DAT</code> and the directory on disk.
/// <p>Before the story <code>delete</code> only removed the entry: the database stayed mounted, so a later create at the same
/// directory failed (#60). Every test builds its own disposable database <code>P747DBT</code> in a directory under the manager
/// directory, the way the REST handler's <code>create</code> does (a directory, <code>SYS.Database.CreateDatabase</code>, then
/// the <code>Config.Databases</code> entry), and removes it before and after, in either order.
/// The oracles are IRIS's own state: <code>SYS.Database</code> <code>Mounted</code>, <code>Config.Databases:Exists</code> and
/// the file system.</p>
Class ExecuteMCPv2.Tests.DatabaseDeleteTest Extends %UnitTest.TestCase
{

/// The disposable database's configuration name.
Parameter DBNAME = "P747DBT";

/// A second configuration name, for the shared-directory test.
Parameter DBNAME2 = "P747DBU";

/// The disposable namespace that uses the database, for the in-use test.
Parameter NSNAME = "P747NS";

/// The directory of the disposable database, normalized (absolute, with the trailing delimiter).
ClassMethod Dir() As %String
{
    Quit ##class(%Library.File).NormalizeDirectory($SYSTEM.Util.ManagerDirectory()_"p747dbt")
}

/// Build the disposable database: directory, <code>IRIS.DAT</code>, and the configuration entry. Runs in %SYS and restores the
/// namespace.
ClassMethod CreateFixture() As %Status
{
    Set tOrigNS = $NAMESPACE
    Set tSC = $$$OK
    Try {
        Set $NAMESPACE = "%SYS"
        Set tDir = ..Dir()
        If '##class(%Library.File).DirectoryExists(tDir) {
            If '##class(%Library.File).CreateDirectoryChain(tDir) {
                Set tSC = $$$ERROR($$$GeneralError, "Failed to create directory: "_tDir)
                Quit
            }
        }
        Set tSC = ##class(SYS.Database).CreateDatabase(tDir, 1)
        If $$$ISERR(tSC) Quit
        Set tProps("Directory") = tDir
        Set tSC = ##class(Config.Databases).Create(..#DBNAME, .tProps)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrigNS
    Quit tSC
}

/// Remove everything the tests create, whatever state they left: the namespace, both configuration entries, the database
/// (<code>SYS.Database.DeleteDatabase</code>), its file and the directory. Runs in %SYS and restores the namespace.
ClassMethod RemoveFixture() As %Status
{
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        If ##class(Config.Namespaces).Exists(..#NSNAME) Do ##class(Config.Namespaces).Delete(..#NSNAME)
        If ##class(Config.Databases).Exists(..#DBNAME2) Do ##class(Config.Databases).Delete(..#DBNAME2)
        If ##class(Config.Databases).Exists(..#DBNAME) Do ##class(Config.Databases).Delete(..#DBNAME)
        Set tDir = ..Dir()
        If ##class(SYS.Database).%ExistsId(tDir) Do ##class(SYS.Database).DeleteDatabase(tDir)
        If ##class(%Library.File).DirectoryExists(tDir) Do ##class(%Library.File).RemoveDirectoryTree(tDir)
    }
    Catch ex {
        ; Best-effort cleanup: the next run starts with the same removal.
    }
    Set $NAMESPACE = tOrigNS
    Quit $$$OK
}

/// Whether the database in <method>Dir</method> is mounted, read from <code>SYS.Database</code>: 1 mounted, 0 not mounted, -1 no
/// such database. Runs in %SYS and restores the namespace.
ClassMethod Mounted() As %Integer
{
    Set tOrigNS = $NAMESPACE
    Set tMounted = -1
    Try {
        Set $NAMESPACE = "%SYS"
        Set tDir = ..Dir()
        If ##class(SYS.Database).%ExistsId(tDir) Set tMounted = +##class(SYS.Database).%OpenId(tDir).Mounted
    }
    Catch ex {
        Set tMounted = -1
    }
    Set $NAMESPACE = tOrigNS
    Quit tMounted
}

/// Whether the configuration entry <var>pName</var> exists. Runs in %SYS and restores the namespace.
ClassMethod ConfigExists(pName As %String) As %Boolean
{
    Set tOrigNS = $NAMESPACE
    Set tExists = 0
    Try {
        Set $NAMESPACE = "%SYS"
        Set tExists = ''##class(Config.Databases).Exists(pName)
    }
    Catch ex {
        Set tExists = 0
    }
    Set $NAMESPACE = tOrigNS
    Quit tExists
}

Method OnBeforeOneTest() As %Status
{
    Quit ..RemoveFixture()
}

Method OnAfterOneTest() As %Status
{
    Quit ..RemoveFixture()
}

/// The fixture itself is real: the database is mounted and has its file before any test deletes it.
Method TestFixtureIsMountedWithItsFile() As %Status
{
    Do $$$AssertStatusOK(..CreateFixture(), "the disposable database is created")
    Do $$$AssertEquals(..Mounted(), 1, "the new database is mounted")
    Do $$$AssertTrue(##class(%Library.File).Exists(..Dir()_"IRIS.DAT"), "IRIS.DAT exists")
    Do $$$AssertTrue(..ConfigExists(..#DBNAME), "the configuration entry exists")
    Quit $$$OK
}

/// An unused database: the entry is removed, the directory is dismounted, IRIS.DAT is kept, and the reply says so.
Method TestDeleteDismountsAndKeepsTheFile() As %Status
{
    Do $$$AssertStatusOK(..CreateFixture(), "the disposable database is created")
    Set tBefore = $NAMESPACE

    Set tSC = ##class(ExecuteMCPv2.REST.Config).DeleteDatabaseEntry(..#DBNAME, .tResult)

    Do $$$AssertStatusOK(tSC, "delete succeeds")
    Do $$$AssertEquals($NAMESPACE, tBefore, "the namespace is restored")
    Do $$$AssertEquals(tResult.%Get("action"), "deleted", "action")
    Do $$$AssertEquals(tResult.%Get("name"), ..#DBNAME, "name")
    Do $$$AssertEquals(tResult.%Get("dismounted"), 1, "the reply says dismounted: true")
    Do $$$AssertEquals(tResult.%IsDefined("dismountNote"), 0, "no dismountNote when it was dismounted")
    Do $$$AssertEquals(..ConfigExists(..#DBNAME), 0, "the configuration entry is gone")
    Do $$$AssertEquals(..Mounted(), 0, "the database is dismounted (SYS.Database Mounted = 0)")
    Do $$$AssertTrue(##class(%Library.File).Exists(..Dir()_"IRIS.DAT"), "IRIS.DAT is kept")
    Quit $$$OK
}

/// The proof that matters (DW-757): a create at the same directory after a delete is no longer blocked by a mounted database
/// (#60, the database must be dismounted). It fails with #78 (the file exists) instead, which is the documented consequence of
/// keeping IRIS.DAT.
Method TestSecondCreateIsNotBlockedByAMountedDatabase() As %Status
{
    Do $$$AssertStatusOK(..CreateFixture(), "the disposable database is created")
    Do $$$AssertStatusOK(##class(ExecuteMCPv2.REST.Config).DeleteDatabaseEntry(..#DBNAME, .tResult), "delete succeeds")

    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Set tCreateSC = ##class(SYS.Database).CreateDatabase(..Dir(), 1)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertStatusNotOK(tCreateSC, "a create at the same directory is refused: IRIS.DAT is kept")
    Set tText = $System.Status.GetErrorText(tCreateSC)
    Do $$$AssertTrue(tText [ "#78", "the refusal is 'the file exists' (#78), not 'the database must be dismounted' (#60): "_tText)
    Quit $$$OK
}

/// Another configuration entry names the same directory: the entry is removed, nothing is dismounted, and the reply says why.
Method TestSharedDirectoryIsNotDismounted() As %Status
{
    Do $$$AssertStatusOK(..CreateFixture(), "the disposable database is created")
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Set tProps("Directory") = ..Dir()
    Set tSC2 = ##class(Config.Databases).Create(..#DBNAME2, .tProps)
    Set $NAMESPACE = tOrigNS
    Do $$$AssertStatusOK(tSC2, "a second entry names the same directory")

    Set tSC = ##class(ExecuteMCPv2.REST.Config).DeleteDatabaseEntry(..#DBNAME, .tResult)

    Do $$$AssertStatusOK(tSC, "delete succeeds")
    Do $$$AssertEquals(tResult.%Get("dismounted"), 0, "the reply says dismounted: false")
    Do $$$AssertTrue(tResult.%Get("dismountNote") [ ..#DBNAME2, "the note names the entry that still uses the directory: "_tResult.%Get("dismountNote"))
    Do $$$AssertEquals(..ConfigExists(..#DBNAME), 0, "the deleted entry is gone")
    Do $$$AssertEquals(..ConfigExists(..#DBNAME2), 1, "the other entry is untouched")
    Do $$$AssertEquals(..Mounted(), 1, "the database is still mounted")
    Quit $$$OK
}

/// A database that a namespace uses is refused by Configuration (#429), and nothing changes: the entry stays and the
/// database stays mounted.
Method TestInUseDeleteIsRefusedAndChangesNothing() As %Status
{
    Do $$$AssertStatusOK(..CreateFixture(), "the disposable database is created")
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Set tNsProps("Routines") = ..#DBNAME
    Set tNsProps("Globals") = ..#DBNAME
    Set tNsSC = ##class(Config.Namespaces).Create(..#NSNAME, .tNsProps)
    Set $NAMESPACE = tOrigNS
    Do $$$AssertStatusOK(tNsSC, "a disposable namespace uses the database")

    Set tSC = ##class(ExecuteMCPv2.REST.Config).DeleteDatabaseEntry(..#DBNAME, .tResult)

    Do $$$AssertStatusNotOK(tSC, "delete is refused")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "in use", "the error is Configuration's own: "_$System.Status.GetErrorText(tSC))
    Do $$$AssertEquals($NAMESPACE, tOrigNS, "the namespace is restored")
    Do $$$AssertEquals(tResult, "", "no result is returned for a refusal")
    Do $$$AssertEquals(..ConfigExists(..#DBNAME), 1, "the configuration entry is untouched")
    Do $$$AssertEquals(..Mounted(), 1, "the database is still mounted")
    Quit $$$OK
}

/// The dismount decision ignores remote (ECP) entries: a remote deleted entry is never dismounted (its directory is a path on
/// its own server), and a remote entry that names the same path never counts as sharing a local directory. A remote entry
/// cannot be created without a configured ECP server, so the rows are built here; <code>Config.Databases</code> documents an
/// empty <code>Server</code> as local, and the shared-directory test above proves the live rows carry it that way.
Method TestRemoteEntriesNeverDismountOrShare() As %Status
{
    Set tDir = ..Dir()
    Set tOthers(1) = $ListBuild("P747REMOTE", "ECPSERVER1", tDir)

    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Config).ShouldDismount("ECPSERVER1", tDir, .tOthers, .tSharedBy), 0, "a remote deleted entry is not dismounted")
    Do $$$AssertEquals(tSharedBy, "", "and no entry is named as sharing it")

    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Config).ShouldDismount("", tDir, .tOthers, .tSharedBy), 1, "a remote entry with the same path does not keep a local database mounted")
    Do $$$AssertEquals(tSharedBy, "", "the remote entry is not named as sharing the directory")

    Set tOthers(2) = $ListBuild(..#DBNAME2, "", tDir)
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Config).ShouldDismount("", tDir, .tOthers, .tSharedBy), 0, "a local entry with the same directory keeps it mounted")
    Do $$$AssertEquals(tSharedBy, ..#DBNAME2, "the local entry is named")

    Kill tNone
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Config).ShouldDismount("", "", .tNone, .tSharedBy), 0, "no directory, no dismount")
    Quit $$$OK
}

/// A name that no database has gets Configuration's own error, and the namespace is restored.
Method TestMissingNameGetsTheConfigurationError() As %Status
{
    Set tBefore = $NAMESPACE

    Set tSC = ##class(ExecuteMCPv2.REST.Config).DeleteDatabaseEntry("P747DBNOSUCH", .tResult)

    Do $$$AssertStatusNotOK(tSC, "delete of a missing name fails")
    Do $$$AssertEquals($NAMESPACE, tBefore, "the namespace is restored")
    Do $$$AssertEquals(tResult, "", "no result is returned for an error")
    Quit $$$OK
}

}
