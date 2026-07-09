/// Unit tests for the Story 21.1 episode-level compression tier
/// (<method>ExecuteMCPv2.Diagram.Compressor:CompressEpisodes</method>) and its nested
/// rendering in <class>ExecuteMCPv2.Diagram.Writer</class> (AC 21.1.1/21.1.2/21.1.4/21.1.5).
/// <p>Pure in-memory fixtures (synthetic <code>Demo.*</code> names — decision G2
/// clean-room); no SQL, no IRIS state. Each §6.4 edge-ledger item (3, 4, 5, 6, 7, 8)
/// maps to one fixture test, plus the I1 error-in-episode-signature rule, the
/// byte-for-byte non-repetitive pass-through gate (AC 21.1.4), the nested-indent
/// rendering contract, and the AC 21.1.5 line-count threshold.</p>
Class ExecuteMCPv2.Tests.DiagramEpisodeTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Build one synthetic in-memory trace event.
Method MakeEvent(pId As %Integer, pType As %String, pInv As %String, pSrc As %String, pDst As %String, pBody As %String = "", pCorrId As %String = "", pIsError As %Boolean = 0, pErrText As %String = "") As ExecuteMCPv2.Diagram.Event
{
    Set tEv = ##class(ExecuteMCPv2.Diagram.Event).%New()
    Set tEv.Id = pId
    Set tEv.Type = pType
    Set tEv.Invocation = pInv
    Set tEv.Source = pSrc
    Set tEv.Target = pDst
    Set tEv.BodyClass = pBody
    Set tEv.CorrId = pCorrId
    Set tEv.IsError = pIsError
    Set tEv.ErrorText = pErrText
    Set tEv.SessionId = 1
    Set tEv.TimeCreated = "2026-07-02 10:00:00"
    Quit tEv
}

