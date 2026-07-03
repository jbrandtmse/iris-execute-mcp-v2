/// Cross-session dedup tests for <method>ExecuteMCPv2.Diagram.Generate:Run</method>
/// (Story 21.1, AC 21.1.3; §6.3 dedup + §6.4 item 9).
/// <p>Drives the facade over LIVE <class>Ens.MessageHeader</class> fixture rows inserted
/// under reserved synthetic SessionIds (990000401+ — disjoint from DiagramLoaderTest's
/// 990000001+ and DiagramGenerateTest's 990000201+) and deleted in
/// <method>OnAfterOneTest</method>. Fixture names are synthetic <code>Demo.*</code>
/// values (decision G2 clean-room).</p>
/// <p>Covers: identical flows across sessions collapse via <code>dedupOf</code> with the
/// I2 metadata header normalized (times differ, flows match); default ON;
/// <code>dedup:false</code> disables; empty sessions dedup without error (§6.4 item 9);
/// different flows never false-dedup; the duplicate entry keeps its full per-session
/// metadata; an empty session-id list is a no-op.</p>
Class ExecuteMCPv2.Tests.DiagramDedupTest Extends %UnitTest.TestCase
{

/// IDs of Ens.MessageHeader rows created by the current test method (killed in teardown).
Property CreatedIds [ MultiDimensional ];

/// Reserved synthetic SessionId range base — disjoint from the other Diagram test suites.
Parameter SESSIONBASE = 990000400;

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Delete every header row created by the test, then sweep the reserved session range
/// as a belt-and-braces guard against leaked fixtures (sweep result checked — a failed
/// sweep surfaces as an assertion, CR 21.0 review pattern).
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
        Do $$$AssertTrue(0, "Fixture sweep failed: "_$Select($IsObject(tRS): tRS.%Message, 1: "no result object"))
    }
    Quit $$$OK
}

/// Insert one Ens.MessageHeader fixture row; returns the new row ID (tracked for teardown).
Method InsertHeader(pSessionId As %Integer, pType As %Integer, pInv As %Integer, pSrc As %String, pDst As %String, pBody As %String, pTimeCreated As %String) As %String
{
    Set tH = ##class(Ens.MessageHeader).%New()
    Set tH.SessionId = pSessionId
    Set tH.Type = pType
    Set tH.Invocation = pInv
    Set tH.SourceConfigName = pSrc
    Set tH.TargetConfigName = pDst
    If pBody '= "" Set tH.MessageBodyClassName = pBody
    Set tH.TimeCreated = pTimeCreated
    Set tSC = tH.%Save()
    Do $$$AssertStatusOK(tSC, "Fixture header %Save should succeed")
    Set tId = tH.%Id()
    If tId '= "" Set ..CreatedIds(tId) = 1
    Quit tId
}

