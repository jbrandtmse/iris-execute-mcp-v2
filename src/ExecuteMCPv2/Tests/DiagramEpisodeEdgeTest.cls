/// QA-stage adversarial edge tests for the Story 21.1 episode-compression tier
/// (<method>ExecuteMCPv2.Diagram.Compressor:CompressEpisodes</method>) — sibling class
/// to <class>ExecuteMCPv2.Tests.DiagramEpisodeTest</class> (split per the story's
/// ~500-line class guidance; each case below was verified ABSENT from the dev suite
/// before writing).
/// <p>Pure in-memory fixtures (synthetic <code>Demo.*</code> names — decision G2
/// clean-room); no SQL, no IRIS state. Covers:</p>
/// <ul>
///   <li>Interleaved different-signature episodes (A B A B) never collapse — only
///       CONTIGUOUS identical runs merge (§6.3), and the interleaved stream stays
///       byte-for-byte pass-through (AC 21.1.4 shape).</li>
///   <li>An errored iteration INSIDE an otherwise-identical episode run splits the
///       collapse (I1 in the signature) and compression RESUMES after it — two separate
///       loops, the errored episode rendered plainly between them.</li>
///   <li>A LEADING trace-utility event (before any business episode) forms its own
///       never-merged all-trace episode (the tCur=0 branch of EpisodeCore) and does not
///       poison the following collapse (§6.4 item 5 interplay).</li>
///   <li>CR 21.1-1 NEST branch — an abandoned sync request followed by a pairloop whose
///       request-leg source EQUALS the abandoned frame's destination does NOT unwind: the
///       pairloop nests into one composite <code>[arrow, pairloop]</code> episode and repeated
///       composites collapse. This is the COMPLEMENT of DiagramEpisodeTest's split fixture
///       (where the sources DIFFER and the frame unwinds), so together they cover both sides
///       of rule A's pairloop branch (<code>tEv.Req.Src '= frameDest</code>).</li>
///   <li>CR 21.1-2 — a PAIRED self-call (Src=Dst, PairId&gt;0) STILL pushes/pops a frame (the
///       guard's PairId&gt;0 exception), so a self-call wrapping an inner hop stays ONE episode
///       and repeats collapse; and a DEEP chain of unpaired self-calls collapses without
///       growing the stack AND does not absorb the distinct multi-hop episode that follows it
///       (boundary isolation).</li>
/// </ul>
Class ExecuteMCPv2.Tests.DiagramEpisodeEdgeTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Build one synthetic in-memory trace event (mirrors DiagramEpisodeTest's helper).
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

/// Append one 4-event multi-hop episode (shape A): sync outer request/response wrapping
/// an async queue round trip. <var>pErrorOnInner</var> flags the inner queue response as
/// errored (I1 fixture).
Method AddHop4(pList As %Library.ListOfObjects, pBase As %Integer, pErrorOnInner As %Boolean = 0) As %Status
{
    Do pList.Insert(..MakeEvent(pBase, "Request", "Inproc", "Demo.Service", "Demo.Process", "Demo.Msg.Outer"))
    Do pList.Insert(..MakeEvent(pBase + 1, "Request", "Queue", "Demo.Process", "Demo.Operation", "Demo.Msg.Inner"))
    Do pList.Insert(..MakeEvent(pBase + 2, "Response", "Queue", "Demo.Operation", "Demo.Process", "Demo.Msg.InnerResp", pBase + 1, pErrorOnInner, $Select(pErrorOnInner: "boom", 1: "")))
    Do pList.Insert(..MakeEvent(pBase + 3, "Response", "Inproc", "Demo.Process", "Demo.Service", "Demo.Msg.OuterResp", pBase))
    Quit $$$OK
}

/// Append one 2-event sync round trip (shape B — a signature DIFFERENT from AddHop4).
Method AddPing2(pList As %Library.ListOfObjects, pBase As %Integer) As %Status
{
    Do pList.Insert(..MakeEvent(pBase, "Request", "Inproc", "Demo.Service", "Demo.Other", "Demo.Msg.Ping"))
    Do pList.Insert(..MakeEvent(pBase + 1, "Response", "Inproc", "Demo.Other", "Demo.Service", "Demo.Msg.Pong", pBase))
    Quit $$$OK
}

/// Append one "abandoned sync request then <pPairCount> pairs ROOTED AT the abandoned
/// request's destination" group (CR 21.1-1 nest branch). The leading request
/// (Demo.Service -> Demo.Gone) has no response, so it opens an abandoned sync frame whose
/// destination is Demo.Gone; each following pair is Demo.Gone -> Demo.Op and back, so the
/// pair-loop's REQUEST-leg source (Demo.Gone) EQUALS the abandoned frame's destination.
/// Rule A must therefore NOT unwind the abandoned frame — the pair-loop NESTS, forming one
/// composite [arrow, pairloop] episode. (Contrast DiagramEpisodeTest:AddAbandonedGroup,
/// whose pairs are Demo.Caller -> Demo.Op — a DIFFERENT source that DOES unwind the frame.)
Method AddContinuedGroup(pList As %Library.ListOfObjects, pBase As %Integer, pPairCount As %Integer) As %Status
{
    Do pList.Insert(..MakeEvent(pBase, "Request", "Inproc", "Demo.Service", "Demo.Gone", "Demo.Msg.Lost"))
    For tI = 0:1:(pPairCount - 1) {
        Set tReqId = pBase + 1 + (tI * 2)
        Do pList.Insert(..MakeEvent(tReqId, "Request", "Inproc", "Demo.Gone", "Demo.Op", "Demo.Msg.Ping"))
        Do pList.Insert(..MakeEvent(tReqId + 1, "Response", "Inproc", "Demo.Op", "Demo.Gone", "Demo.Msg.Pong", tReqId))
    }
    Quit $$$OK
}

/// Append one PAIRED sync self-call (Demo.Loop -> Demo.Loop) that WRAPS one inner sync hop
/// (Demo.Loop -> Demo.Inner and back), then closes with the self-call's own response
/// (CR 21.1-2 paired-self-call fixture). The self-call carries a matching response, so the
/// correlator pairs it (PairId&gt;0) and the episode tier's guard must STILL push its frame
/// (the guard skips the push only for an UNPAIRED self-call) — otherwise the inner hop would
/// wrongly root a separate episode instead of nesting.
Method AddPairedSelfCallWrap(pList As %Library.ListOfObjects, pBase As %Integer) As %Status
{
    Do pList.Insert(..MakeEvent(pBase, "Request", "Inproc", "Demo.Loop", "Demo.Loop", "Demo.Msg.Self"))
    Do pList.Insert(..MakeEvent(pBase + 1, "Request", "Inproc", "Demo.Loop", "Demo.Inner", "Demo.Msg.Step"))
    Do pList.Insert(..MakeEvent(pBase + 2, "Response", "Inproc", "Demo.Inner", "Demo.Loop", "Demo.Msg.StepResp", pBase + 1))
    Do pList.Insert(..MakeEvent(pBase + 3, "Response", "Inproc", "Demo.Loop", "Demo.Loop", "Demo.Msg.SelfResp", pBase))
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
    Quit ..FindLineAfter(pMermaid, pSubstring, 0)
}

/// Return the 1-based index of the first LF-delimited line AFTER line pAfter that
/// contains the substring (0 = none).
Method FindLineAfter(pMermaid As %String, pSubstring As %String, pAfter As %Integer) As %Integer
{
    Set tFound = 0
    Set tCount = $Length(pMermaid, $Char(10))
    For tI = pAfter + 1:1:tCount {
        If $Piece(pMermaid, $Char(10), tI) [ pSubstring {
            Set tFound = tI
            Quit
        }
    }
    Quit tFound
}

/// Interleaved different-signature episodes (A B A B) must NOT collapse: only
/// CONTIGUOUS identical-signature runs merge, so the alternating stream emits zero
/// episodeloop events, preserves the original event order, and renders byte-for-byte
/// identical to the pair-tier stream (the tier is a pure pass-through here).
Method TestInterleavedEpisodesDoNotCollapse() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do ..AddHop4(tEvents, 3000)
    Do ..AddPing2(tEvents, 3020)
    Do ..AddHop4(tEvents, 3040)
    Do ..AddPing2(tEvents, 3060)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, "full", .tRender)
    Do $$$AssertStatusOK(tSC, "Correlate should succeed")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tRender, .tPair)
    Do $$$AssertStatusOK(tSC, "Pair tier should succeed")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).CompressEpisodes(tPair, .tStream)
    Do $$$AssertStatusOK(tSC, "Episode tier should succeed")
    Do $$$AssertEquals(..CountKind(tStream, "episodeloop"), 0, "Interleaved A B A B episodes never collapse")
    Do $$$AssertEquals(tStream.Count(), 12, "All twelve arrows pass through uncompressed")
    Do $$$AssertEquals(tStream.GetAt(1).Label, "Demo.Msg.Outer", "First A episode leads the stream")
    Do $$$AssertEquals(tStream.GetAt(5).Label, "Demo.Msg.Ping", "First B episode follows in original order")
    Do $$$AssertEquals(tStream.GetAt(7).Label, "Demo.Msg.Outer", "Second A episode keeps its position")
    Do $$$AssertEquals(tStream.GetAt(11).Label, "Demo.Msg.Ping", "Second B episode closes the stream")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(3, 12, "t1", "t2", tPair, .tBefore)
    Do $$$AssertStatusOK(tSC, "Writer on the pair-tier stream should succeed")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(3, 12, "t1", "t2", tStream, .tAfter)
    Do $$$AssertStatusOK(tSC, "Writer on the episode-tier stream should succeed")
    Do $$$AssertEquals(tAfter, tBefore, "Interleaved trace mermaid is byte-for-byte unchanged by the episode tier")
    Do $$$AssertTrue('(tAfter [ "loop"), "No loop block anywhere in the interleaved diagram")
    Quit $$$OK
}

