/// REST handler for the SQL execution endpoint behind <code>iris_sql_execute</code> and
/// <code>iris_sql_query</code>.
/// <p>Backs <code>/api/executemcp/v2/dev/sql/execute</code> (<method>Execute</method>, POST
/// JSON body <code>{query, parameters?, namespace?, readOnly?, countOnly?,
/// maxRowsAffected?}</code>). The statement is prepared once, classified by the
/// <code>%SQL.Statement</code> statement type (never by keyword), checked against the
/// read-only and rows-affected controls, and executed in the same request.</p>
/// <ul>
/// <li><b>Read-only.</b> Only statement type 1 (SELECT) runs. It runs inside a transaction
/// this handler opens and always rolls back. Every other type is declined before execution,
/// <code>CALL</code> included.</li>
/// <li><b>Rows-affected cap.</b> Under a cap, types 2, 3 and 4 (INSERT, UPDATE, DELETE) run
/// inside a transaction this handler opens. <code>%ROWCOUNT</code> above the cap, or negative
/// (unknown), rolls the statement back. Otherwise the transaction commits. A SELECT runs as it
/// would without a cap, and every other type is declined before execution.</li>
/// <li><b>Neither.</b> The statement runs as the Atelier <code>action/query</code> route runs
/// it, with no transaction from this handler.</li>
/// <li><b>Transactions.</b> When this handler opened a transaction, it requires
/// <code>$TLEVEL</code> to be the level it opened after execution (a function, procedure or
/// trigger that started, committed or rolled back a transaction is outcome
/// <code>transactionEnded</code>), and it rolls back to the level it found on every exit.</li>
/// </ul>
/// <p>The response result is <code>{outcome, statementType, statementTypeName, ...}</code>.
/// <code>outcome</code> is <code>ok</code> (with <code>content</code>, the rows as
/// <code>action/query</code> serializes them, and <code>rowsAffected</code> for types 2 to 4 or
/// <code>totalCount</code> for <code>countOnly</code>), <code>readOnly</code>,
/// <code>countOnly</code>, <code>capNotCountable</code>, <code>overCap</code> (with
/// <code>rowsAffected</code>) or <code>transactionEnded</code>. A prepare or execution error is
/// an error envelope carrying the SQLCODE and the IRIS message.</p>
/// <p>Rows are keyed by column name and typed by the result set's own <code>clientType</code>:
/// integer, double, numeric, currency and bigint columns are numbers, boolean columns are
/// booleans, and every other column (and every column of a CALL result set, whose metadata
/// carries no client type) is a string. A string that begins with <code>{</code> or
/// <code>[</code> and parses as JSON is embedded as JSON. Values are read with the process
/// default select mode.</p>
Class ExecuteMCPv2.REST.Sql Extends ExecuteMCPv2.REST.Base
{

/// HTTP entry point: reads the body, runs the statement, renders exactly one envelope.
ClassMethod Execute() As %Status
{
    Set tSC = $$$OK
    Set tResult = ""
    Set tErrored = 0
    Try {
        Set tSC1 = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC1) {
            Set tErrored = 1
            Set tCmdStatus = tSC1
            Quit
        }
        Set tSC2 = ..Run(tBody, .tResult)
        If $$$ISERR(tSC2) {
            Set tErrored = 1
            Set tCmdStatus = tSC2
            Quit
        }
        Quit
    } Catch ex {
        Set tErrored = 1
        Set tCmdStatus = ex.AsStatus()
    }

    If tErrored {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus))
    } Else {
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Quit tSC
}