/// Insert one simple Inproc round trip (Demo.Msg.Req / Demo.Msg.Resp) at the given
/// minute so different sessions carry DIFFERENT timestamps (the I2 header must be
/// normalized for the flows to compare equal).
Method InsertRoundTrip(pSessionId As %Integer, pMinute As %Integer) As %Status
{
    Set tMin = $Select(pMinute < 10: "0"_pMinute, 1: pMinute)
    Do ..InsertHeader(pSessionId, 1, 2, "Demo.Service", "Demo.Process", "Demo.Msg.Req", "2026-07-02 10:"_tMin_":01")
    Do ..InsertHeader(pSessionId, 2, 2, "Demo.Process", "Demo.Service", "Demo.Msg.Resp", "2026-07-02 10:"_tMin_":02")
    Quit $$$OK
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

/// Default-ON dedup: two sessions with identical flows at DIFFERENT times collapse —
/// the later entry reports dedupOf = the first session id and keeps its own metadata
/// (sessionId, mermaid, messageCount, warnings, truncated).
Method TestDedupIdenticalSessions() As %Status
{
    Set tA = ..#SESSIONBASE + 1
    Set tB = ..#SESSIONBASE + 2
    Do ..InsertRoundTrip(tA, 1)
    Do ..InsertRoundTrip(tB, 22)
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tA, tB), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed with dedup defaulted ON")
    Set tD0 = tResult.%Get("diagrams").%Get(0)
    Set tD1 = tResult.%Get("diagrams").%Get(1)
    Do $$$AssertTrue('tD0.%IsDefined("dedupOf"), "First session carries no dedupOf")
    Do $$$AssertEquals(tD1.%Get("dedupOf"), tA, "Duplicate session reports dedupOf = first session id")
    Do $$$AssertEquals(tD1.%Get("sessionId"), tB, "Duplicate entry keeps its own sessionId")
    Do $$$AssertEquals(tD1.%Get("messageCount"), 2, "Duplicate entry keeps its own messageCount")
    Do $$$AssertEquals(tD1.%Get("truncated"), 0, "Duplicate entry keeps its own truncated flag")
    Do $$$AssertEquals(tD1.%Get("warnings").%Size(), 0, "Duplicate entry keeps its own warnings array")
    Do $$$AssertTrue(tD1.%Get("mermaid") [ "sequenceDiagram", "Duplicate entry's mermaid stays populated (recorded decision)")
    Do $$$AssertTrue(tD1.%Get("mermaid") [ ("%% Session "_tB_": "), "Duplicate keeps its OWN metadata header")
    Do $$$AssertEquals(tResult.%Get("count"), 2, "count still reflects all requested sessions")
    Quit $$$OK
}

/// dedup:false disables the comparison entirely — no dedupOf on identical flows.
Method TestDedupDisabled() As %Status
{
    Set tA = ..#SESSIONBASE + 3
    Set tB = ..#SESSIONBASE + 4
    Do ..InsertRoundTrip(tA, 1)
    Do ..InsertRoundTrip(tB, 22)
    Set tOptions = {}
    Do tOptions.%Set("dedup", 0, "boolean")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tA, tB), tOptions, .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed with dedup disabled")
    Do $$$AssertTrue('tResult.%Get("diagrams").%Get(0).%IsDefined("dedupOf"), "No dedupOf on the first entry")
    Do $$$AssertTrue('tResult.%Get("diagrams").%Get(1).%IsDefined("dedupOf"), "No dedupOf on the duplicate when disabled")
    Quit $$$OK
}

/// CR 21.1-A review fix: a junk-string or JSON-null <code>dedup</code> option KEEPS the
/// documented default (ON) — it must not silently disable dedup via numeric coercion
/// (the REST layer rejects junk, but the G1 facade is publicly callable).
Method TestDedupJunkOptionKeepsDefaultOn() As %Status
{
    Set tA = ..#SESSIONBASE + 8
    Set tB = ..#SESSIONBASE + 9
    Do ..InsertRoundTrip(tA, 1)
    Do ..InsertRoundTrip(tB, 22)
    ; junk string -> default stays ON
    Set tOptions = {}
    Do tOptions.%Set("dedup", "yes")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tA, tB), tOptions, .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed with a junk dedup option")
    Do $$$AssertEquals(tResult.%Get("diagrams").%Get(1).%Get("dedupOf"), tA, "Junk dedup string keeps the default (ON)")
    ; JSON null -> default stays ON
    Set tOptions2 = {}
    Do tOptions2.%Set("dedup", "", "null")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tA, tB), tOptions2, .tResult2)
    Do $$$AssertStatusOK(tSC, "Run should succeed with a null dedup option")
    Do $$$AssertEquals(tResult2.%Get("diagrams").%Get(1).%Get("dedupOf"), tA, "JSON-null dedup keeps the default (ON)")
    ; string "false" still honored (pre-existing contract unchanged)
    Set tOptions3 = {}
    Do tOptions3.%Set("dedup", "false")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tA, tB), tOptions3, .tResult3)
    Do $$$AssertStatusOK(tSC, "Run should succeed with a string-false dedup option")
    Do $$$AssertTrue('tResult3.%Get("diagrams").%Get(1).%IsDefined("dedupOf"), "String 'false' still disables dedup")
    Quit $$$OK
}