/// An errored iteration INSIDE an otherwise-identical episode run splits the collapse
/// (I1: error state joins the signature) and compression RESUMES after it: clean x3 +
/// errored + clean x3 emits TWO separate loop-3 blocks with the errored episode's plain
/// arrows rendered between them (never merged into either loop).
Method TestErroredIterationSplitsAndResumes() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    For tI = 0:1:2 {
        Do ..AddHop4(tEvents, 3100 + (tI * 10))
    }
    Do ..AddHop4(tEvents, 3130, 1)
    For tI = 0:1:2 {
        Do ..AddHop4(tEvents, 3140 + (tI * 10))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(..CountKind(tStream, "episodeloop"), 2, "Collapse splits at the errored episode and resumes after it")
    Do $$$AssertEquals(tStream.Count(), 6, "Two loops plus the errored episode's four plain arrows")
    Do $$$AssertEquals(tStream.GetAt(1).Kind, "episodeloop", "Leading clean episodes collapse first")
    Do $$$AssertEquals(tStream.GetAt(1).Count, 3, "First loop carries the three leading clean episodes")
    Do $$$AssertEquals(tStream.GetAt(6).Kind, "episodeloop", "Trailing clean episodes collapse again")
    Do $$$AssertEquals(tStream.GetAt(6).Count, 3, "Second loop carries the three trailing clean episodes")
    Do $$$AssertEquals(tStream.GetAt(4).Kind, "arrow", "Errored episode passes through as plain arrows")
    Do $$$AssertTrue(tStream.GetAt(4).IsError, "The errored inner response sits between the loops")
    Set tMermaid = ..RenderStream(tStream, 28)
    Set tLoop1 = ..FindLine(tMermaid, "loop 3 times Demo.Msg.Outer")
    Set tErr = ..FindLine(tMermaid, "[ERROR]")
    Set tLoop2 = ..FindLineAfter(tMermaid, "loop 3 times Demo.Msg.Outer", tErr)
    Do $$$AssertTrue(tLoop1 > 0, "First loop rendered")
    Do $$$AssertTrue((tErr > 0) && (tErr > tLoop1), "Errored arrow renders after the first loop")
    Do $$$AssertTrue((tLoop2 > 0) && (tLoop2 > tErr), "Second loop renders after the errored episode")
    Do $$$AssertEquals($Extract($Piece(tMermaid, $Char(10), tErr), 1, 2), "De", "Errored arrow is unindented (outside both loops)")
    Do $$$AssertTrue(tMermaid [ "%% Error on message 3132: boom", "I1 error warning retained on the split episode")
    Quit $$$OK
}

/// A LEADING trace-utility event (before any business episode) lands in its own
/// all-trace episode (signature "" — never merged; the tCur=0 branch of EpisodeCore)
/// and must not poison the collapse of the following identical episodes (§6.4 item 5
/// interplay with compression).
Method TestLeadingTraceEventDoesNotPoisonCollapse() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do tEvents.Insert(..MakeEvent(3200, "Request", "Inproc", "Demo.Service", "Demo.Tracer", "HS.Util.Trace.Log"))
    For tI = 0:1:2 {
        Do ..AddHop4(tEvents, 3210 + (tI * 10))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 2, "Leading trace arrow + one episode loop remain")
    Do $$$AssertEquals(tStream.GetAt(1).Kind, "arrow", "Leading trace event emitted as a plain arrow")
    Do $$$AssertTrue(tStream.GetAt(1).IsTrace, "Leading arrow is the trace-utility event")
    Do $$$AssertEquals(tStream.GetAt(2).Kind, "episodeloop", "Following episodes still compress")
    Do $$$AssertEquals(tStream.GetAt(2).Count, 3, "All three business episodes merged despite the leading trace")
    Do $$$AssertEquals(tStream.GetAt(2).Body.Count(), 4, "Representative body excludes the leading trace event")
    Set tMermaid = ..RenderStream(tStream, 13)
    Set tTrace = ..FindLine(tMermaid, "HS.Util.Trace.Log")
    Set tLoop = ..FindLine(tMermaid, "loop 3 times Demo.Msg.Outer")
    Do $$$AssertTrue((tTrace > 0) && (tLoop > 0) && (tTrace < tLoop), "Trace arrow renders before the episode loop")
    Do $$$AssertEquals($Extract($Piece(tMermaid, $Char(10), tTrace), 1, 2), "De", "Leading trace arrow is unindented (outside the loop)")
    Do $$$AssertTrue(tMermaid [ "%% Unpaired request: message 3200", "Leading trace event's unpaired warning retained")
    Quit $$$OK
}

/// CR 21.1-1 NEST branch (rule-A pairloop, no-unwind side): an abandoned sync request
/// followed by a pairloop whose request-leg source EQUALS the abandoned frame's destination
/// does NOT unwind — the pairloop nests into one composite [arrow, pairloop] episode.
/// [reqLost(Demo.Service->Demo.Gone), pairloop(Demo.Gone->Demo.Op x3)] x3 therefore yields
/// THREE identical composite episodes that collapse into a single episodeloop. This is the
/// exact complement of DiagramEpisodeTest:TestAbandonedPairloopGroupsSymmetricWithRawPair,
/// where the pairloop's source DIFFERS from the frame destination and the frame unwinds
/// (zero episodeloops) — together the two pin both sides of the CR 21.1-1 branch.
Method TestAbandonedThenContinuedPairloopFormsCompositeEpisode() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    For tG = 0:1:2 { Do ..AddContinuedGroup(tEvents, 4000 + (tG * 100), 3) }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Composite-episode pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 1, "Three identical composite episodes collapse to one event")
    Set tLoop = tStream.GetAt(1)
    Do $$$AssertEquals(tLoop.Kind, "episodeloop", "Collapsed event is an episodeloop")
    Do $$$AssertEquals(tLoop.Count, 3, "Episode loop count is 3")
    Do $$$AssertEquals(tLoop.Body.Count(), 2, "Composite body is the abandoned arrow + the nested pairloop")
    Do $$$AssertEquals(tLoop.Body.GetAt(1).Kind, "arrow", "Body[1] is the abandoned request arrow")
    Do $$$AssertEquals(tLoop.Body.GetAt(1).Dst, "Demo.Gone", "Body[1] targets the abandoned frame's destination")
    Do $$$AssertEquals(tLoop.Body.GetAt(2).Kind, "pairloop", "Body[2] is the nested pairloop (source matches the abandoned frame's destination)")
    Do $$$AssertEquals(tLoop.Body.GetAt(2).Req.Src, "Demo.Gone", "The nested pairloop's request leg is rooted at the abandoned frame's destination")
    Do $$$AssertEquals(tLoop.Label, "Demo.Msg.Lost", "Representative label is the abandoned request's label")
    Set tMermaid = ..RenderStream(tStream, 21)
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"loop 3 times Demo.Msg.Lost"_$Char(10)), "Outer episode loop labelled by the abandoned request")
    Set tOuter = ..FindLine(tMermaid, "loop 3 times Demo.Msg.Lost")
    Set tAbandoned = ..FindLineAfter(tMermaid, "Demo.Service->>Demo.Gone: Demo.Msg.Lost", tOuter)
    Set tInner = ..FindLineAfter(tMermaid, "loop 3 times", tAbandoned)
    Set tLeg = ..FindLineAfter(tMermaid, "Demo.Gone->>Demo.Op: Demo.Msg.Ping", tInner)
    Do $$$AssertTrue((tOuter > 0) && (tAbandoned > tOuter), "Abandoned arrow renders inside the composite loop")
    Do $$$AssertTrue((tInner > tAbandoned) && (tLeg > tInner), "Nested pairloop (and its leg) renders after the abandoned arrow, inside the composite loop")
    Do $$$AssertEquals($Extract($Piece(tMermaid, $Char(10), tLeg), 1, 4), "    ", "Pairloop leg is indented two nesting levels (inside episode + pair loop)")
    Quit $$$OK
}

