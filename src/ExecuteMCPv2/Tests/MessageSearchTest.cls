/// Unit tests for <class>ExecuteMCPv2.REST.MessageSearch</class> (Story 39.1). Data-free: nothing
/// here reads or writes a message header.
/// <p><b>Section A</b> pins <method>ExecuteMCPv2.REST.MessageSearch.HeaderWhere</method>: the WHERE
/// clause <code>resendFiltered</code> relied on before the extraction, the fixed fragment order,
/// that a caller's text only ever travels in the parameter array, and the no-filter case.</p>
/// <p><b>Section A2</b> pins <method>ExecuteMCPv2.REST.MessageSearch.HeaderStatement</method>, whose index hint
/// bounds the plan to the window, and that the three indexes the hint names exist.</p>
/// <p><b>Section B</b> drives every refusal of the <code>POST /interop/message/search</code> route over
/// real HTTP (<code>%Net.HttpRequest</code>, the pattern of
/// <class>ExecuteMCPv2.Tests.MessageResendTest</class>). Each refusal names the offending parameter,
/// never echoes the hostile value sent, and returns an empty result. All of them are decided before the
/// handler switches namespace or reads, so no header data is involved.</p>
Class ExecuteMCPv2.Tests.MessageSearchTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// ==================== Section A: HeaderWhere ====================

/// A filter object holding exactly the four filters <code>resendFiltered</code> builds.
Method ResendFilters(pItem As %String) As %DynamicObject
{
    Set tFilters = {}
    Do tFilters.%Set("item", pItem)
    Do tFilters.%Set("statusCode", 8)
    Do tFilters.%Set("fromNorm", "2001-02-03 06:00:00")
    Do tFilters.%Set("toNorm", "2001-02-03 18:00:00")
    Quit tFilters
}

/// A filter object with every key set. The values are hostile text where a string is accepted.
Method EveryFilter() As %DynamicObject
{
    Set tFilters = {}
    Do tFilters.%Set("item", "i' OR '1'='1")
    Do tFilters.%Set("source", "%")
    Do tFilters.%Set("target", "_")
    Do tFilters.%Set("statusCode", 8)
    Do tFilters.%Set("fromNorm", "2001-02-03 06:00:00")
    Do tFilters.%Set("toNorm", "2001-02-03 18:00:00")
    Do tFilters.%Set("sessionId", 200)
    Do tFilters.%Set("bodyClass", "B'; DROP TABLE Ens.MessageHeader--")
    Do tFilters.%Set("errorOnly", 1, "boolean")
    Quit tFilters
}

/// The filter set <code>resendFiltered</code> builds produces the WHERE clause and parameter order that
/// statement used before the helper existed.
Method TestHeaderWhereResendFilterSet()
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere(..ResendFilters("Story391.Alpha"), .tWhere, .tParams)
    Do $$$AssertStatusOK(tSC, "HeaderWhere succeeds")
    Do $$$AssertEquals(tWhere, "(SourceConfigName = ? OR TargetConfigName = ?) AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ?", "The resendFiltered WHERE clause")
    Do $$$AssertEquals(tParams, 5, "Five parameters")
    Do $$$AssertEquals(tParams(1), "Story391.Alpha", "Parameter 1 is the item (source side)")
    Do $$$AssertEquals(tParams(2), "Story391.Alpha", "Parameter 2 is the item (target side)")
    Do $$$AssertEquals(tParams(3), 8, "Parameter 3 is the status code")
    Do $$$AssertEquals(tParams(4), "2001-02-03 06:00:00", "Parameter 4 is the lower bound")
    Do $$$AssertEquals(tParams(5), "2001-02-03 18:00:00", "Parameter 5 is the upper bound")
}

