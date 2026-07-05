/// <p>End-to-end tests for the deployed <code>GET /api/executemcp/v2/dev/loc</code>
/// REST surface (Story 22.0, AC 22.0.6/22.0.13 automation; QA e2e stage).</p>
/// <p>Unlike <class>ExecuteMCPv2.Tests.LocFacadeTest</class> (which drives the
/// <class>ExecuteMCPv2.Loc.Generate</class> facade in-process), these tests issue
/// REAL HTTP requests through <class>%Net.HttpRequest</class> against the live
/// dispatch surface: Dispatch route → <class>ExecuteMCPv2.REST.Loc</class> handler
/// → facade → envelope render. They verify the wire contract the TypeScript
/// <code>iris_loc_count</code> tool depends on: the Atelier envelope
/// <code>{status, console, result}</code> parses as JSON on EVERY path (success
/// AND rejection — the Rule #7 envelope-integrity regression), rejection errors
/// carry stable parameter names, and the result object carries proper JSON types
/// (numbers/booleans) so <code>structuredContent</code> passes through verbatim.</p>
/// <p>Error-text assertions deliberately match only stable handler-authored
/// substrings (e.g. <code>spec</code>, <code>topN</code>) — never the
/// <code>ERROR #</code> prefix, which varies with the loaded NLS message table
/// per worker process (Rules #13/#34).</p>
/// <p>Connection defaults target the local dev instance (private web server port
/// discovered from <code>Config.Startup</code>, documented dev credentials
/// <code>_SYSTEM</code>). Override via the <code>^UnitTestConfig("LocRest",...)</code>
/// global: subscripts <code>"Port"</code>, <code>"Username"</code>,
/// <code>"Password"</code>.</p>
Class ExecuteMCPv2.Tests.LocRestTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Resolve the local web server port: explicit override global first, then the
/// instance's <code>Config.Startup</code> WebServerPort (%SYS-only class — explicit
/// namespace save/restore per project Rule #3), falling back to 52773.
Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("LocRest","Port"))
    If tPort > 0 Quit tPort
    Set tPort = 52773
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.Startup).Get(.tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISOK(tSC) && (+$Get(tProps("WebServerPort")) > 0) {
            Set tPort = +tProps("WebServerPort")
        }
    } Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Quit tPort
}

