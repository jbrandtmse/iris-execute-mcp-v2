/// Unit tests for <class>ExecuteMCPv2.Diagram.Writer</class> (Story 21.0, AC 21.0.3/21.0.5/21.0.12).
/// <p>Pure in-memory render-event fixtures (synthetic <code>Demo.*</code> names — decision
/// G2 clean-room). Covers Mermaid emission: I2 metadata header, participant registry
/// (first-appearance order, sanitization, collision suffixes, <code>as</code> labels),
/// arrow line shape, I1 <code>[ERROR]</code> suffix + comment, loop blocks, empty-session
/// shape, and single-line discipline.</p>
Class ExecuteMCPv2.Tests.DiagramWriterTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Build one arrow render event.
Method MakeArrow(pSrc As %String, pDst As %String, pLabel As %String, pArrow As %String = "->>", pIsError As %Boolean = 0, pWarning As %String = "") As ExecuteMCPv2.Diagram.RenderEvent
{
    Set tRE = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
    Set tRE.Kind = "arrow"
    Set tRE.Src = pSrc
    Set tRE.Dst = pDst
    Set tRE.Label = pLabel
    Set tRE.Arrow = pArrow
    Set tRE.IsError = pIsError
    If pWarning '= "" Do tRE.Warnings.Insert(pWarning)
    Quit tRE
}

/// Return the 1-based line (LF-delimited) of the mermaid string.
Method MermaidLine(pMermaid As %String, pLineNo As %Integer) As %String
{
    Quit $Piece(pMermaid, $Char(10), pLineNo)
}

/// I2: the diagram opens with sequenceDiagram + session metadata header.
Method TestMetadataHeader() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.Req"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(5, 2, "2026-07-02 10:00:01", "2026-07-02 10:00:02", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 1), "sequenceDiagram", "First line is sequenceDiagram")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 2), "%% Session 5: 2 messages, 2026-07-02 10:00:01 .. 2026-07-02 10:00:02", "I2 metadata header on line 2")
    Quit $$$OK
}

/// Empty session: minimal valid diagram + metadata header + No data available comment.
Method TestEmptySession() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(7, 0, "", "", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed on empty session")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 1), "sequenceDiagram", "Empty diagram still opens sequenceDiagram")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 2), "%% Session 7: 0 messages", "Header shows 0 messages, no time range")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 3), "%% No data available", "No-data comment emitted")
    Do $$$AssertEquals($Length(tMermaid, $Char(10)), 3, "Empty diagram is exactly three lines")
    Quit $$$OK
}

/// Participants are declared in first-appearance order; a sanitized id gets an as-label.
Method TestParticipantOrderAndLabels() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo Service", "Demo.Process", "Demo.Msg.Req"))
    Do tList.Insert(..MakeArrow("Demo.Process", "Demo.Operation", "Demo.Msg.Fwd"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 2, "t1", "t2", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 3), "participant Demo_Service as Demo Service", "Sanitized id gets an as-label")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 4), "participant Demo.Process", "Id equal to label emitted bare")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "participant Demo.Operation", "Third participant in appearance order")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 6), "Demo_Service->>Demo.Process: Demo.Msg.Req", "Arrow uses sanitized ids")
    Quit $$$OK
}

/// Two different names sanitizing to the same id get collision suffixes _2/_3.
Method TestParticipantCollisionSuffix() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo Service", "Demo,Service", "Demo.Msg.Req"))
    Do tList.Insert(..MakeArrow("Demo;Service", "Demo Service", "Demo.Msg.Resp"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 2, "t1", "t2", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 3), "participant Demo_Service as Demo Service", "First name claims the base id")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 4), "participant Demo_Service_2 as Demo,Service", "Second collision gets _2")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "participant Demo_Service_3 as Demo#59;Service", "Third collision gets _3 with the semicolon escaped")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 6), "Demo_Service->>Demo_Service_2: Demo.Msg.Req", "Arrows resolve each name to its own id")
    Quit $$$OK
}

/// An empty participant name becomes id P (bare declaration).
Method TestEmptyParticipantName() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("", "Demo.Process", "Demo.Msg.Req"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 1, "t1", "t1", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 3), "participant P", "Empty name becomes bare id P")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "P->>Demo.Process: Demo.Msg.Req", "Arrow uses the P id")
    Quit $$$OK
}

/// I1: an errored arrow gets the [ERROR] label suffix and its warning renders as a comment.
Method TestErrorSuffixAndComment() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.Req", "->>", 1, "Error on message 9: connection refused"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 1, "t1", "t1", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "Demo.Service->>Demo.Process: Demo.Msg.Req [ERROR]", "Errored arrow label gets [ERROR] suffix")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 6), "%% Error on message 9: connection refused", "Error summary rendered as a comment")
    Quit $$$OK
}