/// With every filter set, the fragments come in the fixed order and the parameters follow the markers.
Method TestHeaderWhereEveryFilterOrder()
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere(..EveryFilter(), .tWhere, .tParams)
    Do $$$AssertStatusOK(tSC, "HeaderWhere succeeds")
    Set tExpected = "(SourceConfigName = ? OR TargetConfigName = ?) AND SourceConfigName = ? AND TargetConfigName = ? AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ? AND SessionId = ? AND MessageBodyClassName = ? AND IsError = 1"
    Do $$$AssertEquals(tWhere, tExpected, "The fragments in their fixed order")
    Do $$$AssertEquals(tParams, 9, "Nine parameters (the item twice; IsError = 1 has none)")
    Do $$$AssertEquals(tParams(3), "%", "Parameter 3 is the source")
    Do $$$AssertEquals(tParams(4), "_", "Parameter 4 is the target")
    Do $$$AssertEquals(tParams(5), 8, "Parameter 5 is the status code")
    Do $$$AssertEquals(tParams(8), 200, "Parameter 8 is the session")
    Do $$$AssertEquals(tParams(9), "B'; DROP TABLE Ens.MessageHeader--", "Parameter 9 is the body class")
}

/// A caller's text appears only in the parameter array: the clause is the same fixed text whatever
/// the values are, and none of the hostile values is in it.
Method TestHeaderWhereNoCallerText()
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere(..EveryFilter(), .tWhere, .tParams)
    Do $$$AssertStatusOK(tSC, "HeaderWhere succeeds with hostile values")
    Set tPlain = {}
    Do tPlain.%Set("item", "a")
    Do tPlain.%Set("source", "b")
    Do tPlain.%Set("target", "c")
    Do tPlain.%Set("statusCode", 1)
    Do tPlain.%Set("fromNorm", "d")
    Do tPlain.%Set("toNorm", "e")
    Do tPlain.%Set("sessionId", 2)
    Do tPlain.%Set("bodyClass", "f")
    Do tPlain.%Set("errorOnly", 1, "boolean")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere(tPlain, .tPlainWhere, .tPlainParams)
    Do $$$AssertEquals(tWhere, tPlainWhere, "The clause does not depend on the values")
    Do $$$AssertTrue(tWhere '[ "'", "No quote in the clause")
    Do $$$AssertTrue(tWhere '[ "DROP", "No hostile text in the clause")
    Do $$$AssertTrue(tWhere '[ "1'='1", "No injected condition in the clause")
    Do $$$AssertEquals(tParams(1), "i' OR '1'='1", "The hostile item is a parameter")
    Do $$$AssertEquals(tParams(2), "i' OR '1'='1", "The hostile item is a parameter on the target side too")
}

/// No filters, or only empty ones, give an empty clause and no parameters.
Method TestHeaderWhereNoFilters()
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere({}, .tWhere, .tParams)
    Do $$$AssertStatusOK(tSC, "HeaderWhere succeeds with no filters")
    Do $$$AssertEquals(tWhere, "", "No clause")
    Do $$$AssertEquals(tParams, 0, "No parameters")
    Set tEmpty = {}
    Do tEmpty.%Set("item", "")
    Do tEmpty.%Set("statusCode", "")
    Do tEmpty.%Set("errorOnly", 0, "boolean")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere(tEmpty, .tWhere2, .tParams2)
    Do $$$AssertEquals(tWhere2, "", "Empty values add no fragment")
    Do $$$AssertEquals(tParams2, 0, "Empty values add no parameter")
}

/// ==================== Section A2: HeaderStatement (Story 39.7) ====================

/// <method>ExecuteMCPv2.REST.MessageSearch.HeaderStatement</method> is the <code>headers</code> action's whole
/// statement: today's text with the index hint right after <code>FROM</code>, the keyset clause when paged, and
/// the order <code>TimeCreated, ID</code>.
Method TestHeaderStatementText()
{
    Set tHint = "%IGNOREINDEX Ens.MessageHeader.Status,Ens.MessageHeader.SourceConfigName,Ens.MessageHeader.TargetConfigName"
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageSearch).#HEADERHINT, tHint, "The hint names the three bitmap indexes in one comma list")
    Set tColumns = "ID, SessionId, Type, Status, IsError, SourceConfigName, TargetConfigName, MessageBodyClassName, MessageBodyId, TimeCreated, TimeProcessed, CorrespondingMessageId"
    Set tWhere = "(SourceConfigName = ? OR TargetConfigName = ?) AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ?"
    Set tPlain = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderStatement(tWhere)
    Do $$$AssertEquals(tPlain, "SELECT TOP ? " _ tColumns _ " FROM " _ tHint _ " Ens.MessageHeader WHERE " _ tWhere _ " ORDER BY TimeCreated, ID", "The plain statement")
    Set tPaged = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderStatement(tWhere, 1)
    Do $$$AssertEquals(tPaged, "SELECT TOP ? " _ tColumns _ " FROM " _ tHint _ " Ens.MessageHeader WHERE " _ tWhere _ " AND (TimeCreated > ? OR (TimeCreated = ? AND ID > ?)) ORDER BY TimeCreated, ID", "The paged statement")
    Do $$$AssertEquals($Length(tPlain, "?") - 1, 6, "Six markers: the page size and HeaderWhere's five")
    Do $$$AssertEquals($Length(tPaged, "?") - 1, 9, "Nine markers with the cursor's three")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageSearch).HeaderStatement(tWhere, 0), tPlain, "An explicit 0 is the plain statement")
}

