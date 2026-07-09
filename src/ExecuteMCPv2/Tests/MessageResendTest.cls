/// Unit tests for <class>ExecuteMCPv2.REST.MessageResend</class> (Story 26.1, AC 26.1.3).
/// <p><b>Section A</b> — pure/direct classmethod tests for the guard-supporting helpers
/// (<method>StatusLabelToCode</method>/<method>StatusCodeToLabel</method>,
/// <method>NormalizeTimestamp</method>/<method>WindowDays</method>,
/// <method>ValidateHeaderIds</method>, <method>BodySummary</method>) — fast, deterministic,
/// no HTTP or IRIS interop state required.</p>
/// <p><b>Section B</b> — <method>PreviewOne</method> shape/verdict tests against synthetic
/// <code>Ens.MessageHeader</code> fixture rows, reserved SessionId range 990000700+
/// (mirrors <class>ExecuteMCPv2.Tests.DiagramLoaderTest</class>'s pattern; that class and
/// its siblings reserve 990000000-990000499, so this range is clear of collision).</p>
/// <p><b>Section C</b> — guard-refusal tests over the REAL deployed REST dispatch surface
/// (<code>%Net.HttpRequest</code>, mirrors <class>ExecuteMCPv2.Tests.LocRestTest</class>),
/// since the guards live inline in the <code>%request</code>-dependent
/// <method>MessageResendPreview</method>/<method>MessageResend</method> entry points and
/// this is the only way to prove the Rule #7 envelope contract AND the "no write occurs on
/// refusal" invariant (AC 26.1.2) end-to-end.</p>
/// <p><b>Section D</b> — a REAL single resend + new-header linkage against the scratch
/// production <code>SessionAgent.Sample.Production</code> (started only if not already
/// running, stopped again afterward; scratch header rows deleted). Uses
/// <method>ResendOne</method>/<method>PreviewOne</method> directly (pure classmethods, no
/// <code>%request</code> dependency) — the identical code path the guarded entry points
/// call, exercised against the real pinned <code>Ens.MessageHeader:ResendDuplicatedMessage</code>
/// API (Story 26.0).</p>
Class ExecuteMCPv2.Tests.MessageResendTest Extends %UnitTest.TestCase
{

/// IDs of Ens.MessageHeader rows created by the current test method (killed in teardown).
Property CreatedIds [ MultiDimensional ];

/// Reserved synthetic SessionId range base — clear of the Diagram*Test ranges
/// (990000000/990000200/990000400).
Parameter SESSIONBASE = 990000700;

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Delete every header row created by the test, then sweep the reserved session range
/// as a belt-and-braces guard against leaked fixtures (mirrors DiagramLoaderTest).
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
    If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
        Do $$$AssertTrue(0, "Fixture sweep failed: " _ $Select($IsObject(tRS): tRS.%Message, 1: "no result object"))
    }
    Quit $$$OK
}

/// Insert one synthetic Ens.MessageHeader fixture row; returns the new row ID.
Method InsertHeader(pSessionId As %Integer, pType As %Integer, pStatus As %Integer, pIsError As %Boolean, pSrc As %String, pDst As %String, pBodyClass As %String = "") As %String
{
    Set tH = ##class(Ens.MessageHeader).%New()
    Set tH.SessionId = pSessionId
    Set tH.Type = pType
    Set tH.Status = pStatus
    Set tH.IsError = pIsError
    Set tH.SourceConfigName = pSrc
    Set tH.TargetConfigName = pDst
    Set tH.Priority = 1
    If pBodyClass '= "" {
        Set tH.MessageBodyClassName = pBodyClass
        Set tH.MessageBodyId = "1"
    }
    Set tSC = tH.%Save()
    Do $$$AssertStatusOK(tSC, "Fixture header %Save should succeed")
    Set tId = tH.%Id()
    If tId '= "" { Set ..CreatedIds(tId) = 1 }
    Quit tId
}