/// The request-independent core of <method>Execute</method>. Validates the controls before any
/// namespace switch, then runs <method>Perform</method> in the requested namespace with device
/// output captured and discarded. The namespace, the I/O redirect and any transaction this
/// method opened are restored on every exit path, before the caller renders.
ClassMethod Run(pBody As %DynamicObject, Output pResult As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pResult = ""
    Set tOrigNS = $NAMESPACE
    Set tInitIO = $IO
    Set tNull = ""
    Set tRedirected = 0
    Try {
        Set tSC = ..ReadControls(pBody, .tQuery, .tNamespace, .tReadOnly, .tCountOnly, .tCap, .tArgs)
        If $$$ISERR(tSC) Quit

        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) Quit
        }

        Set tNull = ##class(%Library.Device).GetNullDevice()
        Open tNull:::1
        Set tRedirected = 1
        Use tNull::("^"_$ZNAME)
        Do ##class(%Library.Device).ReDirectIO(1)

        Set tSC = ..Perform(tQuery, .tArgs, tReadOnly, tCountOnly, tCap, .pResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }

    Set $NAMESPACE = tOrigNS
    If tRedirected Do ##class(ExecuteMCPv2.REST.Command).TeardownRedirect(tInitIO, tNull)
    Quit tSC
}

/// Reads and validates the request controls. <var>pArgs</var> is a local array: <code>pArgs</code>
/// holds the argument count and <code>pArgs(n)</code> the n-th parameter value, as
/// <code>%Execute(pArgs...)</code> takes them. <var>pCap</var> is empty (no cap) or a
/// non-negative integer.
ClassMethod ReadControls(pBody As %DynamicObject, Output pQuery As %String, Output pNamespace As %String, Output pReadOnly As %Boolean, Output pCountOnly As %Boolean, Output pCap As %String, Output pArgs) As %Status
{
    Set tSC = $$$OK
    Set pQuery = "", pNamespace = "", pReadOnly = 0, pCountOnly = 0, pCap = ""
    Kill pArgs
    Set pArgs = 0
    Try {
        If $IsObject(pBody) {
            If pBody.%IsDefined("query") Set pQuery = pBody.%Get("query")
            If pBody.%IsDefined("namespace") Set pNamespace = pBody.%Get("namespace")
        }
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired($ZStrip(pQuery, "<>W"), "query")
        If $$$ISERR(tSC) Quit

        Set tSC = ..ReadFlag(pBody, "readOnly", .pReadOnly)
        If $$$ISERR(tSC) Quit
        Set tSC = ..ReadFlag(pBody, "countOnly", .pCountOnly)
        If $$$ISERR(tSC) Quit

        If pBody.%IsDefined("maxRowsAffected") {
            Set pCap = pBody.%Get("maxRowsAffected")
            If (pCap '= "") && (pCap '? 1.N) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'maxRowsAffected' must be a non-negative integer")
                Quit
            }
        }

        If pBody.%IsDefined("parameters") {
            Set tType = pBody.%GetTypeOf("parameters")
            If tType = "array" {
                Set tParams = pBody.%Get("parameters")
                Set pArgs = tParams.%Size()
                For tI = 1:1:pArgs Set pArgs(tI) = tParams.%Get(tI - 1)
            } ElseIf tType '= "null" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'parameters' must be an array")
                Quit
            }
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Reads an optional boolean control. An absent or null value is false; a value that is not
/// 0, 1, true or false is an error, so a malformed control never runs as false.
ClassMethod ReadFlag(pBody As %DynamicObject, pName As %String, Output pValue As %Boolean) As %Status
{
    Set pValue = 0
    If '$IsObject(pBody) Quit $$$OK
    If 'pBody.%IsDefined(pName) Quit $$$OK
    Set tRaw = pBody.%Get(pName)
    If tRaw = "" Quit $$$OK
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateBoolean(tRaw, pName)
    If $$$ISERR(tSC) Quit tSC
    Set tLower = $ZConvert(tRaw, "L")
    Set pValue = ((tLower = "1") || (tLower = "true"))
    Quit $$$OK
}

/// Prepares, classifies, checks and executes the statement in the current namespace. A
/// declined statement is not an error: <var>pResult</var> carries its outcome. A transaction
/// opened here is rolled back to the level found on entry unless the cap check committed it.
ClassMethod Perform(pQuery As %String, ByRef pArgs, pReadOnly As %Boolean, pCountOnly As %Boolean, pCap As %String, Output pResult As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pResult = ""
    Set tEntryLevel = $TLevel
    Set tOpened = 0
    Try {
        Set tStmt = ##class(%SQL.Statement).%New()
        Set tSC = tStmt.%Prepare(.pQuery, 0)
        If $$$ISERR(tSC) Quit

        Set tType = +tStmt.%Metadata.statementType
        Set tTypeName = ..TypeName(tType)

        Set tDecline = ..Decline(tType, pReadOnly, pCountOnly, pCap)
        If tDecline '= "" {
            Set pResult = ..NewResult(tDecline, tType, tTypeName)
            Quit
        }

        Set tCapped = ('pReadOnly) && (pCap '= "") && (tType >= 2) && (tType <= 4)
        If pReadOnly || tCapped {
            TSTART
            Set tOpened = 1
            Set tOpenLevel = $TLevel
        }

        Set tRS = tStmt.%Execute(pArgs...)
        If tRS.%SQLCODE < 0 {
            Set tSC = ..SqlStatus(tRS.%SQLCODE, tRS.%Message)
            Quit
        }

        Set tRowsAffected = ""
        If (tType >= 2) && (tType <= 4) Set tRowsAffected = tRS.%ROWCOUNT

        Set tContent = []
        Set tTotal = ""
        If pCountOnly {
            Set tSC = ..CountRows(tRS, .tTotal)
        } Else {
            Set tSC = ..Serialize(tRS, tContent)
        }
        If $$$ISERR(tSC) Quit

        If tOpened && ($TLevel '= tOpenLevel) {
            Set pResult = ..NewResult("transactionEnded", tType, tTypeName)
            Quit
        }

        If tCapped {
            If (tRowsAffected < 0) || (tRowsAffected > pCap) {
                Set pResult = ..NewResult("overCap", tType, tTypeName)
                Do pResult.%Set("rowsAffected", +tRowsAffected, "number")
                Quit
            }
            TCOMMIT
            Set tOpened = 0
        }

        Set pResult = ..NewResult("ok", tType, tTypeName)
        Do pResult.%Set("content", tContent)
        If tRowsAffected '= "" Do pResult.%Set("rowsAffected", +tRowsAffected, "number")
        If tTotal '= "" Do pResult.%Set("totalCount", +tTotal, "number")
    } Catch ex {
        Set tSC = ex.AsStatus()
    }

    If tOpened Do ..RollBackTo(tEntryLevel)
    Quit tSC
}

