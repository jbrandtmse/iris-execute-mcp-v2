/// Story 36.4 / ledger 36-2-CR-1 — subscript-injection fix for
/// <class>ExecuteMCPv2.REST.Global</class>:<method>BuildGlobalRef</method>.
/// <p>Every case pins the exact reference string AND checks it with oracles that
/// do not share the builder's code path: <code>$QLength</code>/<code>$QSubscript</code>
/// (IRIS's own reference parser, which never evaluates a subscript expression — it
/// raises <code>&lt;FUNCTION&gt;</code> on one, verified live at the Story 36.4 code
/// review) and a native, variable-subscript read of the node the reference must
/// address. Payload cases also assert that the side-effect global each payload names
/// is never defined, in this namespace or in <code>%SYS</code>.</p>
/// <p>The 12 pre-existing <class>ExecuteMCPv2.Tests.GlobalTest</class> methods are
/// untouched (Rule #19). This class was split out at the Story 36.4 code review so
/// both classes stay under the 500-line test-class limit.</p>
/// <p>Rule #59: proven RED on the pre-fix builder at the Story 36.4 code review by
/// deploying the pre-fix <class>ExecuteMCPv2.REST.Global</class> and running this
/// class (see the story's Review Findings), then restored.</p>
Class ExecuteMCPv2.Tests.GlobalSubscriptSafetyTest Extends %UnitTest.TestCase
{

/// Clean the disposable target and side-effect globals before each test.
Method OnBeforeOneTest() As %Status
{
    Kill ^ExecuteMCPv2SubTest, ^ExecuteMCPv2SubTestSide
    Kill ^["%SYS"]ExecuteMCPv2SubTestSide
    Quit $$$OK
}

/// Clean the disposable target and side-effect globals after each test.
Method OnAfterOneTest() As %Status
{
    Kill ^ExecuteMCPv2SubTest, ^ExecuteMCPv2SubTestSide
    Kill ^["%SYS"]ExecuteMCPv2SubTestSide
    Quit $$$OK
}

/// Shared oracle: <var>pRef</var> must be exactly ONE literal subscript whose value
/// is <var>pValue</var>, and a Set through it must land on the native node
/// <code>^ExecuteMCPv2SubTest(pValue)</code> with no side effect anywhere.
Method CheckOneLiteral(pRef As %String, pValue As %String, pLabel As %String) As %Status
{
    Set tLen = -1
    Try { Set tLen = $QLength(pRef) } Catch { }
    Do $$$AssertEquals(tLen, 1, pLabel_": must parse as exactly ONE literal subscript")
    Set tSub = $Char(0)_"unparsed"
    Try { Set tSub = $QSubscript(pRef, 1) } Catch { }
    Do $$$AssertEquals(tSub, pValue, pLabel_": the subscript must decode to the literal value")
    Set tErr = ""
    Try {
        Set @pRef = "probeValue"
    } Catch ex {
        Set tErr = ex.DisplayString()
    }
    Do $$$AssertEquals(tErr, "", pLabel_": Set through the reference must not raise an error")
    Do $$$AssertEquals($Get(^ExecuteMCPv2SubTest(pValue)), "probeValue", pLabel_": the reference must address the native node for the literal value")
    Do $$$AssertTrue($Data(^ExecuteMCPv2SubTestSide) = 0, pLabel_": the side-effect global must stay undefined (nothing executed)")
    Do $$$AssertTrue($Data(^["%SYS"]ExecuteMCPv2SubTestSide) = 0, pLabel_": the %SYS side-effect global must stay undefined (no namespace escape)")
    Kill ^ExecuteMCPv2SubTest(pValue)
    Quit $$$OK
}

/// The original 36-2-CR-1 payload. Pre-fix it closed the literal early and ran
/// <code>$Increment</code> through the handlers' indirection.
Method TestQuoteBreakoutPayloadIsLiteral() As %Status
{
    Set tQ = $Char(34)
    Set tPayload = "x"_tQ_"_$Increment(^ExecuteMCPv2SubTestSide)_"_tQ_"x"
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tPayload)
    Set tPiece = tQ_"x"_tQ_tQ_"_$Increment(^ExecuteMCPv2SubTestSide)_"_tQ_tQ_"x"_tQ
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tPiece_")", "Quote-breakout payload must be escaped as one literal subscript")
    Do ..CheckOneLiteral(tRef, tPayload, "quote breakout")
    Quit $$$OK
}