/// Insert one synthetic Ens.MessageHeader fixture row with an explicit TimeCreated
/// (Ens.MessageHeader.TimeCreated is NOT auto-populated by a plain %New()/%Save() —
/// verified against Ens.MessageHeader.cls source; only the New*Message()/
/// ResendDuplicatedMessage() helper methods set it). Needed for tests that exercise
/// the resendFiltered time-window SQL, which filters on TimeCreated.
Method InsertHeaderWithTime(pSessionId As %Integer, pType As %Integer, pStatus As %Integer, pIsError As %Boolean, pSrc As %String, pDst As %String, pTimeCreated As %String) As %String
{
    Set tH = ##class(Ens.MessageHeader).%New()
    Set tH.SessionId = pSessionId
    Set tH.Type = pType
    Set tH.Status = pStatus
    Set tH.IsError = pIsError
    Set tH.SourceConfigName = pSrc
    Set tH.TargetConfigName = pDst
    Set tH.Priority = 1
    Set tH.TimeCreated = pTimeCreated
    Set tSC = tH.%Save()
    Do $$$AssertStatusOK(tSC, "Fixture header (with TimeCreated) %Save should succeed")
    Set tId = tH.%Id()
    If tId '= "" { Set ..CreatedIds(tId) = 1 }
    Quit tId
}

/// ==================== Section A: pure helper classmethods ====================

/// StatusLabelToCode covers all 9 canonical labels + the "Errored" alias for Error(8),
/// case-insensitivity, and an invalid label returning 0. StatusCodeToLabel is the exact
/// reverse for the 9 valid codes and "" out of range.
Method TestStatusLabelRoundTrip() As %Status
{
    Set tLabels = $ListBuild("Created", "Queued", "Delivered", "Discarded", "Suspended", "Deferred", "Aborted", "Error", "Completed")
    For tCode=1:1:9 {
        Set tLabel = $ListGet(tLabels, tCode)
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).StatusLabelToCode(tLabel), tCode, "Label '" _ tLabel _ "' maps to code " _ tCode)
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).StatusCodeToLabel(tCode), tLabel, "Code " _ tCode _ " maps back to '" _ tLabel _ "'")
    }
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).StatusLabelToCode("Errored"), 8, "'Errored' alias maps to Error(8)")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).StatusLabelToCode("eRRoRed"), 8, "Label matching is case-insensitive")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).StatusLabelToCode("Bogus"), 0, "Unknown label maps to 0")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).StatusCodeToLabel(0), "", "Out-of-range code 0 maps to ''")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).StatusCodeToLabel(10), "", "Out-of-range code 10 maps to ''")
    Quit $$$OK
}

/// NormalizeTimestamp: "T" separator replaced with space, trailing "Z" stripped, a
/// bare date gets a midnight time component appended.
Method TestNormalizeTimestamp() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).NormalizeTimestamp("2026-07-01T10:30:00Z"), "2026-07-01 10:30:00", "T+Z normalized to ODBC space form")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).NormalizeTimestamp("2026-07-01 10:30:00"), "2026-07-01 10:30:00", "Already-ODBC form passes through")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).NormalizeTimestamp("2026-07-01"), "2026-07-01 00:00:00", "Bare date gets midnight time appended")
    Quit $$$OK
}

