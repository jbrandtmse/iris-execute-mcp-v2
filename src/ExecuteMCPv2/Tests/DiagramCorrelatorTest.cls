/// Unit tests for <class>ExecuteMCPv2.Diagram.Correlator</class> (Story 21.0, AC 21.0.3/21.0.12).
/// <p>Pure in-memory fixtures (synthetic <code>Demo.*</code> names — decision G2 clean-room);
/// no SQL, no IRIS state. Covers §6.2: Inproc/Queue pairing, unpaired handling, conflict
/// warnings, type heuristic, arrow mapping, label modes, and the I1 error warning.</p>
Class ExecuteMCPv2.Tests.DiagramCorrelatorTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Build one synthetic in-memory trace event.
Method MakeEvent(pId As %Integer, pType As %String, pInv As %String, pSrc As %String, pDst As %String, pBody As %String = "", pCorrId As %String = "", pReturnQueue As %String = "", pIsError As %Boolean = 0, pErrText As %String = "") As ExecuteMCPv2.Diagram.Event
{
    Set tEv = ##class(ExecuteMCPv2.Diagram.Event).%New()
    Set tEv.Id = pId
    Set tEv.Type = pType
    Set tEv.Invocation = pInv
    Set tEv.Source = pSrc
    Set tEv.Target = pDst
    Set tEv.BodyClass = pBody
    Set tEv.CorrId = pCorrId
    Set tEv.ReturnQueue = pReturnQueue
    Set tEv.IsError = pIsError
    Set tEv.ErrorText = pErrText
    Set tEv.SessionId = 1
    Set tEv.TimeCreated = "2026-07-02 10:00:0"_pId
    Quit tEv
}

/// True when any warning on the render event contains the substring.
Method HasWarning(pRE As ExecuteMCPv2.Diagram.RenderEvent, pSubstring As %String) As %Boolean
{
    Set tFound = 0
    For tW = 1:1:pRE.Warnings.Count() {
        If pRE.Warnings.GetAt(tW) [ pSubstring Set tFound = 1
    }
    Quit tFound
}

/// Simple Inproc round-trip: both arrows sync, paired, no warnings.
Method TestSimpleSyncRoundTrip() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(1, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Req"))
    Do tEvents.Insert(..MakeEvent(2, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.Resp", 1))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.Count(), 2, "Two arrows emitted")
    Set tReq = tRender.GetAt(1)
    Set tResp = tRender.GetAt(2)
    Do $$$AssertEquals(tReq.Arrow, "->>", "Inproc request renders sync arrow")
    Do $$$AssertEquals(tResp.Arrow, "->>", "Inproc response renders sync arrow")
    Do $$$AssertEquals(tReq.Role, "req", "First arrow is the request leg")
    Do $$$AssertEquals(tResp.Role, "resp", "Second arrow is the response leg")
    Do $$$AssertTrue(tReq.PairId > 0, "PairId assigned to the request leg")
    Do $$$AssertEquals(tReq.PairId, tResp.PairId, "Legs share a PairId")
    Do $$$AssertEquals(tReq.Warnings.Count(), 0, "No warnings on clean request")
    Do $$$AssertEquals(tResp.Warnings.Count(), 0, "No warnings on clean response")
    Do $$$AssertEquals(tResp.Src, "Demo.Process", "Response direction is its own row's Src")
    Do $$$AssertEquals(tResp.Dst, "Demo.Service", "Response direction is its own row's Dst")
    Quit $$$OK
}

/// Queue round-trip via primary CorrespondingMessageId match: both arrows async.
Method TestAsyncQueueRoundTrip() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(10, "Request", "Queue", "Demo.Process", "Demo.Operation", "Demo.Msg.Req"))
    Do tEvents.Insert(..MakeEvent(11, "Response", "Queue", "Demo.Operation", "Demo.Process", "Demo.Msg.Resp", 10))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.GetAt(1).Arrow, "-->>", "Queue request renders async arrow")
    Do $$$AssertEquals(tRender.GetAt(2).Arrow, "-->>", "Queue response renders async arrow")
    Do $$$AssertEquals(tRender.GetAt(1).PairId, tRender.GetAt(2).PairId, "Queue pair correlated by CorrId")
    Do $$$AssertTrue(tRender.GetAt(1).PairId > 0, "Queue pair has a PairId")
    Quit $$$OK
}