/// A payload shaped to close the whole reference and resume code after it.
/// Pre-fix this was a <code>&lt;SYNTAX&gt;</code> error (name indirection cannot be
/// escaped this way); now it is one literal subscript.
Method TestQuoteBreakoutClosingRefPayloadIsLiteral() As %Status
{
    Set tQ = $Char(34)
    Set tPayload = "a"_tQ_")_$Increment(^ExecuteMCPv2SubTestSide)_("_tQ_"b"
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tPayload)
    Set tPiece = tQ_"a"_tQ_tQ_")_$Increment(^ExecuteMCPv2SubTestSide)_("_tQ_tQ_"b"_tQ
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tPiece_")", "Closing-ref payload must be escaped as one literal subscript")
    Do ..CheckOneLiteral(tRef, tPayload, "closing ref")
    Quit $$$OK
}

/// Nested name indirection, WRITE-shaped so the side-effect oracle can vary: pre-fix
/// this incremented the side global through <code>@(...)</code>.
Method TestNestedIndirectionPayloadIsLiteral() As %Status
{
    Set tQ = $Char(34)
    Set tPayload = "x"_tQ_"_$Increment(@("_tQ_"^ExecuteMCPv2SubTestSide"_tQ_"))_"_tQ_"x"
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tPayload)
    Set tPiece = tQ_"x"_tQ_tQ_"_$Increment(@("_tQ_tQ_"^ExecuteMCPv2SubTestSide"_tQ_tQ_"))_"_tQ_tQ_"x"_tQ
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tPiece_")", "Nested-indirection payload must be escaped as one literal subscript")
    Do ..CheckOneLiteral(tRef, tPayload, "nested indirection")
    Quit $$$OK
}

/// Extended-reference namespace escape, WRITE-shaped: pre-fix this incremented the
/// side global in <code>%SYS</code>, a namespace the caller never selected.
Method TestNamespaceEscapePayloadIsLiteral() As %Status
{
    Set tQ = $Char(34)
    Set tPayload = "x"_tQ_"_$Increment(^|"_tQ_"%SYS"_tQ_"|ExecuteMCPv2SubTestSide)_"_tQ_"x"
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tPayload)
    Set tPiece = tQ_"x"_tQ_tQ_"_$Increment(^|"_tQ_tQ_"%SYS"_tQ_tQ_"|ExecuteMCPv2SubTestSide)_"_tQ_tQ_"x"_tQ
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tPiece_")", "Namespace-escape payload must be escaped as one literal subscript")
    Do ..CheckOneLiteral(tRef, tPayload, "namespace escape")
    Quit $$$OK
}

/// A quote-WRAPPED piece whose inner text concatenates code: pre-fix the outer quotes
/// were stripped and the inner <code>"_..._"</code> ran as concatenation.
Method TestWrappedConcatenationPayloadIsLiteral() As %Status
{
    Set tQ = $Char(34)
    Set tInner = "a"_tQ_"_$Increment(^ExecuteMCPv2SubTestSide)_"_tQ_"b"
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tQ_tInner_tQ)
    Set tPiece = tQ_"a"_tQ_tQ_"_$Increment(^ExecuteMCPv2SubTestSide)_"_tQ_tQ_"b"_tQ
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tPiece_")", "Wrapped concatenation payload must be escaped as one literal subscript")
    Do ..CheckOneLiteral(tRef, tInner, "wrapped concatenation")
    Quit $$$OK
}

