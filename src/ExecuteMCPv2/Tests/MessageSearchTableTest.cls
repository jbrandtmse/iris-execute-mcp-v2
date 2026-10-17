/// Unit tests for the Search Table lookup builders of <class>ExecuteMCPv2.REST.MessageSearch</class>
/// (Story 39.4). Data-free: nothing here reads or writes a message header, a message body or a Search Table
/// entry. The dictionary-driven tests read only the compiled definitions of system classes.
/// <p>Every hostile string carries the marker <code>SYNTHPHI394</code>, so a refusal text that echoed a
/// value would fail the assertion that it does not hold the marker.</p>
Class ExecuteMCPv2.Tests.MessageSearchTableTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// The delimited table of the stock HL7 Search Table, as <method>ExecuteMCPv2.REST.MessageSearch.BodyTable</method>
/// writes it.
Method Table() As %String
{
    Quit """EnsLib_HL7"".""SearchTable"""
}

/// The probe every clause of filter <var>pIndex</var> starts with, for the table <method>Table</method>.
Method Probe(pIndex As %Integer) As %String
{
    Quit "SELECT 1 FROM " _ ..Table() _ " s" _ pIndex _ " WHERE s" _ pIndex _ ".DocId = h.MessageBodyId AND s" _ pIndex _ ".PropId = ?"
}

/// The text of the clause <method>ExecuteMCPv2.REST.MessageSearch.SearchTableClause</method> writes.
Method Clause(pIndex As %Integer, pPropType As %String, pOp As %String) As %String
{
    Quit ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableClause(pIndex, ..Table(), pPropType, pOp)
}

/// The value as the Search Table stores it for a property of type <var>pPropType</var>.
Method Value(pPropType As %String, pValue As %String) As %String
{
    Quit ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableValue(pPropType, pValue)
}

/// Whether <var>pOp</var> may be used on a property of type <var>pPropType</var>.
Method Allowed(pPropType As %String, pOp As %String) As %Boolean
{
    Quit ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableOpAllowed(pPropType, pOp)
}

/// The error text of the status <var>pSC</var> without its leading <code>ERROR #n: </code> prefix, whatever
/// the language of the prefix.
Method Message(pSC As %Status) As %String
{
    Quit $Piece($System.Status.GetErrorText(pSC), ": ", 2, 99)
}

/// JSON written with single quotes for the double quotes, as the dynamic value it describes.
Method Parse(pText As %String) As %RawString
{
    Quit ##class(%DynamicAbstractObject).%FromJSON($Replace(pText, "'", """"))
}

/// <var>pClass</var> is refused by <method>ExecuteMCPv2.REST.MessageSearch.SearchTableClass</method>, naming
/// <code>searchTableClass</code>, with no table and no document class left behind. The text is one fixed
/// text: <var>pFixed</var> takes the first refusal's, and every later refusal must equal it, so no input
/// can appear in it.
Method AssertClassRefused(pClass As %String, ByRef pFixed As %String)
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableClass(pClass, .tTable, .tDocClass)
    Do $$$AssertStatusNotOK(tSC, "'" _ pClass _ "' is refused")
    If $$$ISOK(tSC) Quit
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "'searchTableClass'", "'" _ pClass _ "': the text names searchTableClass (got: " _ tText _ ")")
    If $Get(pFixed) = "" Set pFixed = tText
    Do $$$AssertEquals(tText, pFixed, "'" _ pClass _ "': the text is the same fixed text for every class")
    Do $$$AssertEquals(tTable, "", "'" _ pClass _ "': no table")
    Do $$$AssertEquals(tDocClass, "", "'" _ pClass _ "': no document class")
}

