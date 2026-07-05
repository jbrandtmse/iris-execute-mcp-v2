/// Unit tests for <class>ExecuteMCPv2.Diagram.Loader</class> (Story 21.0, AC 21.0.2/21.0.12).
/// <p>Exercises the §6.1 data contract against LIVE <class>Ens.MessageHeader</class> rows
/// inserted under reserved synthetic SessionIds (990000001+ — far above any real session
/// on the dev instance) and deleted in <method>OnAfterOneTest</method>. Fixture names are
/// synthetic <code>Demo.*</code> values (decision G2 clean-room).</p>
/// <p>Covers: NULL-body retention (§6.4 item 1), the HS.Util.Trace.Request filter,
/// TimeCreated-primary/ID-tiebreak ordering plus the ID-only fallback (§6.4 item 2),
/// maxRows truncation (§6.4 item 10), invalid-sessionId empty result, enum
/// normalization, and I1 ErrorStatus sanitization.</p>
Class ExecuteMCPv2.Tests.DiagramLoaderTest Extends %UnitTest.TestCase
{

/// IDs of Ens.MessageHeader rows created by the current test method (killed in teardown).
Property CreatedIds [ MultiDimensional ];

/// Reserved synthetic SessionId range base — real session ids are far lower.
Parameter SESSIONBASE = 990000000;

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Delete every header row created by the test, then sweep the reserved session range
/// as a belt-and-braces guard against leaked fixtures.
Method OnAfterOneTest(testname As %String) As %Status
{
    Set tId = ""
    For {
        Set tId = $Order(..CreatedIds(tId))
        Quit:tId=""
        Do ##class(Ens.MessageHeader).%DeleteId(tId)
    }
    Kill ..CreatedIds
    Set tSQL = "DELETE FROM Ens.MessageHeader WHERE SessionId >= ? AND SessionId <= ?"
    Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, ..#SESSIONBASE + 1, ..#SESSIONBASE + 99)
    ; CR 21.0 review: a silently failed sweep would leak fixture rows into later runs.
    If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
        Do $$$AssertTrue(0, "Fixture sweep failed: "_$Select($IsObject(tRS): tRS.%Message, 1: "no result object"))
    }
    Quit $$$OK
}

/// Insert one Ens.MessageHeader fixture row; returns the new row ID (tracked for teardown).
Method InsertHeader(pSessionId As %Integer, pType As %Integer, pInv As %Integer, pSrc As %String, pDst As %String, pBody As %String, pTimeCreated As %String, pIsError As %Boolean = 0, pErrorStatus As %Status = "", pCorrId As %String = "", pReturnQueue As %String = "") As %String
{
    Set tH = ##class(Ens.MessageHeader).%New()
    Set tH.SessionId = pSessionId
    Set tH.Type = pType
    Set tH.Invocation = pInv
    Set tH.SourceConfigName = pSrc
    Set tH.TargetConfigName = pDst
    If pBody '= "" Set tH.MessageBodyClassName = pBody
    Set tH.TimeCreated = pTimeCreated
    If pIsError {
        Set tH.IsError = 1
        If pErrorStatus '= "" Set tH.ErrorStatus = pErrorStatus
    }
    If pCorrId '= "" Set tH.CorrespondingMessageId = pCorrId
    If pReturnQueue '= "" Set tH.ReturnQueueName = pReturnQueue
    Set tSC = tH.%Save()
    Do $$$AssertStatusOK(tSC, "Fixture header %Save should succeed")
    Set tId = tH.%Id()
    If tId '= "" Set ..CreatedIds(tId) = 1
    Quit tId
}

