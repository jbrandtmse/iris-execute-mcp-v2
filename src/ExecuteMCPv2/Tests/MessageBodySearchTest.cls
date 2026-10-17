/// Unit tests for the body-search statement builders of <class>ExecuteMCPv2.REST.MessageSearch</class>
/// (Story 39.3). Data-free: nothing here reads or writes a message header or a message body. The
/// dictionary-driven tests read only the compiled definitions of system classes.
/// <p>Every hostile string carries the marker <code>SYNTHPHI393</code>, so a refusal text that echoed a
/// value would fail the assertion that it does not hold the marker.</p>
Class ExecuteMCPv2.Tests.MessageBodySearchTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// A filter object holding every key, so every header fragment appears.
Method EveryFilter() As %DynamicObject
{
    Set tFilters = {}
    Do tFilters.%Set("item", "i")
    Do tFilters.%Set("source", "s")
    Do tFilters.%Set("target", "t")
    Do tFilters.%Set("statusCode", 8)
    Do tFilters.%Set("fromNorm", "2001-02-03 06:00:00")
    Do tFilters.%Set("toNorm", "2001-02-03 18:00:00")
    Do tFilters.%Set("sessionId", 200)
    Do tFilters.%Set("bodyClass", "B.C")
    Do tFilters.%Set("errorOnly", 1, "boolean")
    Quit tFilters
}

/// JSON written with single quotes for the double quotes, as the dynamic value it describes. The empty
/// text is the absent value, <code>""</code>.
Method Parse(pText As %String) As %RawString
{
    If pText = "" Quit ""
    Quit ##class(%DynamicAbstractObject).%FromJSON($Replace(pText, "'", """"))
}

/// A string of <var>pLength</var> letters x.
Method Letters(pLength As %Integer) As %String
{
    Quit $Translate($Justify("", pLength), " ", "x")
}

/// <var>pFilters</var> is refused by <method>ExecuteMCPv2.REST.MessageSearch.BodyFilterShape</method> with a
/// text that names <var>pToken</var> as a parameter and does not echo the marker.
Method AssertShapeRefused(pFilters As %RawString, pToken As %String, pLabel As %String)
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyFilterShape(pFilters)
    Do $$$AssertStatusNotOK(tSC, pLabel _ ": refused")
    If $$$ISOK(tSC) Quit
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ ("'" _ pToken _ "'"), pLabel _ ": names " _ pToken _ " (got: " _ tText _ ")")
    Do $$$AssertTrue(tText '[ "SYNTHPHI393", pLabel _ ": does not echo the value")
}