/// CR 21.1-2 PAIRED self-call still pushes (the guard's PairId>0 exception): a paired sync
/// self-call (Demo.Loop->Demo.Loop) wrapping an inner Demo.Loop->Demo.Inner hop must stay
/// ONE 4-event episode — the guard skips the push ONLY for an UNPAIRED self-call, so a
/// paired one keeps nesting the inner hop. Two identical wraps therefore collapse into a
/// single episodeloop of count 2 with a 4-event body. (Were the guard to wrongly skip the
/// paired self-call's push, the inner hop would root a separate episode, the wrap would
/// split into two episodes, and the two groups would NOT collapse.)
Method TestPairedSelfCallStillPushesFrame() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    Do ..AddPairedSelfCallWrap(tEvents, 8100)
    Do ..AddPairedSelfCallWrap(tEvents, 8110)
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Paired-self-call pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 1, "Two identical paired-self-call wraps collapse to one event")
    Set tLoop = tStream.GetAt(1)
    Do $$$AssertEquals(tLoop.Kind, "episodeloop", "Collapsed event is an episodeloop")
    Do $$$AssertEquals(tLoop.Count, 2, "Episode loop count is 2")
    Do $$$AssertEquals(tLoop.Body.Count(), 4, "Body keeps all four arrows of the wrapping episode (the paired self-call nested the inner hop)")
    Do $$$AssertEquals(tLoop.Body.GetAt(1).Src, "Demo.Loop", "Body[1] is the self-call request (source)")
    Do $$$AssertEquals(tLoop.Body.GetAt(1).Dst, "Demo.Loop", "Body[1] is the self-call request (destination equals source)")
    Do $$$AssertEquals(tLoop.Label, "Demo.Msg.Self", "Representative label is the self-call's label")
    Set tMermaid = ..RenderStream(tStream, 8)
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"loop 2 times Demo.Msg.Self"_$Char(10)), "Episode loop labelled by the paired self-call")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"  Demo.Loop->>Demo.Inner: Demo.Msg.Step"_$Char(10)), "Inner hop nested inside the wrapping episode loop")
    Quit $$$OK
}

