/// Unit tests for <class>ExecuteMCPv2.Diagram.Compressor</class> (Story 21.0, AC 21.0.4/21.0.12).
/// <p>Pure in-memory render-event fixtures (synthetic <code>Demo.*</code> names — decision
/// G2 clean-room). Covers §6.3 pair-level compression: contiguous identical pairs collapse
/// to <code>loop N times</code> events, the I1 error-in-signature rule (§6.4 item 11), and
/// warning dedupe/retention across compressed iterations (§6.4 item 8).</p>
Class ExecuteMCPv2.Tests.DiagramCompressorTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Build one arrow render event.
Method MakeArrow(pSrc As %String, pDst As %String, pLabel As %String, pArrow As %String, pPairId As %Integer = 0, pRole As %String = "", pIsError As %Boolean = 0, pWarning As %String = "") As ExecuteMCPv2.Diagram.RenderEvent
{
    Set tRE = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
    Set tRE.Kind = "arrow"
    Set tRE.Src = pSrc
    Set tRE.Dst = pDst
    Set tRE.Label = pLabel
    Set tRE.Arrow = pArrow
    Set tRE.PairId = pPairId
    Set tRE.Role = pRole
    Set tRE.IsError = pIsError
    If pWarning '= "" Do tRE.Warnings.Insert(pWarning)
    Quit tRE
}

/// Append one identical request/response pair (fresh PairId) to the list.
Method AddPair(pList As %Library.ListOfObjects, pPairId As %Integer, pIsError As %Boolean = 0, pWarning As %String = "", pLabel As %String = "Demo.Msg.Req") As %Status
{
    Do pList.Insert(..MakeArrow("Demo.Service", "Demo.Process", pLabel, "->>", pPairId, "req", pIsError, pWarning))
    Do pList.Insert(..MakeArrow("Demo.Process", "Demo.Service", "Demo.Msg.Resp", "->>", pPairId, "resp"))
    Quit $$$OK
}

/// Three contiguous identical pairs collapse to one pairloop event with Count=3.
Method TestPairLoopCompression() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do ..AddPair(tList, 1)
    Do ..AddPair(tList, 2)
    Do ..AddPair(tList, 3)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed")
    Do $$$AssertEquals(tOut.Count(), 1, "Three identical pairs collapse to one event")
    Set tLoop = tOut.GetAt(1)
    Do $$$AssertEquals(tLoop.Kind, "pairloop", "Collapsed event is a pairloop")
    Do $$$AssertEquals(tLoop.Count, 3, "Loop count is 3")
    Do $$$AssertEquals(tLoop.Req.Label, "Demo.Msg.Req", "Loop carries the request leg")
    Do $$$AssertEquals(tLoop.Resp.Label, "Demo.Msg.Resp", "Loop carries the response leg")
    Quit $$$OK
}

/// A single pair is NOT compressed — both arrows pass through unchanged.
Method TestSinglePairNotCompressed() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do ..AddPair(tList, 1)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed")
    Do $$$AssertEquals(tOut.Count(), 2, "Single pair passes through as two arrows")
    Do $$$AssertEquals(tOut.GetAt(1).Kind, "arrow", "First event still an arrow")
    Do $$$AssertEquals(tOut.GetAt(2).Kind, "arrow", "Second event still an arrow")
    Quit $$$OK
}

/// I1 signature rule (§6.4 item 11): an errored pair adjacent to identical clean pairs
/// must NOT merge into their loop.
Method TestErroredPairNotMerged() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do ..AddPair(tList, 1)
    Do ..AddPair(tList, 2)
    Do ..AddPair(tList, 3, 1, "Error on message 5: boom")
    Do ..AddPair(tList, 4)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed")
    ; expected: pairloop(2) + errored req + errored resp + clean req + clean resp = 5 events
    Do $$$AssertEquals(tOut.Count(), 5, "Errored pair breaks the loop into 5 events")
    Do $$$AssertEquals(tOut.GetAt(1).Kind, "pairloop", "Leading clean pairs compressed")
    Do $$$AssertEquals(tOut.GetAt(1).Count, 2, "Only the two clean pairs merged")
    Do $$$AssertEquals(tOut.GetAt(2).Kind, "arrow", "Errored request emitted as plain arrow")
    Do $$$AssertTrue(tOut.GetAt(2).IsError, "Errored request keeps its error flag")
    Do $$$AssertEquals(tOut.GetAt(4).Kind, "arrow", "Trailing single clean pair not compressed")
    Do $$$AssertTrue('tOut.GetAt(4).IsError, "Trailing request is clean")
    Quit $$$OK
}