/// Append one 4-event multi-hop episode: sync outer request/response wrapping an async
/// queue round trip (Demo.Service -> Demo.Process -> Demo.Operation and back).
/// <var>pErrorOnInner</var> flags the inner queue response as errored (I1 fixture).
Method AddHop4(pList As %Library.ListOfObjects, pBase As %Integer, pErrorOnInner As %Boolean = 0) As %Status
{
    Do pList.Insert(..MakeEvent(pBase, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Outer"))
    Do pList.Insert(..MakeEvent(pBase + 1, "Request", "Queue", "Demo.Process", "Demo.Operation", "Demo.Msg.Inner"))
    Do pList.Insert(..MakeEvent(pBase + 2, "Response", "Queue", "Demo.Operation", "Demo.Process", "Demo.Msg.InnerResp", pBase + 1, pErrorOnInner, $Select(pErrorOnInner: "boom", 1: "")))
    Do pList.Insert(..MakeEvent(pBase + 3, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.OuterResp", pBase))
    Quit $$$OK
}

/// Append one "abandoned sync request then <pPairCount> identical single-hop pairs"
/// group (CR 21.1-1 fixtures). The leading request (Demo.Service -> Demo.Gone) has no
/// response, so it is an abandoned sync frame; each pair is Demo.Caller -> Demo.Op and
/// back. With pPairCount=1 the pair does NOT collapse (raw single-pair grouping); with
/// pPairCount&gt;1 the contiguous pairs collapse into a pairloop (pairloop grouping).
Method AddAbandonedGroup(pList As %Library.ListOfObjects, pBase As %Integer, pPairCount As %Integer) As %Status
{
    Do pList.Insert(..MakeEvent(pBase, "Request", "Inproc", "Demo.Service", "Demo.Gone", "Demo.Msg.Lost"))
    For tI = 0:1:(pPairCount - 1) {
        Set tReqId = pBase + 1 + (tI * 2)
        Do pList.Insert(..MakeEvent(tReqId, "Request", "Inproc", "Demo.Caller", "Demo.Op", "Demo.Msg.Ping"))
        Do pList.Insert(..MakeEvent(tReqId + 1, "Response", "Inproc", "Demo.Op", "Demo.Caller", "Demo.Msg.Pong", tReqId))
    }
    Quit $$$OK
}

/// Run the full in-memory pipeline: Correlate -> pair tier -> episode tier.
Method RunTiers(pEvents As %Library.ListOfObjects, Output pStream As %Library.ListOfObjects) As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(pEvents, "full", .tRender)
    If $$$ISERR(tSC) Quit tSC
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tRender, .tPair)
    If $$$ISERR(tSC) Quit tSC
    Quit ##class(ExecuteMCPv2.Diagram.Compressor).CompressEpisodes(tPair, .pStream)
}

/// Render a stream (fixed session/header inputs — the body is what these tests assert).
Method RenderStream(pStream As %Library.ListOfObjects, pMsgCount As %Integer) As %String
{
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, pMsgCount, "t1", "t2", pStream, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Writer should succeed")
    Quit tMermaid
}

/// Count stream events of one Kind.
Method CountKind(pStream As %Library.ListOfObjects, pKind As %String) As %Integer
{
    Set tCount = 0
    For tI = 1:1:pStream.Count() {
        If pStream.GetAt(tI).Kind = pKind Set tCount = tCount + 1
    }
    Quit tCount
}

/// Return the 1-based index of the first LF-delimited line containing the substring (0 = none).
Method FindLine(pMermaid As %String, pSubstring As %String) As %Integer
{
    Set tFound = 0
    Set tCount = $Length(pMermaid, $Char(10))
    For tI = 1:1:tCount {
        If $Piece(pMermaid, $Char(10), tI) [ pSubstring {
            Set tFound = tI
            Quit
        }
    }
    Quit tFound
}

/// AC 21.1.1: three contiguous identical multi-hop episodes collapse to one episodeloop
/// wrapping the representative 4-arrow body, rendered as a labelled loop block.
Method TestEpisodeLoopCollapse() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    For tI = 0:1:2 {
        Do ..AddHop4(tEvents, 1000 + (tI * 10))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 1, "Three identical episodes collapse to one event")
    Set tLoop = tStream.GetAt(1)
    Do $$$AssertEquals(tLoop.Kind, "episodeloop", "Collapsed event is an episodeloop")
    Do $$$AssertEquals(tLoop.Count, 3, "Episode loop count is 3")
    Do $$$AssertEquals(tLoop.Body.Count(), 4, "Representative body keeps all four arrows")
    Do $$$AssertEquals(tLoop.Label, "Demo.Msg.Outer", "Representative label is the opening request's label")
    Set tMermaid = ..RenderStream(tStream, 12)
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"loop 3 times Demo.Msg.Outer"_$Char(10)), "Labelled episode loop header emitted")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"  Demo.Service->>Demo.Process: Demo.Msg.Outer"_$Char(10)), "Body arrows indented 2 spaces")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"  Demo.Process-->>Demo.Operation: Demo.Msg.Inner"_$Char(10)), "Async inner arrow retained inside the loop")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"end"), "Episode loop closed with end at depth 0")
    Quit $$$OK
}

