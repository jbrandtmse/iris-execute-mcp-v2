/// REST handler for searching Interoperability messages (Stories 39.1, 39.3 and 39.4).
/// <p><method>MessageSearch</method> is a read-only route, <code>POST /interop/message/search</code>.
/// Its <code>action</code> body field selects the operation: <code>headers</code>, <code>body</code> and
/// <code>searchTable</code>. All three filter <code>Ens.MessageHeader</code> by a required time window plus
/// optional item, source, target, status, session, body class and error flag, and return header rows (never
/// body data, <code>ErrorStatus</code> or <code>Description</code>) in <code>TimeCreated, ID</code> order,
/// one page at a time, with a keyset cursor taken from the last row of the previous page.</p>
/// <p>The <code>body</code> action also takes a required <code>bodyClass</code> and a list of structured
/// <code>filters</code>, <code>{property, op, value}</code>, and keeps the headers whose body, read by its
/// ID in the table of that class, satisfies every one of them. Nothing a caller sends becomes SQL text:
/// <method>BodyFilterWhere</method> writes a property as its compiled <code>SqlFieldName</code>, in
/// double quotes, <method>BodyOpSql</method> maps an operator from a closed list to a fixed fragment,
/// <method>BodyTable</method> takes the table name from the class dictionary, and every value is a
/// parameter. The shape of the filters is checked by <method>BodyFilterShape</method> before the namespace
/// is switched.</p>
/// <p>The <code>searchTable</code> action takes a required <code>searchTableClass</code>, the exact name of
/// a compiled virtual-document Search Table class, the same <code>filters</code>, and an optional
/// <code>bodyClass</code> that narrows the document class. It keeps the headers of that document class
/// whose body ID has the Search Table entries every filter asks for. A property is resolved by
/// <method>SearchTableFilterWhere</method> to the integer PropId of its <code>Ens.Config.SearchTableProp</code>
/// row and is bound, never written; an operator is written only by <method>SearchTableClause</method> from
/// a closed table; a value is normalized as the Search Table stores it
/// (<method>SearchTableValue</method>) and bound; the table name comes from the class dictionary.</p>
/// <p><method>HeaderWhere</method> is the one place a set of header filters becomes a WHERE clause. It is
/// shared by this handler and by <class>ExecuteMCPv2.REST.MessageResend</class>'s
/// <code>resendFiltered</code>. It owns only that translation: each caller keeps its own required
/// filters, window, caps and its choice between refusing and truncating. It emits fixed column names
/// and <code>?</code> markers only; every caller value travels in the parameter array.</p>
/// <p>The statements run in Logical select mode (<code>%SelectMode=0</code>), so
/// <code>TimeCreated</code>, an <code>Ens.DataType.UTC</code> column, is read and compared as the UTC
/// string it is stored as, whatever select mode the process defaults to.</p>
Class ExecuteMCPv2.REST.MessageSearch Extends ExecuteMCPv2.REST.Base
{

/// The most rows one page returns.
Parameter MAXLIMIT As %Integer = 500;

/// The rows one page returns when the request names no <code>limit</code>.
Parameter DEFAULTLIMIT As %Integer = 100;

/// The longest window, in days, between <code>from</code> and <code>to</code>.
Parameter MAXWINDOWDAYS As %Integer = 7;

/// The most filters one body or Search Table search takes.
Parameter MAXBODYFILTERS As %Integer = 10;

/// The longest string value of one body filter, in characters.
Parameter MAXFILTERVALUE As %Integer = 1024;

/// The longest value of one Search Table filter, in characters: a Search Table stores at most this many
/// characters of a value (<code>PropValue</code> is truncated), so a longer one can never equal a stored
/// value, and an index lookup by one past about 440 characters fails in IRIS with SQLCODE -490.
Parameter MAXSEARCHTABLEVALUE As %Integer = 256;

/// The columns every header row is read from, in the order <method>HeaderRow</method> uses them.
/// <code>ErrorStatus</code> and <code>Description</code> are deliberately absent.
Parameter COLUMNS As %String = "ID, SessionId, Type, Status, IsError, SourceConfigName, TargetConfigName, MessageBodyClassName, MessageBodyId, TimeCreated, TimeProcessed, CorrespondingMessageId";

/// The index hint every header read of a search carries, placed right after <code>FROM</code> (and after
/// <code>%INORDER</code> where the statement has it). It names the three bitmap indexes of
/// <class>Ens.MessageHeader</class> on <code>Status</code>, <code>SourceConfigName</code> and
/// <code>TargetConfigName</code>, so the optimizer reads the <code>TimeCreated</code> index map over the
/// window instead of intersecting history-wide bitmaps. It changes the plan only, never the rows or their
/// order. An index name that does not exist is ignored silently, so a test pins that all three exist.
Parameter HEADERHINT As %String = "%IGNOREINDEX Ens.MessageHeader.Status,Ens.MessageHeader.SourceConfigName,Ens.MessageHeader.TargetConfigName";

/// Translate header filters into a WHERE clause body and its parameters.
/// <p><var>pFilters</var> may hold: <code>item</code> (source OR target), <code>source</code>,
/// <code>target</code>, <code>statusCode</code>, <code>fromNorm</code> (inclusive lower bound),
/// <code>toNorm</code> (inclusive upper bound), <code>sessionId</code>, <code>bodyClass</code> and
/// <code>errorOnly</code>. A key that is absent or empty adds no fragment. The fragments always appear in
/// the order <code>item</code>, <code>source</code>, <code>target</code>, <code>statusCode</code>,
/// <code>fromNorm</code>, <code>toNorm</code>, <code>sessionId</code>, <code>bodyClass</code>,
/// <code>errorOnly</code>, joined with <code>" AND "</code>.</p>
/// <p><var>pAlias</var> is the alias of the header table in the statement the clause joins; with one,
/// every column is written <code>alias.column</code>. With none the text is exactly what it was before
/// the alias existed.</p>
/// <p><var>pWhere</var> is the clause body without the <code>WHERE</code> keyword, or <code>""</code>
/// when no filter is set. <var>pParams</var> is the parameter count, with <code>pParams(i)</code> holding
/// the i-th value in the order of the <code>?</code> markers, so a caller passes it as
/// <code>pParams...</code>. This method never validates a value and never sees a cap.</p>
ClassMethod HeaderWhere(pFilters As %DynamicObject, Output pWhere As %String, Output pParams, pAlias As %String = "") As %Status
{
    Set tSC = $$$OK
    Set pWhere = ""
    Kill pParams
    Set pParams = 0
    Try {
        Set tQ = $Select(pAlias = "": "", 1: pAlias _ ".")
        Set tFragments = ""
        Set tItem = pFilters.%Get("item")
        If tItem '= "" {
            Set tFragments = tFragments _ $ListBuild("(" _ tQ _ "SourceConfigName = ? OR " _ tQ _ "TargetConfigName = ?)")
            Set pParams = pParams + 1, pParams(pParams) = tItem
            Set pParams = pParams + 1, pParams(pParams) = tItem
        }
        Set tSource = pFilters.%Get("source")
        If tSource '= "" {
            Set tFragments = tFragments _ $ListBuild(tQ _ "SourceConfigName = ?")
            Set pParams = pParams + 1, pParams(pParams) = tSource
        }
        Set tTarget = pFilters.%Get("target")
        If tTarget '= "" {
            Set tFragments = tFragments _ $ListBuild(tQ _ "TargetConfigName = ?")
            Set pParams = pParams + 1, pParams(pParams) = tTarget
        }
        Set tStatusCode = pFilters.%Get("statusCode")
        If tStatusCode '= "" {
            Set tFragments = tFragments _ $ListBuild(tQ _ "Status = ?")
            Set pParams = pParams + 1, pParams(pParams) = tStatusCode
        }
        Set tFromNorm = pFilters.%Get("fromNorm")
        If tFromNorm '= "" {
            Set tFragments = tFragments _ $ListBuild(tQ _ "TimeCreated >= ?")
            Set pParams = pParams + 1, pParams(pParams) = tFromNorm
        }
        Set tToNorm = pFilters.%Get("toNorm")
        If tToNorm '= "" {
            Set tFragments = tFragments _ $ListBuild(tQ _ "TimeCreated <= ?")
            Set pParams = pParams + 1, pParams(pParams) = tToNorm
        }
        Set tSessionId = pFilters.%Get("sessionId")
        If tSessionId '= "" {
            Set tFragments = tFragments _ $ListBuild(tQ _ "SessionId = ?")
            Set pParams = pParams + 1, pParams(pParams) = tSessionId
        }
        Set tBodyClass = pFilters.%Get("bodyClass")
        If tBodyClass '= "" {
            Set tFragments = tFragments _ $ListBuild(tQ _ "MessageBodyClassName = ?")
            Set pParams = pParams + 1, pParams(pParams) = tBodyClass
        }
        If +pFilters.%Get("errorOnly") {
            Set tFragments = tFragments _ $ListBuild(tQ _ "IsError = 1")
        }
        For tI = 1:1:$ListLength(tFragments) {
            Set pWhere = pWhere _ $Select(tI > 1: " AND ", 1: "") _ $List(tFragments, tI)
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// The select list of <parameter>COLUMNS</parameter> with every column written <code>pAlias.column</code>,
/// so a statement that joins another table cannot read a column of the wrong table. The result column
/// names stay the bare ones, which is what <method>HeaderRow</method> reads.
ClassMethod AliasedColumns(pAlias As %String) As %String
{
    Set tList = ""
    Set tColumns = ..#COLUMNS
    For tI = 1:1:$Length(tColumns, ",") {
        Set tList = tList _ $Select(tI > 1: ", ", 1: "") _ pAlias _ "." _ $ZStrip($Piece(tColumns, ",", tI), "<>W")
    }
    Quit tList
}

/// The SQL fragment of the body filter operator <var>pOp</var>, written after the quoted column, or
/// <code>""</code> for anything that is not one of the ten operators. This is the only place an operator
/// becomes SQL text, and it never returns any part of its argument. The match is exact: the operators are
/// lower case and <code>EQ</code>, <code>=</code> and <code>like</code> are not operators.
/// <p><code>eq</code>, <code>ne</code>, <code>lt</code>, <code>le</code>, <code>gt</code> and
/// <code>ge</code> compare by the column's collation, so a default string column ignores case;
/// <code>contains</code> is the case-sensitive substring operator; <code>startsWith</code> is
/// <code>%STARTSWITH</code>; <code>isNull</code> and <code>notNull</code> take no value.</p>
ClassMethod BodyOpSql(pOp As %String) As %String
{
    Quit $Case(pOp, "eq": "= ?", "ne": "<> ?", "lt": "< ?", "le": "<= ?", "gt": "> ?", "ge": ">= ?", "contains": "[ ?", "startsWith": "%STARTSWITH ?", "isNull": "IS NULL", "notNull": "IS NOT NULL", : "")
}

/// Check the shape of the body filters <var>pFilters</var> (the request's <code>filters</code> value) and
/// return a refusal status naming the parameter path, <code>filters</code> or
/// <code>filters[i].property</code>, <code>.op</code>, <code>.value</code>, with <code>i</code> counted
/// from 0. No text names a value. It touches no namespace and no dictionary, so a caller runs it before it
/// switches namespace. <var>pAction</var> is the action whose input is checked (<code>body</code> or
/// <code>searchTable</code>); it only names that action in the text of a missing <code>filters</code>.
/// <p>The value must be a non-empty array of at most <parameter>MAXBODYFILTERS</parameter> objects, each
/// holding only <code>property</code>, <code>op</code> and <code>value</code>. A <code>property</code> is
/// 1 to 128 letters and digits starting with a letter. An <code>op</code> is one that
/// <method>BodyOpSql</method> knows. A <code>value</code> is required unless the operator is
/// <code>isNull</code> or <code>notNull</code>, where it must be absent or null; otherwise it is a string of
/// 1 to <parameter>MAXFILTERVALUE</parameter> characters, a finite number or a boolean.</p>
ClassMethod BodyFilterShape(pFilters As %RawString, pAction As %String = "body") As %Status
{
    Set tSC = $$$OK
    Try {
        If '$IsObject(pFilters) {
            If pFilters = "" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'filters' is required for the " _ pAction _ " action: a list of 1 to " _ ..#MAXBODYFILTERS _ " filters")
            }
            Else {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'filters' must be an array of 1 to " _ ..#MAXBODYFILTERS _ " filters")
            }
        }
        ElseIf 'pFilters.%IsA("%Library.DynamicArray") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'filters' must be an array of 1 to " _ ..#MAXBODYFILTERS _ " filters")
        }
        ElseIf (pFilters.%Size() < 1) || (pFilters.%Size() > ..#MAXBODYFILTERS) {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'filters' must hold from 1 to " _ ..#MAXBODYFILTERS _ " filters")
        }
        Else {
            For tI = 0:1:pFilters.%Size() - 1 {
                Set tIndex = tI
                Set tSC = ..FilterShape(pFilters, tI)
                If $$$ISERR(tSC) Quit
            }
        }
    } Catch ex {
        Set tSC = $$$ERROR($$$GeneralError, "Parameter '" _ $Select($Data(tIndex): "filters[" _ tIndex _ "]", 1: "filters") _ "' could not be read")
    }
    Quit tSC
}

