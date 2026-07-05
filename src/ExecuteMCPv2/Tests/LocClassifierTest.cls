/// <p>Unit tests for <class>ExecuteMCPv2.Loc.Classifier</class> (Story 22.0,
/// AC 22.0.4/22.0.5/22.0.11). Pure synthetic line-array fixtures — no REST, no live
/// documents. Every fixture also asserts the bucket-sum === total invariant
/// (fixture-matrix row 15) via <method>AssertBuckets</method>.</p>
Class ExecuteMCPv2.Tests.LocClassifierTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Append one line to a fixture line array (pLines(0) = count).
Method AddLine(ByRef pLines, pText As %String)
{
    Set pLines(0) = +$Get(pLines(0)) + 1
    Set pLines(pLines(0)) = pText
}

/// Run the classifier and assert all five buckets plus the bucket-sum invariant.
Method AssertBuckets(ByRef pLines, pIsTest As %Boolean, ByRef pPyMethods, pBlank As %Integer, pSrcCode As %Integer, pSrcComment As %Integer, pTestCode As %Integer, pTestComment As %Integer, pMsg As %String)
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Classifier).ClassifyDoc(.pLines, pIsTest, .pPyMethods, .tCounts)
    Do $$$AssertStatusOK(tSC, pMsg_": ClassifyDoc status OK")
    Do $$$AssertEquals(tCounts("blank"), pBlank, pMsg_": blank bucket")
    Do $$$AssertEquals(tCounts("sourceCode"), pSrcCode, pMsg_": sourceCode bucket")
    Do $$$AssertEquals(tCounts("sourceComment"), pSrcComment, pMsg_": sourceComment bucket")
    Do $$$AssertEquals(tCounts("testCode"), pTestCode, pMsg_": testCode bucket")
    Do $$$AssertEquals(tCounts("testComment"), pTestComment, pMsg_": testComment bucket")
    Do $$$AssertEquals(tCounts("blank") + tCounts("sourceCode") + tCounts("sourceComment") + tCounts("testCode") + tCounts("testComment"), tCounts("total"), pMsg_": bucket-sum === total invariant")
    Do $$$AssertEquals(tCounts("total"), +$Get(pLines(0)), pMsg_": total equals fixture line count")
}

/// Row 1: every leading single-line comment marker, with and without indentation.
Method TestLeadingCommentMarkers()
{
    Do ..AddLine(.tLines, "// c-style")
    Do ..AddLine(.tLines, "  /// doc comment")
    Do ..AddLine(.tLines, "; legacy MUMPS")
    Do ..AddLine(.tLines, "  #; preprocessor comment")
    Do ..AddLine(.tLines, "##; another preprocessor comment")
    Do ..AddLine(.tLines, $Char(9)_"; tab-indented")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 0, 6, 0, 0, "Row 1 leading markers")
}

/// Row 2: preprocessor DIRECTIVES are code, not comments.
Method TestPreprocessorDirectivesAreCode()
{
    Do ..AddLine(.tLines, "#Define MyMacro 1")
    Do ..AddLine(.tLines, " #Dim tVar As %String")
    Do ..AddLine(.tLines, "#Include MyIncludeFile")
    Do ..AddLine(.tLines, "#If 0")
    Do ..AddLine(.tLines, "#EndIf")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 5, 0, 0, 0, "Row 2 preprocessor directives")
}

/// Row 3: comment markers inside string literals (incl. "" escapes) never match,
/// and a /* inside a literal must NOT open a block comment.
Method TestMarkersInsideStringLiterals()
{
    Set tQ = $Char(34)
    Do ..AddLine(.tLines, "Set x = "_tQ_"// not a comment"_tQ)
    Do ..AddLine(.tLines, "Set y = "_tQ_"a"_tQ_tQ_";"_tQ_tQ_" b"_tQ)
    Do ..AddLine(.tLines, "Set z = "_tQ_"/* not a block"_tQ)
    Do ..AddLine(.tLines, "Set w = 2")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 4, 0, 0, 0, "Row 3 markers in literals")
}

/// Row 4: /* ... */ block comment spanning lines — open, interior, close all comment.
Method TestBlockCommentSpansLines()
{
    Do ..AddLine(.tLines, "/*")
    Do ..AddLine(.tLines, " interior text")
    Do ..AddLine(.tLines, "*/")
    Do ..AddLine(.tLines, "Set a = 1")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 1, 3, 0, 0, "Row 4 block comment spans lines")
}