/// The decline outcome for a statement of type <var>pType</var>, or empty when it may run.
/// Read-only mode governs first, then <code>countOnly</code>, then the rows-affected cap.
ClassMethod Decline(pType As %Integer, pReadOnly As %Boolean, pCountOnly As %Boolean, pCap As %String) As %String
{
    If pReadOnly && (pType '= 1) Quit "readOnly"
    If pCountOnly && (pType '= 1) Quit "countOnly"
    If (pCap '= "") && ((pType < 1) || (pType > 4)) Quit "capNotCountable"
    Quit ""
}

/// A result object carrying the outcome and the statement type.
ClassMethod NewResult(pOutcome As %String, pType As %Integer, pTypeName As %String) As %DynamicObject
{
    Set tResult = {}
    Do tResult.%Set("outcome", pOutcome)
    Do tResult.%Set("statementType", pType, "number")
    Do tResult.%Set("statementTypeName", pTypeName)
    Quit tResult
}

/// IRIS's name for a statement type number (the routine behind
/// <code>%SQL.StatementResult.%StatementTypeName</code>).
ClassMethod TypeName(pType As %Integer) As %String
{
    Set tName = $$GetTypen^%SYS.SQLSRV(pType)
    If tName = "" Set tName = "type "_pType
    Quit tName
}

/// The error status for a negative SQLCODE: its text carries the SQLCODE and the IRIS message.
ClassMethod SqlStatus(pSQLCODE As %Integer, pMessage As %String) As %Status
{
    Quit ##class(%Exception.SQL).CreateFromSQLCODE(pSQLCODE, pMessage).AsStatus()
}

/// Rolls back to <var>pLevel</var>, one level at a time, so every level above it is undone
/// whatever the statement opened.
ClassMethod RollBackTo(pLevel As %Integer)
{
    For {
        If $TLevel '> pLevel Quit
        TROLLBACK 1
    }
}

/// Counts the rows of a query result without serializing them.
ClassMethod CountRows(pRS As %SQL.StatementResult, Output pCount As %Integer) As %Status
{
    Set tSC = $$$OK
    Set pCount = 0
    While pRS.%Next(.tSC) {
        Set pCount = pCount + 1
    }
    Quit tSC
}

/// Appends the rows of <var>pRS</var>, and of every following result set of a CALL, to
/// <var>pContent</var> as row objects keyed by column name. A result set with no columns (a
/// DML or DDL result) contributes no rows.
ClassMethod Serialize(pRS As %SQL.StatementResult, pContent As %DynamicArray) As %Status
{
    Set tSC = $$$OK
    Set tRS = pRS
    While $IsObject(tRS) && $$$ISOK(tSC) {
        Set tMeta = tRS.%GetMetadata()
        Set tCount = 0
        If $IsObject(tMeta) {
            Set tCols = tMeta.columns
            Set tCount = tCols.Count()
        }
        If tCount > 0 {
            Kill tNames, tTypes
            For tI = 1:1:tCount {
                Set tCol = tCols.GetAt(tI)
                Set tNames(tI) = tCol.colName
                Set tTypes(tI) = tCol.clientType
            }
            While tRS.%Next(.tSC) {
                Set tRow = {}
                For tI = 1:1:tCount {
                    Do ..SetValue(tRow, tNames(tI), tTypes(tI), tRS.%GetData(tI))
                }
                Do pContent.%Push(tRow)
            }
        }
        If $$$ISOK(tSC) Set tRS = tRS.%NextResult()
    }
    Quit tSC
}

/// Sets one column value on a row object by the column's <code>clientType</code>: 3 (double),
/// 5 (integer), 14 (numeric), 15 (currency) and 18 (bigint) are numbers, with a NULL as 0; 16
/// (boolean) is a boolean, with a NULL as false; anything else is a string, with a NULL as an
/// empty string. A string beginning with <code>{</code> or <code>[</code> that parses as JSON
/// is embedded as the parsed value.
ClassMethod SetValue(pRow As %DynamicObject, pName As %String, pClientType As %String, pValue As %String)
{
    If $Case(pClientType, 3:1, 5:1, 14:1, 15:1, 18:1, :0) {
        Do pRow.%Set(pName, +pValue, "number")
        Quit
    }
    If pClientType = 16 {
        Do pRow.%Set(pName, +pValue, "boolean")
        Quit
    }
    Set tEmbedded = 0
    Set tFirst = $Extract(pValue, 1)
    If (tFirst = "{") || (tFirst = "[") {
        Try {
            Set tParsed = ##class(%Library.DynamicAbstractObject).%FromJSON(pValue)
            Do pRow.%Set(pName, tParsed)
            Set tEmbedded = 1
        } Catch {
            Set tEmbedded = 0
        }
    }
    If 'tEmbedded Do pRow.%Set(pName, pValue, "string")
}

/// Device-output entry points for the null device bound in <method>Run</method> by
/// <code>Use tNull::("^"_$ZNAME)</code>. <code>$ZNAME</code> names the routine that is executing,
/// so the entry points must be compiled into the same routine as <method>Run</method>; they
/// discard everything a statement writes to the device.
ClassMethod Redirects() [ Internal, Private, ProcedureBlock = 0 ]
{
    Quit
wstr(s) Quit
wchr(a) Quit
wnl Quit
wff Quit
wtab(n) Quit
rstr(len,time) Quit ""
rchr(time) Quit ""
}

}
