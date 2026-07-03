/// End-to-end facade tests for <class>ExecuteMCPv2.Diagram.Generate</class> (Story 21.0,
/// AC 21.0.1/21.0.4/21.0.5/21.0.12 — QA-stage additions; complements the per-stage
/// Loader/Correlator/Compressor/Writer suites without duplicating them).
/// <p>Drives the FULL Load → Correlate → Compress → Write pipeline through
/// <method>ExecuteMCPv2.Diagram.Generate:Run</method> over LIVE
/// <class>Ens.MessageHeader</class> fixture rows inserted under reserved synthetic
/// SessionIds (990000201+ — a range disjoint from DiagramLoaderTest's 990000001+) and
/// deleted in <method>OnAfterOneTest</method>. Fixture names are synthetic
/// <code>Demo.*</code> values (decision G2 clean-room).</p>
/// <p>Covers: the multi-session result envelope (one empty + one populated session),
/// end-to-end diagram content, label modes and option fallbacks through the facade,
/// the §6.4 item 10 truncated flag through the envelope, pair-loop compression and the
/// I1 <code>[ERROR]</code> path end-to-end, structured-warning aggregation, the
/// per-session failure shape (<method>ApplyFailure</method>), and a STRUCTURAL
/// validation that every emitted line conforms to the decision-G3 Mermaid subset
/// grammar (<method>ValidateMermaid</method>).</p>
Class ExecuteMCPv2.Tests.DiagramGenerateTest Extends %UnitTest.TestCase
{

/// IDs of Ens.MessageHeader rows created by the current test method (killed in teardown).
Property CreatedIds [ MultiDimensional ];

/// Reserved synthetic SessionId range base — disjoint from DiagramLoaderTest (990000000).
Parameter SESSIONBASE = 990000200;

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

/// Insert one simple Inproc request/response round trip for the session at the given
/// second offsets (body classes Demo.Msg.Req / Demo.Msg.Resp).
Method InsertRoundTrip(pSessionId As %Integer, pSecReq As %Integer, pSecResp As %Integer) As %Status
{
    Do ..InsertHeader(pSessionId, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.Req", ..FixtureTime(pSecReq))
    Do ..InsertHeader(pSessionId, 2, 2, "Demo.Process", "Demo.Service", "Demo.Msg.Resp", ..FixtureTime(pSecResp))
    Quit $$$OK
}

/// Deterministic fixture timestamp: second offsets 1..59 on a fixed date/hour.
Method FixtureTime(pSec As %Integer) As %String
{
    Quit "2026-07-02 10:00:"_$Select(pSec < 10: "0"_pSec, 1: pSec)
}

/// Build a %ListOfDataTypes of session ids from the varargs.
Method MakeIdList(pIds...) As %Library.ListOfDataTypes
{
    Set tList = ##class(%Library.ListOfDataTypes).%New()
    For tI = 1:1:$Get(pIds, 0) {
        Do tList.Insert($Get(pIds(tI)))
    }
    Quit tList
}

/// Return the 1-based line (LF-delimited) of the mermaid string.
Method MermaidLine(pMermaid As %String, pLineNo As %Integer) As %String
{
    Quit $Piece(pMermaid, $Char(10), pLineNo)
}

/// True when the id is 1+ characters drawn from strict-ASCII [A-Za-z0-9_.] (§6.2
/// participant ids). Checked per character via $Ascii — the ObjectScript pattern code
/// "A" matches any Unicode alphabetic, which would be laxer than the documented set
/// (CR 21.0 review).
Method IsValidId(pId As %String) As %Boolean
{
    If pId = "" Quit 0
    Set tOk = 1
    For tJ = 1:1:$Length(pId) {
        Set tCode = $Ascii(pId, tJ)
        If '(((tCode >= 65) && (tCode <= 90)) || ((tCode >= 97) && (tCode <= 122)) || ((tCode >= 48) && (tCode <= 57)) || (tCode = 95) || (tCode = 46)) {
            Set tOk = 0
            Quit
        }
    }
    Quit tOk
}

/// Structural validation of a whole diagram against the decision-G3 Mermaid subset:
/// <code>sequenceDiagram</code> header, I2 session comment on line 2,
/// <code>%%</code> comments, <code>participant &lt;id&gt; [as &lt;label&gt;]</code>,
/// <code>&lt;id&gt;-&gt;&gt;&lt;id&gt;: &lt;label&gt;</code> /
/// <code>&lt;id&gt;--&gt;&gt;&lt;id&gt;: &lt;label&gt;</code> arrows, and balanced
/// <code>loop N times … end</code> blocks (2-space body indent, no nesting in 21.0).
/// Returns "" when every line conforms, else "line &lt;n&gt;: &lt;reason&gt;".
Method ValidateMermaid(pMermaid As %String) As %String
{
    If pMermaid = "" Quit "diagram is empty"
    Set tNL = $Char(10)
    If $Piece(pMermaid, tNL, 1) '= "sequenceDiagram" Quit "line 1: must be exactly 'sequenceDiagram'"
    If $Extract($Piece(pMermaid, tNL, 2), 1, 11) '= "%% Session " Quit "line 2: must be the I2 session header comment"
    Set tDepth = 0
    Set tErr = ""
    Set tCount = $Length(pMermaid, tNL)
    For tI = 2:1:tCount {
        Set tErr = ..ValidateLine($Piece(pMermaid, tNL, tI), tI, .tDepth)
        Quit:tErr'=""
    }
    If (tErr = "") && (tDepth '= 0) Set tErr = "unclosed loop block at end of diagram"
    Quit tErr
}

/// Validate ONE diagram line against the G3 subset; tracks loop nesting via pDepth.
Method ValidateLine(pRaw As %String, pLineNo As %Integer, ByRef pDepth As %Integer) As %String
{
    If pRaw [ $Char(13) Quit "line "_pLineNo_": contains a carriage return"
    Set tIndent = 0
    While $Extract(pRaw, tIndent + 1) = " " {
        Set tIndent = tIndent + 1
    }
    Set tLine = $Extract(pRaw, tIndent + 1, *)
    If tLine = "" Quit "line "_pLineNo_": blank line"
    If tLine = "end" {
        If pDepth '= 1 Quit "line "_pLineNo_": 'end' without an open loop"
        If tIndent '= 0 Quit "line "_pLineNo_": 'end' must not be indented"
        Set pDepth = 0
        Quit ""
    }
    If (pDepth = 0) && (tIndent '= 0) Quit "line "_pLineNo_": unexpected indentation outside a loop"
    If (pDepth = 1) && (tIndent '= 2) Quit "line "_pLineNo_": loop body must be indented exactly 2 spaces"
    If $Extract(tLine, 1, 2) = "%%" Quit ""
    If $Extract(tLine, 1, 5) = "loop " {
        If pDepth '= 0 Quit "line "_pLineNo_": nested loop not allowed in the 21.0 subset"
        If ($Length(tLine, " ") '= 3) || ($Piece(tLine, " ", 3) '= "times") Quit "line "_pLineNo_": malformed loop header"
        Set tN = $Piece(tLine, " ", 2)
        If (tN '= +tN) || (+tN < 2) Quit "line "_pLineNo_": loop count must be an integer >= 2"
        Set pDepth = 1
        Quit ""
    }
    If $Extract(tLine, 1, 12) = "participant " {
        If pDepth '= 0 Quit "line "_pLineNo_": participant declared inside a loop"
        Set tRest = $Extract(tLine, 13, *)
        Set tId = $Piece(tRest, " as ", 1)
        If '..IsValidId(tId) Quit "line "_pLineNo_": participant id '"_tId_"' outside [A-Za-z0-9_.]"
        If (tRest '= tId) && ($Extract(tRest, $Length(tId) + 5, *) = "") Quit "line "_pLineNo_": empty as-label"
        Quit ""
    }
    ; arrow line: <srcId>->><dstId>: <label>  or  <srcId>-->><dstId>: <label>
    Set tPos = $Find(tLine, "->>")
    If tPos = 0 Quit "line "_pLineNo_": unrecognized construct (outside the G3 subset)"
    Set tStart = tPos - 3
    Set tArrowLen = 3
    If (tStart > 1) && ($Extract(tLine, tStart - 1) = "-") {
        Set tStart = tStart - 1
        Set tArrowLen = 4
    }
    Set tSrc = $Extract(tLine, 1, tStart - 1)
    Set tAfter = $Extract(tLine, tStart + tArrowLen, *)
    Set tDst = $Piece(tAfter, ": ", 1)
    If '..IsValidId(tSrc) Quit "line "_pLineNo_": arrow source id '"_tSrc_"' invalid"
    If '..IsValidId(tDst) Quit "line "_pLineNo_": arrow destination id '"_tDst_"' invalid"
    If $Extract(tAfter, $Length(tDst) + 3, *) = "" Quit "line "_pLineNo_": arrow label missing"
    Quit ""
}

/// Multi-session envelope: one populated session, one unknown (empty) session, and one
/// non-positive id in a single Run call — envelope shape, order, per-diagram fields,
/// and the empty-diagram path end-to-end.
Method TestRunMultiSessionEnvelope() As %Status
{
    Set tSession = ..#SESSIONBASE + 1
    Set tEmpty = ..#SESSIONBASE + 98
    Do ..InsertRoundTrip(tSession, 1, 2)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession, tEmpty, 0), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed for a mixed session list")
    Do $$$AssertTrue($IsObject(tResult), "Result object produced")
    Do $$$AssertEquals(tResult.%Get("count"), 3, "count reflects all requested sessions")
    Set tDiagrams = tResult.%Get("diagrams")
    Do $$$AssertEquals(tDiagrams.%Size(), 3, "One diagram entry per requested session")
    ; populated session, in request order
    Set tD1 = tDiagrams.%Get(0)
    Do $$$AssertEquals(tD1.%Get("sessionId"), tSession, "First entry keeps request order (populated session)")
    Do $$$AssertEquals(tD1.%Get("messageCount"), 2, "Populated session loaded both messages")
    Do $$$AssertEquals(tD1.%Get("truncated"), 0, "Populated session not truncated")
    Do $$$AssertTrue(tD1.%Get("mermaid") [ "sequenceDiagram", "Populated mermaid emitted")
    Do $$$AssertEquals(tD1.%Get("warnings").%Size(), 0, "Clean round trip has no warnings")
    ; unknown session -> empty diagram, not an error
    Set tD2 = tDiagrams.%Get(1)
    Do $$$AssertEquals(tD2.%Get("sessionId"), tEmpty, "Second entry is the unknown session")
    Do $$$AssertEquals(tD2.%Get("messageCount"), 0, "Unknown session has zero messages")
    Do $$$AssertTrue(tD2.%Get("mermaid") [ "%% No data available", "Empty session renders the no-data comment")
    Do $$$AssertEquals(..ValidateMermaid(tD2.%Get("mermaid")), "", "Empty-session diagram conforms to the G3 grammar")
    ; non-positive id -> empty diagram path (§6.1: invalid session id is not an error)
    Set tD3 = tDiagrams.%Get(2)
    Do $$$AssertEquals(tD3.%Get("sessionId"), 0, "Third entry echoes the non-positive id")
    Do $$$AssertEquals(tD3.%Get("messageCount"), 0, "Non-positive id yields an empty diagram")
    Do $$$AssertTrue(tD3.%Get("mermaid") [ "%% No data available", "Non-positive id renders the no-data comment")
    Quit $$$OK
}

/// Exact end-to-end diagram content for a simple sync round trip through the facade.
Method TestRunPipelineContent() As %Status
{
    Set tSession = ..#SESSIONBASE + 2
    Do ..InsertRoundTrip(tSession, 1, 2)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed")
    Set tMermaid = tResult.%Get("diagrams").%Get(0).%Get("mermaid")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 1), "sequenceDiagram", "Line 1 header")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 2), "%% Session "_tSession_": 2 messages, "_..FixtureTime(1)_" .. "_..FixtureTime(2), "I2 metadata header end-to-end")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 3), "participant Demo.Service", "First participant in appearance order")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 4), "participant Demo.Process", "Second participant in appearance order")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 5), "Demo.Service->>Demo.Process: Demo.Msg.Req", "Request arrow end-to-end")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 6), "Demo.Process->>Demo.Service: Demo.Msg.Resp", "Response arrow forced sync end-to-end")
    Do $$$AssertEquals($Length(tMermaid, $Char(10)), 6, "No extra lines emitted")
    Do $$$AssertEquals(..ValidateMermaid(tMermaid), "", "Round-trip diagram conforms to the G3 grammar")
    Quit $$$OK
}

