/// REST handler for searching Interoperability message headers (Story 39.1).
/// <p><method>MessageSearch</method> is a read-only route, <code>POST /interop/message/search</code>.
/// Its <code>action</code> body field selects the operation; <code>headers</code> is the only one
/// implemented. It filters <code>Ens.MessageHeader</code> by a required time window plus optional item,
/// source, target, status, session, body class and error flag, and returns header rows (never body data,
/// <code>ErrorStatus</code> or <code>Description</code>) in <code>TimeCreated, ID</code> order, one page
/// at a time, with a keyset cursor taken from the last row of the previous page.</p>
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

/// The columns every header row is read from, in the order <method>HeaderRow</method> uses them.
/// <code>ErrorStatus</code> and <code>Description</code> are deliberately absent.
Parameter COLUMNS As %String = "ID, SessionId, Type, Status, IsError, SourceConfigName, TargetConfigName, MessageBodyClassName, MessageBodyId, TimeCreated, TimeProcessed, CorrespondingMessageId";

/// Translate header filters into a WHERE clause body and its parameters.
/// <p><var>pFilters</var> may hold: <code>item</code> (source OR target), <code>source</code>,
/// <code>target</code>, <code>statusCode</code>, <code>fromNorm</code> (inclusive lower bound),
/// <code>toNorm</code> (inclusive upper bound), <code>sessionId</code>, <code>bodyClass</code> and
/// <code>errorOnly</code>. A key that is absent or empty adds no fragment. The fragments always appear in
/// the order <code>item</code>, <code>source</code>, <code>target</code>, <code>statusCode</code>,
/// <code>fromNorm</code>, <code>toNorm</code>, <code>sessionId</code>, <code>bodyClass</code>,
/// <code>errorOnly</code>, joined with <code>" AND "</code>.</p>
/// <p><var>pWhere</var> is the clause body without the <code>WHERE</code> keyword, or <code>""</code>
/// when no filter is set. <var>pParams</var> is the parameter count, with <code>pParams(i)</code> holding
/// the i-th value in the order of the <code>?</code> markers, so a caller passes it as
/// <code>pParams...</code>. This method never validates a value and never sees a cap.</p>
ClassMethod HeaderWhere(pFilters As %DynamicObject, Output pWhere As %String, Output pParams) As %Status
{
    Set tSC = $$$OK
    Set pWhere = ""
    Kill pParams
    Set pParams = 0
    Try {
        Set tFragments = ""
        Set tItem = pFilters.%Get("item")
        If tItem '= "" {
            Set tFragments = tFragments _ $ListBuild("(SourceConfigName = ? OR TargetConfigName = ?)")
            Set pParams = pParams + 1, pParams(pParams) = tItem
            Set pParams = pParams + 1, pParams(pParams) = tItem
        }
        Set tSource = pFilters.%Get("source")
        If tSource '= "" {
            Set tFragments = tFragments _ $ListBuild("SourceConfigName = ?")
            Set pParams = pParams + 1, pParams(pParams) = tSource
        }
        Set tTarget = pFilters.%Get("target")
        If tTarget '= "" {
            Set tFragments = tFragments _ $ListBuild("TargetConfigName = ?")
            Set pParams = pParams + 1, pParams(pParams) = tTarget
        }
        Set tStatusCode = pFilters.%Get("statusCode")
        If tStatusCode '= "" {
            Set tFragments = tFragments _ $ListBuild("Status = ?")
            Set pParams = pParams + 1, pParams(pParams) = tStatusCode
        }
        Set tFromNorm = pFilters.%Get("fromNorm")
        If tFromNorm '= "" {
            Set tFragments = tFragments _ $ListBuild("TimeCreated >= ?")
            Set pParams = pParams + 1, pParams(pParams) = tFromNorm
        }
        Set tToNorm = pFilters.%Get("toNorm")
        If tToNorm '= "" {
            Set tFragments = tFragments _ $ListBuild("TimeCreated <= ?")
            Set pParams = pParams + 1, pParams(pParams) = tToNorm
        }
        Set tSessionId = pFilters.%Get("sessionId")
        If tSessionId '= "" {
            Set tFragments = tFragments _ $ListBuild("SessionId = ?")
            Set pParams = pParams + 1, pParams(pParams) = tSessionId
        }
        Set tBodyClass = pFilters.%Get("bodyClass")
        If tBodyClass '= "" {
            Set tFragments = tFragments _ $ListBuild("MessageBodyClassName = ?")
            Set pParams = pParams + 1, pParams(pParams) = tBodyClass
        }
        If +pFilters.%Get("errorOnly") {
            Set tFragments = tFragments _ $ListBuild("IsError = 1")
        }
        For tI = 1:1:$ListLength(tFragments) {
            Set pWhere = pWhere _ $Select(tI > 1: " AND ", 1: "") _ $List(tFragments, tI)
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
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

/// The complete ER7 text of the <class>EnsLib.HL7.Message</class> body <var>pBodyId</var> of class
/// <var>pBodyClass</var>, in <var>pText</var>: children included, unsanitized and never cut, which is what
/// a redaction engine needs. Returns <code>""</code> when <var>pText</var> holds the whole text,
/// <code>tooLarge</code> when the text is longer than <var>pMaxChars</var> characters (then
/// <var>pText</var> is empty), or <code>unreadable</code> on any failure. A failure never carries
/// exception text.
ClassMethod Hl7Text(pBodyClass As %String, pBodyId As %String, pMaxChars As %Integer, Output pText As %String) As %String
{
    Set pText = ""
    Set tResult = "unreadable"
    Try {
        Set tObj = $ClassMethod(pBodyClass, "%OpenId", pBodyId)
        If '$IsObject(tObj) { Quit }
        If 'tObj.%Extends("EnsLib.HL7.Message") { Quit }
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

/// Search message headers. The JSON body holds <code>action</code> (<code>headers</code>),
/// <code>from</code> (required, ISO-8601 or ODBC UTC), optional <code>to</code> (default now, to the
/// millisecond, so a header created in the current second is inside the window), at most
/// 7 days after <code>from</code>, optional <code>item</code>, <code>source</code>, <code>target</code>,
/// <code>status</code> (a label, <code>Errored</code> or <code>Error</code> for status 8),
/// <code>sessionId</code>, <code>bodyClass</code>, <code>errorOnly</code>, <code>limit</code>
/// (1 to 500, default 100), the keyset cursor <code>afterTimeCreated</code> with <code>afterId</code>,
/// and <code>namespace</code>.
/// <p>The result is <code>{action, interopEnabled, rows, hasMore, limit, from, to}</code>.
/// <code>interopEnabled</code> is false, with no rows, when the namespace has no
/// <code>Ens.MessageHeader</code>. Every refusal is the standard envelope with <code>result:{}</code>;
/// nothing is read before the input is valid, and nothing is written.</p>
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
        If tAction '= "headers" {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be: headers")
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
        Set tSC = ..HeaderWhere(tFilters, .tWhere, .tWhereParams)
        If $$$ISERR(tSC) Quit

        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) Quit
        }

        Set tResult = {}
        Do tResult.%Set("action", "headers")
        Do tResult.%Set("limit", tLimit, "number")
        Do tResult.%Set("from", tFromNorm)
        Do tResult.%Set("to", tToNorm)

        If '##class(%Dictionary.CompiledClass).%ExistsId("Ens.MessageHeader") {
            Do tResult.%Set("interopEnabled", 0, "boolean")
            Do tResult.%Set("rows", [])
            Do tResult.%Set("hasMore", 0, "boolean")
            Quit
        }

        ; TOP is a parameter and the keyset clause comes after the filters, so the parameters
        ; are the page size, then HeaderWhere's, then the cursor's.
        Set tSQL = "SELECT TOP ? " _ ..#COLUMNS _ " FROM Ens.MessageHeader WHERE " _ tWhere
        Set tArgs = 1
        Set tArgs(1) = tLimit + 1
        For tI = 1:1:tWhereParams {
            Set tArgs = tArgs + 1, tArgs(tArgs) = tWhereParams(tI)
        }
        If tAfterNorm '= "" {
            Set tSQL = tSQL _ " AND (TimeCreated > ? OR (TimeCreated = ? AND ID > ?))"
            Set tArgs = tArgs + 1, tArgs(tArgs) = tAfterNorm
            Set tArgs = tArgs + 1, tArgs(tArgs) = tAfterNorm
            Set tArgs = tArgs + 1, tArgs(tArgs) = tAfterId
        }
        Set tSQL = tSQL _ " ORDER BY TimeCreated, ID"

        Set tStmt = ##class(%SQL.Statement).%New()
        Set tStmt.%SelectMode = 0
        Set tSC = tStmt.%Prepare(tSQL)
        If $$$ISERR(tSC) Quit
        Set tRS = tStmt.%Execute(tArgs...)
        If tRS.%SQLCODE < 0 {
            Set tSC = $$$ERROR($$$GeneralError, "SQL error: " _ tRS.%Message)
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
        Do tResult.%Set("interopEnabled", 1, "boolean")
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