/// Basic load: rows come back with normalized Type/Invocation values.
Method TestLoadSimpleSession() As %Status
{
    Set tSession = ..#SESSIONBASE + 1
    Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.Req", "2026-07-02 10:00:01")
    Do ..InsertHeader(tSession, 2, 2, "Demo.Process", "Demo.Service", "Demo.Msg.Resp", "2026-07-02 10:00:02")
    Do ..InsertHeader(tSession, 1, 1, "Demo.Process", "Demo.Operation", "Demo.Msg.Fwd", "2026-07-02 10:00:03")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(tSession, 2000, .tEvents, .tTruncated)
    Do $$$AssertStatusOK(tSC, "LoadSession should succeed")
    Do $$$AssertEquals(tEvents.Count(), 3, "All three rows loaded")
    Do $$$AssertEquals(tTruncated, 0, "Not truncated")
    Do $$$AssertEquals(tEvents.GetAt(1).Type, "Request", "Type 1 normalized to Request")
    Do $$$AssertEquals(tEvents.GetAt(2).Type, "Response", "Type 2 normalized to Response")
    Do $$$AssertEquals(tEvents.GetAt(1).Invocation, "Inproc", "Invocation 2 normalized to Inproc")
    Do $$$AssertEquals(tEvents.GetAt(3).Invocation, "Queue", "Invocation 1 normalized to Queue")
    Do $$$AssertEquals(tEvents.GetAt(1).Source, "Demo.Service", "Source loaded")
    Do $$$AssertEquals(tEvents.GetAt(1).SessionId, tSession, "SessionId loaded")
    Quit $$$OK
}

/// §6.4 item 1: rows with NULL MessageBodyClassName MUST be retained by the trace filter.
Method TestNullBodyRetained() As %Status
{
    Set tSession = ..#SESSIONBASE + 2
    Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.Req", "2026-07-02 10:00:01")
    Do ..InsertHeader(tSession, 2, 2, "Demo.Process", "Demo.Service", "", "2026-07-02 10:00:02")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(tSession, 2000, .tEvents, .tTruncated)
    Do $$$AssertStatusOK(tSC, "LoadSession should succeed")
    Do $$$AssertEquals(tEvents.Count(), 2, "NULL-body row retained (NULL-safe filter)")
    Do $$$AssertEquals(tEvents.GetAt(2).BodyClass, "", "Bodyless row loads with empty BodyClass")
    Quit $$$OK
}

/// The trace filter excludes HS.Util.Trace.Request bodies (and only those).
Method TestTraceFilterExcluded() As %Status
{
    Set tSession = ..#SESSIONBASE + 3
    Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.Req", "2026-07-02 10:00:01")
    Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "HS.Util.Trace.Request", "2026-07-02 10:00:02")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(tSession, 2000, .tEvents, .tTruncated)
    Do $$$AssertStatusOK(tSC, "LoadSession should succeed")
    Do $$$AssertEquals(tEvents.Count(), 1, "Trace-utility row excluded")
    Do $$$AssertEquals(tEvents.GetAt(1).BodyClass, "Demo.Msg.Req", "Business row retained")
    Quit $$$OK
}

/// §6.4 item 2: TimeCreated is the primary sort; equal timestamps break ties by ID.
Method TestOrderingTimePrimaryIdTiebreak() As %Status
{
    Set tSession = ..#SESSIONBASE + 4
    Set tIdA = ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.A", "2026-07-02 10:00:02")
    Set tIdB = ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.B", "2026-07-02 10:00:01")
    Set tIdC = ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.C", "2026-07-02 10:00:01")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(tSession, 2000, .tEvents, .tTruncated)
    Do $$$AssertStatusOK(tSC, "LoadSession should succeed")
    Do $$$AssertEquals(tEvents.Count(), 3, "All rows loaded")
    Do $$$AssertEquals(tEvents.GetAt(1).Id, tIdB, "Earlier TimeCreated sorts first (B)")
    Do $$$AssertEquals(tEvents.GetAt(2).Id, tIdC, "Equal timestamps tie-break by ID (C after B)")
    Do $$$AssertEquals(tEvents.GetAt(3).Id, tIdA, "Later TimeCreated sorts last (A)")
    Quit $$$OK
}