/// labelMode=short flows through the facade options into the rendered labels.
Method TestRunLabelModeShort() As %Status
{
    Set tSession = ..#SESSIONBASE + 3
    Do ..InsertRoundTrip(tSession, 1, 2)
    Set tOptions = {}
    Do tOptions.%Set("labelMode", "short")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), tOptions, .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed with labelMode short")
    Set tMermaid = tResult.%Get("diagrams").%Get(0).%Get("mermaid")
    Do $$$AssertTrue(tMermaid [ "Demo.Service->>Demo.Process: Req", "Short mode keeps the last dotted segment")
    Do $$$AssertTrue('(tMermaid [ ": Demo.Msg.Req"), "Full label absent in short mode")
    Quit $$$OK
}

/// §6.4 item 10 end-to-end: the maxRows option caps the load and the truncated flag
/// surfaces in the envelope entry.
Method TestRunTruncationViaFacade() As %Status
{
    Set tSession = ..#SESSIONBASE + 4
    For tI = 1:1:4 {
        Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.R"_tI, ..FixtureTime(tI))
    }
    Set tOptions = {}
    Do tOptions.%Set("maxRows", 2, "number")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), tOptions, .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed with a small maxRows")
    Set tDiag = tResult.%Get("diagrams").%Get(0)
    Do $$$AssertEquals(tDiag.%Get("truncated"), 1, "Truncated flag surfaces in the envelope")
    Do $$$AssertEquals(tDiag.%Get("messageCount"), 2, "messageCount reflects the capped load")
    ; CR 21.0 review: a fractional maxRows is floored to an integer cap (2.5 -> 2),
    ; never concatenated raw into SELECT TOP.
    Set tOptions2 = {}
    Do tOptions2.%Set("maxRows", 2.5, "number")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), tOptions2, .tResult2)
    Do $$$AssertStatusOK(tSC, "Run should succeed with a fractional maxRows")
    Set tDiag2 = tResult2.%Get("diagrams").%Get(0)
    Do $$$AssertEquals(tDiag2.%Get("messageCount"), 2, "Fractional maxRows floored to the integer cap")
    Do $$$AssertEquals(tDiag2.%Get("truncated"), 1, "Floored cap still reports truncation")
    Quit $$$OK
}