/// A pairloop event renders as loop N times / indented legs / end.
Method TestLoopBlock() As %Status
{
    Set tLoop = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
    Set tLoop.Kind = "pairloop"
    Set tLoop.Count = 3
    Set tLoop.Req = ..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.Req")
    Set tLoop.Resp = ..MakeArrow("Demo.Process", "Demo.Service", "Demo.Msg.Resp")
    Do tLoop.Warnings.Insert("warn kept")
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(tLoop)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 6, "t1", "t6", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "loop 3 times", "Loop header emitted")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 6), "  Demo.Service->>Demo.Process: Demo.Msg.Req", "Request leg indented 2 spaces")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 7), "  Demo.Process->>Demo.Service: Demo.Msg.Resp", "Response leg indented 2 spaces")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 8), "  %% warn kept", "Loop warnings render inside the block")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 9), "end", "Loop closed with end")
    Quit $$$OK
}

/// Single-line discipline: CR/LF/TAB inside labels and warnings are collapsed to spaces.
Method TestSingleLineDiscipline() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg"_$Char(10)_"Broken", "->>", 0, "warn"_$Char(13, 10)_"split"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 1, "t1", "t1", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "Demo.Service->>Demo.Process: Demo.Msg Broken", "Newline in label collapsed to a space")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 6), "%% warn  split", "Newlines in warnings collapsed")
    Do $$$AssertEquals($Length(tMermaid, $Char(10)), 6, "No stray lines introduced")
    Quit $$$OK
}

/// Arrow shape: sync and async literals with the exact srcId->>dstId: label form.
Method TestArrowLineShape() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.Req", "->>"))
    Do tList.Insert(..MakeArrow("Demo.Process", "Demo.Operation", "Demo.Msg.Fwd", "-->>"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 2, "t1", "t2", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 6), "Demo.Service->>Demo.Process: Demo.Msg.Req", "Sync arrow line shape")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 7), "Demo.Process-->>Demo.Operation: Demo.Msg.Fwd", "Async arrow line shape")
    Quit $$$OK
}

/// CR 21.0 review: raw semicolons in labels, as-labels, and warning comments are escaped
/// to #59; (Mermaid sequenceDiagram treats ; as a statement separator).
Method TestSemicolonEscaped() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo;Svc", "Demo.Process", "Demo.Msg;Odd", "->>", 0, "warn; with semicolon"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 1, "t1", "t1", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 3), "participant Demo_Svc as Demo#59;Svc", "Semicolon escaped in the as-label")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "Demo_Svc->>Demo.Process: Demo.Msg#59;Odd", "Semicolon escaped in the arrow label")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 6), "%% warn#59; with semicolon", "Semicolon escaped in the warning comment")
    Do $$$AssertTrue('($Replace(tMermaid, "#59;", "") [ ";"), "No raw statement-separator semicolons survive outside the escape")
    Quit $$$OK
}

/// CR 21.0 review: a config name that is a Mermaid statement keyword (e.g. "end") gets a
/// "_" id suffix so the emitted lines cannot terminate loop blocks or lex as keywords.
Method TestReservedWordParticipant() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("end", "Demo.Process", "Demo.Msg.Req"))
    Do tList.Insert(..MakeArrow("Loop", "end", "Demo.Msg.Fwd"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 2, "t1", "t2", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 3), "participant end_ as end", "Reserved word end suffixed, original name kept as label")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "participant Loop_ as Loop", "Reserved-word check is case-insensitive")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 6), "end_->>Demo.Process: Demo.Msg.Req", "Arrow line cannot start with the bare end keyword")
    Quit $$$OK
}

/// CR 21.0 review: a label that strips to empty (whitespace-only body class) falls back
/// to the (no body) placeholder instead of emitting an empty arrow label.
Method TestEmptyLabelPlaceholder() As %Status
{
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(..MakeArrow("Demo.Service", "Demo.Process", " "))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 1, "t1", "t1", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "Demo.Service->>Demo.Process: (no body)", "Whitespace-only label falls back to the placeholder")
    Quit $$$OK
}

/// Participants inside pairloop legs are registered (first-appearance over compressed stream).
Method TestLoopParticipantsRegistered() As %Status
{
    Set tLoop = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
    Set tLoop.Kind = "pairloop"
    Set tLoop.Count = 2
    Set tLoop.Req = ..MakeArrow("Demo.Service", "Demo.Process", "Demo.Msg.Req")
    Set tLoop.Resp = ..MakeArrow("Demo.Process", "Demo.Service", "Demo.Msg.Resp")
    Set tList = ##class(%Library.ListOfObjects).%New()
    Do tList.Insert(tLoop)
    Do tList.Insert(..MakeArrow("Demo.Process", "Demo.Operation", "Demo.Msg.Fwd"))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(1, 5, "t1", "t5", tList, .tMermaid)
    Do $$$AssertStatusOK(tSC, "Write should succeed")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 3), "participant Demo.Service", "Loop req src registered first")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 4), "participant Demo.Process", "Loop req dst registered second")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "participant Demo.Operation", "Post-loop participant registered third")
    Quit $$$OK
}

}