/// AC 21.1.4 byte-for-byte gate: a non-repetitive 21.0-style trace renders IDENTICAL
/// mermaid text with and without the episode tier (the tier is a pure pass-through
/// when no repetition exists).
Method TestNonRepetitivePassThroughByteForByte() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(1, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Req"))
    Do tEvents.Insert(..MakeEvent(2, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.Resp", 1))
    Do tEvents.Insert(..MakeEvent(3, "Request", "Queue", "Demo.Process", "Demo.Operation", "Demo.Msg.Q"))
    Do tEvents.Insert(..MakeEvent(4, "Response", "Queue", "Demo.Operation", "Demo.Process", "Demo.Msg.QResp", 3))
    Do tEvents.Insert(..MakeEvent(5, "Request", "Inproc", "Demo.Service", "Demo.Gone", "Demo.Msg.Lost"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tRender, .tPair)
    Do $$$AssertStatusOK(tSC, "Pair tier should succeed")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).CompressEpisodes(tPair, .tEpisode)
    Do $$$AssertStatusOK(tSC, "Episode tier should succeed")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(9, 5, "t1", "t5", tPair, .tBefore)
    Do $$$AssertStatusOK(tSC, "Writer on the pair-tier stream should succeed")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(9, 5, "t1", "t5", tEpisode, .tAfter)
    Do $$$AssertStatusOK(tSC, "Writer on the episode-tier stream should succeed")
    Do $$$AssertEquals(tAfter, tBefore, "Non-repetitive trace mermaid is byte-for-byte unchanged by the episode tier")
    Quit $$$OK
}

/// §6.4 item 3: episode signatures include inner loop counts — episodes that differ
/// ONLY in a pair-loop's iteration count never merge.
Method TestLoopCountInSignature() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    ; episode X: outer sync wrap around TWO identical inner sync pairs
    Do tEvents.Insert(..MakeEvent(100, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Outer"))
    For tI = 0:1:1 {
        Do tEvents.Insert(..MakeEvent(101 + (tI * 2), "Request", "Inproc", "Demo.Process", "Demo.Operation", "Demo.Msg.Inner"))
        Do tEvents.Insert(..MakeEvent(102 + (tI * 2), "Response", "Inproc", "Demo.Operation", "Demo.Process", "Demo.Msg.InnerResp", 101 + (tI * 2)))
    }
    Do tEvents.Insert(..MakeEvent(105, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.OuterResp", 100))
    ; episode Y: same shape but THREE inner pairs
    Do tEvents.Insert(..MakeEvent(110, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Outer"))
    For tI = 0:1:2 {
        Do tEvents.Insert(..MakeEvent(111 + (tI * 2), "Request", "Inproc", "Demo.Process", "Demo.Operation", "Demo.Msg.Inner"))
        Do tEvents.Insert(..MakeEvent(112 + (tI * 2), "Response", "Inproc", "Demo.Operation", "Demo.Process", "Demo.Msg.InnerResp", 111 + (tI * 2)))
    }
    Do tEvents.Insert(..MakeEvent(117, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.OuterResp", 110))
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(..CountKind(tStream, "episodeloop"), 0, "Different inner loop counts never merge into an episode loop")
    Set tMermaid = ..RenderStream(tStream, 14)
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"loop 2 times"_$Char(10)), "Two-iteration inner pair loop retained")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"loop 3 times"_$Char(10)), "Three-iteration inner pair loop retained")
    Quit $$$OK
}

/// §6.4 item 4 (rule A): an abandoned/unanswered sync request unwinds when the next
/// request's source is not its destination — it must NOT swallow all later episodes.
Method TestAbandonedSyncRequestUnwind() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(200, "Request", "Inproc", "Demo.Service", "Demo.Gone", "Demo.Msg.Lost"))
    For tI = 0:1:2 {
        Do ..AddHop4(tEvents, 210 + (tI * 10))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 2, "Abandoned request + one episode loop remain")
    Do $$$AssertEquals(tStream.GetAt(1).Kind, "arrow", "Abandoned request emitted as a plain arrow")
    Do $$$AssertEquals(tStream.GetAt(2).Kind, "episodeloop", "Later episodes still compress")
    Do $$$AssertEquals(tStream.GetAt(2).Count, 3, "All three episodes after the abandoned request merged")
    Set tMermaid = ..RenderStream(tStream, 13)
    Set tLost = ..FindLine(tMermaid, "Demo.Msg.Lost")
    Set tLoop = ..FindLine(tMermaid, "loop 3 times")
    Do $$$AssertTrue((tLost > 0) && (tLoop > 0) && (tLost < tLoop), "Abandoned arrow renders before the episode loop")
    Do $$$AssertTrue(tMermaid [ "%% Unpaired request: message 200", "Abandoned request's warning retained")
    Quit $$$OK
}

/// §6.4 item 4 (rule B): a response answering a DEEPER frame unwinds to it — an
/// abandoned deeper sync frame whose destination matches the next root's source must
/// not absorb the following episodes.
Method TestResponseAnswersDeeperFrame() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    For tI = 0:1:2 {
        Set tBase = 300 + (tI * 10)
        Do tEvents.Insert(..MakeEvent(tBase, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Outer"))
        Do tEvents.Insert(..MakeEvent(tBase + 1, "Request", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.Nudge"))
        Do tEvents.Insert(..MakeEvent(tBase + 2, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.OuterResp", tBase))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(..CountKind(tStream, "episodeloop"), 1, "Deeper-frame answers still close episodes")
    Do $$$AssertEquals(tStream.GetAt(1).Count, 3, "All three episodes merged despite the abandoned deeper frame")
    ; §6.4 item 8: per-iteration warning texts (distinct message ids) all survive
    Set tMermaid = ..RenderStream(tStream, 9)
    Do $$$AssertTrue(tMermaid [ "%% Unpaired request: message 301", "Iteration 1 warning rendered (representative body)")
    Do $$$AssertTrue(tMermaid [ "%% Unpaired request: message 311", "Iteration 2 warning rendered (loop-level extra)")
    Do $$$AssertTrue(tMermaid [ "%% Unpaired request: message 321", "Iteration 3 warning rendered (loop-level extra)")
    Quit $$$OK
}

/// §6.4 item 5: trace-utility events BETWEEN episodes attach to the previous episode so
/// contiguity (and thus compression) is preserved; trace events stay out of signatures
/// but are retained in the rendered body.
Method TestTraceEventAttachesToPreviousEpisode() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do ..AddHop4(tEvents, 400)
    Do tEvents.Insert(..MakeEvent(405, "Request", "Inproc", "Demo.Process", "Demo.Tracer", "HS.Util.Trace.Log"))
    Do ..AddHop4(tEvents, 410)
    Do tEvents.Insert(..MakeEvent(415, "Request", "Inproc", "Demo.Process", "Demo.Tracer", "HS.Util.Trace.Log"))
    Do ..AddHop4(tEvents, 420)
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 1, "Trace events between episodes do not break contiguity")
    Set tLoop = tStream.GetAt(1)
    Do $$$AssertEquals(tLoop.Kind, "episodeloop", "Episodes still merge across trace events")
    Do $$$AssertEquals(tLoop.Count, 3, "All three episodes merged")
    Do $$$AssertEquals(tLoop.Body.Count(), 5, "Representative body retains its attached trace event")
    Set tMermaid = ..RenderStream(tStream, 14)
    Set tTraceLine = ..FindLine(tMermaid, "HS.Util.Trace.Log")
    Do $$$AssertTrue(tTraceLine > 0, "Trace arrow retained in the rendered body")
    Do $$$AssertEquals($Extract($Piece(tMermaid, $Char(10), tTraceLine), 1, 2), "  ", "Trace arrow indented inside the loop body")
    Quit $$$OK
}

/// §6.4 item 6: an async request with a KNOWN paired response opens a queue-rooted
/// episode that closes when that response is consumed — the whole group compresses.
Method TestQueueRootedEpisode() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    For tI = 0:1:1 {
        Set tBase = 500 + (tI * 10)
        Do tEvents.Insert(..MakeEvent(tBase, "Request", "Queue", "Demo.Process", "Demo.Operation", "Demo.Msg.Job"))
        Do tEvents.Insert(..MakeEvent(tBase + 1, "Request", "Inproc", "Demo.Operation", "Demo.Sub", "Demo.Msg.Step"))
        Do tEvents.Insert(..MakeEvent(tBase + 2, "Response", "Inproc", "Demo.Sub", "Demo.Operation", "Demo.Msg.StepResp", tBase + 1))
        Do tEvents.Insert(..MakeEvent(tBase + 3, "Response", "Queue", "Demo.Operation", "Demo.Process", "Demo.Msg.JobResp", tBase))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 1, "Queue-rooted episodes compress")
    Do $$$AssertEquals(tStream.GetAt(1).Kind, "episodeloop", "Collapsed to an episode loop")
    Do $$$AssertEquals(tStream.GetAt(1).Count, 2, "Both queue-rooted episodes merged")
    Set tMermaid = ..RenderStream(tStream, 8)
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"loop 2 times Demo.Msg.Job"_$Char(10)), "Queue-rooted loop labelled by the async request")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"  Demo.Process-->>Demo.Operation: Demo.Msg.Job"_$Char(10)), "Async request arrow inside the loop")
    Quit $$$OK
}

/// §6.4 item 7: an envelope-wrapper flow (outer sync wrapper request whose response is
/// the final event) starts episode detection at depth 2 — the wrapper is peeled and the
/// inner episodes compress; the wrapper arrows render OUTSIDE the loop.
Method TestEnvelopeWrapperDepth2() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(600, "Request", "Inproc", "Demo.Gateway", "Demo.Service", "Demo.Msg.Wrap"))
    For tI = 0:1:2 {
        Do ..AddHop4(tEvents, 610 + (tI * 10))
    }
    Do tEvents.Insert(..MakeEvent(690, "Response", "Inproc", "Demo.Service", "Demo.Gateway", "Demo.Msg.WrapResp", 600))
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 3, "Wrapper request + episode loop + wrapper response")
    Do $$$AssertEquals(tStream.GetAt(1).Kind, "arrow", "Wrapper request stays a plain arrow")
    Do $$$AssertEquals(tStream.GetAt(2).Kind, "episodeloop", "Inner episodes compress despite the open wrapper")
    Do $$$AssertEquals(tStream.GetAt(2).Count, 3, "All three inner episodes merged")
    Do $$$AssertEquals(tStream.GetAt(3).Kind, "arrow", "Wrapper response stays a plain arrow")
    Set tMermaid = ..RenderStream(tStream, 14)
    Set tWrapReq = ..FindLine(tMermaid, "Demo.Msg.Wrap")
    Set tLoop = ..FindLine(tMermaid, "loop 3 times")
    Set tWrapResp = ..FindLine(tMermaid, "Demo.Msg.WrapResp")
    Do $$$AssertTrue((tWrapReq > 0) && (tWrapReq < tLoop), "Wrapper request renders before the loop")
    Do $$$AssertTrue((tWrapResp > 0) && (tWrapResp > tLoop), "Wrapper response renders after the loop")
    Do $$$AssertEquals($Extract($Piece(tMermaid, $Char(10), tWrapResp), 1, 2), "De", "Wrapper response is unindented (outside the loop)")
    Quit $$$OK
}

/// Improvement I1: error state joins the episode signature — an errored episode never
/// merges into the adjacent clean episodes' loop.
Method TestErrorStateInEpisodeSignature() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do ..AddHop4(tEvents, 700)
    Do ..AddHop4(tEvents, 710)
    Do ..AddHop4(tEvents, 720, 1)
    Do ..AddHop4(tEvents, 730)
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(..CountKind(tStream, "episodeloop"), 1, "Only the two leading clean episodes merge")
    Do $$$AssertEquals(tStream.GetAt(1).Kind, "episodeloop", "Clean episodes collapse first")
    Do $$$AssertEquals(tStream.GetAt(1).Count, 2, "Errored episode excluded from the clean loop")
    Set tMermaid = ..RenderStream(tStream, 16)
    Set tErr = ..FindLine(tMermaid, "[ERROR]")
    Set tEnd = ..FindLine(tMermaid, "end")
    Do $$$AssertTrue((tErr > 0) && (tEnd > 0) && (tErr > tEnd), "Errored arrow renders outside (after) the clean loop")
    Do $$$AssertTrue(tMermaid [ "%% Error on message 722: boom", "I1 error warning retained")
    Quit $$$OK
}

/// AC 21.1.1 nested rendering: pair-loops render INSIDE episode loops with 2-space
/// indentation per nesting level and end lines closing at the right depth.
Method TestNestedPairLoopInsideEpisode() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    For tI = 0:1:1 {
        Set tBase = 800 + (tI * 10)
        Do tEvents.Insert(..MakeEvent(tBase, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Outer"))
        For tJ = 0:1:2 {
            Do tEvents.Insert(..MakeEvent(tBase + 1 + (tJ * 2), "Request", "Inproc", "Demo.Process", "Demo.Operation", "Demo.Msg.Inner"))
            Do tEvents.Insert(..MakeEvent(tBase + 2 + (tJ * 2), "Response", "Inproc", "Demo.Operation", "Demo.Process", "Demo.Msg.InnerResp", tBase + 1 + (tJ * 2)))
        }
        Do tEvents.Insert(..MakeEvent(tBase + 7, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.OuterResp", tBase))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 1, "Both episodes collapse to one episode loop")
    Set tLoop = tStream.GetAt(1)
    Do $$$AssertEquals(tLoop.Count, 2, "Episode loop count is 2")
    Do $$$AssertEquals(tLoop.Body.Count(), 3, "Body is outer request + inner pairloop + outer response")
    Do $$$AssertEquals(tLoop.Body.GetAt(2).Kind, "pairloop", "Inner pair loop nests inside the episode body")
    Set tMermaid = ..RenderStream(tStream, 16)
    Set tNL = $Char(10)
    Do $$$AssertEquals($Piece(tMermaid, tNL, 6), "loop 2 times Demo.Msg.Outer", "Episode loop opens at depth 0")
    Do $$$AssertEquals($Piece(tMermaid, tNL, 7), "  Demo.Service->>Demo.Process: Demo.Msg.Outer", "Outer request at depth 1")
    Do $$$AssertEquals($Piece(tMermaid, tNL, 8), "  loop 3 times", "Nested pair loop opens at depth 1")
    Do $$$AssertEquals($Piece(tMermaid, tNL, 9), "    Demo.Process->>Demo.Operation: Demo.Msg.Inner", "Pair legs at depth 2")
    Do $$$AssertEquals($Piece(tMermaid, tNL, 10), "    Demo.Operation->>Demo.Process: Demo.Msg.InnerResp", "Second leg at depth 2")
    Do $$$AssertEquals($Piece(tMermaid, tNL, 11), "  end", "Nested loop closes at depth 1")
    Do $$$AssertEquals($Piece(tMermaid, tNL, 12), "  Demo.Process->>Demo.Service: Demo.Msg.OuterResp", "Outer response back at depth 1")
    Do $$$AssertEquals($Piece(tMermaid, tNL, 13), "end", "Episode loop closes at depth 0")
    Quit $$$OK
}

/// AC 21.1.5 readability threshold: 200 repeated 3-hop episodes (1200 arrows) emit a
/// compact diagram — under 40 lines (recorded threshold).
Method TestLineCountThreshold() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    For tI = 0:1:199 {
        Set tBase = 10000 + (tI * 10)
        Do tEvents.Insert(..MakeEvent(tBase, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Hop1"))
        Do tEvents.Insert(..MakeEvent(tBase + 1, "Request", "Inproc", "Demo.Process", "Demo.Operation", "Demo.Msg.Hop2"))
        Do tEvents.Insert(..MakeEvent(tBase + 2, "Request", "Inproc", "Demo.Operation", "Demo.Store", "Demo.Msg.Hop3"))
        Do tEvents.Insert(..MakeEvent(tBase + 3, "Response", "Inproc", "Demo.Store", "Demo.Operation", "Demo.Msg.Hop3Resp", tBase + 2))
        Do tEvents.Insert(..MakeEvent(tBase + 4, "Response", "Inproc", "Demo.Operation", "Demo.Process", "Demo.Msg.Hop2Resp", tBase + 1))
        Do tEvents.Insert(..MakeEvent(tBase + 5, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.Hop1Resp", tBase))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed on the large trace")
    Set tMermaid = ..RenderStream(tStream, 1200)
    Do $$$AssertTrue(tMermaid [ "loop 200 times Demo.Msg.Hop1", "200 episodes collapse to one loop")
    Set tLines = $Length(tMermaid, $Char(10))
    Do $$$AssertTrue(tLines < 40, "1200-arrow trace emits under 40 lines (got "_tLines_")")
    Quit $$$OK
}

/// CR 21.1-1 (episode rule-A pairloop symmetry, stakeholder Option A): an abandoned sync
/// request followed by a PAIRLOOP must group the SAME way as one followed by a raw single
/// pair — the abandoned frame unwinds either way, so the traffic never glues into a
/// composite episode. Repeated [reqLost, pairloop]x3 must therefore NOT collapse into one
/// episodeloop (the pre-fix asymmetric behavior), staying an alternating arrow/pairloop
/// stream that matches the raw-single-pair grouping's boundaries (both yield zero
/// episodeloops — the abandoned request is isolated in its own episode in both).
Method TestAbandonedPairloopGroupsSymmetricWithRawPair() As %Status
{
    ; PAIRLOOP grouping: [abandoned reqLost, then 3 identical pairs] x3. The pair tier
    ; collapses each group's 3 pairs into a pairloop; CR 21.1-1 makes the pairloop unwind
    ; the abandoned sync frame (on its request-leg source) so it does NOT glue into a
    ; composite episode.
    Set tPL = ##class(%Library.ListOfObjects).%New()
    For tG = 0:1:2 { Do ..AddAbandonedGroup(tPL, 6000 + (tG * 100), 3) }
    Set tSC = ..RunTiers(tPL, .tPLStream)
    Do $$$AssertStatusOK(tSC, "Pairloop-grouping pipeline should succeed")
    Do $$$AssertEquals(..CountKind(tPLStream, "episodeloop"), 0, "Abandoned request + pairloop does NOT glue into a composite episode loop (CR 21.1-1)")
    Do $$$AssertEquals(tPLStream.Count(), 6, "Stream stays arrow/pairloop alternating (2 events x 3 groups)")
    Do $$$AssertEquals(tPLStream.GetAt(1).Kind, "arrow", "Group 1 abandoned request is its own arrow")
    Do $$$AssertEquals(tPLStream.GetAt(2).Kind, "pairloop", "Group 1 pairs collapse to a pairloop in a SEPARATE episode")
    Do $$$AssertEquals(tPLStream.GetAt(3).Kind, "arrow", "Group 2 abandoned request stays separate")
    Do $$$AssertEquals(tPLStream.GetAt(4).Kind, "pairloop", "Group 2 pairloop stays separate")

    ; RAW-single-pair grouping: [abandoned reqLost, then ONE pair] x3 — no pairloop forms
    ; (the pairs are non-contiguous). The abandoned request already unwinds on the raw
    ; request arrow; assert the SAME symmetric result (no episode-loop glue).
    Set tRaw = ##class(%Library.ListOfObjects).%New()
    For tG = 0:1:2 { Do ..AddAbandonedGroup(tRaw, 7000 + (tG * 100), 1) }
    Set tSC = ..RunTiers(tRaw, .tRawStream)
    Do $$$AssertStatusOK(tSC, "Raw-single-pair pipeline should succeed")
    Do $$$AssertEquals(..CountKind(tRawStream, "episodeloop"), 0, "Raw single-pair grouping ALSO does not glue the abandoned request (symmetric with the pairloop grouping)")
    Do $$$AssertEquals(tRawStream.Count(), 9, "Raw stream is nine plain arrows (reqLost + req + resp) x 3")
    Quit $$$OK
}

/// CR 21.1-2 (Src=Dst self-call depth-stack growth): repeated unanswered sync SELF-calls
/// (Src=Dst, PairId=0, no response) previously each pushed a frame that rule A could never
/// unwind (the frame's destination equals its own source) and no response popped — the
/// depth stack grew linearly and all self-calls glued into ONE episode (defeating
/// compression). With the self-call push-guard each self-call roots its own episode, so
/// three identical ones collapse to a single episodeloop.
Method TestUnpairedSelfCallDoesNotGrowStack() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    For tI = 0:1:2 {
        Do tEvents.Insert(..MakeEvent(8000 + tI, "Request", "Inproc", "Demo.Loop", "Demo.Loop", "Demo.Msg.Self"))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Self-call pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 1, "Three identical self-calls collapse to one event (the stack did not grow)")
    Do $$$AssertEquals(tStream.GetAt(1).Kind, "episodeloop", "Repeated self-calls compress into an episode loop")
    Do $$$AssertEquals(tStream.GetAt(1).Count, 3, "Episode loop count is 3")
    Do $$$AssertEquals(tStream.GetAt(1).Body.Count(), 1, "Representative body is the single self-call arrow")
    Quit $$$OK
}

/// CR 22.1-1 (resolved Story 26.4, defense-only guard): a MALFORMED pairloop event whose
/// REQUEST leg carries an empty <var>Src</var> — a shape the live pipeline's sole pairloop
/// producer (<method>Compressor:Compress</method>) never emits (confirmed by the Story
/// 26.4 source-read probe: its <code>tLoop.Req</code> is always a real request-arrow event
/// with a non-empty <code>Src</code>) — must NOT unwind an open sync frame. Directly
/// exercises <method>ExecuteMCPv2.Diagram.Compressor:CompressEpisodes</method> with a
/// hand-built malformed pairloop (bypassing Correlate/Compress, whose real producer can
/// never emit this shape) to prove the <code>(tReqSrc '= "")</code> guard added to
/// EpisodeCore's rule-A <code>While</code> condition is load-bearing: reverting it would
/// make an empty <var>tReqSrc</var> compare unequal to every open frame's destination and
/// over-unwind, splitting what should be one repeated 2-event episode into four
/// alternating single-event episodes that never collapse (asserted below: WITH the guard,
/// two identical [open-request, malformed-pairloop] repetitions collapse to ONE
/// episodeloop of Count=2; WITHOUT it they would stay four uncollapsed events).
Method TestMalformedPairloopEmptyReqSrcDoesNotUnwind() As %Status
{
    Set tStream = ##class(%Library.ListOfObjects).%New()
    For tI = 1:1:2 {
        ; leg 1: a sync push request opens a frame (Demo.Service -> Demo.Loop)
        Set tReq = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
        Set tReq.Kind = "arrow"
        Set tReq.Src = "Demo.Service"
        Set tReq.Dst = "Demo.Loop"
        Set tReq.Label = "Demo.Msg.Open"
        Set tReq.Arrow = "->>"
        Set tReq.Role = "req"
        Do tStream.Insert(tReq)

        ; leg 2: a malformed pairloop whose Req leg carries an empty Src -- a shape the
        ; real pairloop producer never emits (see method doc comment above)
        Set tPReq = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
        Set tPReq.Kind = "arrow"
        Set tPReq.Src = ""
        Set tPReq.Dst = "Demo.Op"
        Set tPReq.Label = "Demo.Msg.Inner"
        Set tPReq.Arrow = "->>"
        Set tPReq.Role = "req"
        Set tPResp = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
        Set tPResp.Kind = "arrow"
        Set tPResp.Src = "Demo.Op"
        Set tPResp.Dst = ""
        Set tPResp.Label = "Demo.Msg.InnerResp"
        Set tPResp.Arrow = "->>"
        Set tPResp.Role = "resp"
        Set tPairloop = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
        Set tPairloop.Kind = "pairloop"
        Set tPairloop.Count = 2
        Set tPairloop.Req = tPReq
        Set tPairloop.Resp = tPResp
        Do tStream.Insert(tPairloop)
    }
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).CompressEpisodes(tStream, .tOut)
    Do $$$AssertStatusOK(tSC, "CompressEpisodes should succeed on the malformed fixture")
    Do $$$AssertEquals(tOut.Count(), 1, "The two identical [open, malformed-pairloop] episodes stay grouped and collapse to one episodeloop (guard prevents over-unwind)")
    Do $$$AssertEquals(tOut.GetAt(1).Kind, "episodeloop", "Collapsed event is an episodeloop")
    Do $$$AssertEquals(tOut.GetAt(1).Count, 2, "Episode loop count is 2 (both repetitions merged)")
    Quit $$$OK
}

}
