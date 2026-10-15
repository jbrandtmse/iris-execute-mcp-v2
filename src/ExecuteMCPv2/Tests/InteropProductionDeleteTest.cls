/// Real-HTTP coverage for the <code>delete</code> action of
/// <method>ExecuteMCPv2.REST.Interop:ProductionManage</method> (Story 38.0, DW-55 and the
/// DW-54 normal path). The state guard's predicate itself is pinned by
/// <method>ExecuteMCPv2.Tests.InteropHostGuardTest:TestDeleteBlockedByState</method>; this class
/// drives the DEPLOYED <code>/api/executemcp/v2/interop/production</code> route with
/// <class>%Net.HttpRequest</class> so the delete paths are exercised on the route they guard.
/// <ul>
///   <li><b>Orphan row (DW-55).</b> An <class>Ens.Config.Production</class> row whose production
///       class no longer exists used to answer "does not exist" and could not be removed. Delete now
///       removes the row and reports <code>orphanRemoved: true</code>.</li>
///   <li><b>Ordinary delete (DW-54 normal path).</b> A production created through the
///       <code>create</code> action and never started is not the namespace's current production, so
///       the state guard does not apply: its class and row are both removed, with no
///       <code>orphanRemoved</code> field (the response is unchanged for this path).</li>
///   <li><b>Nonexistent name.</b> Neither a class nor a row: the unchanged "does not exist"
///       refusal, and nothing is created or deleted.</li>
/// </ul>
/// <p>Fixtures are the three disposable names below (all under <code>ExecuteMCPv2.Temp.Story380</code>),
/// and every production class and <class>Ens.Config.Production</class> row under that prefix is
/// removed before and after each test, so a killed run cannot leave anything behind. No production
/// is ever started.</p>
Class ExecuteMCPv2.Tests.InteropProductionDeleteTest Extends %UnitTest.TestCase
{

/// Disposable orphan: an Ens.Config.Production row with no production class.
Parameter ORPHAN = "ExecuteMCPv2.Temp.Story380Orphan";

/// Disposable production created through the create action and never started.
Parameter PROD = "ExecuteMCPv2.Temp.Story380Prod";

/// A name that is never created.
Parameter MISSING = "ExecuteMCPv2.Temp.Story380Missing";

/// Prefix shared by every fixture this class may create.
Parameter FIXTUREPREFIX = "ExecuteMCPv2.Temp.Story380";

/// Name of the configuration item the orphan-with-items test gives the orphan row (under the
/// disposable prefix, so the by-name sweep in <method>RemoveFixtures</method> can only reach it).
Parameter ORPHANITEM = "ExecuteMCPv2.Temp.Story380OrphanItem";

Method OnBeforeOneTest() As %Status
{
    Do ..RemoveFixtures()
    Quit $$$OK
}

Method OnAfterOneTest(testname As %String) As %Status
{
    Do ..RemoveFixtures()
    Quit $$$OK
}

/// Remove every production class and Ens.Config.Production row under the fixture prefix.
Method RemoveFixtures()
{
    ; Collect the names first, then delete: no cursor is open while rows disappear.
    Kill tClasses, tRows
    Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ?", ..#FIXTUREPREFIX)
    If $IsObject(tRS) && (tRS.%SQLCODE >= 0) {
        While tRS.%Next() { Set tClasses(tRS.%GetData(1)) = "" }
    }
    Set tRowRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT Name FROM Ens_Config.Production WHERE Name %STARTSWITH ?", ..#FIXTUREPREFIX)
    If $IsObject(tRowRS) && (tRowRS.%SQLCODE >= 0) {
        While tRowRS.%Next() { Set tRows(tRowRS.%GetData(1)) = "" }
    }
    Set tName = ""
    For {
        Set tName = $Order(tClasses(tName))
        Quit:tName=""
        Do ##class(%Dictionary.ClassDefinition).%DeleteId(tName)
    }
    Set tName = ""
    For {
        Set tName = $Order(tRows(tName))
        Quit:tName=""
        If ##class(Ens.Config.Production).%ExistsId(tName) { Do ##class(Ens.Config.Production).%DeleteId(tName) }
    }
    ; An item left behind with no owning production (a failed run) is removed by its fixture name.
    Do ##class(%SQL.Statement).%ExecDirect(, "DELETE FROM Ens_Config.Item WHERE Name = ?", ..#ORPHANITEM)
}

/// Count the Ens.Config.Production rows under the fixture prefix.
Method FixtureRowCount() As %Integer
{
    Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT COUNT(*) FROM Ens_Config.Production WHERE Name %STARTSWITH ?", ..#FIXTUREPREFIX)
    If '$IsObject(tRS) || (tRS.%SQLCODE < 0) Quit -1
    Do tRS.%Next()
    Quit +tRS.%GetData(1)
}

/// Resolve the WebServer port the same way <class>ExecuteMCPv2.Tests.InteropItemCompositeKeyTest</class> does.
Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("Interop", "Port"))
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