/// §6.4 item 2: the ID-only fallback ordering path works when invoked directly.
Method TestFallbackOrderById() As %Status
{
    Set tSession = ..#SESSIONBASE + 5
    Set tIdA = ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.A", "2026-07-02 10:00:02")
    Set tIdB = ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.B", "2026-07-02 10:00:01")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).RunQuery(tSession, 2000, 2, .tEvents, .tTruncated)
    Do $$$AssertStatusOK(tSC, "RunQuery fallback mode should succeed")
    Do $$$AssertEquals(tEvents.Count(), 2, "Both rows loaded via fallback")
    Do $$$AssertEquals(tEvents.GetAt(1).Id, tIdA, "Fallback orders by ID (A first despite later time)")
    Do $$$AssertEquals(tEvents.GetAt(2).Id, tIdB, "Fallback orders by ID (B second)")
    Quit $$$OK
}

/// §6.4 item 10: maxRows caps the load and sets the truncated flag; the extra row is dropped.
Method TestTruncation() As %Status
{
    Set tSession = ..#SESSIONBASE + 6
    For tI = 1:1:4 {
        Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.R"_tI, "2026-07-02 10:00:0"_tI)
    }
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(tSession, 3, .tEvents, .tTruncated)
    Do $$$AssertStatusOK(tSC, "LoadSession should succeed")
    Do $$$AssertEquals(tEvents.Count(), 3, "Load capped at maxRows")
    Do $$$AssertEquals(tTruncated, 1, "Truncated flag set")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(tSession, 10, .tEvents2, .tTruncated2)
    Do $$$AssertStatusOK(tSC, "LoadSession should succeed with room to spare")
    Do $$$AssertEquals(tEvents2.Count(), 4, "All rows load under the cap")
    Do $$$AssertEquals(tTruncated2, 0, "Truncated flag clear under the cap")
    Quit $$$OK
}

/// Invalid / non-positive sessionIds yield an EMPTY result with an OK status — not an error.
Method TestInvalidSessionIdEmpty() As %Status
{
    For tBad = 0, -1, "abc", "", "1.5" {
        Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(tBad, 2000, .tEvents, .tTruncated)
        Do $$$AssertStatusOK(tSC, "LoadSession('"_tBad_"') returns OK")
        Do $$$AssertEquals(tEvents.Count(), 0, "LoadSession('"_tBad_"') returns empty list")
        Do $$$AssertEquals(tTruncated, 0, "LoadSession('"_tBad_"') not truncated")
    }
    Quit $$$OK
}

/// A syntactically valid but unknown sessionId also yields an empty result.
Method TestUnknownSessionEmpty() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(..#SESSIONBASE + 98, 2000, .tEvents, .tTruncated)
    Do $$$AssertStatusOK(tSC, "LoadSession for unknown session returns OK")
    Do $$$AssertEquals(tEvents.Count(), 0, "Unknown session returns empty list")
    Quit $$$OK
}