/// Issue a real HTTP GET against the deployed <code>/dev/loc</code> route.
/// <p><var>pParams</var> — multidim array of query parameters
/// (<code>pParams("spec")="..."</code>); values are URL-encoded by
/// <class>%Net.HttpRequest</class>. An empty array sends no query string.</p>
/// <p><var>pHttpStatus</var> — HTTP status code of the response.</p>
/// <p><var>pEnvelope</var> — the response body parsed as JSON. A parse failure
/// returns an error status: on this endpoint EVERY path must render the JSON
/// envelope (Rule #7 — the "non-JSON response" defect class).</p>
Method CallLoc(ByRef pParams, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Get(^UnitTestConfig("LocRest","Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("LocRest","Password"), "SYS")
        Set tRequest.Timeout = 60
        Set tName = ""
        For {
            Set tName = $Order(pParams(tName), 1, tValue)
            Quit:tName=""
            Do tRequest.SetParam(tName, tValue)
        }
        Set tSC = tRequest.Get("/api/executemcp/v2/dev/loc")
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set pEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Number of entries in the envelope's <code>status.errors</code> array.
Method ErrorCount(pEnvelope As %DynamicObject) As %Integer
{
    Quit pEnvelope.%Get("status").%Get("errors").%Size()
}

/// Text of the first envelope error ("" when none).
Method FirstError(pEnvelope As %DynamicObject) As %String
{
    If ..ErrorCount(pEnvelope) = 0 Quit ""
    Quit pEnvelope.%Get("status").%Get("errors").%Get(0).%Get("error")
}

/// Shared rejection-path checks: HTTP 200, envelope parsed (caller already
/// verified), at least one envelope error naming <var>pToken</var>, and an
/// EMPTY result object.
Method AssertRejection(pHttpStatus As %Integer, pEnvelope As %DynamicObject, pToken As %String, pLabel As %String)
{
    Do $$$AssertEquals(pHttpStatus, 200, pLabel_": rejection still renders HTTP 200 + envelope")
    Do $$$AssertTrue(..ErrorCount(pEnvelope) >= 1, pLabel_": envelope carries at least one error")
    Do $$$AssertTrue(..FirstError(pEnvelope) [ pToken, pLabel_": error names '"_pToken_"' (got: "_..FirstError(pEnvelope)_")")
    Do $$$AssertEquals(pEnvelope.%Get("result").%IsDefined("filesParsed"), 0, pLabel_": result object is empty on rejection")
}

/// AC 22.0.6/22.0.7 — happy path over the real dispatch surface, using the exact
/// wire shape the TS tool sends (namespace + spec + wire-explicit defaults,
/// Rule #10). Verifies the envelope contract and the result's JSON types.
Method TestHappyPathEnvelopeContract()
{
    Set tParams("namespace") = $NAMESPACE
    Set tParams("spec") = "ExecuteMCPv2.Loc.*.cls"
    Set tParams("includeGenerated") = "false"
    Set tParams("topN") = 20
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "HTTP round-trip and JSON envelope parse succeed")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "HTTP 200")
    Do $$$AssertEquals(..ErrorCount(tEnv), 0, "status.errors is empty")
    Do $$$AssertEquals(tEnv.%Get("status").%Get("summary"), "", "status.summary is empty")
    Do $$$AssertEquals(tEnv.%GetTypeOf("console"), "array", "console is an array")
    Do $$$AssertEquals(tEnv.%Get("console").%Size(), 0, "console is empty")
    Set tResult = tEnv.%Get("result")
    Do $$$AssertEquals(tResult.%Get("filesParsed"), 3, "Three Loc library classes counted")
    Do $$$AssertTrue(tResult.%Get("totalLines") > 0, "Total lines counted")
    Do $$$AssertTrue(tResult.%Get("sourceCodeLoc") > 0, "Source code counted")
    Do $$$AssertEquals(tResult.%Get("testCodeLoc"), 0, "Library classes carry no test code")
    ; bucket-sum === totalLines invariant, asserted ON THE WIRE result
    Set tSum = tResult.%Get("blankLines") + tResult.%Get("sourceCodeLoc") + tResult.%Get("sourceCommentLoc") + tResult.%Get("testCodeLoc") + tResult.%Get("testCommentLoc")
    Do $$$AssertEquals(tSum, tResult.%Get("totalLines"), "Bucket-sum invariant holds on the wire result")
    ; JSON types the TS structuredContent-verbatim contract depends on
    Do $$$AssertEquals(tResult.%GetTypeOf("totalLines"), "number", "totalLines is a JSON number")
    Do $$$AssertEquals(tResult.%GetTypeOf("codePct"), "number", "codePct is a JSON number")
    Do $$$AssertEquals(tResult.%GetTypeOf("truncatedTopN"), "boolean", "truncatedTopN is a JSON boolean")
    Do $$$AssertEquals(tResult.%GetTypeOf("topDocuments"), "array", "topDocuments is a JSON array")
    Do $$$AssertEquals(tResult.%Get("truncatedTopN"), 0, "truncatedTopN false when all docs fit")
    ; top-N entries: all three classes, sorted by totalLines descending
    Set tTop = tResult.%Get("topDocuments")
    Do $$$AssertEquals(tTop.%Size(), 3, "topDocuments lists all three classes")
    Set tFirst = tTop.%Get(0)
    Do $$$AssertEquals(tFirst.%GetTypeOf("isTest"), "boolean", "topDocuments[].isTest is a JSON boolean")
    Do $$$AssertEquals(tFirst.%Get("type"), "cls", "top document type is cls")
    Do $$$AssertTrue(tFirst.%Get("totalLines") >= tTop.%Get(1).%Get("totalLines"), "topDocuments sorted descending (0 vs 1)")
    Do $$$AssertTrue(tTop.%Get(1).%Get("totalLines") >= tTop.%Get(2).%Get("totalLines"), "topDocuments sorted descending (1 vs 2)")
}

/// AC 22.0.6 — a request with NO spec parameter is refused with a clean JSON
/// error envelope over the real dispatch surface (D2: spec is required).
Method TestMissingSpecRejected()
{
    Set tParams("namespace") = $NAMESPACE
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Rejection path still renders a parseable JSON envelope (Rule #7)")
    If $$$ISERR(tSC) Quit
    Do ..AssertRejection(tHttp, tEnv, "spec", "Missing spec")
}

/// AC 22.0.6 — empty and whitespace-only spec values are refused identically
/// (the handler $ZStrips before validating).
Method TestEmptyAndWhitespaceSpecRejected()
{
    Set tParams("spec") = ""
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Empty-spec rejection renders a parseable JSON envelope")
    If $$$ISERR(tSC) Quit
    Do ..AssertRejection(tHttp, tEnv, "spec", "Empty spec")
    Kill tParams
    Set tParams("spec") = "   "
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv2)
    Do $$$AssertStatusOK(tSC, "Whitespace-spec rejection renders a parseable JSON envelope")
    If $$$ISERR(tSC) Quit
    Do ..AssertRejection(tHttp, tEnv2, "spec", "Whitespace spec")
}

/// AC 22.0.6 — a junk includeGenerated value is refused cleanly, naming the
/// parameter and the accepted values.
Method TestJunkIncludeGeneratedRejected()
{
    Set tParams("spec") = "ExecuteMCPv2.Loc.*.cls"
    Set tParams("includeGenerated") = "maybe"
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Junk includeGenerated rejection renders a parseable JSON envelope")
    If $$$ISERR(tSC) Quit
    Do ..AssertRejection(tHttp, tEnv, "includeGenerated", "Junk includeGenerated")
}

/// AC 22.0.6 — non-numeric topN values (junk text, negative, decimal) are all
/// refused cleanly, naming the parameter.
Method TestJunkTopNRejected()
{
    For tBad = "abc", "-5", "3.5" {
        Kill tParams
        Set tParams("spec") = "ExecuteMCPv2.Loc.*.cls"
        Set tParams("topN") = tBad
        Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv)
        Do $$$AssertStatusOK(tSC, "topN='"_tBad_"' rejection renders a parseable JSON envelope")
        If $$$ISERR(tSC) Quit
        Do ..AssertRejection(tHttp, tEnv, "topN", "topN='"_tBad_"'")
    }
}

/// AC 22.0.7 / D5 — topN caps the topDocuments list over the wire, and the
/// out-of-range value 0 is clamped up to 1 rather than erroring.
Method TestTopNCapAndClampOverWire()
{
    Set tParams("spec") = "ExecuteMCPv2.Loc.*.cls"
    Set tParams("topN") = 1
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "topN=1 request succeeds")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(..ErrorCount(tEnv), 0, "No envelope errors for topN=1")
    Set tResult = tEnv.%Get("result")
    Do $$$AssertEquals(tResult.%Get("topDocuments").%Size(), 1, "topDocuments capped at topN=1")
    Do $$$AssertEquals(tResult.%Get("truncatedTopN"), 1, "truncatedTopN true when capped")
    Do $$$AssertEquals(tResult.%Get("filesParsed"), 3, "Aggregate still covers every matched document")
    Kill tParams
    Set tParams("spec") = "ExecuteMCPv2.Loc.*.cls"
    Set tParams("topN") = 0
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv2)
    Do $$$AssertStatusOK(tSC, "topN=0 request succeeds")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(..ErrorCount(tEnv2), 0, "topN=0 is clamped, not rejected")
    Do $$$AssertEquals(tEnv2.%Get("result").%Get("topDocuments").%Size(), 1, "topN=0 clamped up to 1")
}