/// POST a JSON body to a deployed ExecuteMCPv2 REST route and parse the envelope.
Method PostJson(pPath As %String, pJsonBody As %String, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Get(^UnitTestConfig("Interop", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("Interop", "Password"), "SYS")
        Set tRequest.Timeout = 60
        Set tRequest.ContentType = "application/json"
        Do tRequest.EntityBody.Write(pJsonBody)
        Set tSC = tRequest.Post(pPath)
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set pEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Number of entries in the envelope's status.errors array.
Method EnvelopeErrorCount(pEnvelope As %DynamicObject) As %Integer
{
    Quit pEnvelope.status.errors.%Size()
}

/// Build the JSON body for one production-manage call.
Method ManageBody(pAction As %String, pName As %String) As %String
{
    Quit "{""action"":"""_pAction_""",""name"":"""_pName_""",""namespace"":"""_$NAMESPACE_"""}"
}

/// DW-55 - an orphan Ens.Config.Production row (no production class) is removed by delete, and the
/// response says so with <code>orphanRemoved</code>. Before the fix this answered "does not exist"
/// and the row could not be removed through the tool.
Method TestDeleteOrphanRowRemoved() As %Status
{
    Set tRow = ##class(Ens.Config.Production).%New()
    Set tRow.Name = ..#ORPHAN
    Do $$$AssertStatusOK(tRow.%Save(), "the orphan Ens.Config.Production row is created")
    Kill tRow
    Do $$$AssertTrue('##class(%Dictionary.ClassDefinition).%ExistsId(..#ORPHAN), "precondition: the orphan has no production class")
    Do $$$AssertTrue(##class(Ens.Config.Production).%ExistsId(..#ORPHAN), "precondition: the orphan row exists")

    Set tSC = ..PostJson("/api/executemcp/v2/interop/production", ..ManageBody("delete", ..#ORPHAN), .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the delete HTTP call must succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "delete renders HTTP 200 + envelope (Rule #7)")
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "removing an orphan row carries no errors (got: " _ tEnv.%ToJSON() _ ")")
    Do $$$AssertEquals(tEnv.result.action, "deleted", "response action is deleted")
    Do $$$AssertEquals(tEnv.result.name, ..#ORPHAN, "response echoes the production name")
    Do $$$AssertEquals(tEnv.result.orphanRemoved, 1, "response reports orphanRemoved")
    Do $$$AssertTrue('##class(Ens.Config.Production).%ExistsId(..#ORPHAN), "the orphan row is gone")
    Quit $$$OK
}

/// DW-55 - the orphan row is removed together with its configuration items: the row is deleted
/// through <code>Ens.Config.Production:%DeleteId</code>, which also removes the items the row owns,
/// so no <class>Ens.Config.Item</class> row is left pointing at a production that no longer exists.
Method TestDeleteOrphanRowRemovesItsItems() As %Status
{
    Set tRow = ##class(Ens.Config.Production).%New()
    Set tRow.Name = ..#ORPHAN
    Set tItem = ##class(Ens.Config.Item).%New()
    Set tItem.Name = ..#ORPHANITEM
    Set tItem.ClassName = "EnsLib.File.PassthroughOperation"
    ; The item row carries its production, exactly as LoadFromClass leaves it; without this
    ; reference the item is not owned by the production and %DeleteId does not remove it.
    Set tItem.Production = tRow
    Do tRow.Items.Insert(tItem)
    Do $$$AssertStatusOK(tRow.%Save(), "the orphan row and its item are created")
    Kill tItem, tRow
    Do $$$AssertTrue('##class(%Dictionary.ClassDefinition).%ExistsId(..#ORPHAN), "precondition: the orphan has no production class")
    Do $$$AssertEquals(..ItemCount(..#ORPHANITEM), 1, "precondition: the orphan row owns one item")

    Set tSC = ..PostJson("/api/executemcp/v2/interop/production", ..ManageBody("delete", ..#ORPHAN), .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the delete HTTP call must succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "removing an orphan row carries no errors (got: " _ tEnv.%ToJSON() _ ")")
    Do $$$AssertEquals(tEnv.result.orphanRemoved, 1, "response reports orphanRemoved")
    Do $$$AssertTrue('##class(Ens.Config.Production).%ExistsId(..#ORPHAN), "the orphan row is gone")
    Do $$$AssertEquals(..ItemCount(..#ORPHANITEM), 0, "the row's item is gone with it, not left behind without a production")
    Quit $$$OK
}

/// Number of <class>Ens.Config.Item</class> rows named <var>pItemName</var>, whichever production (if any) they
/// point at: an item left behind with no production must still be counted.
Method ItemCount(pItemName As %String) As %Integer
{
    Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT COUNT(*) FROM Ens_Config.Item WHERE Name = ?", pItemName)
    If '$IsObject(tRS) || (tRS.%SQLCODE < 0) Quit -1
    Do tRS.%Next()
    Quit +tRS.%GetData(1)
}

/// DW-54 normal path - a production created through the create action and never started is not
/// the namespace's current production, so delete proceeds as before: the class and the row are
/// both removed, and the response carries no <code>orphanRemoved</code> field.
Method TestDeleteCreatedProductionRemovesClassAndRow() As %Status
{
    Set tSC = ..PostJson("/api/executemcp/v2/interop/production", ..ManageBody("create", ..#PROD), .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the create HTTP call must succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "create carries no errors (got: " _ tEnv.%ToJSON() _ ")")
    Do $$$AssertEquals(tEnv.result.action, "created", "response action is created")
    Do $$$AssertTrue(##class(%Dictionary.ClassDefinition).%ExistsId(..#PROD), "precondition: the production class exists")

    Set tSC = ..PostJson("/api/executemcp/v2/interop/production", ..ManageBody("delete", ..#PROD), .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the delete HTTP call must succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "delete renders HTTP 200 + envelope (Rule #7)")
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "deleting a stopped, non-current production carries no errors (got: " _ tEnv.%ToJSON() _ ")")
    Do $$$AssertEquals(tEnv.result.action, "deleted", "response action is deleted")
    Do $$$AssertEquals(tEnv.result.name, ..#PROD, "response echoes the production name")
    Do $$$AssertTrue('tEnv.result.%IsDefined("orphanRemoved"), "an ordinary delete carries no orphanRemoved field")
    Do $$$AssertTrue('##class(%Dictionary.ClassDefinition).%ExistsId(..#PROD), "the production class is gone")
    Do $$$AssertTrue('##class(Ens.Config.Production).%ExistsId(..#PROD), "the Ens.Config.Production row is gone")
    Quit $$$OK
}

/// A name with neither a class nor a row keeps the unchanged "does not exist" refusal and
/// changes nothing: no class or row appears or disappears.
Method TestDeleteNonexistentRefusedNothingChanged() As %Status
{
    Do $$$AssertTrue('##class(%Dictionary.ClassDefinition).%ExistsId(..#MISSING), "precondition: no class")
    Do $$$AssertTrue('##class(Ens.Config.Production).%ExistsId(..#MISSING), "precondition: no row")
    Set tRowsBefore = ..FixtureRowCount()

    Set tSC = ..PostJson("/api/executemcp/v2/interop/production", ..ManageBody("delete", ..#MISSING), .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the delete HTTP call must succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "refusal still renders HTTP 200 + envelope (Rule #7)")
    Do $$$AssertTrue(..EnvelopeErrorCount(tEnv) >= 1, "the envelope carries a refusal")
    Set tErr = tEnv.status.errors.%Get(0).%Get("error")
    Do $$$AssertTrue(tErr [ ("Production '" _ ..#MISSING _ "' does not exist"), "the refusal is the unchanged does-not-exist text (got: " _ tErr _ ")")
    Do $$$AssertTrue('tEnv.result.%IsDefined("action"), "a refusal returns no action result")
    Do $$$AssertTrue('##class(%Dictionary.ClassDefinition).%ExistsId(..#MISSING), "still no class")
    Do $$$AssertTrue('##class(Ens.Config.Production).%ExistsId(..#MISSING), "still no row")
    Do $$$AssertEquals(..FixtureRowCount(), tRowsBefore, "the fixture-prefix row count is unchanged")
    Quit $$$OK
}

}
