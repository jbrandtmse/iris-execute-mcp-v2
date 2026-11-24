/// Tests for <method>ExecuteMCPv2.REST.Security:DocDbRecord</method> and its two routes (Story 44.1).
/// <p>IRIS denies every DocDB call on a database that has no <class>Security.DocDBs</class> record, and the DocDB
/// REST API never writes one, so <code>iris_docdb_manage create</code> registers it through
/// <code>POST /security/docdb</code>. These tests drive the <var>%request</var>-independent seam directly and the
/// deployed GET route over <class>%Net.HttpRequest</class>, against a disposable DocDB database in the current
/// namespace (<parameter>FIXTUREDB</parameter>), which is dropped before and after every test together with its
/// record.</p>
/// <p>Whether <code>$$Create^%SYS.DOCDB</code> can succeed depends on the <code>%Service_DocDB</code> service, which
/// is off by default. <method>TestRegisterFollowsServiceState</method> reads the service state and asserts the
/// matching branch, so the class passes with the service enabled and with it disabled, and every test that does not
/// need the service passes in both states.</p>
Class ExecuteMCPv2.Tests.DocDbRegisterTest Extends %UnitTest.TestCase
{

/// The disposable DocDB database. No underscore: DocDB names become class names.
Parameter FIXTUREDB = "MCPRegTestDb";

/// A name no test ever creates.
Parameter MISSINGDB = "MCPRegNoSuchDb";

/// A disposable user that may call the routes but holds neither <code>%DocDB_Admin</code> nor <code>%Admin_Secure</code>.
Parameter DENIEDUSER = "MCPRegDenied";

/// The disposable role of <parameter>DENIEDUSER</parameter>.
Parameter DENIEDROLE = "MCPRegDeniedRole";

/// The password of <parameter>DENIEDUSER</parameter>.
Parameter DENIEDPASSWORD = "MCPreg44Denied1";

Method OnBeforeOneTest() As %Status
{
    Do ..DropFixture()
    Quit $$$OK
}

Method OnAfterOneTest() As %Status
{
    Do ..DropFixture()
    Quit $$$OK
}

/// Drop the fixture database in the current namespace and delete its record. Both are no-ops when absent
/// (<code>$$Delete^%SYS.DOCDB</code> answers 1 when there is no record).
Method DropFixture()
{
    Try {
        Do ##class(%DocDB.Database).%DropDatabase(..#FIXTUREDB)
    } Catch ex {
    }
    Try {
        Set tSC = $$Delete^%SYS.DOCDB(..#FIXTUREDB, $NAMESPACE)
    } Catch ex {
    }
    Do ..DropDeniedUser()
}

/// Create <parameter>DENIEDUSER</parameter> with a role that may reach the routes (<code>%Development:U</code>,
/// <code>%Service_DocDB:U</code>, and every database resource IRIS lets a role hold, except
/// <code>%DB_IRISSECURITY</code>) and holds no DocDB admin resource, so IRIS itself denies it the record check.
Method CreateDeniedUser() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tResources = "%Development:U,%Service_DocDB:U"
        Set tSC = ##class(Security.Roles).Create(..#DENIEDROLE, "Story 44.1 test: no DocDB admin", tResources)
        If $$$ISERR(tSC) Quit
        Set tRS = ##class(%ResultSet).%New("Security.Resources:List")
        Set tSC = tRS.Execute("%DB_*")
        If $$$ISERR(tSC) Quit
        While tRS.Next() {
            Set tName = tRS.Get("Name")
            If tName = "%DB_IRISSECURITY" Continue
            ; Some system database resources cannot be held by a role (#1499); those are skipped
            Kill tProps
            Set tProps("Resources") = tResources_","_tName_":RW"
            If $$$ISOK(##class(Security.Roles).Modify(..#DENIEDROLE, .tProps)) Set tResources = tProps("Resources")
        }
        Do tRS.Close()
        Set tSC = ##class(Security.Users).Create(..#DENIEDUSER, ..#DENIEDROLE, ..#DENIEDPASSWORD, "Story 44.1 test", , , , 0, 1, , , , , , 1, 1)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrigNS
    Quit tSC
}

/// Delete <parameter>DENIEDUSER</parameter> and its role; a no-op when they are absent.
Method DropDeniedUser()
{
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        If ##class(Security.Users).Exists(..#DENIEDUSER) Do ##class(Security.Users).Delete(..#DENIEDUSER)
        If ##class(Security.Roles).Exists(..#DENIEDROLE) Do ##class(Security.Roles).Delete(..#DENIEDROLE)
    } Catch ex {
    }
    Set $NAMESPACE = tOrigNS
}

/// Does a <class>Security.DocDBs</class> record exist for <var>pName</var> in the current namespace?
Method RecordExists(pName As %String) As %Boolean
{
    Set tOrigNS = $NAMESPACE
    Set tNamespace = $NAMESPACE
    Set tExists = 0
    Try {
        Set $NAMESPACE = "%SYS"
        Set tExists = +##class(Security.DocDBs).Exists(pName, tNamespace)
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

/// A name with no database and no record reports both as absent; it is a status, not an error.
Method TestStatusOfUnknownNameIsUnregistered()
{
    Set tNamespace = $NAMESPACE
    Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(..#MISSINGDB, tNamespace, 0, .tResult)
    Do $$$AssertStatusOK(tSC, "an unknown name is reported, not refused")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tResult.%Get("name"), ..#MISSINGDB, "the name is echoed")
    Do $$$AssertEquals(tResult.%Get("exists"), 0, "no DocDB database")
    Do $$$AssertEquals(tResult.%Get("registered"), 0, "no record")
    Do $$$AssertEquals(tResult.%Get("alreadyRegistered"), 0, "no record before the call either")
    Do $$$AssertEquals($NAMESPACE, tNamespace, "the namespace is restored")
}

/// An empty name or namespace is refused before any work, and the refusal names the field.
Method TestRegisterRequiresName()
{
    Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord("", $NAMESPACE, 1, .tResult)
    Do $$$AssertStatusNotOK(tSC, "an empty name is refused")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "name", "the refusal names 'name' (got: "_tText_")")

    Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(..#FIXTUREDB, "", 1, .tResult)
    Do $$$AssertStatusNotOK(tSC, "an empty namespace is refused")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "namespace", "the refusal names 'namespace' (got: "_tText_")")
    Do $$$AssertEquals(..RecordExists(..#FIXTUREDB), 0, "nothing was written")
}

/// Registering a name that has no DocDB database is refused, and no record is written: IRIS would write one for any
/// name (live probe P11), so the handler's existence check is what keeps orphan records out.
Method TestRegisterRefusesMissingDatabase()
{
    Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(..#MISSINGDB, $NAMESPACE, 1, .tResult)
    Do $$$AssertStatusNotOK(tSC, "a name with no database is refused")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ ..#MISSINGDB, "the refusal names the database (got: "_tText_")")
    Do $$$AssertTrue(tText [ $NAMESPACE, "the refusal names the namespace (got: "_tText_")")
    Do $$$AssertEquals(..RecordExists(..#MISSINGDB), 0, "no record was written")
}

/// Registration follows the <code>%Service_DocDB</code> service. Enabled: the record is written once, IRIS's own
/// access check then passes, a second call reports <code>alreadyRegistered</code>, and dropping the database leaves
/// no record. Disabled: IRIS answers 822, nothing is written, and the failure is a status, never
/// <code>registered:false</code>. Both branches assert.
Method TestRegisterFollowsServiceState()
{
    Set tDb = ..#FIXTUREDB
    Set tNamespace = $NAMESPACE
    Do ##class(%DocDB.Database).%CreateDatabase(tDb)
    Do $$$AssertEquals(..RecordExists(tDb), 0, "a database made through the DocDB API has no record")

    If ..ServiceEnabled() {
        Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(tDb, tNamespace, 1, .tResult)
        Do $$$AssertStatusOK(tSC, "register succeeds with the service enabled (got: "_$System.Status.GetErrorText(tSC)_")")
        If $$$ISERR(tSC) Quit
        Do $$$AssertEquals(tResult.%Get("exists"), 1, "the database exists")
        Do $$$AssertEquals(tResult.%Get("registered"), 1, "the record exists afterwards")
        Do $$$AssertEquals(tResult.%Get("alreadyRegistered"), 0, "it was not there before")
        Do $$$AssertEquals(..RecordExists(tDb), 1, "Security.DocDBs holds the record")
        Do $$$AssertEquals($$CheckAccess^%SYS.DOCDB(tDb, tNamespace, "W"), 1, "IRIS's own access check passes")

        Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(tDb, tNamespace, 1, .tAgain)
        Do $$$AssertStatusOK(tSC, "a second register succeeds")
        Do $$$AssertEquals(tAgain.%Get("alreadyRegistered"), 1, "the second call reports alreadyRegistered")
        Do $$$AssertEquals(tAgain.%Get("registered"), 1, "and the record is still there")

        Do $$$AssertEquals(##class(%DocDB.Database).%DropDatabase(tDb), 1, "the database drops")
        Do $$$AssertEquals(..RecordExists(tDb), 0, "dropping the database leaves no record")
    } Else {
        Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(tDb, tNamespace, 1, .tResult)
        Do $$$AssertStatusNotOK(tSC, "register is refused with the service disabled")
        Do $$$AssertTrue($System.Status.Equals(tSC, 822), "the refusal is IRIS's 822 (got: "_$System.Status.GetErrorText(tSC)_")")
        Do $$$AssertEquals(..RecordExists(tDb), 0, "no record was written")

        Set tSC = ##class(ExecuteMCPv2.REST.Security).DocDbRecord(tDb, tNamespace, 0, .tStatus)
        Do $$$AssertStatusOK(tSC, "the status call still works with the service disabled")
        Do $$$AssertEquals(tStatus.%Get("exists"), 1, "the database exists")
        Do $$$AssertEquals(tStatus.%Get("registered"), 0, "and has no record")
    }
    Do $$$AssertEquals($NAMESPACE, tNamespace, "the namespace is restored")
}

/// The deployed routes answer in the single-envelope shape for the fixture database. GET: it exists and has no record
/// until one is written. POST: an unknown action and a database that does not exist are error envelopes and write
/// nothing; <code>register</code> follows the <code>%Service_DocDB</code> service. Enabled, the first POST answers
/// <code>registered:true, alreadyRegistered:false</code>, a second answers <code>alreadyRegistered:true</code>, and
/// the GET route then reports the record. Disabled, the POST is an error envelope carrying IRIS's "Access Denied"
/// text (<method>SanitizeError</method> re-wraps the 822 as a general error, so the wire carries the text, not the
/// code) and no record exists. Both branches assert.
Method TestRouteGetRoundTrip()
{
    Set tDb = ..#FIXTUREDB
    Set tNamespace = $NAMESPACE
    Do ##class(%DocDB.Database).%CreateDatabase(tDb)

    Set tSC = ..GetRecord(tDb, tNamespace, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "HTTP round-trip and JSON envelope parse succeed")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "HTTP 200")
    Do $$$AssertEquals(tEnv.%Get("status").%Get("errors").%Size(), 0, "status.errors is empty")
    Set tResult = tEnv.%Get("result")
    Do $$$AssertEquals(tResult.%Get("name"), tDb, "the name is echoed")
    Do $$$AssertEquals(tResult.%Get("exists"), 1, "the database exists over the wire")
    Do $$$AssertEquals(tResult.%Get("registered"), 0, "and has no record over the wire")

    ; A caller IRIS denies the record check gets an error envelope, never registered:false
    Set tSC = ..CreateDeniedUser()
    Do $$$AssertStatusOK(tSC, "the disposable non-admin user is created (got: "_$System.Status.GetErrorText(tSC)_")")
    If $$$ISOK(tSC) {
        Set tSC = ..GetRecord(tDb, tNamespace, .tHttp, .tEnv, ..#DENIEDUSER, ..#DENIEDPASSWORD)
        Do $$$AssertStatusOK(tSC, "the denied GET is a parseable envelope (got: "_$System.Status.GetErrorText(tSC)_")")
        If $$$ISOK(tSC) {
            Do $$$AssertTrue(tEnv.%Get("status").%Get("errors").%Size() >= 1, "a caller without DocDB admin rights gets an error envelope (got: "_tEnv.%ToJSON()_")")
            Do $$$AssertNotTrue($IsObject(tEnv.%Get("result")) && (tEnv.%Get("result").%Get("registered") = 0), "and never a registered:false answer")
        }
    }
    Do ..DropDeniedUser()

    ; A request without the required parameters is refused in the same envelope
    Set tSC = ..GetRecord("", tNamespace, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the refusal is a parseable envelope")
    Do $$$AssertTrue(tEnv.%Get("status").%Get("errors").%Size() >= 1, "a missing name is an error envelope")

    ; POST: an unknown action is refused before any work
    Set tSC = ..PostRecord("bogus", tDb, tNamespace, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the unknown-action refusal is a parseable envelope")
    Do $$$AssertTrue(tEnv.%Get("status").%Get("errors").%Size() >= 1, "an unknown action is an error envelope")
    Do $$$AssertEquals(..RecordExists(tDb), 0, "an unknown action writes no record")

    ; POST: a database that does not exist is refused and no record is written
    Set tSC = ..PostRecord("register", ..#MISSINGDB, tNamespace, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the missing-database refusal is a parseable envelope")
    Do $$$AssertTrue(tEnv.%Get("status").%Get("errors").%Size() >= 1, "register for a missing database is an error envelope")
    Do $$$AssertEquals(..RecordExists(..#MISSINGDB), 0, "no record was written for the missing database")

    If ..ServiceEnabled() {
        Set tSC = ..PostRecord("register", tDb, tNamespace, .tHttp, .tEnv)
        Do $$$AssertStatusOK(tSC, "the register round-trip parses")
        If $$$ISERR(tSC) Quit
        Do $$$AssertEquals(tEnv.%Get("status").%Get("errors").%Size(), 0, "register has an empty status.errors")
        Set tResult = tEnv.%Get("result")
        Do $$$AssertEquals(tResult.%Get("name"), tDb, "register echoes the name")
        Do $$$AssertEquals(tResult.%Get("registered"), 1, "register answers registered true")
        Do $$$AssertEquals(tResult.%Get("alreadyRegistered"), 0, "and alreadyRegistered false")
        Do $$$AssertEquals(..RecordExists(tDb), 1, "Security.DocDBs holds the record")

        Set tSC = ..PostRecord("register", tDb, tNamespace, .tHttp, .tEnv)
        Do $$$AssertStatusOK(tSC, "the second register round-trip parses")
        If $$$ISERR(tSC) Quit
        Do $$$AssertEquals(tEnv.%Get("result").%Get("alreadyRegistered"), 1, "a second register answers alreadyRegistered true")

        Set tSC = ..GetRecord(tDb, tNamespace, .tHttp, .tEnv)
        Do $$$AssertStatusOK(tSC, "the GET after register parses")
        If $$$ISERR(tSC) Quit
        Do $$$AssertEquals(tEnv.%Get("result").%Get("registered"), 1, "the GET route then reports registered true")
    } Else {
        Set tSC = ..PostRecord("register", tDb, tNamespace, .tHttp, .tEnv)
        Do $$$AssertStatusOK(tSC, "the refused register is a parseable envelope")
        If $$$ISERR(tSC) Quit
        Do $$$AssertTrue(tEnv.%Get("status").%Get("errors").%Size() >= 1, "register is an error envelope with the service disabled")
        Do $$$AssertTrue(tEnv.%Get("status").%Get("summary") [ "Access Denied", "the error carries IRIS's access-denied text (got: "_tEnv.%Get("status").%ToJSON()_")")
        Do $$$AssertEquals(..RecordExists(tDb), 0, "no record was written")
    }
}

/// GET <code>/security/docdb</code> for <var>pName</var> in <var>pNamespace</var> (mirrors
/// <class>ExecuteMCPv2.Tests.AdvisorDataTest</class>'s <method>PostAdvise</method>), as <var>pUsername</var> when
/// given, else as the configured test user.
Method GetRecord(pName As %String, pNamespace As %String, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject, pUsername As %String = "", pPassword As %String = "") As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Select(pUsername '= "": pUsername, 1: $Get(^UnitTestConfig("DocDb", "Username"), "_SYSTEM"))
        Set tRequest.Password = $Select(pUsername '= "": pPassword, 1: $Get(^UnitTestConfig("DocDb", "Password"), "SYS"))
        Set tRequest.Timeout = 60
        Do tRequest.SetParam("name", pName)
        Do tRequest.SetParam("namespace", pNamespace)
        Set tSC = tRequest.Get("/api/executemcp/v2/security/docdb")
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set pEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// POST <code>/security/docdb</code> with <code>{action, name, namespace}</code> (same pattern as
/// <method>GetRecord</method>).
Method PostRecord(pAction As %String, pName As %String, pNamespace As %String, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tBody = {}
        Do tBody.%Set("action", pAction)
        Do tBody.%Set("name", pName)
        Do tBody.%Set("namespace", pNamespace)
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Get(^UnitTestConfig("DocDb", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("DocDb", "Password"), "SYS")
        Set tRequest.Timeout = 60
        Set tRequest.ContentType = "application/json"
        Do tRequest.EntityBody.Write(tBody.%ToJSON())
        Set tSC = tRequest.Post("/api/executemcp/v2/security/docdb")
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set pEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Resolve the local web server port; override via <code>^UnitTestConfig("DocDb","Port")</code>.
Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("DocDb", "Port"))
    If tPort > 0 Quit tPort
    Set tPort = 52773
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.Startup).Get(.tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISOK(tSC) && (+$Get(tProps("WebServerPort")) > 0) { Set tPort = +tProps("WebServerPort") }
    } Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Quit tPort
}

}