/// Each PropType is stored in the form of the Task 0 probe of Story 39.4, which indexed one message with a
/// literal item per type on IRIS 2026.2 (build 221U) and read back what <class>Ens.VDoc.SearchTableGenerator</class>
/// stored: <code>MiXeD|Pipe</code> is <code>mixed+pipe</code> for a case-insensitive string and
/// <code>MiXeD+Pipe</code> for a case-sensitive one, <code>0007</code> is 7, <code>1.50</code> is 1.5,
/// <code>Yes</code> is 1, and the two date and time types are unchanged.
Method TestSearchTableValue()
{
    Do $$$AssertEquals(..Value("String:CaseInsensitive", "MiXeD|Pipe"), "mixed+pipe", "String:CaseInsensitive")
    Do $$$AssertEquals(..Value("String:CaseSensitive", "MiXeD|Pipe"), "MiXeD+Pipe", "String:CaseSensitive")
    Do $$$AssertEquals(..Value("Integer", "0007"), 7, "Integer")
    Do $$$AssertEquals(..Value("Numeric", "1.50"), 1.5, "Numeric")
    Do $$$AssertEquals(..Value("Boolean", "Yes"), 1, "Boolean")
    Do $$$AssertEquals(..Value("DateTime:ODBC", "2001-02-03 08:00:00"), "2001-02-03 08:00:00", "DateTime:ODBC")
    Do $$$AssertEquals(..Value("DateTime:HL7", "20010203080000"), "20010203080000", "DateTime:HL7")

    Do $$$AssertEquals(..Value("Integer", 12.9), 12, "A JSON number is truncated for an Integer property")
    Do $$$AssertEquals(..Value("Integer", -3.7), -3, "A negative number is truncated toward zero")
    Do $$$AssertEquals(..Value("Numeric", .5), .5, "A JSON number is kept for a Numeric property")
    Do $$$AssertEquals(..Value("Boolean", 1), 1, "A JSON true is 1")
    Do $$$AssertEquals(..Value("Boolean", 0), 0, "A JSON false is 0")
    Do $$$AssertEquals(..Value("Boolean", "TRUE"), 1, "TRUE")
    Do $$$AssertEquals(..Value("Boolean", "On"), 1, "On")
    Do $$$AssertEquals(..Value("Boolean", "no"), 0, "no")
    Do $$$AssertEquals(..Value("String:CaseInsensitive", 12), 12, "A number given to a string property is its text")

    Do $$$AssertEquals(..Value("DateTime:ODBC", "a|b|c"), "a+b+c", "A pipe is stored as a plus in a date and time type")
    Do $$$AssertEquals(..Value("String:CaseInsensitive", "A|B"), "a+b", "A pipe is stored as a plus after the case is folded")
    Do $$$AssertEquals(..Value("", "MiXeD|Pipe"), "MiXeD+Pipe", "A type this method does not know is unchanged apart from the pipe")
    Do $$$AssertEquals(..Value("Nonsense", "AbC"), "AbC", "An unknown type is unchanged")

    Set tHostile = "X' OR 1=1 --SYNTHPHI394"
    Do $$$AssertEquals(..Value("String:CaseInsensitive", tHostile), $ZConvert(tHostile, "L"), "A hostile string is only lower-cased")
    Do $$$AssertEquals(..Value("String:CaseSensitive", tHostile), tHostile, "A hostile string is otherwise unchanged")
}

/// The ten operators on a string or a date and time, and four of them on an integer, a numeric and a
/// boolean; anything else is refused.
Method TestSearchTableOpAllowed()
{
    Set tOps = $ListBuild("eq", "ne", "lt", "le", "gt", "ge", "contains", "startsWith", "isNull", "notNull")
    Set tLimitedOps = $ListBuild("eq", "ne", "isNull", "notNull")
    For tType = "String:CaseInsensitive", "String:CaseSensitive", "DateTime:ODBC", "DateTime:HL7", "", "Integer", "Numeric", "Boolean" {
        Set tLimited = (tType = "Integer") || (tType = "Numeric") || (tType = "Boolean")
        For tI = 1:1:$ListLength(tOps) {
            Set tOp = $List(tOps, tI)
            Set tExpected = $Select(tLimited: ($ListFind(tLimitedOps, tOp) > 0), 1: 1)
            Do $$$AssertEquals(..Allowed(tType, tOp), tExpected, $Select(tType = "": "(default)", 1: tType) _ " " _ tOp)
        }
    }
    For tOp = "EQ", "Eq", "=", "like", "in", "between", "[", "%STARTSWITH", "", " eq", "eq OR 1=1 SYNTHPHI394" {
        Do $$$AssertEquals(..Allowed("String:CaseInsensitive", tOp), 0, "'" _ tOp _ "' is not an operator")
        Do $$$AssertEquals(..Allowed("Integer", tOp), 0, "'" _ tOp _ "' is not an operator for an Integer property")
    }
}