/// <var>pFilters</var> has an acceptable shape.
Method AssertShapeAccepted(pFilters As %RawString, pLabel As %String)
{
    Do $$$AssertStatusOK(##class(ExecuteMCPv2.REST.MessageSearch).BodyFilterShape(pFilters), pLabel _ ": accepted")
}

/// Run <method>ExecuteMCPv2.REST.MessageSearch.BodyFilterWhere</method> for <var>pClass</var> and the
/// single-quoted JSON filters <var>pJson</var>, with alias <code>b</code>.
Method Where(pClass As %String, pJson As %String, Output pWhere As %String, Output pParams) As %Status
{
    Quit ##class(ExecuteMCPv2.REST.MessageSearch).BodyFilterWhere(pClass, ..Parse(pJson), "b", .pWhere, .pParams)
}

/// <var>pJson</var> is refused by <method>ExecuteMCPv2.REST.MessageSearch.BodyFilterWhere</method> for
/// <var>pClass</var>, naming <var>pToken</var>, with no clause and no parameters left behind.
Method AssertWhereRefused(pClass As %String, pJson As %String, pToken As %String, pLabel As %String)
{
    Set tSC = ..Where(pClass, pJson, .tWhere, .tParams)
    Do $$$AssertStatusNotOK(tSC, pLabel _ ": refused")
    If $$$ISOK(tSC) Quit
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ ("'" _ pToken _ "'"), pLabel _ ": names " _ pToken _ " (got: " _ tText _ ")")
    Do $$$AssertTrue(tText '[ "SYNTHPHI393", pLabel _ ": does not echo the value")
    Do $$$AssertEquals(tWhere, "", pLabel _ ": no clause")
    Do $$$AssertEquals(tParams, 0, pLabel _ ": no parameters")
}

/// With an alias every header column is written <code>alias.column</code>, and without one the text is
/// what Story 39.1 shipped. The select list is the one <parameter>COLUMNS</parameter> list, aliased.
Method TestHeaderWhereAlias()
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere(..EveryFilter(), .tAliased, .tAliasedParams, "h")
    Do $$$AssertStatusOK(tSC, "HeaderWhere with an alias succeeds")
    Set tExpected = "(h.SourceConfigName = ? OR h.TargetConfigName = ?) AND h.SourceConfigName = ? AND h.TargetConfigName = ? AND h.Status = ? AND h.TimeCreated >= ? AND h.TimeCreated <= ? AND h.SessionId = ? AND h.MessageBodyClassName = ? AND h.IsError = 1"
    Do $$$AssertEquals(tAliased, tExpected, "Every column carries the alias")
    Do $$$AssertEquals(tAliasedParams, 9, "The aliased clause has the same nine parameters")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere(..EveryFilter(), .tPlain, .tPlainParams)
    Do $$$AssertStatusOK(tSC, "HeaderWhere with no alias succeeds")
    Set tShipped = "(SourceConfigName = ? OR TargetConfigName = ?) AND SourceConfigName = ? AND TargetConfigName = ? AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ? AND SessionId = ? AND MessageBodyClassName = ? AND IsError = 1"
    Do $$$AssertEquals(tPlain, tShipped, "With no alias the text is exactly the one Story 39.1 shipped")
    Do $$$AssertEquals(tPlainParams, 9, "The plain clause has nine parameters")
    For tI = 1:1:9 {
        Do $$$AssertEquals(tAliasedParams(tI), tPlainParams(tI), "Parameter " _ tI _ " is the same with and without the alias")
    }

    Set tColumns = ##class(ExecuteMCPv2.REST.MessageSearch).AliasedColumns("h")
    Do $$$AssertEquals($Length(tColumns, ","), $Length(##class(ExecuteMCPv2.REST.MessageSearch).#COLUMNS, ","), "One aliased column for each column of COLUMNS")
    Do $$$AssertTrue($Piece(tColumns, ", ", 1) = "h.ID", "The select list starts with h.ID")
    For tI = 1:1:$Length(tColumns, ", ") {
        Do $$$AssertTrue($Extract($Piece(tColumns, ", ", tI), 1, 2) = "h.", "Column " _ tI _ " of the select list is aliased")
    }
    Do $$$AssertTrue(tColumns '[ "ErrorStatus", "The select list has no ErrorStatus")
    Do $$$AssertTrue(tColumns '[ "Description", "The select list has no Description")
}

/// <method>ExecuteMCPv2.REST.MessageSearch.BodyOpSql</method> is a closed map: each operator gives its
/// fragment, and anything else, however close, gives <code>""</code> and none of its own text.
Method TestBodyOpSqlClosedMap()
{
    Set tClass = "ExecuteMCPv2.REST.MessageSearch"
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "eq"), "= ?", "eq")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "ne"), "<> ?", "ne")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "lt"), "< ?", "lt")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "le"), "<= ?", "le")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "gt"), "> ?", "gt")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "ge"), ">= ?", "ge")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "contains"), "[ ?", "contains")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "startsWith"), "%STARTSWITH ?", "startsWith")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "isNull"), "IS NULL", "isNull")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyOpSql", "notNull"), "IS NOT NULL", "notNull")
    For tOp = "EQ", "Eq", "like", "=", "<>", "in", "between", "", " eq", "eq ", "startswith", "eq' OR 1=1 SYNTHPHI393", "%STARTSWITH", "[", 0, 1 {
        Set tFragment = $ClassMethod(tClass, "BodyOpSql", tOp)
        Do $$$AssertEquals(tFragment, "", "'" _ tOp _ "' is not an operator")
    }
}

