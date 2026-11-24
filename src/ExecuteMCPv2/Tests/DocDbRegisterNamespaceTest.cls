/// Namespace-separation tests for <method>ExecuteMCPv2.REST.Security:DocDbRecord</method> (Story 44.1, QA gap tests).
/// <p><class>ExecuteMCPv2.Tests.DocDbRegisterTest</class> runs every case with the DocDB database in the CURRENT namespace, so
/// a <method>DocDbRecord</method> that checked the database in the caller's namespace (not the requested one), or wrote the
/// record under the caller's namespace, would pass all of it. Here the disposable database
/// (<parameter>FIXTUREDB</parameter>) lives in another namespace (<property>OtherNs</property>, the first of
/// <parameter>OTHERNAMESPACES</parameter> that exists and is not the one the test runs in), and the call is made from the
/// current one. Both are cleaned in every test together with their records. On an instance with no such namespace every
/// test is reported as skipped.</p>
/// <p>Registration needs the <code>%Service_DocDB</code> service, which is off by default.
/// <method>TestRegisterWritesTheRecordForTheTargetNamespace</method> reads the service state and asserts the matching
/// branch, so the class passes with the service enabled and with it disabled.</p>
Class ExecuteMCPv2.Tests.DocDbRegisterNamespaceTest Extends %UnitTest.TestCase
{

/// The disposable DocDB database. No underscore: DocDB names become class names.
Parameter FIXTUREDB = "MCPRegNsDb";

/// The namespaces that may hold the fixture, in order of preference.
Parameter OTHERNAMESPACES = "USER,HSCUSTOM";

/// The namespace the fixture lives in for this test: not the one the test runs in. Empty when there is none.
Property OtherNs As %String;

Method OnBeforeOneTest() As %Status
{
    Set ..OtherNs = ""
    For tIndex = 1:1:$Length(..#OTHERNAMESPACES, ",") {
        Set tCandidate = $Piece(..#OTHERNAMESPACES, ",", tIndex)
        If (tCandidate '= $ZConvert($NAMESPACE, "U")) && ##class(%SYS.Namespace).Exists(tCandidate) {
            Set ..OtherNs = tCandidate
            Quit
        }
    }
    Do ..DropFixture()
    Quit $$$OK
}

Method OnAfterOneTest() As %Status
{
    Do ..DropFixture()
    Quit $$$OK
}

/// Drop the fixture database in the other namespace and in the current one, and delete both records. Every step is a
/// no-op when there is nothing to remove (<code>$$Delete^%SYS.DOCDB</code> answers 1 when there is no record).
Method DropFixture()
{
    Set tOrigNS = $NAMESPACE
    If ..OtherNs '= "" {
        Try {
            Set $NAMESPACE = ..OtherNs
            Do ##class(%DocDB.Database).%DropDatabase(..#FIXTUREDB)
        } Catch ex {
        }
        Set $NAMESPACE = tOrigNS
        Try {
            Set tSC = $$Delete^%SYS.DOCDB(..#FIXTUREDB, ..OtherNs)
        } Catch ex {
        }
    }
    Try {
        Do ##class(%DocDB.Database).%DropDatabase(..#FIXTUREDB)
    } Catch ex {
    }
    Try {
        Set tSC = $$Delete^%SYS.DOCDB(..#FIXTUREDB, tOrigNS)
    } Catch ex {
    }
    Set $NAMESPACE = tOrigNS
}

/// Can this class test namespace separation here? It needs a second namespace (<property>OtherNs</property>);
/// without one the test is reported as skipped, never as a pass, and this answers 0.
Method OtherNamespaceUsable() As %Boolean
{
    If ..OtherNs = "" {
        Do $$$AssertSkipped("none of "_..#OTHERNAMESPACES_" exists here apart from "_$NAMESPACE_", so no second namespace can hold the fixture")
        Quit 0
    }
    Quit 1
}

/// Create the fixture DocDB database in <property>OtherNs</property>; the current namespace is restored.
Method CreateFixtureInOtherNamespace()
{
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = ..OtherNs
        Do ##class(%DocDB.Database).%CreateDatabase(..#FIXTUREDB)
    } Catch ex {
    }
    Set $NAMESPACE = tOrigNS
}

/// Does a <class>Security.DocDBs</class> record exist for <var>pName</var> in <var>pNamespace</var>?
Method RecordExists(pName As %String, pNamespace As %String) As %Boolean
{
    Set tOrigNS = $NAMESPACE
    Set tExists = 0
    Try {
        Set $NAMESPACE = "%SYS"
        Set tExists = +##class(Security.DocDBs).Exists(pName, pNamespace)
        Set $NAMESPACE = tOrigNS
    } Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Quit tExists
}

/// Is the <code>%Service_DocDB</code> service enabled?
Method ServiceEnabled() As %Boolean
{
    Set tOrigNS = $NAMESPACE
    Set tEnabled = 0
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Security.Services).Get("%Service_DocDB", .tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISOK(tSC) Set tEnabled = +$Get(tProps("Enabled"))
    } Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Quit tEnabled
}

/// The existence check runs in the REQUESTED namespace: a database that lives in the other namespace is found when that
/// namespace is asked for, and is not found when the caller's own namespace is. It is a status call, so it passes
/// with the service enabled and disabled.
Method TestExistenceIsCheckedInTheRequestedNamespace()
{
    If '..OtherNamespaceUsable() Quit
    Set tNamespace = $NAMESPACE
    Do ..CreateFixtureInOtherNamespace()

    Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(..#FIXTUREDB, ..OtherNs, 0, .tOther)
    Do $$$AssertStatusOK(tSC, "the status call for the other namespace succeeds (got: "_$System.Status.GetErrorText(tSC)_")")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tOther.%Get("namespace"), ..OtherNs, "the requested namespace is echoed")
    Do $$$AssertEquals(tOther.%Get("exists"), 1, "the database is found in the namespace that holds it")
    Do $$$AssertEquals(tOther.%Get("registered"), 0, "and has no record")

    Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(..#FIXTUREDB, tNamespace, 0, .tOwn)
    Do $$$AssertStatusOK(tSC, "the status call for the caller's namespace succeeds")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tOwn.%Get("exists"), 0, "the same name is not a database of the caller's namespace")
    Do $$$AssertEquals($NAMESPACE, tNamespace, "the namespace is restored")
}

/// Registering a name for a namespace that does not hold the database is refused, even though the database exists in
/// another namespace, and no record is written for either namespace.
Method TestRegisterRefusesADatabaseOfAnotherNamespace()
{
    If '..OtherNamespaceUsable() Quit
    Set tNamespace = $NAMESPACE
    Do ..CreateFixtureInOtherNamespace()

    ; The premise: the database does exist, in the other namespace
    Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(..#FIXTUREDB, ..OtherNs, 0, .tPremise)
    Do $$$AssertStatusOK(tSC, "the status call for the other namespace succeeds (got: "_$System.Status.GetErrorText(tSC)_")")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tPremise.%Get("exists"), 1, "the fixture exists in "_..OtherNs)

    Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(..#FIXTUREDB, tNamespace, 1, .tResult)
    Do $$$AssertStatusNotOK(tSC, "the caller's namespace holds no such database, so the register is refused")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ tNamespace, "the refusal names the requested namespace (got: "_tText_")")
    Do $$$AssertEquals(..RecordExists(..#FIXTUREDB, tNamespace), 0, "no record was written for the caller's namespace")
    Do $$$AssertEquals(..RecordExists(..#FIXTUREDB, ..OtherNs), 0, "none for the other namespace either")
    Do $$$AssertEquals($NAMESPACE, tNamespace, "the namespace is restored")
}

/// Registering from one namespace for a database of another writes the record under the TARGET namespace, and dropping
/// the database there removes it. Enabled: the record exists for the target namespace and not for the caller's, and IRIS's
/// own access check passes for the target. Disabled: IRIS answers 822 and nothing is written. Both branches assert.
Method TestRegisterWritesTheRecordForTheTargetNamespace()
{
    If '..OtherNamespaceUsable() Quit
    Set tNamespace = $NAMESPACE
    Do ..CreateFixtureInOtherNamespace()

    If ..ServiceEnabled() {
        Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(..#FIXTUREDB, ..OtherNs, 1, .tResult)
        Do $$$AssertStatusOK(tSC, "register succeeds with the service enabled (got: "_$System.Status.GetErrorText(tSC)_")")
        If $$$ISERR(tSC) Quit
        Do $$$AssertEquals(tResult.%Get("registered"), 1, "the record exists afterwards")
        Do $$$AssertEquals(tResult.%Get("alreadyRegistered"), 0, "it was not there before")
        Do $$$AssertEquals(..RecordExists(..#FIXTUREDB, ..OtherNs), 1, "Security.DocDBs holds the record for the target namespace")
        Do $$$AssertEquals(..RecordExists(..#FIXTUREDB, tNamespace), 0, "and none for the caller's namespace")
        Do $$$AssertEquals($$CheckAccess^%SYS.DOCDB(..#FIXTUREDB, ..OtherNs, "W"), 1, "IRIS's own access check passes for the target namespace")

        Set tOrigNS = $NAMESPACE
        Set $NAMESPACE = ..OtherNs
        Do $$$AssertEquals(##class(%DocDB.Database).%DropDatabase(..#FIXTUREDB), 1, "the database drops in its own namespace")
        Set $NAMESPACE = tOrigNS
        Do $$$AssertEquals(..RecordExists(..#FIXTUREDB, ..OtherNs), 0, "dropping it leaves no record")
    } Else {
        Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(..#FIXTUREDB, ..OtherNs, 1, .tResult)
        Do $$$AssertStatusNotOK(tSC, "register is refused with the service disabled")
        Do $$$AssertTrue($System.Status.Equals(tSC, 822), "the refusal is IRIS's 822 (got: "_$System.Status.GetErrorText(tSC)_")")
        Do $$$AssertEquals(..RecordExists(..#FIXTUREDB, ..OtherNs), 0, "no record was written")
    }
    Do $$$AssertEquals($NAMESPACE, tNamespace, "the namespace is restored")
}

}