/// Improvement I1: ErrorStatus is sanitized at load — single line, no caret-global refs.
Method TestErrorStatusSanitized() As %Status
{
    Set tSession = ..#SESSIONBASE + 7
    Set tBadStatus = $$$ERROR($$$GeneralError, "boom writing ^Demo.Global(1)"_$Char(10)_"second line")
    Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.Req", "2026-07-02 10:00:01", 1, tBadStatus)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(tSession, 2000, .tEvents, .tTruncated)
    Do $$$AssertStatusOK(tSC, "LoadSession should succeed")
    Do $$$AssertEquals(tEvents.Count(), 1, "Errored row loaded")
    Set tEv = tEvents.GetAt(1)
    Do $$$AssertTrue(tEv.IsError, "IsError flag loaded")
    Do $$$AssertTrue(tEv.ErrorText '= "", "ErrorText populated")
    Do $$$AssertTrue(tEv.ErrorText [ "boom", "Sanitized text keeps the human-readable part")
    Do $$$AssertTrue('(tEv.ErrorText [ "^"), "Caret-global reference stripped (Rule #33)")
    Do $$$AssertTrue('(tEv.ErrorText [ $Char(10)), "ErrorText collapsed to a single line")
    Do $$$AssertTrue('(tEv.ErrorText [ "ERROR #"), "No ERROR # prefix in the I1 summary (Rule #8 strip)")
    Quit $$$OK
}

/// I1 fallback: IsError with an OK ErrorStatus loads the generic summary.
Method TestErrorGenericWhenStatusOk() As %Status
{
    Set tSession = ..#SESSIONBASE + 8
    Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.Req", "2026-07-02 10:00:01", 1, "")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(tSession, 2000, .tEvents, .tTruncated)
    Do $$$AssertStatusOK(tSC, "LoadSession should succeed")
    Do $$$AssertEquals(tEvents.GetAt(1).ErrorText, "message reported error", "Generic summary when ErrorStatus is empty/OK")
    Quit $$$OK
}

/// Post-epic smoke fix (2026-07-03): CleanStatusText strips word-code prefixes and
/// rebuilds the kernel's unresolved-message-table boilerplate into the resolved shape,
/// so I1 summaries read identically whether or not the namespace maps the error-domain
/// message tables. Direct unit tests with crafted GetErrorText renderings.
Method TestCleanStatusTextUnwrapsUnresolvedBoilerplate() As %Status
{
    ; numeric prefix strip (pre-existing Rule #8 shape) still works
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText("ERROR #5001: boom"), "boom", "Numeric code prefix stripped")
    ; word-code prefix + boilerplate (the SADEMO shape) rebuilds to the resolved form,
    ; nested parens preserved
    Set tRaw = "ERROR #ErrGeneral: Unknown status code: <Ens>ErrGeneral (Injected SQL persist failure for OrderId=ORD-000004 (sample error mode))"
    Set tWant = "ERROR <Ens>ErrGeneral: Injected SQL persist failure for OrderId=ORD-000004 (sample error mode)"
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText(tRaw), tWant, "Word-code prefix stripped and boilerplate unwrapped to the resolved shape")
    ; the exact LIVE shape: Utils re-wrap prefix STACKED on the word-code prefix
    ; (GetErrorText(SanitizeError(status)) on a namespace without Ens message tables)
    Set tStacked = "ERROR #5001: "_tRaw
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText(tStacked), tWant, "Stacked re-wrap + word-code prefixes both stripped before the unwrap")
    ; already-resolved form (bracket code, no '#') passes through untouched
    Set tResolved = "ERROR <Ens>ErrGeneral: Injected file publish failure for OrderId=ORD-000240 (sample error mode partialSuccess)"
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText(tResolved), tResolved, "Resolved form is untouched (bracket tokens never stripped, Rule #8)")
    ; boilerplate without params has nothing to unwrap -> unchanged after prefix strip
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText("ERROR #ErrGeneral: Unknown status code: <Ens>ErrGeneral"), "Unknown status code: <Ens>ErrGeneral", "No-params boilerplate left as-is")
    ; a '#' deep inside long text is not a prefix (length gate)
    Set tLong = "The report for widget batch number sign #12345 came back: all good"
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText(tLong), tLong, "Long text with an interior # is not treated as a prefix")
    ; locale-word normalization on RESOLVED renderings (Rule #13: GetErrorText picks
    ; the message-table language per worker process — same session must render the
    ; same text on every worker)
    Set tArabicResolved = "خطأ <Ens>ErrGeneral: Injected file publish failure for OrderId=ORD-000240 (sample error mode partialSuccess)"
    Set tEnglishResolved = "ERROR <Ens>ErrGeneral: Injected file publish failure for OrderId=ORD-000240 (sample error mode partialSuccess)"
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText(tArabicResolved), tEnglishResolved, "Arabic locale word on a resolved rendering normalizes to ERROR")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText("ERROR #5001: "_tArabicResolved), tEnglishResolved, "Stacked re-wrap prefix + Arabic resolved word both normalize")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText("خطأ فادح: something"), "خطأ فادح: something", "Arabic word NOT followed by a bracket code is left alone")
    ; plain text with no shapes at all -> unchanged
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText("just a message"), "just a message", "Plain text unchanged")
    Quit $$$OK
}

}