/// Check filter number <var>pIndex</var> (from 0) of the array <var>pFilters</var>; see
/// <method>BodyFilterShape</method>.
ClassMethod FilterShape(pFilters As %DynamicArray, pIndex As %Integer) As %Status
{
    Set tPath = "filters[" _ pIndex _ "]"
    If pFilters.%GetTypeOf(pIndex) '= "object" {
        Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ "' must be an object holding property, op and value")
    }
    Set tFilter = pFilters.%Get(pIndex)
    ; Counting the keys that are present avoids iterating, which would also convert every value.
    Set tKnownKeys = tFilter.%IsDefined("property") + tFilter.%IsDefined("op") + tFilter.%IsDefined("value")
    If tFilter.%Size() '= tKnownKeys {
        Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ "' may hold only property, op and value")
    }

    If tFilter.%GetTypeOf("property") '= "string" {
        Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".property' is required and must be a string")
    }
    Set tProperty = tFilter.%Get("property")
    If ($Length(tProperty) > 128) || '$Match(tProperty, "^[A-Za-z][A-Za-z0-9]*$") {
        Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".property' must be a property name of 1 to 128 letters and digits, starting with a letter")
    }

    If tFilter.%GetTypeOf("op") '= "string" {
        Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".op' is required and must be one of: eq, ne, lt, le, gt, ge, contains, startsWith, isNull, notNull")
    }
    Set tOp = tFilter.%Get("op")
    If ..BodyOpSql(tOp) = "" {
        Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".op' must be one of: eq, ne, lt, le, gt, ge, contains, startsWith, isNull, notNull")
    }

    Set tValueType = tFilter.%GetTypeOf("value")
    If (tOp = "isNull") || (tOp = "notNull") {
        If (tValueType '= "unassigned") && (tValueType '= "null") {
            Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".value' must be absent for the isNull and notNull operators")
        }
        Quit $$$OK
    }
    If tValueType = "string" {
        Set tLength = $Length(tFilter.%Get("value"))
        If (tLength < 1) || (tLength > ..#MAXFILTERVALUE) {
            Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".value' must be a string of 1 to " _ ..#MAXFILTERVALUE _ " characters, a number or a boolean")
        }
        Quit $$$OK
    }
    If tValueType = "boolean" Quit $$$OK
    If tValueType = "number" {
        Set tSC = ..ReadFilterNumber(tFilter, .tNumber)
        If $$$ISERR(tSC) {
            Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".value' must be a finite number")
        }
        Quit $$$OK
    }
    Quit $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".value' is required and must be a string of 1 to " _ ..#MAXFILTERVALUE _ " characters, a number or a boolean")
}

