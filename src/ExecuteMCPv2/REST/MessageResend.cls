/// REST handler for Interoperability message resend/replay (Epic 26).
/// <p>Provides a read-only <method>MessageResendPreview</method> (resendability
/// verdicts, never mutates) and a write <method>MessageResend</method> that
/// dispatches on an <code>action</code> body field: <code>resend</code> (an
/// explicit list of header IDs) or <code>resendFiltered</code> (a bounded
/// item/status/time-window scan with a dry-run-first double gate).</p>
/// <p>The ONLY resend API this class calls is the pinned
/// <code>Ens.MessageHeader:ResendDuplicatedMessage</code> (Story 26.0). v1
/// always passes <code>pNewTarget</code>/<code>pNewBody</code>/<code>pNewSource</code>
/// empty — edit-and-resend is out of scope. New header linkage
/// (<code>{originalId, newHeaderId}</code>) is captured in this handler's own
/// response payload, never inferred from header fields (the <code>Resent</code>
/// property is not set by the pinned API).</p>
/// <p>Like <class>ExecuteMCPv2.REST.Interop</class>, Ens.* operations run in the
/// <b>target namespace</b> (not %SYS) — namespace switching via
/// <method>ExecuteMCPv2.Utils:SwitchNamespace</method> is used when a
/// <code>namespace</code> parameter is supplied.</p>
Class ExecuteMCPv2.REST.MessageResend Extends %Atelier.REST
{

/// Map a case-insensitive <code>Ens.DataType.MessageStatus</code> display label
/// (e.g. <code>"Errored"</code>) to its numeric code. Accepts both the DISPLAYLIST
/// spelling ("Error") and the tool contract's spelling ("Errored") for the error
/// status. Returns 0 for an unrecognized label.
ClassMethod StatusLabelToCode(pLabel As %String) As %Integer
{
    Set tLabel = $ZConvert($ZStrip(pLabel, "<>W"), "L")
    Set tCode = 0
    If tLabel = "created" { Set tCode = 1 }
    ElseIf tLabel = "queued" { Set tCode = 2 }
    ElseIf tLabel = "delivered" { Set tCode = 3 }
    ElseIf tLabel = "discarded" { Set tCode = 4 }
    ElseIf tLabel = "suspended" { Set tCode = 5 }
    ElseIf tLabel = "deferred" { Set tCode = 6 }
    ElseIf tLabel = "aborted" { Set tCode = 7 }
    ElseIf (tLabel = "errored") || (tLabel = "error") { Set tCode = 8 }
    ElseIf tLabel = "completed" { Set tCode = 9 }
    Quit tCode
}

/// Reverse of <method>StatusLabelToCode</method> — numeric code to display label
/// (using the "Error" DISPLAYLIST spelling). Returns "" for an out-of-range code.
ClassMethod StatusCodeToLabel(pCode As %Integer) As %String
{
    Set tLabels = $ListBuild("Created", "Queued", "Delivered", "Discarded", "Suspended", "Deferred", "Aborted", "Error", "Completed")
    If (pCode < 1) || (pCode > 9) Quit ""
    Quit $ListGet(tLabels, pCode)
}

/// Normalize a caller-supplied ISO-8601 or ODBC timestamp into the
/// <code>"yyyy-mm-dd hh:mm:ss"</code>-style string that <code>Ens.MessageHeader</code>'s
/// <code>TimeCreated</code> column (an <code>Ens.DataType.UTC</code> / <code>%TimeStamp</code>)
/// compares against lexicographically. Replaces a literal <code>"T"</code> separator
/// with a space, strips a trailing <code>"Z"</code>, and appends a midnight time
/// component to a bare date. Does NOT validate — callers should feed the result
/// through <method>WindowDays</method>, which throws on an unparseable value.
ClassMethod NormalizeTimestamp(pValue As %String) As %String
{
    Set tNorm = $ZStrip(pValue, "<>W")
    Set tNorm = $Replace(tNorm, "T", " ")
    If $Extract(tNorm, *) = "Z" { Set tNorm = $Extract(tNorm, 1, *-1) }
    If tNorm '[ " " { Set tNorm = tNorm _ " 00:00:00" }
    Quit tNorm
}

/// Compute the (fractional) number of days between two normalized timestamps
/// (<method>NormalizeTimestamp</method> output) via <code>$ZDATETIMEH</code>.
/// Returns a non-OK <var>%Status</var> if either value fails to parse as a valid
/// date/time (the guard-facing "invalid timestamp" signal). <var>pDays</var> is
/// negative when <var>pToNorm</var> precedes <var>pFromNorm</var>.
ClassMethod WindowDays(pFromNorm As %String, pToNorm As %String, Output pDays As %Numeric) As %Status
{
    Set tSC = $$$OK
    Set pDays = 0
    Try {
        Set tFromH = $ZDATETIMEH(pFromNorm, 3)
        Set tToH = $ZDATETIMEH(pToNorm, 3)
        Set tFromDay = $Piece(tFromH, ",", 1)
        Set tFromSec = $Piece(tFromH, ",", 2)
        Set tToDay = $Piece(tToH, ",", 1)
        Set tToSec = $Piece(tToH, ",", 2)
        Set pDays = ((tToDay - tFromDay) * 86400 + (tToSec - tFromSec)) / 86400
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Validate a <code>headerIds</code> JSON array: must be an array of 1-100
/// entries, each a numeric (positive-integer-string) header ID. On success,
/// <var>pIds</var> is populated <code>pIds(0)=count</code>, <code>pIds(i)=+id</code>
/// for <code>i=1..count</code>. Returns the first validation failure as a
/// descriptive <var>%Status</var> — input hygiene guard (a), Rule #29 spirit.
ClassMethod ValidateHeaderIds(pArr As %DynamicArray, Output pIds) As %Status
{
    Set tSC = $$$OK
    Kill pIds
    Set pIds(0) = 0
    Try {
        If '$IsObject(pArr) {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'headerIds' must be a non-empty array of 1-100 numeric header IDs")
            Quit
        }
        Set tCount = pArr.%Size()
        If (tCount < 1) || (tCount > 100) {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'headerIds' must contain between 1 and 100 header IDs (found "_tCount_")")
            Quit
        }
        Set tIter = pArr.%GetIterator()
        Set tN = 0
        While tIter.%GetNext(.tIdx, .tRaw) {
            Set tN = tN + 1
            Set tRawStr = $ZStrip(tRaw, "<>W")
            If (tRawStr = "") || (tRawStr '? 1.N) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'headerIds' must contain only numeric header IDs (invalid value: '"_tRaw_"')")
                Quit
            }
            Set pIds(tN) = +tRawStr
        }
        If $$$ISOK(tSC) { Set pIds(0) = tN }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Resendability verdict + reason for one header, per the Story 26.0 observed
/// semantics: a Request-type header with Status=Error(8) is the correct retry
/// target ("recommended"); a Response-type header with IsError=true is
/// resendable-but-likely-a-no-op ("caution"); everything else is informational
/// ("note"). A missing message-body class always escalates to (at least)
/// "caution" and appends a warning, since <code>ResendDuplicatedMessage</code>
/// never validates body-class existence and the failure is invisible on the
/// header (only in the Event Log). Returns <code>$ListBuild(verdict, reason)</code>.
/// <p><b>Reviewable:</b> the exact verdict wording is a recommended default per
/// Story 26.0's Dev Notes, not a fixed product spec — product may refine.</p>
ClassMethod Verdict(pType As %Integer, pStatusCode As %Integer, pIsError As %Boolean, pBodyClass As %String, pBodyClassExists As %Boolean) As %String
{
    Set tVerdict = "note"
    Set tReason = "This message is not in an error state; resending will redeliver it and re-run the downstream pipeline from this hop."
    If (pType = 1) && (pStatusCode = 8) {
        Set tVerdict = "recommended"
        Set tReason = "This is the failed REQUEST message (Status=Error); resending will retry delivery to the target — the correct retry target for a failed message."
    }
    ElseIf (pType = 2) && pIsError {
        Set tVerdict = "caution"
        Set tReason = "This is a Response-type error payload FROM a failed operation; resending it is typically a no-op because the original session correlation is gone. Consider resending the original REQUEST header instead."
    }
    ElseIf (pType = 1) && pIsError {
        Set tVerdict = "recommended"
        Set tReason = "This Request message is flagged as an error; resending will retry delivery to the target."
    }
    If (pBodyClass '= "") && 'pBodyClassExists {
        Set tReason = tReason _ " WARNING: message body class '" _ pBodyClass _ "' no longer exists — resend will succeed at the header level, but the target will fail when it tries to open the body (visible only in the Ensemble Event Log)."
        If tVerdict = "recommended" { Set tVerdict = "caution" }
    }
    Quit $ListBuild(tVerdict, tReason)
}

/// Best-effort first-~1KB sanitized summary of a message body. Returns "" when
/// the body class is empty/missing/nonexistent or the body cannot be opened.
/// Only stream bodies (<code>%Extends("%Stream.Object")</code>) yield content;
/// other body classes yield a generic class-name note rather than attempting a
/// per-class serialization. Control characters (other than tab) are replaced
/// with a space. Never throws.
ClassMethod BodySummary(pBodyClass As %String, pBodyId As %String, pBodyClassExists As %Boolean) As %String
{
    Set tSummary = ""
    Try {
        If (pBodyClass = "") || (pBodyId = "") || 'pBodyClassExists { Quit }
        Set tObj = $ClassMethod(pBodyClass, "%OpenId", pBodyId)
        If '$IsObject(tObj) { Quit }
        Set tRaw = ""
        If $ClassMethod(pBodyClass, "%Extends", "%Stream.Object") {
            Do tObj.Rewind()
            Set tRaw = tObj.Read(1024)
        }
        Else {
            Set tRaw = "(non-stream body; class=" _ pBodyClass _ ")"
        }
        Set tClean = ""
        Set tLen = $Length(tRaw)
        For i=1:1:tLen {
            Set tCh = $Extract(tRaw, i)
            Set tCode = $Ascii(tCh)
            If (tCode >= 32) || (tCode = 9) { Set tClean = tClean _ tCh }
            Else { Set tClean = tClean _ " " }
        }
        If tLen >= 1024 { Set tClean = tClean _ "..." }
        Set tSummary = tClean
    } Catch {
        Set tSummary = ""
    }
    Quit tSummary
}

/// Build the preview payload for one header ID. Never throws (all failure
/// paths are captured as <code>{id, found:false, error}</code>) — the caller
/// still wraps this in a per-message Try/Catch as defense-in-depth.
ClassMethod PreviewOne(pId As %Integer) As %DynamicObject
{
    Set tItem = {}
    Try {
        Set tSQL = "SELECT ID, Type, MessageBodyClassName, MessageBodyId, SourceConfigName, TargetConfigName, TimeCreated, TimeProcessed, Status, SessionId, IsError, CorrespondingMessageId FROM Ens.MessageHeader WHERE ID = ?"
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, pId)
        If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
            Do tItem.%Set("id", pId, "number")
            Do tItem.%Set("found", 0, "boolean")
            Do tItem.%Set("error", "SQL query failed")
            Quit
        }
        If 'tRS.%Next() {
            Do tItem.%Set("id", pId, "number")
            Do tItem.%Set("found", 0, "boolean")
            Do tItem.%Set("error", "Header " _ pId _ " not found")
            Quit
        }

        Set tType = +tRS.Type
        Set tStatusCode = +tRS.Status
        Set tIsError = +tRS.IsError
        Set tBodyClass = tRS.MessageBodyClassName
        Set tBodyClassExists = 0
        If tBodyClass '= "" { Set tBodyClassExists = ##class(%Dictionary.CompiledClass).%ExistsId(tBodyClass) }

        Do tItem.%Set("id", pId, "number")
        Do tItem.%Set("found", 1, "boolean")
        Do tItem.%Set("sessionId", +tRS.SessionId, "number")
        Do tItem.%Set("type", $Select(tType=1:"Request", tType=2:"Response", tType=3:"Terminate", 1:"Unknown"))
        Do tItem.%Set("sourceItem", tRS.SourceConfigName)
        Do tItem.%Set("targetItem", tRS.TargetConfigName)
        Do tItem.%Set("status", ..StatusCodeToLabel(tStatusCode))
        Do tItem.%Set("isError", tIsError, "boolean")
        Do tItem.%Set("timeCreated", tRS.TimeCreated)
        If tRS.TimeProcessed '= "" { Do tItem.%Set("timeProcessed", tRS.TimeProcessed) }
        Do tItem.%Set("bodyClassName", tBodyClass)
        Do tItem.%Set("bodyClassExists", tBodyClassExists, "boolean")
        If tRS.CorrespondingMessageId '= "" { Do tItem.%Set("correspondingMessageId", +tRS.CorrespondingMessageId, "number") }
        Do tItem.%Set("bodySummary", ..BodySummary(tBodyClass, tRS.MessageBodyId, tBodyClassExists))

        Set tVerdict = ..Verdict(tType, tStatusCode, tIsError, tBodyClass, tBodyClassExists)
        Do tItem.%Set("verdict", $ListGet(tVerdict, 1))
        Do tItem.%Set("reason", $ListGet(tVerdict, 2))
    } Catch ex {
        Set tItem = {}
        Do tItem.%Set("id", pId, "number")
        Do tItem.%Set("found", 0, "boolean")
        Do tItem.%Set("error", $System.Status.GetErrorText(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus())))
    }
    Quit tItem
}

/// Read-only resend preview. Accepts a JSON body with <code>headerIds</code>
/// (array of 1-100 numeric IDs, required) and optional <code>namespace</code>.
/// Per header: id, session, source/target item, status, time, body classname
/// (+ existence check), body summary, and a resendability verdict + reason.
/// Never mutates.
ClassMethod MessageResendPreview() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tHeaderIdsArr = ""
        If tBody.%IsDefined("headerIds") { Set tHeaderIdsArr = tBody.%Get("headerIds") }
        Set tSC = ..ValidateHeaderIds(tHeaderIdsArr, .tIds)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tNamespace = tBody.%Get("namespace")
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        Set tCount = tIds(0)
        Set tHeaders = []
        For i=1:1:tCount {
            Set tId = tIds(i)
            Try {
                Set tHeaderItem = ..PreviewOne(tId)
            } Catch exInner {
                Set tHeaderItem = {}
                Do tHeaderItem.%Set("id", tId, "number")
                Do tHeaderItem.%Set("found", 0, "boolean")
                Do tHeaderItem.%Set("error", $System.Status.GetErrorText(##class(ExecuteMCPv2.Utils).SanitizeError(exInner.AsStatus())))
            }
            Do tHeaders.%Push(tHeaderItem)
        }

        Set $NAMESPACE = tOrigNS
        Set tResult = {}
        Do tResult.%Set("headers", tHeaders)
        Do tResult.%Set("count", tHeaders.%Size(), "number")
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Resend one header via the pinned <code>Ens.MessageHeader:ResendDuplicatedMessage</code>
/// API (v1 always passes empty target/body/source). Never throws — a failure is
/// captured as <code>{originalId, ok:false, error}</code> so a per-batch caller
/// can continue past a bad header (spec §3, AC 26.1.1 per-message Try/Catch).
ClassMethod ResendOne(pId As %Integer, pHeadOfQueue As %Boolean) As %DynamicObject
{
    Set tItem = {}
    Try {
        Set tNewId = ""
        Set tRSC = ##class(Ens.MessageHeader).ResendDuplicatedMessage(pId, .tNewId, "", "", "", pHeadOfQueue)
        Do tItem.%Set("originalId", pId, "number")
        If $$$ISOK(tRSC) {
            Do tItem.%Set("newHeaderId", +tNewId, "number")
            Do tItem.%Set("ok", 1, "boolean")
        }
        Else {
            Do tItem.%Set("ok", 0, "boolean")
            Do tItem.%Set("error", $System.Status.GetErrorText(##class(ExecuteMCPv2.Utils).SanitizeError(tRSC)))
        }
    } Catch ex {
        Set tItem = {}
        Do tItem.%Set("originalId", pId, "number")
        Do tItem.%Set("ok", 0, "boolean")
        Do tItem.%Set("error", $System.Status.GetErrorText(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus())))
    }
    Quit tItem
}

/// Run a batch of <method>ResendOne</method> calls, returning
/// <code>{results:[...], summary:{total,succeeded,failed}}</code> fields set
/// directly on <var>pResult</var>.
ClassMethod ResendBatch(ByRef pIds, pHeadOfQueue As %Boolean, pResult As %DynamicObject)
{
    Set tCount = pIds(0)
    Set tResults = []
    Set tSucceeded = 0
    Set tFailed = 0
    For i=1:1:tCount {
        Set tItem = ..ResendOne(pIds(i), pHeadOfQueue)
        If tItem.%Get("ok") { Set tSucceeded = tSucceeded + 1 }
        Else { Set tFailed = tFailed + 1 }
        Do tResults.%Push(tItem)
    }
    Do pResult.%Set("results", tResults)
    Set tSummary = {}
    Do tSummary.%Set("total", tSucceeded + tFailed, "number")
    Do tSummary.%Set("succeeded", tSucceeded, "number")
    Do tSummary.%Set("failed", tFailed, "number")
    Do pResult.%Set("summary", tSummary)
}

/// Resend messages — dispatches on the required <code>action</code> body field:
/// <ul>
///   <li><code>resend</code> — <code>headerIds</code> (array of 1-100 numeric IDs,
///       required), optional <code>headOfQueue</code>/<code>namespace</code>.
///       Resends each listed header directly (no dry-run gate — the caller has
///       already named the exact, bounded set of IDs).</li>
///   <li><code>resendFiltered</code> — <code>item</code> + <code>from</code>
///       (required), optional <code>status</code> (default "Errored"),
///       <code>to</code> (default now), <code>maxMessages</code> (default 100,
///       hard cap 500), <code>dryRun</code> (default true), <code>confirm</code>
///       (default false), <code>namespace</code>. Enumerates matching headers
///       (item = source OR target config name) via the same query shape as
///       <class>ExecuteMCPv2.REST.Interop</class>'s message-trace query, adding
///       item/status/time-window filters (Rule #38 bounded scope). Executing
///       (rather than previewing) requires <code>dryRun:false</code> AND
///       <code>confirm:true</code> (Epic-20 double-gate pattern) and refuses if
///       the matched count exceeds the effective cap.</li>
/// </ul>
/// <p>Every guard refusal returns the standard envelope with
/// <code>result:{}</code> and mutates nothing (AC 26.1.2).</p>
ClassMethod MessageResend() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "resend") && (tAction '= "resendFiltered") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: resend, resendFiltered")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tNamespace = tBody.%Get("namespace")

        If tAction = "resend" {
            ; --- Guard (a): headerIds structural validation (input hygiene) ---
            Set tHeaderIdsArr = ""
            If tBody.%IsDefined("headerIds") { Set tHeaderIdsArr = tBody.%Get("headerIds") }
            Set tSC = ..ValidateHeaderIds(tHeaderIdsArr, .tIds)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tHeadOfQueue = +tBody.%Get("headOfQueue")

            If tNamespace '= "" {
                Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
                If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            }

            ; --- Guard (f): production-running precheck — fast/clear refusal
            ; before attempting N resends, per Story 26.0 observed semantics ---
            If '##class(Ens.Director).IsProductionRunning() {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Cannot resend: no Interoperability production is running in this namespace. Start the production first. No changes were made.")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tResult = {}
            Do tResult.%Set("action", "resend")
            Do ..ResendBatch(.tIds, tHeadOfQueue, tResult)

            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "resendFiltered" {
            ; --- Guard (b): item + from required (bounded scope, Rule #38) ---
            Set tItemName = tBody.%Get("item")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tItemName, "item")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tFrom = tBody.%Get("from")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tFrom, "from")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tTo = tBody.%Get("to")
            Set tStatusLabel = tBody.%Get("status")
            If tStatusLabel = "" { Set tStatusLabel = "Errored" }
            Set tStatusCode = ..StatusLabelToCode(tStatusLabel)
            If tStatusCode = 0 {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'status' must be one of: Created, Queued, Delivered, Discarded, Suspended, Deferred, Aborted, Errored, Completed")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tFromNorm = ..NormalizeTimestamp(tFrom)
            If tTo = "" { Set tToNorm = $ZDATETIME($ZTIMESTAMP, 3) }
            Else { Set tToNorm = ..NormalizeTimestamp(tTo) }

            Set tSC = ..WindowDays(tFromNorm, tToNorm, .tDays)
            If $$$ISERR(tSC) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameters 'from'/'to' must be valid ISO-8601 or ODBC timestamps")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; --- Guard (c): window bounds ---
            If tDays < 0 {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'from' must be earlier than 'to' (the requested window is negative). No changes were made.")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            If tDays > 7 {
                Set tSC = $$$ERROR($$$GeneralError, "The 'from'/'to' window spans approximately " _ $FNumber(tDays, "", 2) _ " days, exceeding the maximum allowed window of 7 days; narrow the range and retry. No changes were made.")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; --- maxMessages bounds (default 100, hard cap 500) ---
            Set tMaxMessages = 100
            If tBody.%IsDefined("maxMessages") { Set tMaxMessages = +tBody.%Get("maxMessages") }
            If tMaxMessages < 1 {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'maxMessages' must be a positive integer")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            If tMaxMessages > 500 {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'maxMessages' exceeds the hard cap of 500 (got " _ tMaxMessages _ ")")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; --- dryRun/confirm double-gate (Epic-20 pattern) — structural,
            ; checked before any namespace switch or IRIS-state query ---
            Set tDryRun = 1
            If tBody.%IsDefined("dryRun") { Set tDryRun = +tBody.%Get("dryRun") }
            Set tConfirm = 0
            If tBody.%IsDefined("confirm") { Set tConfirm = +tBody.%Get("confirm") }

            ; --- Guard (e): execute requires dryRun:false AND confirm:true ---
            If 'tDryRun && 'tConfirm {
                Set tSC = $$$ERROR($$$GeneralError, "resendFiltered execution requires dryRun:false and confirm:true; by default dryRun is true and only previews matching messages without resending. No changes were made.")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            If tNamespace '= "" {
                Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
                If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            }

            ; --- Enumerate matches (item = source OR target; status; window) ---
            Set tCountSQL = "SELECT COUNT(*) AS cnt FROM Ens.MessageHeader WHERE (SourceConfigName = ? OR TargetConfigName = ?) AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ?"
            Set tCountRS = ##class(%SQL.Statement).%ExecDirect(, tCountSQL, tItemName, tItemName, tStatusCode, tFromNorm, tToNorm)
            If '$IsObject(tCountRS) || (tCountRS.%SQLCODE < 0) {
                Set $NAMESPACE = tOrigNS
                Set tMsg = $Select('$IsObject(tCountRS): "SQL execution failed", 1: "SQL error: " _ tCountRS.%Message)
                Set tSC = $$$ERROR($$$GeneralError, tMsg)
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Do tCountRS.%Next()
            Set tMatchCount = +tCountRS.cnt

            If 'tDryRun {
                ; --- Guard (d): count > cap → refuse, NAMING the count found ---
                If tMatchCount > tMaxMessages {
                    Set $NAMESPACE = tOrigNS
                    Set tSC = $$$ERROR($$$GeneralError, tMatchCount _ " messages match the filter, exceeding the maxMessages cap of " _ tMaxMessages _ "; narrow the time window or item filter and retry. No changes were made.")
                    Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                    Set tSC = $$$OK
                    Quit
                }

                ; --- Guard (f): production-running precheck ---
                If '##class(Ens.Director).IsProductionRunning() {
                    Set $NAMESPACE = tOrigNS
                    Set tSC = $$$ERROR($$$GeneralError, "Cannot resend: no Interoperability production is running in this namespace. Start the production first. No changes were made.")
                    Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                    Set tSC = $$$OK
                    Quit
                }

                Set tFetchSQL = "SELECT TOP " _ tMaxMessages _ " ID FROM Ens.MessageHeader WHERE (SourceConfigName = ? OR TargetConfigName = ?) AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ? ORDER BY TimeCreated"
                Set tFetchRS = ##class(%SQL.Statement).%ExecDirect(, tFetchSQL, tItemName, tItemName, tStatusCode, tFromNorm, tToNorm)
                Set tIds(0) = 0
                If $IsObject(tFetchRS) && (tFetchRS.%SQLCODE >= 0) {
                    Set tN = 0
                    While tFetchRS.%Next() {
                        Set tN = tN + 1
                        Set tIds(tN) = +tFetchRS.ID
                    }
                    Set tIds(0) = tN
                }

                Set tResult = {}
                Do tResult.%Set("action", "resendFiltered")
                Do tResult.%Set("dryRun", 0, "boolean")
                Do tResult.%Set("matchCount", tMatchCount, "number")
                Do ..ResendBatch(.tIds, 0, tResult)

                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody($$$OK, , tResult)
            }
            Else {
                ; --- Dry run: count + first-20 sample, resends nothing ---
                Set tSampleSQL = "SELECT TOP 20 ID, SourceConfigName, TargetConfigName, Status, TimeCreated, SessionId FROM Ens.MessageHeader WHERE (SourceConfigName = ? OR TargetConfigName = ?) AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ? ORDER BY TimeCreated"
                Set tSampleRS = ##class(%SQL.Statement).%ExecDirect(, tSampleSQL, tItemName, tItemName, tStatusCode, tFromNorm, tToNorm)
                Set tSample = []
                If $IsObject(tSampleRS) && (tSampleRS.%SQLCODE >= 0) {
                    While tSampleRS.%Next() {
                        Set tRow = {}
                        Do tRow.%Set("id", +tSampleRS.ID, "number")
                        Do tRow.%Set("sourceItem", tSampleRS.SourceConfigName)
                        Do tRow.%Set("targetItem", tSampleRS.TargetConfigName)
                        Do tRow.%Set("status", ..StatusCodeToLabel(+tSampleRS.Status))
                        Do tRow.%Set("timeCreated", tSampleRS.TimeCreated)
                        Do tRow.%Set("sessionId", +tSampleRS.SessionId, "number")
                        Do tSample.%Push(tRow)
                    }
                }

                Set $NAMESPACE = tOrigNS
                Set tResult = {}
                Do tResult.%Set("action", "resendFiltered")
                Do tResult.%Set("dryRun", 1, "boolean")
                Do tResult.%Set("matchCount", tMatchCount, "number")
                Do tResult.%Set("sample", tSample)
                Do tResult.%Set("item", tItemName)
                Do tResult.%Set("status", tStatusLabel)
                Do tResult.%Set("from", tFromNorm)
                Do tResult.%Set("to", tToNorm)
                Do tResult.%Set("maxMessages", tMaxMessages, "number")
                Do ..RenderResponseBody($$$OK, , tResult)
            }
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}
