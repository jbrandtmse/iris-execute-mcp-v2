/// Trace loader for the message-trace sequence-diagram library (Epic 21, Story 21.0).
/// <p>Implements the §6.1 data contract of sprint-change-proposal-2026-07-02.md: one
/// read-only dynamic-SQL query over <class>Ens.MessageHeader</class> selecting the
/// 12-column projection (ID, Invocation, MessageBodyClassName, SessionId,
/// SourceConfigName, TargetConfigName, ReturnQueueName, CorrespondingMessageId,
/// TimeCreated, Type, IsError, ErrorStatus) with:</p>
/// <ul>
///   <li>the NULL-safe trace filter <code>(MessageBodyClassName IS NULL OR
///       MessageBodyClassName &lt;&gt; 'HS.Util.Trace.Request')</code> — a bare
///       <code>&lt;&gt;</code> drops bodyless headers under SQL three-valued logic;</li>
///   <li>deterministic ordering <code>ORDER BY TimeCreated, ID</code> with an
///       <code>ORDER BY ID</code> fallback when the primary sort reports a SQLCODE error;</li>
///   <li>a <code>maxRows</code> cap (default 2000, max 10000) with a truncated flag;</li>
///   <li>normalization of <code>Type</code>/<code>Invocation</code> enums and sanitization
///       of <code>ErrorStatus</code> into a one-line summary at load (improvement I1).</li>
/// </ul>
/// <p>Dynamic <class>%SQL.Statement</class> with <code>?</code> parameters is used
/// deliberately (story Amendment A1): embedded SQL would add a compile-time schema
/// dependency on <class>Ens.MessageHeader</class>, which does not exist in
/// non-interoperability namespaces the bootstrap deploys to.</p>
Class ExecuteMCPv2.Diagram.Loader Extends %RegisteredObject
{

/// Load one session's message headers as normalized
/// <class>ExecuteMCPv2.Diagram.Event</class> instances.
/// <p><var>pSessionId</var> must be a positive canonical integer; any other value
/// (empty, junk, zero, negative, fractional) yields an EMPTY list with an OK status —
/// per §6.1 an invalid session id is not an error.</p>
/// <p><var>pMaxRows</var> defaults to 2000 and is clamped to 1..10000. When the session
/// has more rows than the cap, <var>pTruncated</var> is set and the extra rows dropped.</p>
ClassMethod LoadSession(pSessionId As %String = "", pMaxRows As %Integer = 2000, Output pEvents As %Library.ListOfObjects, Output pTruncated As %Boolean) As %Status
{
    Set tSC = $$$OK
    Set pTruncated = 0
    Set pEvents = ##class(%Library.ListOfObjects).%New()
    Try {
        ; Invalid / non-positive / non-integer sessionId -> empty result, not an error (§6.1)
        If (pSessionId = "") || (pSessionId '= +pSessionId) || (+pSessionId <= 0) || (+pSessionId '= (+pSessionId \ 1)) {
            Quit
        }
        Set tMax = +pMaxRows \ 1
        If tMax < 1 Set tMax = 2000
        If tMax > 10000 Set tMax = 10000

        ; Primary ordering: TimeCreated with ID tiebreak; fallback: ID only (§6.1 determinism)
        Set tSC = ..RunQuery(pSessionId, tMax, 1, .pEvents, .pTruncated)
        If $$$ISERR(tSC) {
            Set tSC = ..RunQuery(pSessionId, tMax, 2, .pEvents, .pTruncated)
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Internal query runner. <var>pOrderMode</var> 1 = <code>ORDER BY TimeCreated, ID</code>
/// (primary), 2 = <code>ORDER BY ID</code> (fallback). Exposed as its own method so the
/// fallback path can be exercised directly by unit tests (§6.4 item 2).
ClassMethod RunQuery(pSessionId As %String, pMaxRows As %Integer, pOrderMode As %Integer = 1, Output pEvents As %Library.ListOfObjects, Output pTruncated As %Boolean) As %Status
{
    Set tSC = $$$OK
    Set pTruncated = 0
    Set pEvents = ##class(%Library.ListOfObjects).%New()
    Try {
        Set tList = ##class(%Library.ListOfObjects).%New()
        ; SELECT TOP maxRows+1 so truncation is detectable without a second query
        Set tSQL = "SELECT TOP "_(pMaxRows + 1)_" ID, Invocation, MessageBodyClassName, SessionId, SourceConfigName, TargetConfigName, ReturnQueueName, CorrespondingMessageId, TimeCreated, Type, IsError, ErrorStatus"
        Set tSQL = tSQL_" FROM Ens.MessageHeader WHERE SessionId = ?"
        ; NULL-safe trace filter: bodyless headers (NULL MessageBodyClassName) MUST be retained (§6.4 item 1)
        Set tSQL = tSQL_" AND (MessageBodyClassName IS NULL OR MessageBodyClassName <> 'HS.Util.Trace.Request')"
        If pOrderMode = 1 {
            Set tSQL = tSQL_" ORDER BY TimeCreated, ID"
        } Else {
            Set tSQL = tSQL_" ORDER BY ID"
        }

        Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, +pSessionId)
        If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
            Set tMsg = $Select('$IsObject(tRS): "SQL execution failed", 1: "SQL error: "_tRS.%Message)
            Set tSC = $$$ERROR($$$GeneralError, tMsg)
            Quit
        }

        While tRS.%Next() {
            Set tEv = ##class(ExecuteMCPv2.Diagram.Event).%New()
            Set tEv.Id = tRS.ID
            Set tEv.SessionId = tRS.SessionId
            Set tEv.Source = tRS.SourceConfigName
            Set tEv.Target = tRS.TargetConfigName
            Set tEv.ReturnQueue = tRS.ReturnQueueName
            Set tEv.BodyClass = tRS.MessageBodyClassName
            Set tEv.TimeCreated = tRS.TimeCreated
            Set tCorr = tRS.CorrespondingMessageId
            Set tEv.CorrId = $Select(tCorr = "": "", 1: +tCorr)
            ; Type: 1=Request, 2=Response, 3=Terminate ($$$eMessageType* — EnsConstants.inc:78-80).
            ; Literal values are used instead of the macros so this class compiles in
            ; namespaces without ENSLIB include-file mappings (bootstrap deploys everywhere;
            ; story Amendment A1 rationale). String forms accepted defensively (§6.2).
            Set tRawType = tRS.Type
            If (tRawType = 1) || (tRawType = "Request") {
                Set tEv.Type = "Request"
            } ElseIf (tRawType = 2) || (tRawType = "Response") {
                Set tEv.Type = "Response"
            } Else {
                Set tEv.Type = ""
            }
            ; Invocation: 1=Queue, 2=InProc ($$$eMessageInvocation* — EnsConstants.inc:84-85).
            Set tRawInv = tRS.Invocation
            If (tRawInv = 2) || ($ZConvert(tRawInv, "U") = "INPROC") {
                Set tEv.Invocation = "Inproc"
            } ElseIf (tRawInv = 1) || ($ZConvert(tRawInv, "U") = "QUEUE") {
                Set tEv.Invocation = "Queue"
            } Else {
                Set tEv.Invocation = ""
            }
            ; Improvement I1: sanitize ErrorStatus into a one-line summary at load
            Set tEv.IsError = ''tRS.IsError
            Set tEv.ErrorText = ""
            If tEv.IsError Set tEv.ErrorText = ..SanitizeErrorText(tRS.ErrorStatus)
            Do tList.Insert(tEv)
        }
        If tRS.%SQLCODE < 0 {
            Set tSC = $$$ERROR($$$GeneralError, "SQL fetch error: "_tRS.%Message)
            Quit
        }

        If tList.Count() > pMaxRows {
            Set pTruncated = 1
            Do tList.RemoveAt(pMaxRows + 1)
        }
        Set pEvents = tList
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Convert an <code>ErrorStatus</code> <class>%Status</class> value into a sanitized,
/// single-line, length-capped summary (improvement I1, Rule #33 discipline).
/// <p>Delegates to <method>ExecuteMCPv2.Utils:SanitizeError</method> (strips caret-global
/// and routine references), collapses CR/LF/TAB to spaces, caps at ~200 characters, and
/// falls back to a generic <code>"message reported error"</code> when the status carries
/// no usable text (e.g. IsError=1 with an OK/empty ErrorStatus).</p>
ClassMethod SanitizeErrorText(pErrorStatus As %Status) As %String [ Internal ]
{
    Set tText = ""
    Try {
        If (pErrorStatus '= "") && $System.Status.IsError(pErrorStatus) {
            Set tSafe = ##class(ExecuteMCPv2.Utils).SanitizeError(pErrorStatus)
            Set tText = ..CleanStatusText($System.Status.GetErrorText(tSafe))
        }
    } Catch ex {
        Set tText = ""
    }
    Set tText = $ZStrip($Translate(tText, $Char(13, 10, 9), "   "), "<>W")
    If $Length(tText) > 200 Set tText = $Extract(tText, 1, 197)_"..."
    If tText = "" Set tText = "message reported error"
    Quit tText
}

/// Clean one <code>GetErrorText</code> rendering into a human-readable summary line
/// (shared by <method>SanitizeErrorText</method> and
/// <method>ExecuteMCPv2.Diagram.Generate:ApplyFailure</method>).
/// <p>Two transformations, both no-ops when their shape is absent:</p>
/// <ul>
///   <li><b>Prefix strip</b> (Rule #8 shape): up to three leading
///       <code>&lt;word&gt; #&lt;code&gt;: </code> prefixes are removed — numeric codes
///       (<code>ERROR #5001: </code>, the <class>ExecuteMCPv2.Utils</class> re-wrap) AND
///       word codes (<code>ERROR #ErrGeneral: </code> / locale variants like
///       <code>خطأ #ErrGeneral: </code>, which stack INSIDE the re-wrap when the error
///       domain's message table cannot be resolved — smoke finding 2026-07-03, SADEMO
///       namespace without Ens message-table mappings). Each strip is length-gated so a
///       <code>#</code> deep inside legitimate text is never mistaken for a prefix.
///       Bracket tokens (<code>&lt;Ens&gt;ErrGeneral</code>) are NEVER stripped — they
///       are legitimate error info (Rule #8).</li>
///   <li><b>Boilerplate unwrap</b>: the kernel's unresolved-message-table rendering
///       <code>Unknown status code: &lt;domain&gt;Code (params)</code> is rebuilt into the
///       resolved shape <code>ERROR &lt;domain&gt;Code: params</code>, so I1 error summaries
///       read identically whether or not the namespace has the error-domain message
///       tables mapped. Nested parentheses inside the params are preserved (first
///       <code>" ("</code> to LAST <code>")"</code>).</li>
/// </ul>
ClassMethod CleanStatusText(pText As %String) As %String [ Internal ]
{
    Set tText = pText
    ; strip up to three stacked leading "<word> #<code>: " prefixes; <code> is alphanumeric
    For tStrip = 1:1:3 {
        Set tColon = $Find(tText, ": ")
        Quit:(tColon = 0)||(tColon > 44)
        Quit:'($Extract(tText, 1, tColon - 3) ? .E1"#"1.AN)
        Set tText = $Extract(tText, tColon, *)
    }
    ; unwrap "Unknown status code: <code> (params)" -> "ERROR <code>: params"
    If $Extract(tText, 1, 21) = "Unknown status code: " {
        Set tRest = $Extract(tText, 22, *)
        Set tParen = $Find(tRest, " (")
        Set tClose = 0
        For tI = $Length(tRest):-1:1 {
            If $Extract(tRest, tI) = ")" {
                Set tClose = tI
                Quit
            }
        }
        If (tParen > 0) && (tClose >= tParen) {
            Set tCode = $Extract(tRest, 1, tParen - 3)
            Set tParams = $Extract(tRest, tParen, tClose - 1)
            If (tCode '= "") && (tParams '= "") {
                Set tText = "ERROR "_tCode_": "_tParams
            }
        }
    }
    Quit tText
}

}