/// Every shape rule of the body filters is decided without a namespace or a dictionary, and its text names
/// the parameter path, counted from 0, and never a value.
Method TestBodyFilterShapeRefusals()
{
    Set tOkFilter = "{'property':'Code','op':'eq','value':'x'}"
    Do ..AssertShapeAccepted(..Parse("[" _ tOkFilter _ "]"), "one equality filter")
    Do ..AssertShapeAccepted(..Parse("[{'property':'Code','op':'eq','value':true}]"), "a boolean value")
    Do ..AssertShapeAccepted(..Parse("[{'property':'Code','op':'lt','value':12.5}]"), "a number value")
    Do ..AssertShapeAccepted(..Parse("[{'property':'Code','op':'isNull'}]"), "isNull with no value")
    Do ..AssertShapeAccepted(..Parse("[{'property':'Code','op':'notNull','value':null}]"), "notNull with a null value")
    Do ..AssertShapeAccepted(..Parse("[{'property':'A" _ ..Letters(127) _ "','op':'eq','value':'" _ ..Letters(1024) _ "'}]"), "a 128-character property and a 1024-character value")
    Set tTen = tOkFilter
    For tI = 2:1:10 { Set tTen = tTen _ "," _ tOkFilter }
    Do ..AssertShapeAccepted(..Parse("[" _ tTen _ "]"), "ten filters")

    Do ..AssertShapeRefused("", "filters", "no filters")
    Do ..AssertShapeRefused("SYNTHPHI393", "filters", "filters is a string")
    Do ..AssertShapeRefused(..Parse("{'a':'SYNTHPHI393'}"), "filters", "filters is an object")
    Do ..AssertShapeRefused(..Parse("[]"), "filters", "filters is empty")
    Do ..AssertShapeRefused(..Parse("[" _ tTen _ "," _ tOkFilter _ "]"), "filters", "eleven filters")
    Do ..AssertShapeRefused(..Parse("[5]"), "filters[0]", "a filter that is a number")
    Do ..AssertShapeRefused(..Parse("['SYNTHPHI393']"), "filters[0]", "a filter that is a string")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'eq','value':'x','SYNTHPHI393':1}]"), "filters[0]", "an extra key")

    Do ..AssertShapeRefused(..Parse("[{'op':'eq','value':'SYNTHPHI393'}]"), "filters[0].property", "property missing")
    Do ..AssertShapeRefused(..Parse("[{'property':5,'op':'eq','value':'x'}]"), "filters[0].property", "property is a number")
    Do ..AssertShapeRefused(..Parse("[{'property':'Co de SYNTHPHI393','op':'eq','value':'x'}]"), "filters[0].property", "property with a space")
    Do ..AssertShapeRefused(..Parse("[{'property':'a\""b SYNTHPHI393','op':'eq','value':'x'}]"), "filters[0].property", "property with a double quote")
    Do ..AssertShapeRefused(..Parse("[{'property':'SYNTHPHI393" _ ..Letters(118) _ "','op':'eq','value':'x'}]"), "filters[0].property", "property of 129 characters")
    Do ..AssertShapeRefused(..Parse("[{'property':'1SYNTHPHI393','op':'eq','value':'x'}]"), "filters[0].property", "property starting with a digit")
    Do ..AssertShapeRefused(..Parse("[{'property':'Addr.Street SYNTHPHI393','op':'eq','value':'x'}]"), "filters[0].property", "a dotted path")
    Do ..AssertShapeRefused(..Parse("[{'property':'','op':'eq','value':'x'}]"), "filters[0].property", "property empty")

    Do ..AssertShapeRefused(..Parse("[{'property':'Code','value':'SYNTHPHI393'}]"), "filters[0].op", "op missing")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'EQ SYNTHPHI393','value':'x'}]"), "filters[0].op", "op in capitals")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'like','value':'SYNTHPHI393%'}]"), "filters[0].op", "op like")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'=','value':'SYNTHPHI393'}]"), "filters[0].op", "op =")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':5,'value':'x'}]"), "filters[0].op", "op is a number")

    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'eq'}]"), "filters[0].value", "eq with no value")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'eq','value':null}]"), "filters[0].value", "eq with a null value")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'isNull','value':'SYNTHPHI393'}]"), "filters[0].value", "isNull with a value")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'notNull','value':0}]"), "filters[0].value", "notNull with a value")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'eq','value':''}]"), "filters[0].value", "an empty value")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'eq','value':'SYNTHPHI393" _ ..Letters(1014) _ "'}]"), "filters[0].value", "a value of 1025 characters")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'eq','value':{'a':'SYNTHPHI393'}}]"), "filters[0].value", "an object value")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'eq','value':['SYNTHPHI393']}]"), "filters[0].value", "an array value")
    Do ..AssertShapeRefused(..Parse("[{'property':'Code','op':'eq','value':1e400}]"), "filters[0].value", "a number IRIS cannot hold")

    Do ..AssertShapeRefused(..Parse("[" _ tOkFilter _ "," _ tOkFilter _ ",{'property':'Code','op':'SYNTHPHI393','value':'x'}]"), "filters[2].op", "the third filter has a bad op")
}