/// AC 22.0.2/22.0.7 / D7 — the includeGenerated toggle visibly changes what the
/// endpoint counts (compiler-generated .int hidden by default).
Method TestIncludeGeneratedToggleOverWire()
{
    Set tParams("spec") = "ExecuteMCPv2.Loc.*.int"
    Set tParams("includeGenerated") = "false"
    Set tSC = ..CallLoc(.tParams, .tHttp, .tOff)
    Do $$$AssertStatusOK(tSC, "Generated-excluded request succeeds")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(..ErrorCount(tOff), 0, "No envelope errors with generated excluded")
    Do $$$AssertEquals(tOff.%Get("result").%Get("filesParsed"), 0, "No generated .int counted by default")
    Kill tParams
    Set tParams("spec") = "ExecuteMCPv2.Loc.*.int"
    Set tParams("includeGenerated") = "true"
    Set tSC = ..CallLoc(.tParams, .tHttp, .tOn)
    Do $$$AssertStatusOK(tSC, "Generated-included request succeeds")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(..ErrorCount(tOn), 0, "No envelope errors with generated included")
    Set tResult = tOn.%Get("result")
    Do $$$AssertTrue(tResult.%Get("filesParsed") > 0, "Generated .int counted with includeGenerated=true")
    Do $$$AssertTrue(tResult.%Get("totalLines") > 0, "Generated .int lines counted")
    Do $$$AssertEquals(tResult.%Get("topDocuments").%Get(0).%Get("type"), "int", "top document type is int")
}