/// WindowDays: ~3 days apart computes to 3.0 (within a small tolerance), equal
/// timestamps compute to 0, a 'to' before 'from' is negative, and an unparseable
/// timestamp returns a non-OK status (the guard's "invalid timestamp" signal).
Method TestWindowDaysComputation() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).WindowDays("2026-07-01 00:00:00", "2026-07-04 00:00:00", .tDays)
    Do $$$AssertStatusOK(tSC, "WindowDays succeeds for two valid timestamps")
    Do $$$AssertTrue((tDays > 2.99) && (tDays < 3.01), "3-day span computes to ~3.0 (got " _ tDays _ ")")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).WindowDays("2026-07-01 00:00:00", "2026-07-01 00:00:00", .tDaysEq)
    Do $$$AssertStatusOK(tSC, "WindowDays succeeds for equal timestamps")
    Do $$$AssertEquals(tDaysEq, 0, "Equal timestamps compute to 0 days")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).WindowDays("2026-07-04 00:00:00", "2026-07-01 00:00:00", .tDaysNeg)
    Do $$$AssertStatusOK(tSC, "WindowDays succeeds even when 'to' precedes 'from'")
    Do $$$AssertTrue(tDaysNeg < 0, "'to' before 'from' computes a negative window")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).WindowDays("not-a-date", "2026-07-01 00:00:00", .tDaysBad)
    Do $$$AssertStatusNotOK(tSC, "An unparseable timestamp returns a non-OK status")
    Quit $$$OK
}

/// ValidateHeaderIds: a valid 1-100 numeric array passes; an empty array, an
/// over-100 array, and a non-numeric entry are each rejected with a descriptive
/// status naming 'headerIds'.
Method TestValidateHeaderIdsGuard() As %Status
{
    Set tOk = ["82546", "82557"]
    Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).ValidateHeaderIds(tOk, .tIds)
    Do $$$AssertStatusOK(tSC, "A valid 2-entry numeric array passes")
    Do $$$AssertEquals(tIds(0), 2, "Two IDs captured")
    Do $$$AssertEquals(tIds(1), 82546, "First ID captured numerically")

    Set tEmpty = []
    Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).ValidateHeaderIds(tEmpty, .tIdsEmpty)
    Do $$$AssertStatusNotOK(tSC, "An empty array is rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "headerIds", "Empty-array rejection names 'headerIds'")

    Set tTooMany = []
    For i=1:1:101 { Do tTooMany.%Push(i) }
    Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).ValidateHeaderIds(tTooMany, .tIdsMany)
    Do $$$AssertStatusNotOK(tSC, "A 101-entry array is rejected")

    Set tBad = ["82546", "notanumber"]
    Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).ValidateHeaderIds(tBad, .tIdsBad)
    Do $$$AssertStatusNotOK(tSC, "A non-numeric entry is rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "notanumber", "Rejection echoes the offending value")

    Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).ValidateHeaderIds("", .tIdsUndef)
    Do $$$AssertStatusNotOK(tSC, "A non-array (undefined) value is rejected")
    Quit $$$OK
}

/// BodySummary never throws and returns "" for empty/missing-class/nonexistent-class
/// inputs.
Method TestBodySummaryEmptyInputs() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).BodySummary("", "", 0), "", "Empty body class yields empty summary")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).BodySummary("Some.Class", "", 1), "", "Empty body id yields empty summary")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.MessageResend).BodySummary("ZZNoSuch.BogusBodyClass12345", "1", 0), "", "bodyClassExists=false yields empty summary without opening anything")
    Quit $$$OK
}

/// ==================== Section B: PreviewOne shape/verdict ====================