/// CR 21.1-2 DEEP chain + boundary isolation: five identical UNPAIRED self-calls
/// (Demo.Loop->Demo.Loop) collapse into one episodeloop of count 5 (the guard keeps the
/// depth stack from growing, so each self-call roots its own episode), AND the DISTINCT
/// multi-hop episode that follows (three AddHop4 episodes) compresses into its OWN separate
/// episodeloop — the self-calls neither absorb it nor leak a frame across the boundary.
/// (Without the guard the five self-calls would glue into one non-collapsing episode and
/// GetAt(1) would be a plain arrow, not an episodeloop.)
Method TestDeepSelfCallChainCollapsesAndIsolatesNextEpisode() As %Status
{
    Set tEvents = ##class(%Library.ListOfObjects).%New()
    For tI = 0:1:4 {
        Do tEvents.Insert(..MakeEvent(8200 + tI, "Request", "Inproc", "Demo.Loop", "Demo.Loop", "Demo.Msg.Self"))
    }
    For tI = 0:1:2 {
        Do ..AddHop4(tEvents, 8210 + (tI * 10))
    }
    Set tSC = ..RunTiers(tEvents, .tStream)
    Do $$$AssertStatusOK(tSC, "Deep-self-call pipeline should succeed")
    Do $$$AssertEquals(tStream.Count(), 2, "One self-call loop + one distinct multi-hop episode loop")
    Do $$$AssertEquals(tStream.GetAt(1).Kind, "episodeloop", "Deep self-call chain collapses (the stack did not grow)")
    Do $$$AssertEquals(tStream.GetAt(1).Count, 5, "All five identical self-calls merged")
    Do $$$AssertEquals(tStream.GetAt(1).Body.Count(), 1, "Self-call episode body is the single self-call arrow")
    Do $$$AssertEquals(tStream.GetAt(1).Label, "Demo.Msg.Self", "First loop labelled by the self-call")
    Do $$$AssertEquals(tStream.GetAt(2).Kind, "episodeloop", "The following distinct episode compresses separately (boundary isolation)")
    Do $$$AssertEquals(tStream.GetAt(2).Count, 3, "All three following multi-hop episodes merged")
    Do $$$AssertEquals(tStream.GetAt(2).Body.Count(), 4, "Following episode keeps its four-arrow body")
    Do $$$AssertEquals(tStream.GetAt(2).Label, "Demo.Msg.Outer", "Second loop labelled by the multi-hop episode's opening request")
    Set tMermaid = ..RenderStream(tStream, 17)
    Set tSelf = ..FindLine(tMermaid, "loop 5 times Demo.Msg.Self")
    Set tOuter = ..FindLineAfter(tMermaid, "loop 3 times Demo.Msg.Outer", tSelf)
    Do $$$AssertTrue((tSelf > 0) && (tOuter > 0) && (tSelf < tOuter), "Self-call loop renders before the distinct multi-hop episode loop")
    Quit $$$OK
}

}