/// The hint ignores an index by its name, and an unknown name is ignored silently, so a renamed index would make
/// the hint a no-op without any failure. The three names must exist in the compiled dictionary of
/// <class>Ens.MessageHeader</class>.
Method TestHeaderHintIndexesExist()
{
    Set tNames = $ListBuild("Status", "SourceConfigName", "TargetConfigName")
    For tI = 1:1:$ListLength(tNames) {
        Set tName = $List(tNames, tI)
        Do $$$AssertTrue(##class(%Dictionary.CompiledIndex).%ExistsId("Ens.MessageHeader||" _ tName), "Ens.MessageHeader has the index " _ tName)
        Do $$$AssertTrue(##class(ExecuteMCPv2.REST.MessageSearch).#HEADERHINT [ ("Ens.MessageHeader." _ tName), "The hint names " _ tName)
    }
    Do $$$AssertTrue(##class(%Dictionary.CompiledIndex).%ExistsId("Ens.MessageHeader||TimeCreated"), "The index the plan should read exists")
}

/// ==================== Section B: the route's refusals over real HTTP ====================

/// Resolve the local web server port (mirrors MessageResendTest); override via
/// <code>^UnitTestConfig("MessageSearch",...)</code>.
Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("MessageSearch", "Port"))
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

/// POST a JSON body to the search route; returns the HTTP status and the parsed envelope.
Method PostSearch(pBody As %DynamicObject, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Https = 0
        Set tRequest.Username = $Get(^UnitTestConfig("MessageSearch", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("MessageSearch", "Password"), "SYS")
        Set tRequest.Timeout = 60
        Set tRequest.ContentType = "application/json"
        Do tRequest.EntityBody.Write(pBody.%ToJSON())
        Set tSC = tRequest.Post("/api/executemcp/v2/interop/message/search")
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set pEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// A request body that is valid but for what a row changes: <code>headers</code> over one day of 2001,
/// aimed at a namespace that does not exist, so a guard that stopped refusing fails on the namespace
/// switch instead of reading this namespace's headers.
Method ValidBody() As %DynamicObject
{
    Set tBody = {}
    Do tBody.%Set("action", "headers")
    Do tBody.%Set("from", "2001-02-03T00:00:00Z")
    Do tBody.%Set("to", "2001-02-04T00:00:00Z")
    Do tBody.%Set("namespace", "EXECMCPTMP391Z")
    Quit tBody
}

/// POST <var>pBody</var> and assert the refusal: HTTP 200 with an envelope, at least one error whose text
/// contains <var>pToken</var> and, when <var>pHostile</var> is not empty, does not contain it, and an
/// empty result.
Method AssertRefused(pBody As %DynamicObject, pToken As %String, pHostile As %String, pLabel As %String)
{
    Set tSC = ..PostSearch(pBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, pLabel _ ": HTTP round trip and envelope parse")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, pLabel _ ": a refusal is an HTTP 200 envelope")
    Set tErrors = tEnv.%Get("status").%Get("errors")
    Do $$$AssertTrue(tErrors.%Size() >= 1, pLabel _ ": the envelope carries an error")
    If tErrors.%Size() < 1 Quit
    Set tText = tErrors.%Get(0).%Get("error")
    Do $$$AssertTrue(tText [ pToken, pLabel _ ": the error names '" _ pToken _ "' (got: " _ tText _ ")")
    If pHostile '= "" {
        Do $$$AssertTrue(tText '[ pHostile, pLabel _ ": the error does not echo the value sent")
    }
    Set tIter = tEnv.%Get("result").%GetIterator()
    Do $$$AssertTrue('tIter.%GetNext(.tKey, .tValue), pLabel _ ": the result is empty")
}

/// Every direct-REST refusal row: the text names the parameter and never the hostile value.
Method TestHttpValidationRefusals()
{
    Set tHostile = "ZZhostile'--OR 1=1"

    Set tBody = {}
    Do ..AssertRefused(tBody, "action", "", "no action")

    Set tBody = {}
    Do tBody.%Set("action", tHostile)
    Do ..AssertRefused(tBody, "action", tHostile, "unknown action")

    Set tBody = ..ValidBody()
    Do tBody.%Set("action", "bogus")
    Do ..AssertRefused(tBody, "must be one of: headers, body, searchTable", "", "an action that does not exist")

    Set tBody = ..ValidBody()
    Do tBody.%Remove("from")
    Do ..AssertRefused(tBody, "from", "", "no from")

    Set tBody = ..ValidBody()
    Do tBody.%Set("from", tHostile)
    Do ..AssertRefused(tBody, "from", tHostile, "unparseable from")

    Set tBody = ..ValidBody()
    Do tBody.%Set("to", tHostile)
    Do ..AssertRefused(tBody, "to", tHostile, "unparseable to")

    Set tBody = ..ValidBody()
    Do tBody.%Set("from", "2001-02-04T00:00:00Z")
    Do tBody.%Set("to", "2001-02-03T00:00:00Z")
    Do ..AssertRefused(tBody, "earlier", "", "negative window")

    Set tBody = ..ValidBody()
    Do tBody.%Set("to", "2001-02-12T00:00:00Z")
    Do ..AssertRefused(tBody, "7 days", "", "window over 7 days")

    For tLimit = 0, 501 {
        Set tBody = ..ValidBody()
        Do tBody.%Set("limit", tLimit, "number")
        Do ..AssertRefused(tBody, "limit", "", "limit " _ tLimit)
    }
    Set tBody = ..ValidBody()
    Do tBody.%Set("limit", 2.5, "number")
    Do ..AssertRefused(tBody, "limit", "", "limit 2.5")

    Set tBody = ..ValidBody()
    Do tBody.%Set("status", tHostile)
    Do ..AssertRefused(tBody, "status", tHostile, "unknown status")

    Set tBody = ..ValidBody()
    Do tBody.%Set("sessionId", tHostile)
    Do ..AssertRefused(tBody, "sessionId", tHostile, "sessionId that is not an integer")

    Set tBody = ..ValidBody()
    Do tBody.%Set("afterTimeCreated", "2001-02-03 08:00:00.5")
    Do tBody.%Set("afterId", tHostile)
    Do ..AssertRefused(tBody, "afterId", tHostile, "afterId that is not an integer")

    Set tBody = ..ValidBody()
    Do tBody.%Set("afterId", 5, "number")
    Do ..AssertRefused(tBody, "afterId", "", "afterId without afterTimeCreated")

    Set tBody = ..ValidBody()
    Do tBody.%Set("afterTimeCreated", tHostile)
    Do tBody.%Set("afterId", 5, "number")
    Do ..AssertRefused(tBody, "afterTimeCreated", tHostile, "unparseable afterTimeCreated")

    Set tBody = ..ValidBody()
    Do tBody.%Set("item", $Justify("", 129))
    Do ..AssertRefused(tBody, "item", "", "item over 128 characters")

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyClass", $Justify("", 221))
    Do ..AssertRefused(tBody, "bodyClass", "", "bodyClass over 220 characters")

    Set tBody = ..ValidBody()
    Do tBody.%Set("source", 5, "number")
    Do ..AssertRefused(tBody, "source", "", "source that is not a string")

    Set tBody = ..ValidBody()
    Do tBody.%Set("errorOnly", tHostile)
    Do ..AssertRefused(tBody, "errorOnly", tHostile, "errorOnly that is not a boolean")
}

}