/// The closed clause table: each operator's exact text, with only the markers for the PropId and the value.
Method TestSearchTableClause()
{
    Set tProbe = ..Probe(0)
    Set tEntry = tProbe _ " AND s0.PropValue <> ''"

    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "eq"), "EXISTS (" _ tEntry _ " AND s0.PropValue = ?)", "eq")
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "lt"), "EXISTS (" _ tEntry _ " AND s0.PropValue < ?)", "lt")
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "le"), "EXISTS (" _ tEntry _ " AND s0.PropValue <= ?)", "le")
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "gt"), "EXISTS (" _ tEntry _ " AND s0.PropValue > ?)", "gt")
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "ge"), "EXISTS (" _ tEntry _ " AND s0.PropValue >= ?)", "ge")
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "contains"), "EXISTS (" _ tEntry _ " AND s0.PropValue [ ?)", "contains")
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "startsWith"), "EXISTS (" _ tEntry _ " AND s0.PropValue %STARTSWITH ?)", "startsWith")
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "ne"), "NOT EXISTS (" _ tProbe _ " AND s0.PropValue = ?)", "ne is NOT EXISTS of an equal entry, not an entry that differs")
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "notNull"), "EXISTS (" _ tEntry _ ")", "notNull")
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "isNull"), "NOT EXISTS (" _ tEntry _ ")", "isNull")

    Do $$$AssertEquals(..Clause(0, "String:CaseSensitive", "eq"), "EXISTS (" _ tEntry _ " AND %EXACT(s0.PropValue) = ?)", "A case-sensitive property is compared with %EXACT")
    Do $$$AssertEquals(..Clause(0, "String:CaseSensitive", "ne"), "NOT EXISTS (" _ tProbe _ " AND %EXACT(s0.PropValue) = ?)", "ne with %EXACT")
    Do $$$AssertEquals(..Clause(0, "String:CaseSensitive", "startsWith"), "EXISTS (" _ tEntry _ " AND %EXACT(s0.PropValue) %STARTSWITH ?)", "startsWith with %EXACT")
    Do $$$AssertEquals(..Clause(0, "String:CaseSensitive", "notNull"), "EXISTS (" _ tEntry _ ")", "notNull has no value to compare")
    For tType = "Integer", "Numeric", "Boolean", "DateTime:ODBC", "DateTime:HL7", "" {
        Do $$$AssertEquals(..Clause(0, tType, "eq"), "EXISTS (" _ tEntry _ " AND s0.PropValue = ?)", "eq on " _ tType _ " has no %EXACT")
    }

    Set tProbe2 = ..Probe(2)
    Do $$$AssertEquals(..Clause(2, "String:CaseInsensitive", "eq"), "EXISTS (" _ tProbe2 _ " AND s2.PropValue <> '' AND s2.PropValue = ?)", "The filter's number is the alias")

    For tOp = "eq", "ne", "lt", "le", "gt", "ge", "contains", "startsWith", "isNull", "notNull" {
        Set tClause = ..Clause(0, "String:CaseInsensitive", tOp)
        Do $$$AssertEquals($Length(tClause, "?") - 1, $Select((tOp = "isNull") || (tOp = "notNull"): 1, 1: 2), tOp _ ": the PropId and, for a value operator, the value are the only markers")
        Do $$$AssertTrue(tClause '[ "SYNTHPHI394", tOp _ ": the clause holds no value")
    }

    For tOp = "EQ", "like", "=", "", "eq OR Story393.Side_Bump()=1 SYNTHPHI394", "isnull" {
        Set tClause = ..Clause(0, "String:CaseInsensitive", tOp)
        Do $$$AssertEquals(tClause, "", "'" _ tOp _ "' gives no clause")
    }
    Do $$$AssertEquals(..Clause(0, "String:CaseInsensitive", "' OR 1=1 SYNTHPHI394"), "", "A hostile string gives no clause")
}