/// The property-kind table and the statement text, over system classes whose definitions are in an
/// Interoperability-enabled namespace such as HSCUSTOM (the story's live gate covers a custom body class).
/// A value is only ever a parameter; the column is written in double quotes from the dictionary.
Method TestBodyFilterWhereSystemClasses()
{
    Set tHostile = "x' OR 1=1 --SYNTHPHI393"
    Set tFilters = [{"property":"StringValue","op":"eq"}]
    Do tFilters.%Get(0).%Set("value", tHostile)
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyFilterWhere("Ens.StringRequest", tFilters, "b", .tWhere, .tParams)
    Do $$$AssertStatusOK(tSC, "StringValue eq")
    Do $$$AssertEquals(tWhere, "b.""StringValue"" = ?", "A delimited column, the fragment and a marker")
    Do $$$AssertEquals(tParams, 1, "One parameter")
    Do $$$AssertEquals(tParams(1), tHostile, "The hostile value is the parameter")
    Do $$$AssertTrue(tWhere '[ "SYNTHPHI393", "The clause holds no value")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyFilterWhere("Ens.StringRequest", ..Parse("[{'property':'StringValue','op':'ne','value':'a'}]"), "", .tPlain, .tPlainParams)
    Do $$$AssertStatusOK(tSC, "No alias")
    Do $$$AssertEquals(tPlain, """StringValue"" <> ?", "With no alias the column has no prefix")

    Set tSC = ..Where("EnsLib.HL7.Message", "[{'property':'RawContent','op':'contains','value':'SYNTHPHI393-MRN'}]", .tWhere, .tParams)
    Do $$$AssertStatusOK(tSC, "RawContent contains (SQL-computed, calculated and transient)")
    Do $$$AssertEquals(tWhere, "b.""RawContent"" [ ?", "The contains operator")
    Do $$$AssertEquals(tParams(1), "SYNTHPHI393-MRN", "The search text is the parameter")

    Set tSC = ..Where("Ens.StringRequest", "[{'property':'StringValue','op':'startsWith','value':'a'},{'property':'StringValue','op':'ge','value':12.5},{'property':'StringValue','op':'eq','value':true},{'property':'StringValue','op':'eq','value':false},{'property':'StringValue','op':'notNull'}]", .tWhere, .tParams)
    Do $$$AssertStatusOK(tSC, "Five filters")
    Set tExpected = "b.""StringValue"" %STARTSWITH ? AND b.""StringValue"" >= ? AND b.""StringValue"" = ? AND b.""StringValue"" = ? AND b.""StringValue"" IS NOT NULL"
    Do $$$AssertEquals(tWhere, tExpected, "The filters are joined with AND in order")
    Do $$$AssertEquals(tParams, 4, "notNull adds no parameter")
    Do $$$AssertEquals(tParams(2), 12.5, "A number is bound as a number")
    Do $$$AssertEquals(tParams(3), 1, "true is bound as 1")
    Do $$$AssertEquals(tParams(4), 0, "false is bound as 0")

    Set tSC = ..Where("Ens.StreamContainer", "[{'property':'StreamGC','op':'isNull'}]", .tWhere, .tParams)
    Do $$$AssertStatusOK(tSC, "A stream accepts isNull")
    Do $$$AssertEquals(tWhere, "b.""StreamGC"" IS NULL", "isNull on a stream")
    Do $$$AssertEquals(tParams, 0, "isNull binds nothing")
    Set tSC = ..Where("Ens.StreamContainer", "[{'property':'StreamGC','op':'notNull'}]", .tWhere, .tParams)
    Do $$$AssertEquals(tWhere, "b.""StreamGC"" IS NOT NULL", "notNull on a stream")
    Do ..AssertWhereRefused("Ens.StreamContainer", "[{'property':'StreamGC','op':'eq','value':'SYNTHPHI393'}]", "filters[0].op", "eq on a stream")
    Do ..AssertWhereRefused("Ens.StreamContainer", "[{'property':'StreamGC','op':'contains','value':'SYNTHPHI393'}]", "filters[0].op", "contains on a stream")
    Do ..AssertWhereRefused("Ens.StreamContainer", "[{'property':'Stream','op':'isNull'}]", "filters[0].property", "a calculated, transient stream")

    Do ..AssertWhereRefused("EnsLib.HL7.Message", "[{'property':'UserValues','op':'isNull'}]", "filters[0].property", "an array collection")
    Do ..AssertWhereRefused("EnsLib.HL7.Message", "[{'property':'Separators','op':'eq','value':'SYNTHPHI393'}]", "filters[0].property", "a transient property")
    Do ..AssertWhereRefused("Ens.Rule.Rule", "[{'property':'RuleSet','op':'isNull'}]", "filters[0].property", "a parent relationship")
    Do ..AssertWhereRefused("Ens.StringRequest", "[{'property':'stringvalue','op':'eq','value':'SYNTHPHI393'}]", "filters[0].property", "a case variant of a property")
    Do ..AssertWhereRefused("Ens.StringRequest", "[{'property':'NoSuchProperty','op':'eq','value':'SYNTHPHI393'}]", "filters[0].property", "a property that does not exist")
    Do ..AssertWhereRefused("Ens.StringRequest", "[{'property':'StringValue','op':'eq','value':'a'},{'property':'NoSuch','op':'eq','value':'SYNTHPHI393'}]", "filters[1].property", "the second filter is the bad one")
    Do ..AssertWhereRefused("Ens.StringRequest", "[{'property':'StringValue','op':'like','value':'SYNTHPHI393'}]", "filters[0].op", "an operator outside the map")
}

/// <method>ExecuteMCPv2.REST.MessageSearch.BodyTable</method> takes the table from the class dictionary, and
/// refuses a class that is not a compiled persistent one under exactly that name.
/// <method>ExecuteMCPv2.REST.MessageSearch.BodyStatement</method> then builds the whole statement from fixed
/// text, that table and the two clauses, with nothing of the body in its select list.
Method TestBodyTableSystemClasses()
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyTable("EnsLib.HL7.Message", .tTable)
    Do $$$AssertStatusOK(tSC, "EnsLib.HL7.Message")
    Do $$$AssertEquals(tTable, """EnsLib_HL7"".""Message""", "The schema and table of the dictionary, in double quotes")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyTable("Ens.StringRequest", .tTable)
    Do $$$AssertStatusOK(tSC, "Ens.StringRequest")
    Do $$$AssertEquals(tTable, """Ens"".""StringRequest""", "Ens.StringRequest")

    Set tWindow = {}
    Do tWindow.%Set("fromNorm", "2001-02-03 07:00:00")
    Do tWindow.%Set("toNorm", "2001-02-03 09:00:00")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere(tWindow, .tHeaderWhere, .tHeaderParams, "h")
    Set tBodyWhere = "b.""StringValue"" = ?"
    Set tSelect = "SELECT TOP ? h.ID, h.SessionId, h.Type, h.Status, h.IsError, h.SourceConfigName, h.TargetConfigName, h.MessageBodyClassName, h.MessageBodyId, h.TimeCreated, h.TimeProcessed, h.CorrespondingMessageId"
    Set tHint = "%IGNOREINDEX Ens.MessageHeader.Status,Ens.MessageHeader.SourceConfigName,Ens.MessageHeader.TargetConfigName"
    Set tFrom = " FROM %INORDER " _ tHint _ " Ens.MessageHeader h, ""Ens"".""StringRequest"" b WHERE h.MessageBodyId = b.%ID AND h.TimeCreated >= ? AND h.TimeCreated <= ? AND b.""StringValue"" = ?"
    Set tSQL = ##class(ExecuteMCPv2.REST.MessageSearch).BodyStatement(tTable, tHeaderWhere, tBodyWhere)
    Do $$$AssertEquals(tSQL, tSelect _ tFrom _ " ORDER BY h.TimeCreated, h.ID", "The statement is fixed text, the dictionary's table and the two clauses")
    Do $$$AssertTrue($Piece(tSQL, " FROM ", 1) '[ "b.", "Nothing of the body is selected")
    Do $$$AssertEquals($Length(tSQL, "?") - 1, 4, "Four markers: the page size, the two window bounds, the body value")
    Set tPaged = ##class(ExecuteMCPv2.REST.MessageSearch).BodyStatement(tTable, tHeaderWhere, tBodyWhere, 1)
    Do $$$AssertEquals(tPaged, tSelect _ tFrom _ " AND (h.TimeCreated > ? OR (h.TimeCreated = ? AND h.ID > ?)) ORDER BY h.TimeCreated, h.ID", "The keyset clause follows the filters")
    Do $$$AssertEquals($Length(tPaged, "?") - 1, 7, "Seven markers with the cursor's three")

    For tClass ="%Stream.GlobalCharacter", "No.Such.Story393Class", "ens.stringrequest", "ENS.STRINGREQUEST", "Ens.StringRequest ", "%Library.SerialObject", "Ens" {
        Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyTable(tClass, .tRefusedTable)
        Do $$$AssertStatusNotOK(tSC, "'" _ tClass _ "' is refused")
        If $$$ISOK(tSC) Continue
        Set tText = $System.Status.GetErrorText(tSC)
        Do $$$AssertTrue(tText [ "'bodyClass'", "'" _ tClass _ "': the text names bodyClass (got: " _ tText _ ")")
        Do $$$AssertTrue(tText '[ tClass, "'" _ tClass _ "': the text does not echo the class name")
        Do $$$AssertEquals(tRefusedTable, "", "'" _ tClass _ "': no table")
    }
}

}