/// §6.4 item 9: dedup of empty/blank diagrams must not error — two unknown (empty)
/// sessions normalize identical and DO dedup.
Method TestDedupEmptySessionsNoError() As %Status
{
    Set tA = ..#SESSIONBASE + 97
    Set tB = ..#SESSIONBASE + 98
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tA, tB), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed for two empty sessions")
    Set tD0 = tResult.%Get("diagrams").%Get(0)
    Set tD1 = tResult.%Get("diagrams").%Get(1)
    Do $$$AssertTrue(tD0.%Get("mermaid") [ "%% No data available", "First empty session renders the no-data diagram")
    Do $$$AssertEquals(tD1.%Get("dedupOf"), tA, "Empty sessions dedup (normalized headers match)")
    Do $$$AssertEquals(tD1.%Get("messageCount"), 0, "Duplicate empty entry keeps zero messageCount")
    Quit $$$OK
}

/// Different flows never false-dedup: the normalized texts differ beyond the header.
Method TestDedupDifferentFlowsUntouched() As %Status
{
    Set tA = ..#SESSIONBASE + 5
    Set tB = ..#SESSIONBASE + 6
    Do ..InsertRoundTrip(tA, 1)
    Do ..InsertHeader(tB, 1, 2, "Demo.Service", "Demo.Other", "Demo.Msg.Different", "2026-07-02 10:30:01")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tA, tB), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed")
    Do $$$AssertTrue('tResult.%Get("diagrams").%Get(0).%IsDefined("dedupOf"), "First flow untouched")
    Do $$$AssertTrue('tResult.%Get("diagrams").%Get(1).%IsDefined("dedupOf"), "Different flow not deduped")
    Quit $$$OK
}

/// The same session requested twice is a trivially identical text (header included) —
/// the second entry reports dedupOf; anomaly warnings survive on BOTH entries (dedup
/// only ADDS the mapping, it never drops warnings — §6.4 item 8 at the facade level).
Method TestDedupSameSessionTwiceKeepsWarnings() As %Status
{
    Set tA = ..#SESSIONBASE + 7
    Do ..InsertHeader(tA, 1, 2, "Demo.Service", "Demo.Gone", "Demo.Msg.Lost", "2026-07-02 10:40:01")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tA, tA), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed with a repeated session id")
    Set tD0 = tResult.%Get("diagrams").%Get(0)
    Set tD1 = tResult.%Get("diagrams").%Get(1)
    Do $$$AssertEquals(tD1.%Get("dedupOf"), tA, "Repeated session id dedups to the first occurrence")
    Do $$$AssertTrue(tD0.%Get("warnings").%Get(0) [ "Unpaired request", "First entry keeps its warning")
    Do $$$AssertTrue(tD1.%Get("warnings").%Get(0) [ "Unpaired request", "Duplicate entry keeps its warnings too")
    Quit $$$OK
}

/// An empty session-id list is a no-op for dedup (nothing to compare, no error).
Method TestDedupEmptyIdList() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed on an empty id list")
    Do $$$AssertEquals(tResult.%Get("count"), 0, "No diagrams generated")
    Quit $$$OK
}

/// Post-epic smoke fix (2026-07-03): two DIFFERENT sessions carrying the same flow with
/// anomaly warnings (each warning names its own message row id) must still dedup — the
/// row-id tokens are masked for the comparison. This is the exact real-data shape that
/// kept dedup inert (every async service-initiated session carries an unpaired-request
/// warning naming its first message). The rendered diagrams keep their real ids.
Method TestDedupFiresAcrossSessionsWithIdBearingWarnings() As %Status
{
    Set tA = ..#SESSIONBASE + 11
    Set tB = ..#SESSIONBASE + 12
    ; one unpaired async request each -> "%% Unpaired request: message <id> ..." comment
    Do ..InsertHeader(tA, 1, 1, "Demo.Service", "Demo.Sink", "Demo.Msg.OneWay", "2026-07-02 11:01:01")
    Do ..InsertHeader(tB, 1, 1, "Demo.Service", "Demo.Sink", "Demo.Msg.OneWay", "2026-07-02 11:22:01")
    Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(..MakeIdList(tA, tB), , .tResult)
    Do $$$AssertStatusOK(tSC, "Run should succeed")
    Set tD0 = tResult.%Get("diagrams").%Get(0)
    Set tD1 = tResult.%Get("diagrams").%Get(1)
    Do $$$AssertEquals(tD1.%Get("dedupOf"), tA, "Same flow dedups even though warnings embed different message ids")
    Do $$$AssertTrue(tD0.%Get("warnings").%Get(0) [ "Unpaired request", "First entry keeps its warning")
    Do $$$AssertTrue(tD1.%Get("warnings").%Get(0) [ "Unpaired request", "Duplicate entry keeps its warning")
    ; rendered diagrams keep their REAL row ids (masking is comparison-only)
    Do $$$AssertTrue(tD0.%Get("mermaid") '[ "message #", "Rendered diagram keeps real ids (no mask leakage)")
    Quit $$$OK
}

/// Direct unit coverage of the comparison normalizer: row-id tokens are masked ONLY in
/// comment lines; payload differences and arrow-line text never mask, so genuinely
/// different diagrams can never false-dedup.
Method TestNormalizeForDedupMasksOnlyCommentIds() As %Status
{
    Set tNL = $Char(10)
    ; identical flows differing only by message ids inside %% comments -> equal
    Set tX = "sequenceDiagram"_tNL_"%% Session 2: 7 messages, t1 .. t2"_tNL_"A-->>B: Req"_tNL_"%% Unpaired request: message 2 (A -> B) has no matching response"
    Set tY = "sequenceDiagram"_tNL_"%% Session 3: 7 messages, t3 .. t4"_tNL_"A-->>B: Req"_tNL_"%% Unpaired request: message 3 (A -> B) has no matching response"
    Set tNX = ##class(ExecuteMCPv2.Diagram.Generate).NormalizeForDedup(tX)
    Set tNY = ##class(ExecuteMCPv2.Diagram.Generate).NormalizeForDedup(tY)
    Do $$$AssertEquals(tNX, tNY, "Texts differing only by comment message ids normalize equal")
    ; indented comment (inside a loop body) is masked too
    Set tI1 = "sequenceDiagram"_tNL_"%% Session 5: 1 messages, t .. t"_tNL_"  %% Error on message 28: boom"
    Set tI2 = "sequenceDiagram"_tNL_"%% Session 6: 1 messages, t .. t"_tNL_"  %% Error on message 41: boom"
    Do $$$AssertEquals(##class(ExecuteMCPv2.Diagram.Generate).NormalizeForDedup(tI1), ##class(ExecuteMCPv2.Diagram.Generate).NormalizeForDedup(tI2), "Indented comment ids are masked")
    ; payload differences inside comments are NOT masked -> stay different
    Set tP1 = "sequenceDiagram"_tNL_"%% Session 5: 1 messages, t .. t"_tNL_"%% Error on message 28: failure for OrderId=ORD-1"
    Set tP2 = "sequenceDiagram"_tNL_"%% Session 6: 1 messages, t .. t"_tNL_"%% Error on message 28: failure for OrderId=ORD-2"
    Do $$$AssertNotEquals(##class(ExecuteMCPv2.Diagram.Generate).NormalizeForDedup(tP1), ##class(ExecuteMCPv2.Diagram.Generate).NormalizeForDedup(tP2), "Payload differences (order ids) never mask")
    ; "message <n>" in an ARROW line is not a comment -> untouched
    Set tA1 = "sequenceDiagram"_tNL_"%% Session 7: 1 messages, t .. t"_tNL_"A-->>B: process message 5 now"
    Set tA2 = "sequenceDiagram"_tNL_"%% Session 8: 1 messages, t .. t"_tNL_"A-->>B: process message 6 now"
    Do $$$AssertNotEquals(##class(ExecuteMCPv2.Diagram.Generate).NormalizeForDedup(tA1), ##class(ExecuteMCPv2.Diagram.Generate).NormalizeForDedup(tA2), "Arrow-line text is never masked")
    ; "message " with no digits after it is left alone (no spurious #)
    Set tE = "sequenceDiagram"_tNL_"%% Session 9: 1 messages, t .. t"_tNL_"%% message ends the line: message "
    Do $$$AssertTrue(##class(ExecuteMCPv2.Diagram.Generate).NormalizeForDedup(tE) '[ "message #", "No digits after the token -> no mask inserted")
    Quit $$$OK
}

}