/// Queue fallback pairing: equal ReturnQueueName + reversed endpoints + empty CorrId.
Method TestQueueFallbackPairing() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(20, "Request", "Queue", "Demo.Process", "Demo.Operation", "Demo.Msg.Req", "", "QDemo"))
    Do tEvents.Insert(..MakeEvent(21, "Response", "Queue", "Demo.Operation", "Demo.Process", "Demo.Msg.Resp", "", "QDemo"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertTrue(tRender.GetAt(1).PairId > 0, "Fallback pairing produced a pair")
    Do $$$AssertEquals(tRender.GetAt(1).PairId, tRender.GetAt(2).PairId, "Fallback pair legs share PairId")
    Do $$$AssertEquals(tRender.GetAt(2).Arrow, "-->>", "Fallback-paired response stays async")
    Do $$$AssertEquals(tRender.GetAt(1).Warnings.Count(), 0, "No warnings for the fallback pair request")
    Quit $$$OK
}

/// Mixed Inproc and Queue pairs keep distinct arrow styles.
Method TestMixedInprocQueue() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(30, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.A"))
    Do tEvents.Insert(..MakeEvent(31, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.A", 30))
    Do tEvents.Insert(..MakeEvent(32, "Request", "Queue", "Demo.Process", "Demo.Operation", "Demo.Msg.B"))
    Do tEvents.Insert(..MakeEvent(33, "Response", "Queue", "Demo.Operation", "Demo.Process", "Demo.Msg.B", 32))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.Count(), 4, "Four arrows emitted")
    Do $$$AssertEquals(tRender.GetAt(1).Arrow, "->>", "Inproc request sync")
    Do $$$AssertEquals(tRender.GetAt(2).Arrow, "->>", "Inproc response sync")
    Do $$$AssertEquals(tRender.GetAt(3).Arrow, "-->>", "Queue request async")
    Do $$$AssertEquals(tRender.GetAt(4).Arrow, "-->>", "Queue response async")
    Do $$$AssertTrue(tRender.GetAt(1).PairId '= tRender.GetAt(3).PairId, "Distinct pairs get distinct PairIds")
    Quit $$$OK
}

/// Unknown invocation: warning emitted, arrow defaults to sync.
Method TestUnknownInvocationWarning() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(40, "Request", "", "Demo.Service", "Demo.Process", "Demo.Msg.Req"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.GetAt(1).Arrow, "->>", "Unknown invocation defaults to sync arrow")
    Do $$$AssertTrue(..HasWarning(tRender.GetAt(1), "Unknown invocation"), "Unknown-invocation warning attached")
    Quit $$$OK
}

/// A request with no matching response warns but is still emitted.
Method TestUnpairedRequest() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(50, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Req"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.Count(), 1, "Unpaired request still emitted")
    Do $$$AssertEquals(tRender.GetAt(1).PairId, 0, "Unpaired request has no PairId")
    Do $$$AssertTrue(..HasWarning(tRender.GetAt(1), "Unpaired request"), "Unpaired-request warning attached")
    Quit $$$OK
}

/// An orphan response is emitted standalone (own Src->Dst) with a warning — never dropped.
Method TestUnpairedResponseStandalone() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(60, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.Resp", 999))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.Count(), 1, "Unpaired response still emitted")
    Do $$$AssertEquals(tRender.GetAt(1).Src, "Demo.Process", "Standalone response keeps its own Src")
    Do $$$AssertEquals(tRender.GetAt(1).Dst, "Demo.Service", "Standalone response keeps its own Dst")
    Do $$$AssertTrue(..HasWarning(tRender.GetAt(1), "Unpaired response"), "Unpaired-response warning attached")
    Quit $$$OK
}

/// Inproc order-pairing with a mismatched CorrespondingMessageId: pairs anyway + conflict warning.
Method TestCorrelationConflictWarning() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(70, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Req"))
    Do tEvents.Insert(..MakeEvent(71, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.Resp", 999))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.GetAt(1).PairId, tRender.GetAt(2).PairId, "Conflict still pairs by order")
    Do $$$AssertTrue(tRender.GetAt(1).PairId > 0, "Pair formed despite CorrId mismatch")
    Do $$$AssertTrue(..HasWarning(tRender.GetAt(2), "Correlation conflict"), "Conflict warning on the response leg")
    Quit $$$OK
}

/// Type heuristic: an unknown-type row with CorrId set is treated as a Response.
Method TestHeuristicCorrIdResponse() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(80, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Req"))
    Do tEvents.Insert(..MakeEvent(81, "", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.Resp", 80))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.GetAt(2).Role, "resp", "CorrId-set unknown-type row resolved as Response")
    Do $$$AssertEquals(tRender.GetAt(1).PairId, tRender.GetAt(2).PairId, "Heuristic response pairs with the request")
    Quit $$$OK
}

/// The response arrow of an Inproc pair is forced sync even when its own row says Queue.
Method TestResponseForcedSync() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(90, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Req"))
    Do tEvents.Insert(..MakeEvent(91, "Response", "Queue", "Demo.Process", "Demo.Service", "Demo.Msg.Resp", 90))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.GetAt(2).Arrow, "->>", "Inproc-paired response forced to sync arrow")
    Quit $$$OK
}

/// A queued pair is never reclassified to sync, even when the response row says Inproc.
Method TestQueuePairNeverSync() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(100, "Request", "Queue", "Demo.Process", "Demo.Operation", "Demo.Msg.Req"))
    Do tEvents.Insert(..MakeEvent(101, "Response", "Inproc", "Demo.Operation", "Demo.Process", "Demo.Msg.Resp", 100))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.GetAt(2).Arrow, "-->>", "Queue-paired response stays async")
    Quit $$$OK
}

/// Label modes: full class name by default; short mode keeps the last dotted segment.
Method TestLabelModes() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(110, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Pkg.Msg.Req"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tFull)
    Do $$$AssertStatusOK(tSC, "Correlate full mode should succeed")
    Do $$$AssertEquals(tFull.GetAt(1).Label, "Demo.Pkg.Msg.Req", "Full mode keeps the whole class name")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "short", .tShort)
    Do $$$AssertStatusOK(tSC, "Correlate short mode should succeed")
    Do $$$AssertEquals(tShort.GetAt(1).Label, "Req", "Short mode keeps the last dotted segment")
    Quit $$$OK
}

/// A bodyless (NULL MessageBodyClassName) event renders a placeholder label.
Method TestNullBodyLabel() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(120, "Request", "Inproc", "Demo.Service", "Demo.Process", ""))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.GetAt(1).Label, "(no body)", "Empty body class labelled '(no body)'")
    Quit $$$OK
}

/// Improvement I1: an errored event carries the error flag + sanitized error warning.
Method TestErrorWarningAttached() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(130, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Req", "", "", 1, "connection refused"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertTrue(tRender.GetAt(1).IsError, "IsError propagated to the render event")
    Do $$$AssertTrue(..HasWarning(tRender.GetAt(1), "Error on message 130: connection refused"), "I1 error warning attached")
    Quit $$$OK
}

/// I1 fallback: IsError set but no error text yields the generic summary.
Method TestErrorGenericSummary() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(140, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Req", "", "", 1, ""))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertTrue(..HasWarning(tRender.GetAt(1), "message reported error"), "Generic error summary used when text missing")
    Quit $$$OK
}

/// An unknown-type row without CorrId (e.g. Terminate) flows through the request
/// heuristic and is emitted — never dropped.
Method TestTerminateTypeFlowsThrough() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(150, "", "Queue", "Demo.Process", "Demo.Operation", "Demo.Msg.Stop"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Do $$$AssertEquals(tRender.Count(), 1, "Unknown-type row emitted, not dropped")
    Do $$$AssertEquals(tRender.GetAt(1).Arrow, "-->>", "Row keeps its own invocation arrow")
    Quit $$$OK
}

}