/// Over system classes whose definitions are in an Interoperability-enabled namespace such as HSCUSTOM: the
/// extent table and document class come from the class dictionary, and a class that is not a compiled,
/// persistent, concrete Search Table subclass under exactly that name is refused.
Method TestSearchTableClassSystemClasses()
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableClass("EnsLib.HL7.SearchTable", .tTable, .tDocClass)
    Do $$$AssertStatusOK(tSC, "EnsLib.HL7.SearchTable")
    Do $$$AssertEquals(tTable, """EnsLib_HL7"".""SearchTable""", "The schema and table of the dictionary, in double quotes")
    Do $$$AssertEquals(tDocClass, "EnsLib.HL7.Message", "The DOCCLASS parameter")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableClass("EnsLib.XML.SearchTable", .tTable, .tDocClass)
    Do $$$AssertStatusOK(tSC, "EnsLib.XML.SearchTable")
    Do $$$AssertEquals(tTable, """EnsLib_XML"".""SearchTable""", "The XML Search Table's own extent root")
    Do $$$AssertEquals(tDocClass, "Ens.StreamContainer", "DOCCLASS is inherited from Ens.VDoc.XMLSearchTable")

    Set tFixed = ""
    For tClass = "Ens.VDoc.SearchTable", "Ens.VDoc.XMLSearchTable", "Ens.CustomSearchTable", "EnsLib.HL7.Message", "No.Such.Story394Class", "enslib.hl7.searchtable", "ENSLIB.HL7.SEARCHTABLE", "EnsLib.HL7.SearchTable ", "EnsLib.HL7", "No.SYNTHPHI394" {
        Do ..AssertClassRefused(tClass, .tFixed)
    }
    Do $$$AssertTrue(tFixed '[ "SYNTHPHI394", "The fixed text holds no marker")
    Do $$$AssertTrue(tFixed [ "exact, case-sensitive name", "The text says the name is exact")

    Set tClass = "ExecuteMCPv2.REST.MessageSearch"
    Do $$$AssertEquals($ClassMethod(tClass, "BodyClassExtends", "EnsLib.HL7.Message", "EnsLib.HL7.Message"), 1, "A class is its own document class")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyClassExtends", "EnsLib.HL7.Message", "EnsLib.EDI.Segmented"), 1, "A subclass extends its superclass")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyClassExtends", "EnsLib.EDI.Segmented", "EnsLib.HL7.Message"), 0, "A superclass does not extend its subclass")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyClassExtends", "Ens.StringRequest", "EnsLib.HL7.Message"), 0, "An unrelated class does not extend it")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyClassExtends", "enslib.hl7.message", "EnsLib.HL7.Message"), 0, "A case variant is another name")
    Do $$$AssertEquals($ClassMethod(tClass, "BodyClassExtends", "No.Such.Story394Class", "EnsLib.HL7.Message"), 0, "A class that does not exist extends nothing")
}