/// Read the number <code>value</code> of <var>pFilter</var> into <var>pNumber</var>. Fails, without text,
/// for a number IRIS cannot hold (an exponent beyond its range).
ClassMethod ReadFilterNumber(pFilter As %DynamicObject, Output pNumber As %Numeric) As %Status
{
    Set tSC = $$$OK
    Set pNumber = ""
    Try {
        Set pNumber = pFilter.%Get("value")
    } Catch {
        Set pNumber = ""
        Set tSC = $$$ERROR($$$GeneralError, "Not a finite number")
    }
    Quit tSC
}

/// Resolve the body class <var>pClassName</var> to its SQL table, in <var>pTable</var> as
/// <code>"schema"."table"</code> with both names in double quotes, taken from the class dictionary. The
/// class must be compiled in this namespace, its name must equal <var>pClassName</var> exactly (a case
/// variant is another name), it must be persistent, and its schema and table names must be non-empty and
/// hold no double quote. Otherwise the status names the parameter <var>pParam</var> (<code>bodyClass</code>
/// unless the caller says otherwise), without its value, and <var>pTable</var> is empty.
ClassMethod BodyTable(pClassName As %String, Output pTable As %String, pParam As %String = "bodyClass") As %Status
{
    Set pTable = ""
    Set tFound = 0
    Try {
        Set tClass = ##class(%Dictionary.CompiledClass).%OpenId(pClassName)
        If $IsObject(tClass) && (tClass.Name = pClassName) && (tClass.ClassType = "persistent") {
            Set tSchema = tClass.SqlSchemaName
            Set tTable = tClass.SqlTableName
            If (tSchema '= "") && (tTable '= "") && (tSchema '[ """") && (tTable '[ """") {
                Set pTable = """" _ tSchema _ """.""" _ tTable _ """"
                Set tFound = 1
            }
        }
    } Catch {
        Set tFound = 0
    }
    If tFound Quit $$$OK
    Set pTable = ""
    Quit $$$ERROR($$$GeneralError, "Parameter '" _ pParam _ "' must name a compiled persistent class with an SQL table in this namespace")
}

/// How the property <var>pProperty</var> of the class <var>pClassName</var> may be searched, from the
/// compiled class dictionary, and its SQL column in <var>pField</var> (the compiled <code>SqlFieldName</code>).
/// The first rule that holds decides:
/// <ol>
/// <li>no compiled property of exactly that name: <code>refused</code>;</li>
/// <li>multidimensional: <code>refused</code>;</li>
/// <li>transient or calculated, and not SQL-computed (it has no column): <code>refused</code>;</li>
/// <li>a list or an array collection: <code>refused</code>;</li>
/// <li>a relationship: <code>refused</code>;</li>
/// <li>a serial object (its columns are its sub-properties): <code>refused</code>;</li>
/// <li>a stream (SQL allows only a null test on it): <code>stream</code>;</li>
/// <li>an empty column name or one that holds a double quote: <code>refused</code>;</li>
/// <li>anything else, which includes a reference to a persistent class (its column holds the ID):
/// <code>value</code>.</li>
/// </ol>
/// Anything that cannot be determined is <code>refused</code>.
ClassMethod PropertyKind(pClassName As %String, pProperty As %String, Output pField As %String) As %String
{
    Set pField = ""
    Set tKind = "refused"
    Try {
        Set tProp = ##class(%Dictionary.CompiledProperty).%OpenId(pClassName _ "||" _ pProperty)
        If '$IsObject(tProp) || (tProp.Name '= pProperty) { Set tKind = "refused" }
        ElseIf tProp.MultiDimensional { Set tKind = "refused" }
        ElseIf (tProp.Transient || tProp.Calculated) && 'tProp.SqlComputed { Set tKind = "refused" }
        ElseIf tProp.Collection '= "" { Set tKind = "refused" }
        ElseIf tProp.Relationship { Set tKind = "refused" }
        ElseIf $ClassMethod(tProp.Type, "%IsA", "%Library.SerialObject") { Set tKind = "refused" }
        Else {
            Set tField = tProp.SqlFieldName
            If (tField = "") || (tField [ """") { Set tKind = "refused" }
            Else {
                Set pField = tField
                Set tKind = $Select($ClassMethod(tProp.Type, "%IsA", "%Stream.Object"): "stream", 1: "value")
            }
        }
    } Catch {
        Set pField = ""
        Set tKind = "refused"
    }
    Quit tKind
}

/// Translate the body filters <var>pFilters</var> of the class <var>pClassName</var> into a WHERE clause
/// body and its parameters, <var>pWhere</var> and <var>pParams</var> as <method>HeaderWhere</method>
/// returns them. Each filter becomes <code>alias."SqlFieldName" fragment</code>: the column name comes
/// from <method>PropertyKind</method>, the fragment from <method>BodyOpSql</method>, and the value, a
/// string, a number or a boolean bound as 1 or 0, only into <var>pParams</var>. The fragments are joined
/// with <code>" AND "</code>. A property <method>PropertyKind</method> refuses is refused, and so is any
/// operator other than <code>isNull</code> and <code>notNull</code> on a stream, with a status naming
/// <code>filters[i].property</code> or <code>filters[i].op</code>, never the value. The shape is checked
/// again here with <method>BodyFilterShape</method>, so a caller cannot skip it.
ClassMethod BodyFilterWhere(pClassName As %String, pFilters As %RawString, pAlias As %String, Output pWhere As %String, Output pParams) As %Status
{
    Set pWhere = ""
    Kill pParams
    Set pParams = 0
    Set tSC = ..BodyFilterShape(pFilters)
    If $$$ISERR(tSC) Quit tSC
    Try {
        Set tQ = $Select(pAlias = "": "", 1: pAlias _ ".")
        For tI = 0:1:pFilters.%Size() - 1 {
            Set tPath = "filters[" _ tI _ "]"
            Set tFilter = pFilters.%Get(tI)
            Set tOp = tFilter.%Get("op")
            Set tKind = ..PropertyKind(pClassName, tFilter.%Get("property"), .tField)
            If tKind = "refused" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".property' is not a searchable property of the body class")
                Quit
            }
            If (tKind = "stream") && (tOp '= "isNull") && (tOp '= "notNull") {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".op' must be isNull or notNull for a stream property")
                Quit
            }
            Set tFragment = ..BodyOpSql(tOp)
            Set pWhere = pWhere _ $Select(tI > 0: " AND ", 1: "") _ tQ _ """" _ tField _ """ " _ tFragment
            If tFragment [ "?" {
                Set pParams = pParams + 1
                Set pParams(pParams) = tFilter.%Get("value")
            }
        }
    } Catch {
        Set tSC = $$$ERROR($$$GeneralError, "Parameter 'filters' could not be read")
    }
    If $$$ISERR(tSC) {
        Set pWhere = ""
        Kill pParams
        Set pParams = 0
    }
    Quit tSC
}

/// The text of the body search statement. It reads the headers (alias <code>h</code>) first, in window
/// order, and each body row (alias <code>b</code>, the table <var>pBodyTable</var> from
/// <method>BodyTable</method>) by its ID, joined on the header's body ID. The select list is the header
/// columns of <parameter>COLUMNS</parameter> and nothing of the body. <var>pWhere</var> is
/// <method>HeaderWhere</method>'s clause (alias <code>h</code>) and <var>pBodyWhere</var>
/// <method>BodyFilterWhere</method>'s (alias <code>b</code>); with <var>pCursor</var> the keyset clause
/// follows them. Every other character is fixed text or a parameter marker, in the order the caller binds:
/// the page size, <var>pWhere</var>'s, <var>pBodyWhere</var>'s, then the cursor's three.
/// <p>With an empty <var>pBodyTable</var> there is no joined table: the statement reads the headers alone and
/// <var>pBodyWhere</var> is a set of conditions on the header (alias <code>h</code>), as the Search Table
/// lookup's <method>SearchTableClause</method> clauses are.</p>
ClassMethod BodyStatement(pBodyTable As %String, pWhere As %String, pBodyWhere As %String, pCursor As %Boolean = 0) As %String
{
    If pBodyTable = "" {
        Set tSQL = "SELECT TOP ? " _ ..AliasedColumns("h") _ " FROM %INORDER " _ ..#HEADERHINT _ " Ens.MessageHeader h WHERE " _ pWhere _ " AND " _ pBodyWhere
    }
    Else {
        Set tSQL = "SELECT TOP ? " _ ..AliasedColumns("h") _ " FROM %INORDER " _ ..#HEADERHINT _ " Ens.MessageHeader h, " _ pBodyTable _ " b WHERE h.MessageBodyId = b.%ID AND " _ pWhere _ " AND " _ pBodyWhere
    }
    If pCursor {
        Set tSQL = tSQL _ " AND (h.TimeCreated > ? OR (h.TimeCreated = ? AND h.ID > ?))"
    }
    Quit tSQL _ " ORDER BY h.TimeCreated, h.ID"
}

/// The text of the <code>headers</code> action's statement: the columns of <parameter>COLUMNS</parameter>
/// read from <class>Ens.MessageHeader</class> (unaliased) with <parameter>HEADERHINT</parameter> right after
/// <code>FROM</code>, then <code>WHERE</code> <var>pWhere</var> (<method>HeaderWhere</method>'s clause with no
/// alias). With <var>pCursor</var> the keyset clause follows it. The order is always
/// <code>TimeCreated, ID</code>. Every other character is fixed text or a parameter marker, in the order the
/// caller binds: the page size, <var>pWhere</var>'s, then the cursor's three.
ClassMethod HeaderStatement(pWhere As %String, pCursor As %Boolean = 0) As %String
{
    Set tSQL = "SELECT TOP ? " _ ..#COLUMNS _ " FROM " _ ..#HEADERHINT _ " Ens.MessageHeader WHERE " _ pWhere
    If pCursor {
        Set tSQL = tSQL _ " AND (TimeCreated > ? OR (TimeCreated = ? AND ID > ?))"
    }
    Quit tSQL _ " ORDER BY TimeCreated, ID"
}

/// Resolve the Search Table class <var>pClassName</var>: in <var>pTable</var> the delimited SQL table of its
/// extent root (<code>"schema"."table"</code>, taken from the class dictionary by <method>BodyTable</method>)
/// and in <var>pDocClass</var> its <code>DOCCLASS</code>. The class must be compiled in this namespace under
/// exactly that name (a case variant is another name), persistent, not abstract and a subclass of
/// <class>Ens.VDoc.SearchTable</class>; it must have an extent root with an SQL table; and its
/// <code>DOCCLASS</code> must name a compiled class. Otherwise the status names
/// <code>searchTableClass</code>, without its value, and both outputs are empty.
ClassMethod SearchTableClass(pClassName As %String, Output pTable As %String, Output pDocClass As %String) As %Status
{
    Set pTable = ""
    Set pDocClass = ""
    Set tFound = 0
    Try {
        Set tClass = ##class(%Dictionary.CompiledClass).%OpenId(pClassName)
        If $IsObject(tClass) && (tClass.Name = pClassName) && (tClass.ClassType = "persistent") && 'tClass.Abstract && $ClassMethod(pClassName, "%Extends", "Ens.VDoc.SearchTable") {
            Set tRoot = ##class(Ens.VDoc.SearchTableGenerator).GetExtentSuperclass(pClassName)
            If tRoot '= "" {
                Set tDocClass = $Parameter(pClassName, "DOCCLASS")
                If (tDocClass '= "") && ##class(%Dictionary.CompiledClass).%ExistsId(tDocClass) && $$$ISOK(..BodyTable(tRoot, .tTable, "searchTableClass")) {
                    Set pTable = tTable
                    Set pDocClass = tDocClass
                    Set tFound = 1
                }
            }
        }
    } Catch {
        Set tFound = 0
    }
    If tFound Quit $$$OK
    Set pTable = ""
    Set pDocClass = ""
    Quit $$$ERROR($$$GeneralError, "Parameter 'searchTableClass' must be the exact, case-sensitive name of a compiled Search Table class (a persistent subclass of Ens.VDoc.SearchTable with an SQL table and a document class) in this namespace")
}

/// Whether the body class <var>pBodyClass</var> is a compiled class, under exactly that name, that is or
/// extends the document class <var>pDocClass</var>. Anything that cannot be determined is false.
ClassMethod BodyClassExtends(pBodyClass As %String, pDocClass As %String) As %Boolean
{
    Set tResult = 0
    Try {
        Set tClass = ##class(%Dictionary.CompiledClass).%OpenId(pBodyClass)
        If $IsObject(tClass) && (tClass.Name = pBodyClass) {
            Set tResult = +$ClassMethod(pBodyClass, "%Extends", pDocClass)
        }
    } Catch {
        Set tResult = 0
    }
    Quit tResult
}

/// Whether this namespace has any Search Table property, a row of <class>Ens.Config.SearchTableProp</class>.
/// The statement is fixed. A SQL failure, when the statement is prepared or when its row is fetched, is
/// thrown, so a caller's Try/Catch answers it with an error and it can never read as "none configured".
ClassMethod SearchTablesConfigured() As %Boolean
{
    Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT TOP 1 PropId FROM Ens_Config.SearchTableProp")
    If tRS.%SQLCODE < 0 {
        Throw ##class(%Exception.SQL).CreateFromSQLCODE(tRS.%SQLCODE, tRS.%Message)
    }
    Set tFound = tRS.%Next()
    If tRS.%SQLCODE < 0 {
        Throw ##class(%Exception.SQL).CreateFromSQLCODE(tRS.%SQLCODE, tRS.%Message)
    }
    Quit tFound
}

/// The value <var>pValue</var> of a Search Table filter as the Search Table stores it for a property of
/// type <var>pPropType</var>, which is how <class>Ens.VDoc.SearchTableGenerator</class> normalizes a value
/// before it stores it: a case-insensitive string is lower-cased, an integer is truncated (<code>+v\1</code>),
/// a numeric is a number (<code>+v</code>), a boolean is 1 for true, yes and on and otherwise the truth of
/// the value, and every other type (a case-sensitive string, a date and time, and any type this method does
/// not know) is unchanged. A <code>|</code> is stored as <code>+</code>, so it is replaced last, in every type.
ClassMethod SearchTableValue(pPropType As %String, pValue As %String) As %String
{
    Set tValue = $Case(pPropType, "String:CaseInsensitive": $ZConvert(pValue, "L"), "Integer": +pValue\1, "Numeric": +pValue, "Boolean": $Case($ZConvert(pValue, "L"), "true": 1, "yes": 1, "on": 1, : ''pValue), : pValue)
    Quit $Replace(tValue, "|", "+")
}

/// Whether the operator <var>pOp</var> may be used on a Search Table property of type <var>pPropType</var>.
/// The ten operators of <method>BodyOpSql</method> may be used on a string or a date and time. An integer, a
/// numeric and a boolean are stored as text, so a range, a substring or a prefix of one would compare text
/// and mean nothing: they accept only <code>eq</code>, <code>ne</code>, <code>isNull</code> and
/// <code>notNull</code>. Anything that is not one of the ten operators is refused.
ClassMethod SearchTableOpAllowed(pPropType As %String, pOp As %String) As %Boolean
{
    If ..BodyOpSql(pOp) = "" Quit 0
    If (pPropType = "Integer") || (pPropType = "Numeric") || (pPropType = "Boolean") {
        Quit (pOp = "eq") || (pOp = "ne") || (pOp = "isNull") || (pOp = "notNull")
    }
    Quit 1
}

/// The condition on a header (alias <code>h</code>) for filter number <var>pIndex</var>: a correlated
/// <code>EXISTS</code> or <code>NOT EXISTS</code> over the Search Table <var>pTable</var>
/// (<method>SearchTableClass</method>'s delimited name, alias <code>s</code><var>pIndex</var>), probing it by
/// the header's body ID and a PropId. The marker <code>?</code> stands for the PropId, then, except for
/// <code>isNull</code> and <code>notNull</code>, for the value, so the caller binds them in that order.
/// <code>eq lt le gt ge contains startsWith</code> need an entry whose value is not the empty StoreNulls
/// marker and satisfies <method>BodyOpSql</method>'s fragment; <code>ne</code> needs that there is no entry
/// equal to the value; <code>notNull</code> needs an entry that is not the marker and <code>isNull</code>
/// that there is none. A <code>String:CaseSensitive</code> value is compared with <code>%EXACT</code>; any
/// other type is compared by the column's collation. An operator that is not one of the ten gives
/// <code>""</code>. This is the only place an operator becomes part of the lookup, and it returns no part of
/// its arguments.
ClassMethod SearchTableClause(pIndex As %Integer, pTable As %String, pPropType As %String, pOp As %String) As %String
{
    Set tFragment = ..BodyOpSql(pOp)
    If tFragment = "" Quit ""
    Set tAlias = "s" _ (+pIndex)
    Set tColumn = $Select(pPropType = "String:CaseSensitive": "%EXACT(" _ tAlias _ ".PropValue)", 1: tAlias _ ".PropValue")
    Set tProbe = "SELECT 1 FROM " _ pTable _ " " _ tAlias _ " WHERE " _ tAlias _ ".DocId = h.MessageBodyId AND " _ tAlias _ ".PropId = ?"
    Set tEntry = tProbe _ " AND " _ tAlias _ ".PropValue <> ''"
    If pOp = "ne" Quit "NOT EXISTS (" _ tProbe _ " AND " _ tColumn _ " = ?)"
    If pOp = "notNull" Quit "EXISTS (" _ tEntry _ ")"
    If pOp = "isNull" Quit "NOT EXISTS (" _ tEntry _ ")"
    Quit "EXISTS (" _ tEntry _ " AND " _ tColumn _ " " _ tFragment _ ")"
}

/// The shape of the Search Table filters <var>pFilters</var>, checked before the namespace is switched and
/// again by <method>SearchTableFilterWhere</method>: <method>BodyFilterShape</method>'s rules for the
/// <code>searchTable</code> action, plus a value of at most <parameter>MAXSEARCHTABLEVALUE</parameter>
/// characters for every operator that takes one (a Search Table stores no more, and an index lookup by a much
/// longer value fails in IRIS). A refusal names <code>filters[i].value</code>, never the value. It touches no
/// namespace and no dictionary.
ClassMethod SearchTableShape(pFilters As %RawString) As %Status
{
    Set tSC = ..BodyFilterShape(pFilters, "searchTable")
    If $$$ISERR(tSC) Quit tSC
    Try {
        For tI = 0:1:pFilters.%Size() - 1 {
            Set tFilter = pFilters.%Get(tI)
            Set tOp = tFilter.%Get("op")
            If (tOp '= "isNull") && (tOp '= "notNull") && ($Length(tFilter.%Get("value")) > ..#MAXSEARCHTABLEVALUE) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'filters[" _ tI _ "].value' is longer than the " _ ..#MAXSEARCHTABLEVALUE _ " characters a Search Table stores")
                Quit
            }
        }
    } Catch {
        Set tSC = $$$ERROR($$$GeneralError, "Parameter 'filters' could not be read")
    }
    Quit tSC
}

/// Translate the Search Table filters <var>pFilters</var> of the class <var>pClassName</var> (its extent
/// table is <var>pTable</var>, from <method>SearchTableClass</method>) into a WHERE clause body and its
/// parameters, <var>pWhere</var> and <var>pParams</var> as <method>HeaderWhere</method> returns them. The
/// shape is checked again here with <method>SearchTableShape</method>, so a caller cannot skip it. The class's
/// properties are listed once, by <class>Ens.VDoc.SearchTableGenerator</class>'s <code>getPropsList</code>,
/// which returns those of the class and its Search Table superclasses; each filter's <code>property</code>
/// must equal the name of one of them exactly. Each filter becomes the <method>SearchTableClause</method> of
/// its operator and the property's type, and its parameters are the property's integer PropId, then, except
/// for <code>isNull</code> and <code>notNull</code>, the value normalized by <method>SearchTableValue</method>.
/// The clauses are joined with <code>" AND "</code>. A property that is not one of the class's is refused,
/// and so is an operator the property's type does not allow, with a status naming
/// <code>filters[i].property</code> or <code>filters[i].op</code>, never the value; the property refusal lists
/// the class's property names (at most 50), which are configuration.
ClassMethod SearchTableFilterWhere(pClassName As %String, pTable As %String, pFilters As %RawString, Output pWhere As %String, Output pParams) As %Status
{
    Set pWhere = ""
    Kill pParams
    Set pParams = 0
    Set tSC = ..SearchTableShape(pFilters)
    If $$$ISERR(tSC) Quit tSC
    Try {
        Kill tProps, tByName
        Set tSC = ##class(Ens.VDoc.SearchTableGenerator).getPropsList(pClassName, .tProps)
        If $$$ISERR(tSC) {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'searchTableClass' names a class whose Search Table properties cannot be listed")
        }
        Else {
            For tN = 1:1:+$Get(tProps) {
                Set tByName(tProps(tN)) = $ListBuild(tProps(tN, "PropId"), tProps(tN, "PropType"))
            }
            For tI = 0:1:pFilters.%Size() - 1 {
                Set tPath = "filters[" _ tI _ "]"
                Set tFilter = pFilters.%Get(tI)
                Set tProperty = tFilter.%Get("property")
                Set tOp = tFilter.%Get("op")
                If '$Data(tByName(tProperty)) {
                    Set tSC = $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".property' is not a property of this Search Table class" _ ..PropertyNames(.tByName))
                    Quit
                }
                Set tPropId = $List(tByName(tProperty), 1)
                Set tPropType = $List(tByName(tProperty), 2)
                If '..SearchTableOpAllowed(tPropType, tOp) {
                    Set tSC = $$$ERROR($$$GeneralError, "Parameter '" _ tPath _ ".op' is not allowed for a Search Table property of type " _ tPropType _ ": an integer, numeric or boolean property accepts only eq, ne, isNull and notNull")
                    Quit
                }
                Set pWhere = pWhere _ $Select(tI > 0: " AND ", 1: "") _ ..SearchTableClause(tI, pTable, tPropType, tOp)
                Set pParams = pParams + 1
                Set pParams(pParams) = tPropId
                If (tOp '= "isNull") && (tOp '= "notNull") {
                    Set pParams = pParams + 1
                    Set pParams(pParams) = ..SearchTableValue(tPropType, tFilter.%Get("value"))
                }
            }
        }
    } Catch {
        Set tSC = $$$ERROR($$$GeneralError, "Parameter 'filters' could not be read")
    }
    If $$$ISERR(tSC) {
        Set pWhere = ""
        Kill pParams
        Set pParams = 0
    }
    Quit tSC
}