/// Row 5: complete same-line /* ... */ pair between two code fragments is excised.
Method TestSameLineBlockPair()
{
    Do ..AddLine(.tLines, "Set a=1 /* c */ Set b=2")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 1, 0, 0, 0, "Row 5 same-line pair")
}

/// Row 6: code after the terminator of a spanning block is classified as code.
Method TestCodeAfterBlockTerminator()
{
    Do ..AddLine(.tLines, "/* a")
    Do ..AddLine(.tLines, "*/ Set x=1")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 1, 1, 0, 0, "Row 6 code after terminator")
}

/// Row 6b: code BEFORE an inline complete pair on the terminator-free form.
Method TestCodeBeforeInlinePair()
{
    Do ..AddLine(.tLines, "/* a */ Set x=1")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 1, 0, 0, 0, "Row 6b code after inline pair")
}

/// Row 7: terminator remainder that is whitespace or another comment stays comment.
Method TestTerminatorRemainderComment()
{
    Do ..AddLine(.tLines, "/* a")
    Do ..AddLine(.tLines, "*/   ")
    Do ..AddLine(.tLines, "/* b")
    Do ..AddLine(.tLines, "*/ // trailing comment")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 0, 4, 0, 0, "Row 7 remainder whitespace/comment")
}

/// Row 8: a line with code before an inline trailing comment counts as code.
Method TestInlineTrailingComment()
{
    Do ..AddLine(.tLines, "Set x=1 // trailing")
    Do ..AddLine(.tLines, "Set y=2 /* mid */ // tail")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 2, 0, 0, 0, "Row 8 inline trailing comment")
}

/// Row 9: a line that is ONLY an unterminated opener or excised pairs + trailing //.
Method TestCommentOnlyRemainder()
{
    Do ..AddLine(.tLines, "/* opening")
    Do ..AddLine(.tLines, "*/")
    Do ..AddLine(.tLines, "/* a */ // b")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 0, 3, 0, 0, "Row 9 comment-only remainder")
}

/// Row 10: python method body — leading # is a comment ONLY inside the python method;
/// python scope alone does NOT test-bucket (source class).
Method TestPythonMethodBody()
{
    Set tPy("PyMethod") = 1
    Do ..AddLine(.tLines, "Method PyMethod() As %String")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "    # python comment")
    Do ..AddLine(.tLines, "    x = 1")
    Do ..AddLine(.tLines, "    return x")
    Do ..AddLine(.tLines, "}")
    Do ..AddLine(.tLines, "#After python scope this is code again")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 6, 1, 0, 0, "Row 10 python method body")
}

/// Row 10b: python method inside a FILE-LEVEL test class buckets as test.
Method TestPythonInTestClass()
{
    Set tPy("PyMethod") = 1
    Do ..AddLine(.tLines, "Method PyMethod() As %String")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "    # python comment")
    Do ..AddLine(.tLines, "    return 1")
    Do ..AddLine(.tLines, "}")
    Do ..AssertBuckets(.tLines, 1, .tPy, 0, 0, 0, 4, 1, "Row 10b python in test class")
}

/// Row 11 semantics at classifier level: a file-level test class buckets the ENTIRE
/// document as test, including /// doc lines above the Class line.
Method TestFileLevelTestClassBucketsAll()
{
    Do ..AddLine(.tLines, "/// doc comment above the Class line")
    Do ..AddLine(.tLines, "Class Demo.FixtureTest Extends Demo.FixtureBase")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "Set x = 1")
    Do ..AddLine(.tLines, "}")
    Do ..AssertBuckets(.tLines, 1, .tPy, 0, 0, 0, 4, 1, "Row 11 file-level test bucketing")
}

/// Row 12: Test* method inside a NON-test class — test-bucketed inside the braces,
/// source after the closing brace.
Method TestMethodScopeInNonTestClass()
{
    Do ..AddLine(.tLines, "Method TestSomething()")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "    Set x = 1")
    Do ..AddLine(.tLines, "    // comment inside test method")
    Do ..AddLine(.tLines, "}")
    Do ..AddLine(.tLines, "Set outside = 1")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 1, 0, 4, 1, "Row 12 Test* method scope")
}

/// Row 12b: ClassMethod variant + parameterized signature also enters test scope.
Method TestClassMethodTestDetection()
{
    Do ..AddLine(.tLines, "ClassMethod TestOther(pArg As %String) As %Status")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "    Quit 1")
    Do ..AddLine(.tLines, "}")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 0, 0, 4, 0, "Row 12b ClassMethod Test*")
}