/// Warnings from compressed pairs are deduped (identical text once) and retained.
Method TestWarningRetentionAndDedup() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do ..AddPair(tList, 1, 0, "Unknown invocation on message 1; defaulting to sync arrow")
    Do ..AddPair(tList, 2, 0, "Unknown invocation on message 1; defaulting to sync arrow")
    Do ..AddPair(tList, 3, 0, "Unknown invocation on message 1; defaulting to sync arrow")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed")
    Do $$$AssertEquals(tOut.Count(), 1, "Pairs with identical warnings still compress")
    Do $$$AssertEquals(tOut.GetAt(1).Warnings.Count(), 1, "Identical warnings deduped to one")
    Do $$$AssertEquals(tOut.GetAt(1).Warnings.GetAt(1), "Unknown invocation on message 1; defaulting to sync arrow", "Warning text retained")
    Quit $$$OK
}

/// Distinct warning texts from compressed iterations are ALL retained (first-seen order).
Method TestDistinctWarningsRetained() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do ..AddPair(tList, 1, 0, "warn one")
    Do ..AddPair(tList, 2, 0, "warn two")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed")
    Do $$$AssertEquals(tOut.Count(), 1, "Two identical-signature pairs compress")
    Do $$$AssertEquals(tOut.GetAt(1).Warnings.Count(), 2, "Both distinct warnings retained")
    Do $$$AssertEquals(tOut.GetAt(1).Warnings.GetAt(1), "warn one", "First warning kept in order")
    Do $$$AssertEquals(tOut.GetAt(1).Warnings.GetAt(2), "warn two", "Second warning kept in order")
    Quit $$$OK
}

/// Pairs with different labels do not merge.
Method TestDifferentLabelsNotMerged() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do ..AddPair(tList, 1, 0, "", "Demo.Msg.A")
    Do ..AddPair(tList, 2, 0, "", "Demo.Msg.B")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed")
    Do $$$AssertEquals(tOut.Count(), 4, "Different-label pairs pass through uncompressed")
    Quit $$$OK
}

/// Arrow style participates in the signature: an Inproc pair and a Queue pair with the
/// same endpoints/labels do not merge.
Method TestArrowStyleInSignature() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.Req", "->>", 1, "req"))
    Do tList.Insert(..MakeArrow("Demo.Process", "Demo.Service", "Demo.Msg.Resp", "->>", 1, "resp"))
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.Req", "-->>", 2, "req"))
    Do tList.Insert(..MakeArrow("Demo.Process", "Demo.Service", "Demo.Msg.Resp", "-->>", 2, "resp"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed")
    Do $$$AssertEquals(tOut.Count(), 4, "Sync and async pairs stay distinct")
    Quit $$$OK
}

/// A pair whose response does not immediately follow its request is not compressible;
/// interleaved arrows pass through unchanged.
Method TestNonAdjacentPairNotCompressed() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.A", "-->>", 1, "req"))
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.B", "-->>", 2, "req"))
    Do tList.Insert(..MakeArrow("Demo.Process", "Demo.Service", "Demo.Msg.A", "-->>", 1, "resp"))
    Do tList.Insert(..MakeArrow("Demo.Process", "Demo.Service", "Demo.Msg.B", "-->>", 2, "resp"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed")
    Do $$$AssertEquals(tOut.Count(), 4, "Interleaved pairs pass through uncompressed")
    Do $$$AssertEquals(tOut.GetAt(1).Kind, "arrow", "No pairloop synthesized")
    Quit $$$OK
}

/// Unpaired arrows (PairId 0) between pairs break contiguity and pass through.
Method TestUnpairedArrowBreaksRun() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do ..AddPair(tList, 1)
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.Odd", "->>", 0, "", 0, "Unpaired request: message 9"))
    Do ..AddPair(tList, 2)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed")
    Do $$$AssertEquals(tOut.Count(), 5, "Runs split by the unpaired arrow stay uncompressed")
    Do $$$AssertEquals(tOut.GetAt(3).Label, "Demo.Msg.Odd", "Unpaired arrow retained in position")
    Quit $$$OK
}

/// An empty stream compresses to an empty stream.
Method TestEmptyStream() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tList, .tOut)
    Do $$$AssertStatusOK(tSC, "Compress should succeed on empty input")
    Do $$$AssertEquals(tOut.Count(), 0, "Empty in, empty out")
    Quit $$$OK
}

}