/// The tail of a property refusal: the names in the array <var>pByName</var> (subscripts), in order, at most
/// 50 of them and then how many more, or a note that there are none.
ClassMethod PropertyNames(ByRef pByName) As %String
{
    Set tNames = ""
    Set tCount = 0
    Set tName = ""
    For {
        Set tName = $Order(pByName(tName))
        If tName = "" Quit
        Set tCount = tCount + 1
        If tCount <= 50 {
            Set tNames = tNames _ $Select(tNames = "": "", 1: ", ") _ tName
        }
    }
    If tCount = 0 Quit ": the class has no configured properties"
    Quit ". Use one of: " _ tNames _ $Select(tCount > 50: " and " _ (tCount - 50) _ " more", 1: "")
}

/// The label of an <code>Ens.DataType.MessageType</code> code, or <code>"Unknown"</code>.
ClassMethod TypeLabel(pType As %Integer) As %String
{
    Quit $Select(pType = 1: "Request", pType = 2: "Response", pType = 3: "Terminate", 1: "Unknown")
}

/// The kind of a message body, from its class alone and never from its content. The first test that
/// holds decides, in this order: an empty class name is <code>literal</code> (the header's body ID is
/// the value); a class that is not compiled is <code>missing</code>; <class>EnsLib.HL7.Message</class> is
/// <code>hl7v2</code>; <class>EnsLib.EDI.XML.Document</class> is <code>xmlvdoc</code>;
/// <class>Ens.VDoc.Interface</class> is <code>vdoc</code>; <class>%Stream.Object</class> is
/// <code>stream</code>; <class>Ens.StreamContainer</class> is <code>streamContainer</code>;
/// <class>%Library.Persistent</class> is <code>persistent</code>; anything else is <code>other</code>.
/// A class that cannot be tested at all is <code>other</code>, the kind that is never redactable.
ClassMethod BodyKind(pClassName As %String) As %String
{
    Set tKind = "other"
    Try {
        If pClassName = "" { Set tKind = "literal" Quit }
        If '##class(%Dictionary.CompiledClass).%ExistsId(pClassName) { Set tKind = "missing" Quit }
        If $ClassMethod(pClassName, "%Extends", "EnsLib.HL7.Message") { Set tKind = "hl7v2" Quit }
        If $ClassMethod(pClassName, "%Extends", "EnsLib.EDI.XML.Document") { Set tKind = "xmlvdoc" Quit }
        If $ClassMethod(pClassName, "%Extends", "Ens.VDoc.Interface") { Set tKind = "vdoc" Quit }
        If $ClassMethod(pClassName, "%Extends", "%Stream.Object") { Set tKind = "stream" Quit }
        If $ClassMethod(pClassName, "%Extends", "Ens.StreamContainer") { Set tKind = "streamContainer" Quit }
        If $ClassMethod(pClassName, "%Extends", "%Library.Persistent") { Set tKind = "persistent" Quit }
    } Catch {
        Set tKind = "other"
    }
    Quit tKind
}