/// A header ID with no backing row is reported found:false with an error message
/// naming the ID — never mutates, never throws.
Method TestPreviewOneNotFound() As %Status
{
    Set tItem = ##class(ExecuteMCPv2.REST.MessageResend).PreviewOne(999999999)
    Do $$$AssertEquals(tItem.%Get("found"), 0, "Nonexistent header reports found:false")
    Do $$$AssertTrue(tItem.%Get("error") [ "999999999", "Error message names the missing header ID")
    Quit $$$OK
}

/// Covers all three verdict branches (Request+Error=recommended, Response+IsError=
/// caution, everything-else=note) plus the missing-body-class escalation, against
/// synthetic fixture rows (Story 26.0 observed-semantics §4 points 1/4/5).
Method TestPreviewOneVerdicts() As %Status
{
    Set tSession = ..#SESSIONBASE + 1

    ; Request, Status=Error(8) -> recommended
    Set tId1 = ..InsertHeader(tSession, 1, 8, 0, "Demo.Source", "Demo.Target")
    Set tItem1 = ##class(ExecuteMCPv2.REST.MessageResend).PreviewOne(tId1)
    Do $$$AssertEquals(tItem1.%Get("found"), 1, "Fixture header found")
    Do $$$AssertEquals(tItem1.%Get("type"), "Request", "Type=1 normalizes to 'Request'")
    Do $$$AssertEquals(tItem1.%Get("status"), "Error", "Status=8 normalizes to 'Error'")
    Do $$$AssertEquals(tItem1.%Get("verdict"), "recommended", "Request+Status=Error is the recommended retry target")

    ; Response, IsError=true -> caution
    Set tId2 = ..InsertHeader(tSession, 2, 4, 1, "Demo.Target", "Demo.Source")
    Set tItem2 = ##class(ExecuteMCPv2.REST.MessageResend).PreviewOne(tId2)
    Do $$$AssertEquals(tItem2.%Get("type"), "Response", "Type=2 normalizes to 'Response'")
    Do $$$AssertEquals(tItem2.%Get("verdict"), "caution", "Response+IsError is flagged caution (likely a no-op)")

    ; Request, Status=Completed(9) -> note
    Set tId3 = ..InsertHeader(tSession, 1, 9, 0, "Demo.Source", "Demo.Target")
    Set tItem3 = ##class(ExecuteMCPv2.REST.MessageResend).PreviewOne(tId3)
    Do $$$AssertEquals(tItem3.%Get("verdict"), "note", "A non-error message gets the informational 'note' verdict")

    ; Missing body class -> bodyClassExists false, reason warns, verdict escalates
    Set tId4 = ..InsertHeader(tSession, 1, 8, 0, "Demo.Source", "Demo.Target", "ZZNoSuch.BogusBodyClass12345")
    Set tItem4 = ##class(ExecuteMCPv2.REST.MessageResend).PreviewOne(tId4)
    Do $$$AssertEquals(tItem4.%Get("bodyClassExists"), 0, "Nonexistent body class detected")
    Do $$$AssertTrue(tItem4.%Get("reason") [ "no longer exists", "Reason warns about the missing body class")
    Do $$$AssertEquals(tItem4.%Get("verdict"), "caution", "Missing body class escalates the verdict to caution")
    Quit $$$OK
}

/// ==================== Section C: guard refusals over the real REST surface ====================

/// Resolve the local web server port (mirrors LocRestTest); override via
/// <code>^UnitTestConfig("MessageResend",...)</code>.
Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("MessageResend", "Port"))
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

/// POST a JSON body to a deployed route; returns the HTTP status + parsed envelope.
Method PostJson(pPath As %String, pJsonBody As %String, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Https = 0
        Set tRequest.Username = $Get(^UnitTestConfig("MessageResend", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("MessageResend", "Password"), "SYS")
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
Method ErrorCount(pEnvelope As %DynamicObject) As %Integer
{
    Quit pEnvelope.%Get("status").%Get("errors").%Size()
}

/// Text of the first envelope error ("" when none).
Method FirstError(pEnvelope As %DynamicObject) As %String
{
    If ..ErrorCount(pEnvelope) = 0 Quit ""
    Quit pEnvelope.%Get("status").%Get("errors").%Get(0).%Get("error")
}

/// True when the envelope's result object carries zero keys (the "result:{}" no-write
/// contract, AC 26.1.2).
Method IsResultEmpty(pEnvelope As %DynamicObject) As %Boolean
{
    Set tIter = pEnvelope.%Get("result").%GetIterator()
    Quit '(tIter.%GetNext(.k, .v))
}

/// Shared guard-refusal assertion: POST, expect HTTP 200 + a parseable envelope, at
/// least one error naming <var>pToken</var>, and an EMPTY result (no write).
Method AssertRestRejected(pPath As %String, pJson As %String, pToken As %String, pLabel As %String)
{
    Set tSC = ..PostJson(pPath, pJson, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, pLabel _ ": HTTP round-trip and JSON envelope parse succeed")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, pLabel _ ": rejection still renders HTTP 200 + envelope (Rule #7)")
    Do $$$AssertTrue(..ErrorCount(tEnv) >= 1, pLabel _ ": envelope carries at least one error")
    Do $$$AssertTrue(..FirstError(tEnv) [ pToken, pLabel _ ": error names '" _ pToken _ "' (got: " _ ..FirstError(tEnv) _ ")")
    Do $$$AssertTrue(..IsResultEmpty(tEnv), pLabel _ ": result is empty — no write occurred")
}

/// AC 26.1.2 guards (a)/(b)/(c)/(d)/(e) — every refusal names its offending
/// parameter and mutates nothing.
Method TestHttpGuardRefusals()
{
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend/preview", "{}", "headerIds", "Preview missing headerIds")
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend/preview", "{""headerIds"":[""abc""]}", "headerIds", "Preview non-numeric headerId")
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{}", "action", "Resend missing action")
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""bogus""}", "action", "Resend invalid action")
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resend"",""headerIds"":[""notanumber""]}", "headerIds", "Resend non-numeric headerId")
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resendFiltered"",""from"":""2026-07-01T00:00:00Z""}", "item", "resendFiltered missing item")
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resendFiltered"",""item"":""ZZNoSuchItem""}", "from", "resendFiltered missing from")
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resendFiltered"",""item"":""ZZNoSuchItem"",""from"":""2026-07-01T00:00:00Z"",""status"":""Bogus""}", "status", "resendFiltered invalid status")

    Set tOldH = ($Piece($ZTIMESTAMP, ",", 1) - 30) _ "," _ $Piece($ZTIMESTAMP, ",", 2)
    Set tFrom30 = $ZDATETIME(tOldH, 3)
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resendFiltered"",""item"":""ZZNoSuchItem"",""from"":""" _ tFrom30 _ """}", "7 days", "resendFiltered window too wide")

    Set tYestH = ($Piece($ZTIMESTAMP, ",", 1) - 1) _ "," _ $Piece($ZTIMESTAMP, ",", 2)
    Set tYesterday = $ZDATETIME(tYestH, 3)
    Set tNow = $ZDATETIME($ZTIMESTAMP, 3)
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resendFiltered"",""item"":""ZZNoSuchItem"",""from"":""" _ tNow _ """,""to"":""" _ tYesterday _ """}", "earlier", "resendFiltered from-after-to")

    Set tRecent = $ZDATETIME(($Piece($ZTIMESTAMP, ",", 1)) _ "," _ ($Piece($ZTIMESTAMP, ",", 2) - 60), 3)
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resendFiltered"",""item"":""ZZNoSuchItem"",""from"":""" _ tRecent _ """,""maxMessages"":600}", "500", "resendFiltered maxMessages over hard cap")
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resendFiltered"",""item"":""ZZNoSuchItem"",""from"":""" _ tRecent _ """,""dryRun"":false}", "confirm", "resendFiltered execute missing confirm")
}