/// Row 12c: name-pattern edges — "MyTest" does NOT match, "Testable" DOES match
/// (reference regex Test[A-Za-z0-9_]* is a prefix pattern).
Method TestMethodNamePatternEdges()
{
    Do ..AddLine(.tLines, "Method MyTest()")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "    Set a = 1")
    Do ..AddLine(.tLines, "}")
    Do ..AddLine(.tLines, "Method Testable()")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "}")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 4, 0, 3, 0, "Row 12c name-pattern edges")
}

/// Row 12d: inside a FILE-level test class the method-name check is skipped
/// (is_test guard) — everything is already test-bucketed.
Method TestFileTestSuppressesMethodCheck()
{
    Do ..AddLine(.tLines, "Method TestFoo()")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "}")
    Do ..AssertBuckets(.tLines, 1, .tPy, 0, 0, 0, 3, 0, "Row 12d file-test suppresses method check")
}

/// Row 13: %UnitTest lifecycle method names enter test-method scope.
Method TestLifecycleMethodScope()
{
    Do ..AddLine(.tLines, "Method OnBeforeAllTests() As %Status")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "    Quit 1")
    Do ..AddLine(.tLines, "}")
    Do ..AddLine(.tLines, "Set src = 1")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 1, 0, 4, 0, "Row 13 lifecycle method scope")
}

/// Row 14: blank lines — empty, spaces, tab, and trailing-CR tolerance.
Method TestBlankAndCrTolerance()
{
    Do ..AddLine(.tLines, "")
    Do ..AddLine(.tLines, "   ")
    Do ..AddLine(.tLines, $Char(9))
    Do ..AddLine(.tLines, "  "_$Char(13))
    Do ..AddLine(.tLines, "Set x = 1"_$Char(13))
    Do ..AssertBuckets(.tLines, 0, .tPy, 4, 1, 0, 0, 0, "Row 14 blank/CR tolerance")
}

/// Brace-depth nesting: a nested closing brace must NOT end the tracked method.
Method TestBraceDepthNesting()
{
    Do ..AddLine(.tLines, "Method TestNest()")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "    If x {")
    Do ..AddLine(.tLines, "        Set y = 1")
    Do ..AddLine(.tLines, "    }")
    Do ..AddLine(.tLines, "    Set z = 2")
    Do ..AddLine(.tLines, "}")
    Do ..AddLine(.tLines, "Set after = 1")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 1, 0, 7, 0, "Brace-depth nesting")
}

/// Braces inside string literals and inline comments must not skew the depth.
Method TestBracesInStringsAndComments()
{
    Set tQ = $Char(34)
    Do ..AddLine(.tLines, "Method TestStr()")
    Do ..AddLine(.tLines, "{")
    Do ..AddLine(.tLines, "    Set s = "_tQ_"}"_tQ)
    Do ..AddLine(.tLines, "    Set c = 1 // }")
    Do ..AddLine(.tLines, "}")
    Do ..AddLine(.tLines, "Set after = 1")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 1, 0, 5, 0, "Braces in strings/comments")
}

/// Empty input: zero lines classify to all-zero buckets with a passing invariant.
Method TestEmptyDocument()
{
    Set tLines(0) = 0
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 0, 0, 0, 0, "Empty document")
}

/// CR 22.0-1: string-mask backtracking parity with the reference regex's
/// leftmost-LONGEST semantics. An EOL doubled quote must re-close the literal
/// (masking any /* inside it) so one line cannot poison the rest of the
/// document; a TRULY unterminated literal still leaves its /* exposed and
/// opens a block. Expected buckets pinned by running cos_loc_counter.sh on
/// the equivalent fixtures (t1: 3 code; t3: 1 code + 1 comment).
Method TestStringMaskBacktrackParity()
{
    Set tQ = $Char(34)
    ; reference: regex backtracks, masks "/*abc", trailing quote inert -> 3 code
    Do ..AddLine(.tLines, "Set x = "_tQ_"/*abc"_tQ_tQ)
    Do ..AddLine(.tLines, "Set y = 2")
    Do ..AddLine(.tLines, "Set z = 3")
    Do ..AssertBuckets(.tLines, 0, .tPy, 0, 3, 0, 0, 0, "EOL doubled-quote backtrack")
    ; reference: no valid close at all -> literal left raw, /* opens a block
    Do ..AddLine(.tLines2, "Set c = "_tQ_"unterminated /* here")
    Do ..AddLine(.tLines2, "Set d = 4")
    Do ..AssertBuckets(.tLines2, 0, .tPy2, 0, 1, 1, 0, 0, "Truly unterminated literal parity")
}

}