/// The number of characters in the complete ER7 text of the <class>EnsLib.HL7.Message</class> body
/// <var>pBodyId</var> of class <var>pBodyClass</var>, summed from the stored segment sizes
/// (<method>EnsLib.HL7.Message:GetFullSize</method>) without serializing anything. A batch is counted with all
/// of its nested children: a batch is a chain of parents (FHS, then BHS, then the messages), and
/// <code>GetFullSize</code> skips the segments that only point at children, so each node found adds its own
/// size and one fixed query (<code>ParentId</code> equal to the node's ID, or starting with the ID and a colon)
/// then finds that node's children. The sum stops at the first node that takes it past <var>pLimit</var>, so no
/// node after that one is sized or queried. Each node that is sized costs one pass over its own stored segment
/// index, and each node that is queried costs one pass over its children's IDs, which is far less than
/// serializing the text but grows with the number of segments and children. The segment sizes assume a
/// one-character segment terminator, which is what an opened body serializes with (the terminator of the text a
/// message was imported from is not stored), so the sum equals the length the serialization writes. Returns
/// <code>0</code> on any failure, which makes the caller serialize and check the length itself.
ClassMethod Hl7Size(pBodyClass As %String, pBodyId As %String, pLimit As %Integer) As %Integer
{
    Set tSum = 0
    Try {
        Set tStmt = ##class(%SQL.Statement).%New()
        Set tSC = tStmt.%Prepare("SELECT %ID FROM EnsLib_HL7.Message WHERE ParentId = ? OR ParentId %STARTSWITH ?")
        If $$$ISERR(tSC) { Set tSum = 0 Quit }
        Set tQueue(1) = pBodyId
        Set tTail = 1
        Set tHead = 0
        While tHead < tTail {
            Set tHead = tHead + 1
            Set tId = tQueue(tHead)
            If $Data(tSeen(tId)) { Continue }
            Set tSeen(tId) = ""
            If tHead = 1 {
                Set tSum = tSum + $ClassMethod(pBodyClass, "GetFullSize", tId)
            }
            Else {
                Set tSum = tSum + ##class(EnsLib.HL7.Message).GetFullSize(tId)
            }
            If tSum > pLimit { Quit }
            Set tRS = tStmt.%Execute(tId, tId _ ":")
            If tRS.%SQLCODE < 0 { Set tSum = 0 Quit }
            While tRS.%Next() {
                Set tTail = tTail + 1
                Set tQueue(tTail) = tRS.%GetData(1)
            }
            If tRS.%SQLCODE < 0 { Set tSum = 0 Quit }
        }
    }
    Catch {
        Set tSum = 0
    }
    Quit tSum
}