/// AC 26.1.2 guard (f) — the production-not-running precheck, for both the
/// <code>resend</code> and <code>resendFiltered</code> execute paths. Assumes the
/// default namespace's scratch production is Stopped at test time (project convention
/// — see Story Dev Notes); if some other production happens to be running this test
/// will report a spurious failure rather than a false pass (fail-safe direction).
Method TestHttpProductionNotRunningGuardRefusals()
{
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resend"",""headerIds"":[""1""]}", "running", "resend with no production running")

    Set tRecent = $ZDATETIME(($Piece($ZTIMESTAMP, ",", 1)) _ "," _ ($Piece($ZTIMESTAMP, ",", 2) - 60), 3)
    Do ..AssertRestRejected("/api/executemcp/v2/interop/message/resend", "{""action"":""resendFiltered"",""item"":""ZZNoSuchItemForGuardF"",""from"":""" _ tRecent _ """,""dryRun"":false,""confirm"":true}", "running", "resendFiltered execute with no production running")
}

/// resendFiltered with dryRun left at its default (true) succeeds (200, no errors)
/// and returns matchCount + sample without requiring confirm — the safe preview path.
Method TestHttpResendFilteredDryRunDefaultSucceeds()
{
    Set tRecent = $ZDATETIME(($Piece($ZTIMESTAMP, ",", 1)) _ "," _ ($Piece($ZTIMESTAMP, ",", 2) - 60), 3)
    Set tJson = "{""action"":""resendFiltered"",""item"":""ZZNoSuchItemForDryRun"",""from"":""" _ tRecent _ """}"
    Set tSC = ..PostJson("/api/executemcp/v2/interop/message/resend", tJson, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Dry-run HTTP round-trip succeeds")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "HTTP 200")
    Do $$$AssertEquals(..ErrorCount(tEnv), 0, "No envelope errors — dryRun default does not require confirm")
    Set tResult = tEnv.%Get("result")
    Do $$$AssertEquals(tResult.%Get("dryRun"), 1, "dryRun reported true")
    Do $$$AssertTrue(tResult.%IsDefined("matchCount"), "matchCount present")
    Do $$$AssertTrue(tResult.%IsDefined("sample"), "sample present")
}

/// AC 26.1.2 guard (d) — the DATA-dependent over-cap refusal: the actual matched
/// count exceeds the caller's requested maxMessages, distinct from the structural
/// "maxMessages > hard cap 500" check (already covered by
/// <method>TestHttpGuardRefusals</method>'s "over hard cap" case). Two fixture rows
/// matching the filter with maxMessages:1 must refuse and NAME the found count (2) —
/// this guard runs before the production-running precheck, so no scratch production
/// is needed.
Method TestHttpResendFilteredMatchCountExceedsMaxMessagesGuard()
{
    Set tItemName = "ZZGuardDCapTest26.1"
    Set tNow = $ZDATETIME($ZTIMESTAMP, 3)
    Do ..InsertHeaderWithTime(..#SESSIONBASE + 20, 1, 8, 0, tItemName, "Demo.Target", tNow)
    Do ..InsertHeaderWithTime(..#SESSIONBASE + 21, 1, 8, 0, tItemName, "Demo.Target", tNow)

    Set tRecent = $ZDATETIME(($Piece($ZTIMESTAMP, ",", 1)) _ "," _ ($Piece($ZTIMESTAMP, ",", 2) - 60), 3)
    Set tJson = "{""action"":""resendFiltered"",""item"":""" _ tItemName _ """,""from"":""" _ tRecent _ """,""maxMessages"":1,""dryRun"":false,""confirm"":true}"

    Set tSC = ..PostJson("/api/executemcp/v2/interop/message/resend", tJson, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "HTTP round-trip and JSON envelope parse succeed")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "Rejection still renders HTTP 200 + envelope (Rule #7)")
    Do $$$AssertTrue(..ErrorCount(tEnv) >= 1, "Envelope carries at least one error")
    Set tErr = ..FirstError(tEnv)
    Do $$$AssertTrue(tErr [ "2 messages", "Error names the found count of 2 (got: " _ tErr _ ")")
    Do $$$AssertTrue(tErr [ "exceeding", "Error explains the maxMessages cap was exceeded (got: " _ tErr _ ")")
    Do $$$AssertTrue(..IsResultEmpty(tEnv), "result is empty — no resend occurred (guard fires before enumeration/fetch)")
}

/// ==================== Section D: real resend against the scratch production ====================

/// A REAL single resend + new-header linkage, driven against
/// SessionAgent.Sample.Production (started only if not already running; scratch
/// header rows deleted and the production stopped again afterward). Exercises
/// ResendOne/PreviewOne directly — the exact code path the guarded HTTP entry points
/// call — against the pinned Ens.MessageHeader:ResendDuplicatedMessage API.
Method TestRealResendAgainstScratchProduction() As %Status
{
    Set tWasRunning = ##class(Ens.Director).IsProductionRunning()
    If 'tWasRunning {
        Set tSC = ##class(Ens.Director).StartProduction("SessionAgent.Sample.Production")
        Do $$$AssertStatusOK(tSC, "Scratch production starts")
    }

    Set tMaxBefore = 0
    Try {
        Set tRS0 = ##class(%SQL.Statement).%ExecDirect(, "SELECT MAX(ID) AS mx FROM Ens.MessageHeader")
        If $IsObject(tRS0) && tRS0.%Next() { Set tMaxBefore = +tRS0.mx }

        Do ##class(SessionAgent.Sample.BS.OrderIngest).RunScenario("none")
        Hang 2

        Set tOriginalId = 0
        Set tRS1 = ##class(%SQL.Statement).%ExecDirect(, "SELECT TOP 1 ID FROM Ens.MessageHeader WHERE ID > ? AND Type = 1 ORDER BY ID", tMaxBefore)
        If $IsObject(tRS1) && tRS1.%Next() { Set tOriginalId = +tRS1.ID }
        Do $$$AssertTrue(tOriginalId > 0, "A new Request header was created by the scenario run")

        If tOriginalId > 0 {
            Set tRow = ##class(ExecuteMCPv2.REST.MessageResend).ResendOne(tOriginalId, 0)
            Do $$$AssertEquals(tRow.%Get("ok"), 1, "Real resend reports ok")
            Do $$$AssertEquals(tRow.%Get("originalId"), tOriginalId, "originalId echoed")
            Do $$$AssertTrue(tRow.%IsDefined("newHeaderId"), "newHeaderId present on success")
            Set tNewId = tRow.%Get("newHeaderId")
            Do $$$AssertTrue(tNewId '= tOriginalId, "New header id differs from the original")

            If tRow.%Get("ok") {
                Set tRS2 = ##class(%SQL.Statement).%ExecDirect(, "SELECT Description, SessionId FROM Ens.MessageHeader WHERE ID = ?", tNewId)
                Do $$$AssertTrue($IsObject(tRS2) && tRS2.%Next(), "New header row exists")
                If $IsObject(tRS2) {
                    Do $$$AssertTrue(tRS2.Description [ ("Resent " _ tOriginalId), "New header Description carries the resend linkage")
                }

                Set tPreview = ##class(ExecuteMCPv2.REST.MessageResend).PreviewOne(tOriginalId)
                Do $$$AssertEquals(tPreview.%Get("found"), 1, "Original header previews as found")
                Do $$$AssertEquals(tPreview.%Get("type"), "Request", "Original header previews as Request type")
                Do $$$AssertTrue(tPreview.%IsDefined("verdict"), "Preview carries a verdict")
                Do $$$AssertTrue(tPreview.%IsDefined("reason"), "Preview carries a reason")
            }
        }

        Hang 1
        Set tDelRS = ##class(%SQL.Statement).%ExecDirect(, "DELETE FROM Ens.MessageHeader WHERE ID > ?", tMaxBefore)
        Do $$$AssertTrue($IsObject(tDelRS) && (tDelRS.%SQLCODE >= 0), "Scratch header cleanup sweep succeeded")
    } Catch ex {
        Do $$$AssertTrue(0, "Unexpected exception during real-resend test: " _ ex.DisplayString())
    }

    If 'tWasRunning {
        Set tSC = ##class(Ens.Director).StopProduction(60, 1)
        Do $$$AssertStatusOK(tSC, "Scratch production stopped back to its pre-test state")
    }
    Quit $$$OK
}

/// A <method>ResendBatch</method> call with a mix of one VALID header (resends
/// successfully against the scratch production) and one bad/nonexistent header ID
/// must return a per-header {ok} result for EACH entry and must NOT abort the batch
/// (spec §3 / AC 26.1.1 per-message Try/Catch continuation). Exercises the exact
/// classmethod the guarded <method>MessageResend</method> HTTP entry point calls.
Method TestResendBatchContinuesPastBadHeader() As %Status
{
    Set tWasRunning = ##class(Ens.Director).IsProductionRunning()
    If 'tWasRunning {
        Set tSC = ##class(Ens.Director).StartProduction("SessionAgent.Sample.Production")
        Do $$$AssertStatusOK(tSC, "Scratch production starts")
    }

    Set tMaxBefore = 0
    Try {
        Set tRS0 = ##class(%SQL.Statement).%ExecDirect(, "SELECT MAX(ID) AS mx FROM Ens.MessageHeader")
        If $IsObject(tRS0) && tRS0.%Next() { Set tMaxBefore = +tRS0.mx }

        Do ##class(SessionAgent.Sample.BS.OrderIngest).RunScenario("none")
        Hang 2

        Set tValidId = 0
        Set tRS1 = ##class(%SQL.Statement).%ExecDirect(, "SELECT TOP 1 ID FROM Ens.MessageHeader WHERE ID > ? AND Type = 1 ORDER BY ID", tMaxBefore)
        If $IsObject(tRS1) && tRS1.%Next() { Set tValidId = +tRS1.ID }
        Do $$$AssertTrue(tValidId > 0, "A new Request header was created for the batch-continuation test")

        If tValidId > 0 {
            Set tBadId = 999999999
            Set tIds(0) = 2
            Set tIds(1) = tValidId
            Set tIds(2) = tBadId
            Set tResult = {}
            Do ##class(ExecuteMCPv2.REST.MessageResend).ResendBatch(.tIds, 0, tResult)

            Set tResults = tResult.%Get("results")
            Do $$$AssertEquals(tResults.%Size(), 2, "Batch returns one result entry per header, even after a bad one")

            Set tRow1 = tResults.%Get(0)
            Do $$$AssertEquals(tRow1.%Get("originalId"), tValidId, "First result echoes the valid header id")
            Do $$$AssertEquals(tRow1.%Get("ok"), 1, "Valid header resends ok")
            Do $$$AssertTrue(tRow1.%IsDefined("newHeaderId"), "Valid header result carries a newHeaderId")

            Set tRow2 = tResults.%Get(1)
            Do $$$AssertEquals(tRow2.%Get("originalId"), tBadId, "Second result echoes the bad header id — batch did not abort after the first entry")
            Do $$$AssertEquals(tRow2.%Get("ok"), 0, "Nonexistent header fails")
            Do $$$AssertTrue(tRow2.%Get("error") '= "", "Failure carries a non-empty error message")

            Set tSummary = tResult.%Get("summary")
            Do $$$AssertEquals(tSummary.%Get("total"), 2, "Summary total counts both headers")
            Do $$$AssertEquals(tSummary.%Get("succeeded"), 1, "Summary succeeded=1")
            Do $$$AssertEquals(tSummary.%Get("failed"), 1, "Summary failed=1")
        }

        Hang 1
        Set tDelRS = ##class(%SQL.Statement).%ExecDirect(, "DELETE FROM Ens.MessageHeader WHERE ID > ?", tMaxBefore)
        Do $$$AssertTrue($IsObject(tDelRS) && (tDelRS.%SQLCODE >= 0), "Scratch header cleanup sweep succeeded")
    } Catch ex {
        Do $$$AssertTrue(0, "Unexpected exception during batch-continuation test: " _ ex.DisplayString())
    }

    If 'tWasRunning {
        Set tSC = ##class(Ens.Director).StopProduction(60, 1)
        Do $$$AssertStatusOK(tSC, "Scratch production stopped back to its pre-test state")
    }
    Quit $$$OK
}

}