/// A fixed hostile corpus: every piece must build exactly ONE literal subscript with
/// the expected value, addressed natively, with no side effect.
Method TestHostileCorpusAlwaysOneLiteral() As %Status
{
    Set tQ = $Char(34), tSide = "^ExecuteMCPv2SubTestSide"
    Set tIn = $ListBuild("x"_tQ_"_@("_tQ_tSide_tQ_")_"_tQ_"x", "x"_tQ_"_^|"_tQ_"%SYS"_tQ_"|ExecuteMCPv2SubTestSide_"_tQ_"x", tQ_"_$Increment("_tSide_")_"_tQ, "a"_tQ_"b", "a"_tQ_tQ_tQ_"b", "$Increment("_tSide_")", "@ExecuteMCPv2SubTestSide", "(", ")", "^", "|", "_", "$", "@", tQ_" "_tQ, $Char(20013,25991), "a"_$Char(10)_"b", "1E5", "-0", "1.0", ".5", "-1.5")
    Set tExp = $ListBuild("x"_tQ_"_@("_tQ_tSide_tQ_")_"_tQ_"x", "x"_tQ_"_^|"_tQ_"%SYS"_tQ_"|ExecuteMCPv2SubTestSide_"_tQ_"x", "_$Increment("_tSide_")_", "a"_tQ_"b", "a"_tQ_tQ_"b", "$Increment("_tSide_")", "@ExecuteMCPv2SubTestSide", "(", ")", "^", "|", "_", "$", "@", " ", $Char(20013,25991), "a"_$Char(10)_"b", "1E5", "-0", "1.0", .5, -1.5)
    For i = 1:1:$ListLength(tIn) {
        Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", $List(tIn, i))
        Do ..CheckOneLiteral(tRef, $List(tExp, i), "corpus piece "_i)
    }
    Quit $$$OK
}

/// A doubled quote decodes to one literal quote whether or not the piece is wrapped,
/// and both forms keep the pre-fix builder's byte-identical reference (Rule #19).
Method TestDoubledQuotesDecodeLikePreFix() As %Status
{
    Set tQ = $Char(34)
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tQ_"a"_tQ_tQ_"b"_tQ)
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tQ_"a"_tQ_tQ_"b"_tQ_")", "Wrapped a-doubledquote-b must be byte-identical to the pre-fix reference")
    Do ..CheckOneLiteral(tRef, "a"_tQ_"b", "wrapped doubled quote")
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", "a"_tQ_tQ_"b")
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tQ_"a"_tQ_tQ_"b"_tQ_")", "Unwrapped a-doubledquote-b must be byte-identical to the pre-fix reference")
    Do ..CheckOneLiteral(tRef, "a"_tQ_"b", "unwrapped doubled quote")
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tQ_tQ_"abc")
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tQ_tQ_tQ_"abc"_tQ_")", "An even leading quote run must be byte-identical to the pre-fix reference")
    Do ..CheckOneLiteral(tRef, tQ_"abc", "even leading quote run")
    Quit $$$OK
}

/// Control characters are literal data (AC 36.4.2): inside a string literal they are
/// inert under indirection, and the pre-fix builder already addressed these nodes, so
/// the references stay byte-identical (Rule #19). Leading/trailing whitespace
/// (space, tab, NBSP) is still trimmed, as before.
Method TestControlCharactersAreLiteralData() As %Status
{
    Set tQ = $Char(34)
    For tValue = "a"_$Char(10)_"b", "a"_$Char(1)_"b", "k"_$Char(0), "x"_$Char(150)_"y", "a"_$Char(127)_"b" {
        Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tValue)
        Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tQ_tValue_tQ_")", "An unwrapped piece with an interior control character is one literal subscript")
        Do ..CheckOneLiteral(tRef, tValue, "control character (unwrapped, code "_$Ascii($Extract(tValue, 2))_")")
    }
    Set tValue = "a"_$Char(9)_"b"
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tQ_tValue_tQ)
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tQ_tValue_tQ_")", "A wrapped piece with an interior tab is one literal subscript")
    Do ..CheckOneLiteral(tRef, tValue, "interior tab (wrapped)")
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", $Char(9)_"abc"_$Char(9))
    Do $$$AssertEquals(tRef, "^ExecuteMCPv2SubTest("_tQ_"abc"_tQ_")", "Leading/trailing tab is trimmed as whitespace, unchanged from the pre-fix builder")
    Quit $$$OK
}