/// The complete ER7 text of the <class>EnsLib.HL7.Message</class> body <var>pBodyId</var> of class
/// <var>pBodyClass</var>, in <var>pText</var>: children included, unsanitized and never cut, which is what
/// a redaction engine needs. Returns <code>""</code> when <var>pText</var> holds the whole text,
/// <code>tooLarge</code> when the text is longer than <var>pMaxChars</var> characters (then
/// <var>pText</var> is empty), or <code>unreadable</code> on any failure. A failure never carries
/// exception text. The size is checked against the stored segment sizes (<method>Hl7Size</method>) after
/// the body opens and before anything is serialized, so a body that is over the limit costs a sum and not
/// a serialization; the length of the serialized text is checked again.
ClassMethod Hl7Text(pBodyClass As %String, pBodyId As %String, pMaxChars As %Integer, Output pText As %String) As %String
{
    Set pText = ""
    Set tResult = "unreadable"
    Try {
        Set tObj = $ClassMethod(pBodyClass, "%OpenId", pBodyId)
        If '$IsObject(tObj) { Quit }
        If 'tObj.%Extends("EnsLib.HL7.Message") { Quit }
        If ..Hl7Size(pBodyClass, pBodyId, pMaxChars) > pMaxChars { Set tResult = "tooLarge" Quit }
        Set tStream = ##class(%Stream.TmpCharacter).%New()
        Set tSC = tObj.OutputToLibraryStream(tStream)
        If $$$ISERR(tSC) { Quit }
        Set tSize = tStream.Size
        If tSize > pMaxChars { Set tResult = "tooLarge" Quit }
        Do tStream.Rewind()
        Set tText = ""
        While 'tStream.AtEnd { Set tText = tText _ tStream.Read(32000) }
        If $Length(tText) '= tSize { Quit }
        Set pText = tText
        Set tResult = ""
    } Catch {
        Set pText = ""
        Set tResult = "unreadable"
    }
    Quit tResult
}