/// The searchTable statement is the header scan with no joined table; the existing texts are what Story 39.3
/// shipped, and the new texts name their action or parameter.
Method TestSearchTableStatementText()
{
    Set tWindow = {}
    Do tWindow.%Set("fromNorm", "2001-02-03 07:00:00")
    Do tWindow.%Set("toNorm", "2001-02-03 09:00:00")
    Do tWindow.%Set("bodyClass", "EnsLib.HL7.Message")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).HeaderWhere(tWindow, .tHeaderWhere, .tHeaderParams, "h")
    Do $$$AssertStatusOK(tSC, "HeaderWhere")
    Set tClause = ..Clause(0, "String:CaseInsensitive", "eq")

    Set tSQL = ##class(ExecuteMCPv2.REST.MessageSearch).BodyStatement("", tHeaderWhere, tClause)
    Do $$$AssertEquals($Extract(tSQL, 1, 31), "SELECT TOP ? h.ID, h.SessionId,", "The select list starts with the header columns")
    Do $$$AssertTrue(tSQL [ " FROM %INORDER Ens.MessageHeader h WHERE ", "The headers are read first, in window order, with no joined table")
    Do $$$AssertTrue(tSQL '[ "Ens.MessageHeader h,", "No second table follows the header table")
    Do $$$AssertTrue(tSQL '[ " b ", "No body alias")
    Do $$$AssertTrue($Piece(tSQL, " FROM ", 1) '[ "b.", "Nothing of the body is selected")
    Do $$$AssertTrue($Piece(tSQL, " FROM ", 1) '[ "s0", "Nothing of the Search Table is selected")
    Do $$$AssertTrue($Piece(tSQL, " FROM ", 1) '[ "PropValue", "No Search Table value is selected")
    Do $$$AssertEquals(tSQL, "SELECT TOP ? h.ID, h.SessionId, h.Type, h.Status, h.IsError, h.SourceConfigName, h.TargetConfigName, h.MessageBodyClassName, h.MessageBodyId, h.TimeCreated, h.TimeProcessed, h.CorrespondingMessageId FROM %INORDER Ens.MessageHeader h WHERE " _ tHeaderWhere _ " AND " _ tClause _ " ORDER BY h.TimeCreated, h.ID", "The whole statement is fixed text, HeaderWhere's clause and the Search Table clauses")
    Do $$$AssertEquals($Length(tSQL, "?") - 1, 6, "Six markers: the page size, two window bounds, the document class, the PropId and the value")
    Set tPaged = ##class(ExecuteMCPv2.REST.MessageSearch).BodyStatement("", tHeaderWhere, tClause, 1)
    Do $$$AssertEquals(tPaged, $Piece(tSQL, " ORDER BY", 1) _ " AND (h.TimeCreated > ? OR (h.TimeCreated = ? AND h.ID > ?)) ORDER BY h.TimeCreated, h.ID", "The keyset clause follows the filters")

    Set tTable = """Ens"".""StringRequest"""
    Set tBodyWhere = "b.""StringValue"" = ?"
    Set tJoined = ##class(ExecuteMCPv2.REST.MessageSearch).BodyStatement(tTable, "h.TimeCreated >= ?", tBodyWhere)
    Do $$$AssertEquals(tJoined, "SELECT TOP ? h.ID, h.SessionId, h.Type, h.Status, h.IsError, h.SourceConfigName, h.TargetConfigName, h.MessageBodyClassName, h.MessageBodyId, h.TimeCreated, h.TimeProcessed, h.CorrespondingMessageId FROM %INORDER Ens.MessageHeader h, ""Ens"".""StringRequest"" b WHERE h.MessageBodyId = b.%ID AND h.TimeCreated >= ? AND b.""StringValue"" = ? ORDER BY h.TimeCreated, h.ID", "With a body table the statement is what Story 39.3 shipped")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyFilterShape("")
    Do $$$AssertEquals(..Message(tSC), "Parameter 'filters' is required for the body action: a list of 1 to 10 filters", "The default names the body action")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyFilterShape("", "searchTable")
    Do $$$AssertEquals(..Message(tSC), "Parameter 'filters' is required for the searchTable action: a list of 1 to 10 filters", "The searchTable text names its action")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyFilterShape("x", "searchTable")
    Do $$$AssertEquals(..Message(tSC), "Parameter 'filters' must be an array of 1 to 10 filters", "The other filters texts do not name an action")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyTable("No.Such.Story394Class", .tNone)
    Do $$$AssertEquals(..Message(tSC), "Parameter 'bodyClass' must name a compiled persistent class with an SQL table in this namespace", "The default names bodyClass")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).BodyTable("No.Such.Story394Class", .tNone, "searchTableClass")
    Do $$$AssertEquals(..Message(tSC), "Parameter 'searchTableClass' must name a compiled persistent class with an SQL table in this namespace", "The Search Table text names searchTableClass")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableFilterWhere("EnsLib.HL7.SearchTable", ..Table(), ..Parse("[{'property':'NoSuchStory394Property','op':'eq','value':'SYNTHPHI394'}]"), .tWhere, .tParams)
    Do $$$AssertStatusNotOK(tSC, "A property that is none of the class's is refused")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "'filters[0].property'", "The refusal names filters[0].property (got: " _ tText _ ")")
    Do $$$AssertTrue(tText '[ "SYNTHPHI394", "The refusal does not echo the value")
    Do $$$AssertTrue(tText '[ "NoSuchStory394Property", "The refusal does not echo the property")
    Do $$$AssertEquals(tWhere, "", "No clause is left behind")
    Do $$$AssertEquals(tParams, 0, "No parameter is left behind")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableFilterWhere("EnsLib.HL7.SearchTable", ..Table(), ..Parse("[{'property':'PatientID','op':'like','value':'SYNTHPHI394'}]"), .tWhere, .tParams)
    Do $$$AssertStatusNotOK(tSC, "An operator outside the closed list is refused")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "'filters[0].op'", "The refusal names filters[0].op")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) '[ "SYNTHPHI394", "The refusal does not echo the value")

    Set tLong = $Translate($Justify("", 257), " ", "x")
    Set tAtLimit = $Translate($Justify("", 256), " ", "x")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableShape(..Parse("[{'property':'PatientID','op':'eq','value':'" _ tAtLimit _ "'}]"))
    Do $$$AssertStatusOK(tSC, "A value of 256 characters is accepted")
    For tOp = "eq", "ne", "lt", "le", "gt", "ge", "contains", "startsWith" {
        Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableShape(..Parse("[{'property':'PatientID','op':'" _ tOp _ "','value':'" _ tLong _ "'}]"))
        Do $$$AssertEquals(..Message(tSC), "Parameter 'filters[0].value' is longer than the 256 characters a Search Table stores", tOp _ ": a value of 257 characters is refused naming filters[0].value")
    }
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableShape(..Parse("[{'property':'PatientID','op':'notNull'},{'property':'PatientID','op':'eq','value':'" _ tLong _ "'}]"))
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "'filters[1].value'", "The refusal counts from 0 and names the second filter")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableShape(..Parse("[{'property':'PatientID','op':'like','value':'x'}]"))
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "'filters[0].op'", "The shape rules of the body action still apply")
    Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).SearchTableFilterWhere("EnsLib.HL7.SearchTable", ..Table(), ..Parse("[{'property':'PatientID','op':'eq','value':'" _ tLong _ "'}]"), .tWhere, .tParams)
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "'filters[0].value'", "SearchTableFilterWhere applies the same rule")

    Kill tNames
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageSearch).PropertyNames(.tNames), ": the class has no configured properties", "No names")
    For tI = 1:1:50 {
        Set tNames("N" _ $Translate($Justify(tI, 3), " ", "0")) = ""
    }
    Set tText = ##class(ExecuteMCPv2.REST.MessageSearch).PropertyNames(.tNames)
    Do $$$AssertTrue($Find(tText, ". Use one of: N001, N002, N003") = 31, "The names are listed in order, after the fixed lead (got: " _ tText _ ")")
    Do $$$AssertTrue(tText [ "N050", "Fifty names are all listed")
    Do $$$AssertTrue(tText '[ " more", "Fifty names have no remainder")
    Set tNames("N051") = ""
    Set tText = ##class(ExecuteMCPv2.REST.MessageSearch).PropertyNames(.tNames)
    Do $$$AssertTrue(tText '[ "N051", "The fifty-first name is cut")
    Do $$$AssertTrue(tText [ "N050 and 1 more", "The remainder is counted (got: " _ tText _ ")")
}

}
