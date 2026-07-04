/// <p>Unit tests for <class>ExecuteMCPv2.Loc.Generate</class> (Story 22.0,
/// AC 22.0.1/22.0.2/22.0.11; decisions D2/D4/D5/D7). Drive the facade directly
/// (independent of REST) against the live HSCUSTOM dictionary.</p>
Class ExecuteMCPv2.Tests.LocFacadeTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// D2: the spec is REQUIRED — an empty spec is refused, no implicit whole-namespace scan.
Method TestSpecRequired()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count("", "", "", .tResult)
    Do $$$AssertStatusNotOK(tSC, "Empty spec is refused")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "spec", "Error names the missing 'spec' parameter")
}

/// Scoped count over the Loc library package: aggregate shape, invariant,
/// percentages, and the top-N document entries (D4/D5).
Method TestCountLocPackage()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count("", "ExecuteMCPv2.Loc.*.cls", "", .tResult)
    Do $$$AssertStatusOK(tSC, "Count succeeds for the Loc package spec")
    Do $$$AssertEquals(tResult.%Get("filesParsed"), 3, "Three library classes parsed")
    Do $$$AssertTrue(tResult.%Get("totalLines") > 0, "Total lines counted")
    Do $$$AssertTrue(tResult.%Get("sourceCodeLoc") > 0, "Source code counted")
    Do $$$AssertTrue(tResult.%Get("sourceCommentLoc") > 0, "Source comments counted")
    Do $$$AssertEquals(tResult.%Get("testCodeLoc"), 0, "Library classes carry no test code")
    Do $$$AssertEquals(tResult.%Get("testCommentLoc"), 0, "Library classes carry no test comments")
    Set tSum = tResult.%Get("blankLines") + tResult.%Get("sourceCodeLoc") + tResult.%Get("sourceCommentLoc") + tResult.%Get("testCodeLoc") + tResult.%Get("testCommentLoc")
    Do $$$AssertEquals(tSum, tResult.%Get("totalLines"), "Aggregate bucket-sum === totalLines invariant")
    ; percentages: each in 0..100 and code+comment+whitespace ~ 100 (1-decimal rounding)
    Set tPctSum = tResult.%Get("codePct") + tResult.%Get("commentPct") + tResult.%Get("whitespacePct")
    Do $$$AssertTrue((tPctSum > 99.6) && (tPctSum < 100.4), "Percentages sum to ~100 (got "_tPctSum_")")
    ; top-N entries (D5): all three docs, each with the per-document fields
    Set tTop = tResult.%Get("topDocuments")
    Do $$$AssertEquals(tTop.%Size(), 3, "topDocuments lists all three classes")
    Do $$$AssertEquals(tResult.%Get("truncatedTopN"), 0, "truncatedTopN false when all docs fit")
    Set tFirst = tTop.%Get(0)
    Do $$$AssertTrue(tFirst.%Get("name") '= "", "top document has a name")
    Do $$$AssertEquals(tFirst.%Get("type"), "cls", "top document type is cls")
    Do $$$AssertTrue(tFirst.%Get("totalLines") >= tTop.%Get(1).%Get("totalLines"), "topDocuments sorted by totalLines descending")
    Do $$$AssertTrue(tFirst.%Get("codeLoc") > 0, "top document code counted")
    Do $$$AssertTrue(tFirst.%Get("commentLoc") > 0, "top document comments counted")
    Do $$$AssertEquals(tFirst.%Get("isTest"), 0, "library class not test-flagged")
}

/// D5: topN caps the per-document list and flags truncation.
Method TestTopNCapAndTruncation()
{
    Set tOptions = {}
    Do tOptions.%Set("topN", 1, "number")
    Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count("", "ExecuteMCPv2.Loc.*.cls", tOptions, .tResult)
    Do $$$AssertStatusOK(tSC, "Count succeeds with topN=1")
    Do $$$AssertEquals(tResult.%Get("topDocuments").%Size(), 1, "topDocuments capped at topN")
    Do $$$AssertEquals(tResult.%Get("truncatedTopN"), 1, "truncatedTopN true when docs exceed topN")
    Do $$$AssertEquals(tResult.%Get("filesParsed"), 3, "Aggregate still covers every matched document")
}

/// D7: includeGenerated visibly changes what is counted (generated .int excluded
/// by default, included on request).
Method TestIncludeGeneratedChangesCounts()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count("", "ExecuteMCPv2.Loc.*.int", "", .tOff)
    Do $$$AssertStatusOK(tSC, "Count succeeds with generated excluded")
    Do $$$AssertEquals(tOff.%Get("filesParsed"), 0, "No generated .int counted by default")
    Set tOptions = {}
    Do tOptions.%Set("includeGenerated", 1, "boolean")
    Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count("", "ExecuteMCPv2.Loc.*.int", tOptions, .tOn)
    Do $$$AssertStatusOK(tSC, "Count succeeds with generated included")
    Do $$$AssertTrue(tOn.%Get("filesParsed") > 0, "Generated .int counted with includeGenerated")
    Do $$$AssertTrue(tOn.%Get("totalLines") > 0, "Generated .int lines counted")
}

/// A spec matching nothing returns a zeroed result, not an error.
Method TestZeroMatches()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count("", "ZZZNoSuchPkg.*.cls", "", .tResult)
    Do $$$AssertStatusOK(tSC, "Count succeeds for a no-match spec")
    Do $$$AssertEquals(tResult.%Get("filesParsed"), 0, "Zero files parsed")
    Do $$$AssertEquals(tResult.%Get("totalLines"), 0, "Zero total lines")
    Do $$$AssertEquals(tResult.%Get("codePct"), 0, "Percentages zero when total is zero")
    Do $$$AssertEquals(tResult.%Get("topDocuments").%Size(), 0, "Empty topDocuments")
    Do $$$AssertEquals(tResult.%Get("truncatedTopN"), 0, "Not truncated")
}

/// An explicit namespace equal to the current one works through the switch path.
Method TestExplicitNamespace()
{
    Set tNS = $NAMESPACE
    Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count(tNS, "ExecuteMCPv2.Loc.*.cls", "", .tResult)
    Do $$$AssertStatusOK(tSC, "Count succeeds with an explicit namespace")
    Do $$$AssertEquals(tResult.%Get("filesParsed"), 3, "Same result through the namespace path")
    Do $$$AssertEquals($NAMESPACE, tNS, "Namespace unchanged after the call")
}

/// A bad namespace fails cleanly AND restores the original namespace.
Method TestBadNamespaceRestores()
{
    Set tNS = $NAMESPACE
    Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count("ZZZNOSUCHNS", "*.cls", "", .tResult)
    Do $$$AssertStatusNotOK(tSC, "Bad namespace reported as an error")
    Do $$$AssertEquals($NAMESPACE, tNS, "Original namespace restored after the failure")
}

/// CR 22.0-2: a facade-direct numeric topN below 1 clamps to 1 (the documented
/// 1..100 clamp, matching the REST layer) instead of silently reverting to the
/// default of 20.
Method TestTopNZeroClampsToOne()
{
    Set tOptions = {}
    Do tOptions.%Set("topN", 0, "number")
    Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count("", "ExecuteMCPv2.Loc.*.cls", tOptions, .tResult)
    Do $$$AssertStatusOK(tSC, "Count succeeds with topN=0")
    Do $$$AssertEquals(tResult.%Get("topDocuments").%Size(), 1, "topN=0 clamps to 1, not the default 20")
    Do $$$AssertEquals(tResult.%Get("truncatedTopN"), 1, "Truncation flagged at the clamped cap")
}

}