/// Build the header row for the current row of <var>pRS</var>, a result of a SELECT of
/// <parameter>COLUMNS</parameter>. Times are the stored UTC strings: converting them is the caller's
/// job. The row never carries <code>ErrorStatus</code> or <code>Description</code>.
ClassMethod HeaderRow(pRS As %SQL.StatementResult) As %DynamicObject
{
    Set tRow = {}
    Do tRow.%Set("id", +pRS.ID, "number")
    Do tRow.%Set("sessionId", +pRS.SessionId, "number")
    Do tRow.%Set("type", ..TypeLabel(+pRS.Type))
    Do tRow.%Set("status", ##class(ExecuteMCPv2.REST.MessageResend).StatusCodeToLabel(+pRS.Status))
    Do tRow.%Set("isError", +pRS.IsError, "boolean")
    Do tRow.%Set("sourceItem", pRS.SourceConfigName)
    Do tRow.%Set("targetItem", pRS.TargetConfigName)
    Do tRow.%Set("bodyClassName", pRS.MessageBodyClassName)
    Do tRow.%Set("bodyId", pRS.MessageBodyId)
    Do tRow.%Set("timeCreated", pRS.TimeCreated)
    Do tRow.%Set("timeProcessed", pRS.TimeProcessed)
    If pRS.CorrespondingMessageId = "" {
        Do tRow.%Set("correspondingMessageId", "", "null")
    }
    Else {
        Do tRow.%Set("correspondingMessageId", +pRS.CorrespondingMessageId, "number")
    }
    Quit tRow
}

/// Read the optional string parameter <var>pName</var> of <var>pBody</var> into <var>pValue</var>
/// (<code>""</code> when absent or null). Fails when it is not a string or is longer than
/// <var>pMaxLen</var> characters; the text names the parameter and never the value.
ClassMethod ReadString(pBody As %DynamicObject, pName As %String, pMaxLen As %Integer, Output pValue As %String) As %Status
{
    Set pValue = ""
    If 'pBody.%IsDefined(pName) Quit $$$OK
    Set tType = pBody.%GetTypeOf(pName)
    If tType = "null" Quit $$$OK
    If tType '= "string" Quit $$$ERROR($$$GeneralError, "Parameter '" _ pName _ "' must be a string")
    Set pValue = pBody.%Get(pName)
    If $Length(pValue) > pMaxLen Quit $$$ERROR($$$GeneralError, "Parameter '" _ pName _ "' exceeds the maximum length of " _ pMaxLen _ " characters")
    Quit $$$OK
}

/// Read the optional integer parameter <var>pName</var> of <var>pBody</var> into <var>pValue</var>
/// (<var>pDefault</var> when absent or null). It must be a JSON number or a string of digits, from
/// <var>pMin</var> to <var>pMax</var>; the text names the parameter and never the value.
ClassMethod ReadInteger(pBody As %DynamicObject, pName As %String, pDefault As %String, pMin As %Integer, pMax As %Integer, Output pValue As %String) As %Status
{
    Set pValue = pDefault
    If 'pBody.%IsDefined(pName) Quit $$$OK
    Set tType = pBody.%GetTypeOf(pName)
    If tType = "null" Quit $$$OK
    Set tRaw = pBody.%Get(pName)
    If ((tType '= "number") && (tType '= "string")) || (tRaw '? 1.N) || ($Length(tRaw) > 18) || (+tRaw < pMin) || (+tRaw > pMax) {
        Quit $$$ERROR($$$GeneralError, "Parameter '" _ pName _ "' must be an integer from " _ pMin _ " to " _ pMax)
    }
    Set pValue = +tRaw
    Quit $$$OK
}

/// Whether <var>pNorm</var> (a <method>ExecuteMCPv2.REST.MessageResend.NormalizeTimestamp</method>
/// result) parses as a date and time.
ClassMethod IsTimestamp(pNorm As %String) As %Boolean
{
    Quit $$$ISOK(##class(ExecuteMCPv2.REST.MessageResend).WindowDays(pNorm, pNorm, .tDays))
}

/// Search message headers. The JSON body holds <code>action</code> (<code>headers</code>,
/// <code>body</code> or <code>searchTable</code>), <code>from</code> (required, ISO-8601 or ODBC UTC),
/// optional <code>to</code> (default now, to the millisecond, so a header created in the current second is
/// inside the window), at most 7 days after <code>from</code>, optional <code>item</code>,
/// <code>source</code>, <code>target</code>, <code>status</code> (a label, <code>Errored</code> or
/// <code>Error</code> for status 8), <code>sessionId</code>, <code>bodyClass</code>, <code>errorOnly</code>,
/// <code>limit</code> (1 to 500, default 100), the keyset cursor <code>afterTimeCreated</code> with
/// <code>afterId</code>, and <code>namespace</code>. The <code>body</code> action requires
/// <code>bodyClass</code>, which is then the exact name of a persistent class and matches only the headers
/// of that class, and <code>filters</code>, a list of 1 to 10 <code>{property, op, value}</code> objects (see
/// <method>BodyFilterShape</method>). The <code>searchTable</code> action requires
/// <code>searchTableClass</code> and <code>filters</code> and takes an optional <code>bodyClass</code>, the
/// exact name of a compiled class that is, or extends, the Search Table's document class (it then replaces
/// that class as the header class predicate). The <code>headers</code> action refuses a <code>filters</code>
/// key, and <code>searchTableClass</code> is refused on every action but <code>searchTable</code>.
/// <p>The result is <code>{action, interopEnabled, rows, hasMore, limit, from, to}</code>, and for
/// <code>searchTable</code> also <code>searchTablesConfigured</code>.
/// <code>interopEnabled</code> is false, with no rows, when the namespace has no
/// <code>Ens.MessageHeader</code>; <code>searchTablesConfigured</code> is false, with no rows, when it has no
/// <code>Ens.Config.SearchTableProp</code> row, a check that comes before the class is looked up. Every
/// refusal is the standard envelope with <code>result:{}</code>; nothing is read before the input is valid,
/// and nothing is written. A failure of the body or Search Table statement's preparation carries its
/// sanitized status, which holds only dictionary names and parameter markers; a failure while it runs is the
/// fixed text <code>The body search failed with SQLCODE n.</code> or <code>The Search Table lookup failed
/// with SQLCODE n.</code>, so no response names a filter value or body content.</p>
ClassMethod MessageSearch() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Set tResult = ""
    Try {
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) Quit
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Quit
        }

        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) Quit
        If (tAction '= "headers") && (tAction '= "body") && (tAction '= "searchTable") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: headers, body, searchTable")
            Quit
        }
        If (tAction = "headers") && tBody.%IsDefined("filters") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'filters' applies only to the body and searchTable actions")
            Quit
        }
        If (tAction '= "searchTable") && tBody.%IsDefined("searchTableClass") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'searchTableClass' applies only to the searchTable action")
            Quit
        }

        Set tSC = ..ReadString(tBody, "from", 64, .tFrom)
        If $$$ISERR(tSC) Quit
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tFrom, "from")
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadString(tBody, "to", 64, .tTo)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadString(tBody, "item", 128, .tItem)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadString(tBody, "source", 128, .tSource)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadString(tBody, "target", 128, .tTarget)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadString(tBody, "bodyClass", 220, .tBodyClass)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadString(tBody, "searchTableClass", 220, .tSearchTableClass)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadString(tBody, "status", 64, .tStatusLabel)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadString(tBody, "afterTimeCreated", 64, .tAfterTime)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadString(tBody, "namespace", 256, .tNamespace)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadInteger(tBody, "sessionId", "", 1, 999999999999999999, .tSessionId)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadInteger(tBody, "limit", ..#DEFAULTLIMIT, 1, ..#MAXLIMIT, .tLimit)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadInteger(tBody, "afterId", "", 1, 999999999999999999, .tAfterId)
        If $$$ISERR(tSC) Quit

        Set tErrorOnly = 0
        If tBody.%IsDefined("errorOnly") && (tBody.%GetTypeOf("errorOnly") '= "null") {
            Set tErrorType = tBody.%GetTypeOf("errorOnly")
            Set tErrorRaw = tBody.%Get("errorOnly")
            If (tErrorType = "boolean") || ((tErrorType = "number") && ((tErrorRaw = 0) || (tErrorRaw = 1))) {
                Set tErrorOnly = +tErrorRaw
            }
            Else {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'errorOnly' must be a boolean")
                Quit
            }
        }

        Set tStatusCode = ""
        If tStatusLabel '= "" {
            Set tStatusCode = ##class(ExecuteMCPv2.REST.MessageResend).StatusLabelToCode(tStatusLabel)
            If tStatusCode = 0 {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'status' must be one of: Created, Queued, Delivered, Discarded, Suspended, Deferred, Aborted, Errored, Completed")
                Quit
            }
        }

        If (tAfterTime = "") '= (tAfterId = "") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameters 'afterTimeCreated' and 'afterId' must be given together")
            Quit
        }

        Set tFromNorm = ##class(ExecuteMCPv2.REST.MessageResend).NormalizeTimestamp(tFrom)
        If tTo = "" { Set tToNorm = $ZDATETIME($ZTIMESTAMP, 3, 1, 3) }
        Else { Set tToNorm = ##class(ExecuteMCPv2.REST.MessageResend).NormalizeTimestamp(tTo) }
        Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).WindowDays(tFromNorm, tToNorm, .tDays)
        If $$$ISERR(tSC) {
            Set tSC = $$$ERROR($$$GeneralError, "Parameters 'from'/'to' must be valid ISO-8601 or ODBC timestamps")
            Quit
        }
        If tDays < 0 {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'from' must be earlier than 'to' (the requested window is negative)")
            Quit
        }
        If tDays > ..#MAXWINDOWDAYS {
            Set tSC = $$$ERROR($$$GeneralError, "The 'from'/'to' window exceeds the maximum of " _ ..#MAXWINDOWDAYS _ " days; narrow the range and retry")
            Quit
        }

        Set tAfterNorm = ""
        If tAfterTime '= "" {
            Set tAfterNorm = ##class(ExecuteMCPv2.REST.MessageResend).NormalizeTimestamp(tAfterTime)
            If '..IsTimestamp(tAfterNorm) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'afterTimeCreated' must be a valid timestamp")
                Quit
            }
        }

        ; The body and searchTable actions' whole input is checked here, before the namespace is switched.
        Set tClassPattern = "^%?[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$"
        Set tBodyFilters = ""
        If tAction = "body" {
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tBodyClass, "bodyClass")
            If $$$ISERR(tSC) Quit
            If '$Match(tBodyClass, tClassPattern) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'bodyClass' must be a class name, such as Package.Class")
                Quit
            }
            Set tBodyFilters = tBody.%Get("filters")
            Set tSC = ..BodyFilterShape(tBodyFilters)
            If $$$ISERR(tSC) Quit
        }
        ElseIf tAction = "searchTable" {
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tSearchTableClass, "searchTableClass")
            If $$$ISERR(tSC) Quit
            If '$Match(tSearchTableClass, tClassPattern) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'searchTableClass' must be a class name, such as Package.Class")
                Quit
            }
            If (tBodyClass '= "") && '$Match(tBodyClass, tClassPattern) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'bodyClass' must be a class name, such as Package.Class")
                Quit
            }
            Set tBodyFilters = tBody.%Get("filters")
            Set tSC = ..SearchTableShape(tBodyFilters)
            If $$$ISERR(tSC) Quit
        }

        Set tFilters = {}
        Do tFilters.%Set("item", tItem)
        Do tFilters.%Set("source", tSource)
        Do tFilters.%Set("target", tTarget)
        Do tFilters.%Set("statusCode", tStatusCode)
        Do tFilters.%Set("fromNorm", tFromNorm)
        Do tFilters.%Set("toNorm", tToNorm)
        Do tFilters.%Set("sessionId", tSessionId)
        Do tFilters.%Set("bodyClass", tBodyClass)
        Do tFilters.%Set("errorOnly", tErrorOnly, "boolean")
        If tAction = "headers" {
            Set tSC = ..HeaderWhere(tFilters, .tWhere, .tWhereParams)
            If $$$ISERR(tSC) Quit
        }

        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) Quit
        }

        Set tResult = {}
        Do tResult.%Set("action", tAction)
        Do tResult.%Set("limit", tLimit, "number")
        Do tResult.%Set("from", tFromNorm)
        Do tResult.%Set("to", tToNorm)

        If '##class(%Dictionary.CompiledClass).%ExistsId("Ens.MessageHeader") {
            Do tResult.%Set("interopEnabled", 0, "boolean")
            Do tResult.%Set("rows", [])
            Do tResult.%Set("hasMore", 0, "boolean")
            Quit
        }

        ; The body action reads the headers first, in window order, and each body row by its ID. Its
        ; statement holds only fixed text, names from the class dictionary, and parameter markers.
        If tAction = "body" {
            Set tSC = ..BodyTable(tBodyClass, .tBodyTable)
            If $$$ISERR(tSC) Quit
            Set tSC = ..HeaderWhere(tFilters, .tWhere, .tWhereParams, "h")
            If $$$ISERR(tSC) Quit
            Set tSC = ..BodyFilterWhere(tBodyClass, tBodyFilters, "b", .tBodyWhere, .tBodyParams)
            If $$$ISERR(tSC) Quit
        }

        ; The searchTable action reads the headers of the document class first, in window order, and probes
        ; the Search Table by each header's body ID. It is checked in this order: a namespace with no Search
        ; Table property at all is not applicable, then the class, then bodyClass, then each filter.
        If tAction = "searchTable" {
            If '..SearchTablesConfigured() {
                Do tResult.%Set("interopEnabled", 1, "boolean")
                Do tResult.%Set("searchTablesConfigured", 0, "boolean")
                Do tResult.%Set("rows", [])
                Do tResult.%Set("hasMore", 0, "boolean")
                Quit
            }
            Set tSC = ..SearchTableClass(tSearchTableClass, .tSearchTable, .tDocClass)
            If $$$ISERR(tSC) Quit
            Set tHeaderClass = tDocClass
            If tBodyClass '= "" {
                If '..BodyClassExtends(tBodyClass, tDocClass) {
                    Set tSC = $$$ERROR($$$GeneralError, "Parameter 'bodyClass' must name a compiled class that is, or extends, the Search Table's document class " _ tDocClass)
                    Quit
                }
                Set tHeaderClass = tBodyClass
            }
            Do tFilters.%Set("bodyClass", tHeaderClass)
            Set tSC = ..HeaderWhere(tFilters, .tWhere, .tWhereParams, "h")
            If $$$ISERR(tSC) Quit
            Set tSC = ..SearchTableFilterWhere(tSearchTableClass, tSearchTable, tBodyFilters, .tBodyWhere, .tBodyParams)
            If $$$ISERR(tSC) Quit
        }

        ; TOP is a parameter and the keyset clause comes after the filters, so the parameters
        ; are the page size, then HeaderWhere's, then the body or Search Table filters', then the cursor's.
        If tAction = "body" {
            Set tSQL = ..BodyStatement(tBodyTable, tWhere, tBodyWhere, tAfterNorm '= "")
        }
        ElseIf tAction = "searchTable" {
            Set tSQL = ..BodyStatement("", tWhere, tBodyWhere, tAfterNorm '= "")
        }
        Else {
            Set tSQL = ..HeaderStatement(tWhere, tAfterNorm '= "")
        }
        Set tArgs = 1
        Set tArgs(1) = tLimit + 1
        For tI = 1:1:tWhereParams {
            Set tArgs = tArgs + 1, tArgs(tArgs) = tWhereParams(tI)
        }
        If (tAction = "body") || (tAction = "searchTable") {
            For tI = 1:1:tBodyParams {
                Set tArgs = tArgs + 1, tArgs(tArgs) = tBodyParams(tI)
            }
        }
        If tAfterNorm '= "" {
            Set tArgs = tArgs + 1, tArgs(tArgs) = tAfterNorm
            Set tArgs = tArgs + 1, tArgs(tArgs) = tAfterNorm
            Set tArgs = tArgs + 1, tArgs(tArgs) = tAfterId
        }

        Set tStmt = ##class(%SQL.Statement).%New()
        Set tStmt.%SelectMode = 0
        Set tSC = tStmt.%Prepare(tSQL)
        If $$$ISERR(tSC) Quit
        Set tRS = tStmt.%Execute(tArgs...)
        If tRS.%SQLCODE < 0 {
            If tAction = "body" {
                Set tSC = $$$ERROR($$$GeneralError, "The body search failed with SQLCODE " _ tRS.%SQLCODE _ ".")
            }
            ElseIf tAction = "searchTable" {
                Set tSC = $$$ERROR($$$GeneralError, "The Search Table lookup failed with SQLCODE " _ tRS.%SQLCODE _ ".")
            }
            Else {
                Set tSC = $$$ERROR($$$GeneralError, "SQL error: " _ tRS.%Message)
            }
            Quit
        }

        Set tRows = []
        Set tHasMore = 0
        While tRS.%Next() {
            If tRows.%Size() >= tLimit {
                Set tHasMore = 1
                Quit
            }
            Do tRows.%Push(..HeaderRow(tRS))
        }
        If (tAction = "body") && (tRS.%SQLCODE < 0) {
            Set tSC = $$$ERROR($$$GeneralError, "The body search failed with SQLCODE " _ tRS.%SQLCODE _ ".")
            Quit
        }
        If (tAction = "searchTable") && (tRS.%SQLCODE < 0) {
            Set tSC = $$$ERROR($$$GeneralError, "The Search Table lookup failed with SQLCODE " _ tRS.%SQLCODE _ ".")
            Quit
        }
        Do tResult.%Set("interopEnabled", 1, "boolean")
        If tAction = "searchTable" {
            Do tResult.%Set("searchTablesConfigured", 1, "boolean")
        }
        Do tResult.%Set("rows", tRows)
        Do tResult.%Set("hasMore", tHasMore, "boolean")
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrigNS
    If $$$ISERR(tSC) {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    Else {
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Quit $$$OK
}

}