/// An unwrapped piece that begins or ends with an unmatched quote is rejected with a
/// clear error rather than silently addressing a different node. This is the shape a
/// quoted key containing a comma takes after the comma split. Every one of these
/// inputs was a SYNTAX or SUBSCRIPT error (or code) before the fix.
Method TestUnmatchedEdgeQuoteRejected() As %Status
{
    Set tQ = $Char(34)
    For tInput = tQ_"a,b"_tQ, tQ_"abc", "abc"_tQ, tQ, tQ_tQ_tQ_"abc", "1,"_tQ_"key" {
        Set tCaught = 0, tErrText = ""
        Try {
            Do ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("ExecuteMCPv2SubTest", tInput)
        } Catch ex {
            Set tCaught = 1, tErrText = ex.DisplayString()
        }
        Do $$$AssertTrue(tCaught, "Input "_tInput_" must be rejected")
        Do $$$AssertTrue(tErrText [ "unmatched quote", "The rejection must name the reason (input "_tInput_")")
    }
    Do $$$AssertTrue($Data(^ExecuteMCPv2SubTest) = 0, "A rejected input must not touch the target global")
    Quit $$$OK
}

/// Epic 36 consumer contract (readGlobalNode in packages/iris-dev-mcp's execute.ts):
/// this exact shape must stay byte-identical (Rule #19).
Method TestUnitTestQueueFixtureFormUnchanged() As %Status
{
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("IRIS.TempAtelierAsyncQueue", "31797604,""unittest"",""id""")
    Do $$$AssertEquals(tRef, "^IRIS.TempAtelierAsyncQueue(31797604,""unittest"",""id"")", "The Epic 36 readGlobalNode subscript shape must be byte-identical to before")
    Quit $$$OK
}

/// Negative/decimal numbers stay unquoted. An empty middle piece keeps its pre-fix
/// positional gap: <code>^TestGlobal(1,,2)</code> is pinned for byte-identity only —
/// IRIS rejects it with SYNTAX at evaluation (live-verified), exactly as before.
Method TestNegativeDecimalAndEmptyPiecesUnchanged() As %Status
{
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("TestGlobal", "-1.5")
    Do $$$AssertEquals(tRef, "^TestGlobal(-1.5)", "A negative decimal subscript must stay unquoted and unchanged")
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("TestGlobal", "1,,2")
    Do $$$AssertEquals(tRef, "^TestGlobal(1,,2)", "An empty middle piece keeps its pre-fix positional gap")
    Quit $$$OK
}

/// The global-NAME half of AC 36.4.2: extended references, subscripts, carets and
/// embedded code in the name are rejected by <method>ValidateGlobalName</method>, which
/// all three handlers call BEFORE <method>BuildGlobalRef</method>.
Method TestGlobalNameRejectsReferenceSyntax() As %Status
{
    Set tQ = $Char(34)
    For tName = "|"_tQ_"%SYS"_tQ_"|X", "["_tQ_"%SYS"_tQ_"]X", "X(1)", "X"_tQ_"_$Increment(^S)_"_tQ, "^X", "X,Y", "X Y", "" {
        Set tSC = ##class(ExecuteMCPv2.REST.Global).ValidateGlobalNamePublic(tName)
        Do $$$AssertStatusNotOK(tSC, "Global name "_tName_" must be rejected")
    }
    Quit $$$OK
}

}