/// Pair-loop compression end-to-end: three identical DB round trips collapse to one
/// loop block in the emitted mermaid.
Method TestRunPairLoopViaFacade() As %Status
{
    Set tSession = ..#SESSIONBASE + 5
    Do ..InsertRoundTrip(tSession, 1, 2)
    Do ..InsertRoundTrip(tSession, 3, 4)
    Do ..InsertRoundTrip(tSession, 5, 6)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed")
    Set tDiag = tResult.%Get("diagrams").%Get(0)
    Do $$$AssertEquals(tDiag.%Get("messageCount"), 6, "All six loaded rows counted")
    Set tMermaid = tDiag.%Get("mermaid")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"loop 3 times"_$Char(10)), "Three identical pairs collapse to loop 3 times")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"  Demo.Service->>Demo.Process: Demo.Msg.Req"_$Char(10)), "Request leg indented inside the loop")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"end"), "Loop closed with end")
    Do $$$AssertEquals(..ValidateMermaid(tMermaid), "", "Loop diagram conforms to the G3 grammar")
    Quit $$$OK
}

/// I1 end-to-end: an errored DB row renders the [ERROR] label suffix, a sanitized
/// %% error comment (no caret-globals), and mirrors into structured warnings.
Method TestRunErrorFlagViaFacade() As %Status
{
    Set tSession = ..#SESSIONBASE + 6
    Set tBadStatus = $$$ERROR($$$GeneralError, "boom writing ^Demo.Global(1)")
    Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.Req", ..FixtureTime(1))
    Do ..InsertHeader(tSession, 2, 2, "Demo.Process", "Demo.Service", "Demo.Msg.Resp", ..FixtureTime(2), 1, tBadStatus)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed for an errored trace")
    Set tDiag = tResult.%Get("diagrams").%Get(0)
    Set tMermaid = tDiag.%Get("mermaid")
    Do $$$AssertTrue(tMermaid [ "Demo.Msg.Resp [ERROR]", "Errored arrow carries the [ERROR] suffix end-to-end")
    Do $$$AssertTrue(tMermaid [ "%% Error on message", "Sanitized error comment emitted")
    Do $$$AssertTrue(tMermaid [ "boom", "Human-readable error part survives sanitization")
    Do $$$AssertTrue('(tMermaid [ "^"), "No caret-global reference anywhere in the diagram (Rule #33)")
    Do $$$AssertTrue('(tMermaid [ "ERROR #"), "No ERROR # status prefix in the I1 comment (Rule #8 strip)")
    Set tWarnings = tDiag.%Get("warnings")
    Do $$$AssertEquals(tWarnings.%Size(), 1, "Error mirrored into structured warnings")
    Do $$$AssertTrue(tWarnings.%Get(0) [ "boom", "Structured warning keeps the sanitized text")
    Do $$$AssertTrue('(tWarnings.%Get(0) [ "^"), "Structured warning has no caret-global reference")
    Do $$$AssertEquals(..ValidateMermaid(tMermaid), "", "Errored diagram conforms to the G3 grammar")
    Quit $$$OK
}

/// Structured warnings[] aggregates anomaly texts from the compressed stream
/// (unpaired request path) and the same text renders as a %% comment.
Method TestRunUnpairedWarningAggregated() As %Status
{
    Set tSession = ..#SESSIONBASE + 7
    Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Gone", "Demo.Msg.Lost", ..FixtureTime(1))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed for an unpaired trace")
    Set tDiag = tResult.%Get("diagrams").%Get(0)
    Set tWarnings = tDiag.%Get("warnings")
    Do $$$AssertEquals(tWarnings.%Size(), 1, "Unpaired-request warning aggregated into the envelope")
    Do $$$AssertTrue(tWarnings.%Get(0) [ "Unpaired request", "Warning text names the anomaly")
    Do $$$AssertTrue(tDiag.%Get("mermaid") [ "%% Unpaired request", "Same anomaly rendered as a %% comment")
    Quit $$$OK
}

/// Option handling through the facade: omitted options -> full labels; junk labelMode
/// and non-positive maxRows fall back to the defaults; an over-limit maxRows is clamped
/// and still succeeds.
Method TestRunOptionsHandling() As %Status
{
    Set tSession = ..#SESSIONBASE + 8
    Do ..InsertRoundTrip(tSession, 1, 2)
    ; omitted options object -> defaults (full labels)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed with omitted options")
    Do $$$AssertTrue(tResult.%Get("diagrams").%Get(0).%Get("mermaid") [ ": Demo.Msg.Req", "Default label mode is full")
    ; junk labelMode + non-positive maxRows -> ignored, defaults apply
    Set tOptions = {}
    Do tOptions.%Set("labelMode", "fancy")
    Do tOptions.%Set("maxRows", -7, "number")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), tOptions, .tResult2)
    Do $$$AssertStatusOK(tSC, "Run should succeed with junk options")
    Set tDiag2 = tResult2.%Get("diagrams").%Get(0)
    Do $$$AssertTrue(tDiag2.%Get("mermaid") [ ": Demo.Msg.Req", "Junk labelMode falls back to full")
    Do $$$AssertEquals(tDiag2.%Get("truncated"), 0, "Non-positive maxRows falls back to the default cap")
    ; over-limit maxRows is clamped to 10000 and the call still succeeds
    Set tOptions3 = {}
    Do tOptions3.%Set("maxRows", 99999, "number")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), tOptions3, .tResult3)
    Do $$$AssertStatusOK(tSC, "Run should succeed with an over-limit maxRows")
    Do $$$AssertEquals(tResult3.%Get("diagrams").%Get(0).%Get("messageCount"), 2, "Clamped maxRows still loads the session")
    Quit $$$OK
}

/// The per-session hard-failure shape: ApplyFailure produces a grammar-valid
/// comment-only diagram with a sanitized warning (best-effort contract).
Method TestApplyFailureShape() As %Status
{
    Set tDiag = {}
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).ApplyFailure(tDiag, 42, $$$ERROR($$$GeneralError, "kaboom in ^Demo.Bad(1)"))
    Do $$$AssertStatusOK(tSC, "ApplyFailure should succeed")
    Do $$$AssertEquals(tDiag.%Get("sessionId"), 42, "Failure entry keeps the session id")
    Do $$$AssertEquals(tDiag.%Get("messageCount"), 0, "Failure entry reports zero messages")
    Do $$$AssertEquals(tDiag.%Get("truncated"), 0, "Failure entry not truncated")
    Set tMermaid = tDiag.%Get("mermaid")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 1), "sequenceDiagram", "Failure diagram still opens sequenceDiagram")
    Do $$$AssertEquals(..MermaidLine(tMermaid, 2), "%% Session 42: generation failed", "Failure header comment")
    Do $$$AssertTrue(..MermaidLine(tMermaid, 3) [ "kaboom", "Failure comment carries the sanitized error text")
    Do $$$AssertTrue('(tMermaid [ "^"), "No caret-global reference in the failure diagram (Rule #33)")
    Do $$$AssertTrue('(tMermaid [ "ERROR #"), "No ERROR # status prefix in the failure comment (Rule #8 strip)")
    Do $$$AssertEquals(..ValidateMermaid(tMermaid), "", "Failure diagram conforms to the G3 grammar")
    Set tWarnings = tDiag.%Get("warnings")
    Do $$$AssertEquals(tWarnings.%Size(), 1, "Failure mirrored into structured warnings")
    Do $$$AssertTrue(tWarnings.%Get(0) [ "kaboom", "Structured warning keeps the sanitized text")
    Do $$$AssertTrue('(tWarnings.%Get(0) [ "^"), "Structured warning has no caret-global reference")
    Quit $$$OK
}

/// Composite grammar conformance: a session mixing a pair loop, an async queue pair,
/// an errored pair, sanitized/colliding participant names, and an unpaired request —
/// EVERY emitted line must conform to the G3 subset grammar.
Method TestGrammarRichDiagram() As %Status
{
    Set tSession = ..#SESSIONBASE + 9
    ; three identical Inproc pairs from a space-bearing participant name (sanitize + as-label)
    For tI = 0:1:2 {
        Do ..InsertHeader(tSession, 1, 2, "Demo Svc", "Demo.Process", "Demo.Msg.Ping", ..FixtureTime(1 + (tI * 2)))
        Do ..InsertHeader(tSession, 2, 2, "Demo.Process", "Demo Svc", "Demo.Msg.Pong", ..FixtureTime(2 + (tI * 2)))
    }
    ; async queue pair correlated by CorrespondingMessageId
    Set tQReqId = ..InsertHeader(tSession, 1, 1, "Demo.Process", "Demo.Operation", "Demo.Msg.Q", ..FixtureTime(7))
    Do ..InsertHeader(tSession, 2, 1, "Demo.Operation", "Demo.Process", "Demo.Msg.QResp", ..FixtureTime(8), 0, "", tQReqId)
    ; errored Inproc pair from a comma-bearing name that COLLIDES with "Demo Svc" after sanitization
    Do ..InsertHeader(tSession, 1, 2, "Demo,Svc", "Demo.Operation", "Demo.Msg.Err", ..FixtureTime(9))
    Do ..InsertHeader(tSession, 2, 2, "Demo.Operation", "Demo,Svc", "Demo.Msg.ErrResp", ..FixtureTime(10), 1, $$$ERROR($$$GeneralError, "boom at ^Demo.G(7)"))
    ; unpaired request
    Do ..InsertHeader(tSession, 1, 2, "Demo.Service", "Demo.Gone", "Demo.Msg.Lost", ..FixtureTime(11))
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tSession), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed for the composite trace")
    Set tDiag = tResult.%Get("diagrams").%Get(0)
    Do $$$AssertEquals(tDiag.%Get("messageCount"), 11, "All eleven rows loaded")
    Set tMermaid = tDiag.%Get("mermaid")
    Do $$$AssertEquals(..ValidateMermaid(tMermaid), "", "Every line of the composite diagram conforms to the G3 grammar")
    Do $$$AssertTrue(tMermaid [ ($Char(10)_"loop 3 times"_$Char(10)), "Identical pairs compressed inside the composite")
    Do $$$AssertTrue(tMermaid [ "participant Demo_Svc as Demo Svc", "Sanitized participant declared with as-label")
    Do $$$AssertTrue(tMermaid [ "participant Demo_Svc_2 as Demo,Svc", "Colliding sanitized name suffixed _2")
    Do $$$AssertTrue(tMermaid [ "Demo.Process-->>Demo.Operation: Demo.Msg.Q", "Queue pair renders async arrows")
    Do $$$AssertTrue(tMermaid [ "Demo.Msg.ErrResp [ERROR]", "Errored arrow flagged inside the composite")
    Do $$$AssertTrue('(tMermaid [ "^"), "No caret-global reference in the composite diagram")
    Quit $$$OK
}

}