/// AC 22.0.2 — INC documents are counted over the wire (Ensemble.inc is mapped
/// into every Interoperability-enabled namespace on this instance) and are never
/// test-bucketed (no directory heuristic in a namespace — documented delta).
Method TestIncDocumentOverWire()
{
    Set tParams("spec") = "Ensemble.inc"
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "INC request succeeds")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(..ErrorCount(tEnv), 0, "No envelope errors for the INC spec")
    Set tResult = tEnv.%Get("result")
    Do $$$AssertEquals(tResult.%Get("filesParsed"), 1, "Exactly one INC document counted")
    Do $$$AssertTrue(tResult.%Get("sourceCodeLoc") > 0, "INC source code counted")
    Do $$$AssertEquals(tResult.%Get("testCodeLoc"), 0, "INC never test-bucketed")
    Do $$$AssertEquals(tResult.%Get("testCommentLoc"), 0, "INC never test-comment-bucketed")
    Do $$$AssertEquals(tResult.%Get("topDocuments").%Get(0).%Get("type"), "inc", "top document type is inc")
    Set tSum = tResult.%Get("blankLines") + tResult.%Get("sourceCodeLoc") + tResult.%Get("sourceCommentLoc") + tResult.%Get("testCodeLoc") + tResult.%Get("testCommentLoc")
    Do $$$AssertEquals(tSum, tResult.%Get("totalLines"), "Bucket-sum invariant holds for the INC document")
}

/// AC 22.0.6 — a bad namespace fails as a clean JSON error envelope (no worker
/// crash, no non-JSON response), and the endpoint keeps serving afterwards
/// (namespace restored — Rule #7 catch-path regression, best-effort across
/// worker processes).
Method TestBadNamespaceCleanErrorAndRecovery()
{
    Set tParams("namespace") = "ZZZNOSUCHNS"
    Set tParams("spec") = "*.cls"
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Bad-namespace rejection renders a parseable JSON envelope (Rule #7)")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "Bad namespace still renders HTTP 200 + envelope")
    Do $$$AssertTrue(..ErrorCount(tEnv) >= 1, "Envelope carries the namespace failure")
    Do $$$AssertEquals(tEnv.%Get("result").%IsDefined("filesParsed"), 0, "Result object is empty on namespace failure")
    ; follow-up request succeeds — the failure left no wedged worker state
    Kill tParams
    Set tParams("namespace") = $NAMESPACE
    Set tParams("spec") = "ExecuteMCPv2.Loc.*.cls"
    Set tSC = ..CallLoc(.tParams, .tHttp2, .tEnv2)
    Do $$$AssertStatusOK(tSC, "Follow-up request succeeds after the namespace failure")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(..ErrorCount(tEnv2), 0, "Follow-up request returns a clean result")
    Do $$$AssertEquals(tEnv2.%Get("result").%Get("filesParsed"), 3, "Follow-up count matches the happy path")
}

/// AC 22.0.6 — omitting the namespace parameter defaults to the web
/// application's namespace (the handler's default-current path).
Method TestDefaultNamespaceOmitted()
{
    Set tParams("spec") = "ExecuteMCPv2.Loc.Generate.cls"
    Set tSC = ..CallLoc(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Request without a namespace parameter succeeds")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(..ErrorCount(tEnv), 0, "No envelope errors without a namespace parameter")
    Do $$$AssertEquals(tEnv.%Get("result").%Get("filesParsed"), 1, "Single-document spec counted in the default namespace")
}

}
