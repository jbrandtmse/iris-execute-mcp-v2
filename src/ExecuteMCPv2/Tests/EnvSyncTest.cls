/// Unit tests for <class>ExecuteMCPv2.REST.EnvSync</class> (Story 27.0, AC 27.0.2).
/// <p><b>Section A</b> — direct classmethod tests against the <var>%request</var>-independent
/// seams (<method>CoerceBoolean</method>, <method>CheckWideSpec</method>,
/// <method>HashDoc</method>, <method>EnumerateDocsWithDate</method>,
/// <method>ComputeHashes</method>) — fast, deterministic, no HTTP or live CSP context
/// required (mirrors <class>ExecuteMCPv2.Tests.HealthCheckTest</class>'s per-area-helper
/// pattern). Content-sensitivity ("a source edit changes the hash") is proven via two
/// pre-existing fixture documents with DIFFERENT content
/// (<class>ExecuteMCPv2.Tests.LocFixtureBase</class> /
/// <class>ExecuteMCPv2.Tests.LocFixtureChild</class>, Story 22.0) rather than mutating a
/// class mid-test — the same content-sensitivity claim, without the fragility of a dynamic
/// class edit+recompile inside a test run.</p>
/// <p><b>Section B</b> — envelope-contract tests over the REAL deployed REST dispatch
/// surface (<code>%Net.HttpRequest</code>, mirrors <class>ExecuteMCPv2.Tests.LocRestTest</class>
/// / <class>ExecuteMCPv2.Tests.MessageResendTest</class> Section C): the Rule #7 JSON-envelope
/// contract on both the happy path and every rejection path, plus the GET/POST dual-route
/// dispatch. The full <code>allowWide:true</code> PERMIT path is deliberately NOT exercised
/// here with a genuinely wide spec — an actual whole-namespace scan's cost/duration is a
/// live-smoke concern (Rule #38's own guidance), not a fast automated-suite concern; the
/// REFUSAL path (allowWide omitted) is what Section B proves over HTTP, and the PERMIT
/// decision itself is proven deterministically in Section A via the isolated
/// <method>CheckWideSpec</method> gate (no scan performed).</p>
Class ExecuteMCPv2.Tests.EnvSyncTest Extends %UnitTest.TestCase
{

/// ==================== Section A: direct classmethod tests ====================

/// AC 27.0.2 — CoerceBoolean recognizes "1"/"true" (case-insensitive) as true and
/// defaults everything else (including empty/junk) to false — the safe default for
/// both allowWide and includeGenerated.
Method TestCoerceBoolean()
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.EnvSync).CoerceBoolean("1"), 1, "'1' is true")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.EnvSync).CoerceBoolean("true"), 1, "'true' is true")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.EnvSync).CoerceBoolean("TRUE"), 1, "'TRUE' is true (case-insensitive)")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.EnvSync).CoerceBoolean("True"), 1, "'True' is true (case-insensitive)")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.EnvSync).CoerceBoolean("0"), 0, "'0' is false")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.EnvSync).CoerceBoolean("false"), 0, "'false' is false")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.EnvSync).CoerceBoolean(""), 0, "empty is false (safe default)")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.EnvSync).CoerceBoolean("maybe"), 0, "junk is false (safe default)")
}

/// Rule #38 — a bare "*" spec is refused when allowWide is not set, naming the risk.
Method TestCheckWideSpecRefusesBareStarWithoutAllowWide()
{
    Set tSC = ##class(ExecuteMCPv2.REST.EnvSync).CheckWideSpec("*", 0)
    Do $$$AssertStatusNotOK(tSC, "Bare '*' spec refused without allowWide")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "allowWide", "Refusal names 'allowWide' as the override (got: " _ tText _ ")")
}

/// Rule #38 — a "*" appearing as ONE comma-delimited part (alongside a narrower part)
/// is ALSO refused — the whole-namespace risk exists regardless of accompanying parts.
Method TestCheckWideSpecRefusesStarAmongMultipleParts()
{
    Set tSC = ##class(ExecuteMCPv2.REST.EnvSync).CheckWideSpec("ExecuteMCPv2.Tests.LocFixtureBase.cls,*", 0)
    Do $$$AssertStatusNotOK(tSC, "A '*' part among several is refused without allowWide")
}

/// Rule #38 — allowWide:true permits the SAME bare "*" spec through the gate (proven
/// WITHOUT running the actual scan — see class doc comment).
Method TestCheckWideSpecPermitsWithAllowWide()
{
    Set tSC = ##class(ExecuteMCPv2.REST.EnvSync).CheckWideSpec("*", 1)
    Do $$$AssertStatusOK(tSC, "Bare '*' spec permitted with allowWide:true")
}

/// A narrow/scoped spec (no bare "*" part) is NEVER refused, regardless of allowWide.
Method TestCheckWideSpecAllowsNarrowSpecRegardless()
{
    Set tSC1 = ##class(ExecuteMCPv2.REST.EnvSync).CheckWideSpec("ExecuteMCPv2.Tests.LocFixtureBase.cls", 0)
    Do $$$AssertStatusOK(tSC1, "Exact document name never refused (allowWide=0)")
    Set tSC2 = ##class(ExecuteMCPv2.REST.EnvSync).CheckWideSpec("ExecuteMCPv2.Tests.LocFixture*.cls", 0)
    Do $$$AssertStatusOK(tSC2, "Package-scoped wildcard never refused (allowWide=0)")
}

/// AC 27.0.2 — hashing the SAME document twice produces the IDENTICAL 64-character
/// hex hash (stable/repeatable — Rule #16 pinned SHAHash+ToHex API).
Method TestHashDocStableAcrossRepeatedCalls()
{
    Set tSC1 = ##class(ExecuteMCPv2.REST.EnvSync).HashDoc("ExecuteMCPv2.Tests.LocFixtureBase.cls", .tHash1)
    Do $$$AssertStatusOK(tSC1, "First hash computation succeeds")
    Set tSC2 = ##class(ExecuteMCPv2.REST.EnvSync).HashDoc("ExecuteMCPv2.Tests.LocFixtureBase.cls", .tHash2)
    Do $$$AssertStatusOK(tSC2, "Second hash computation succeeds")
    Do $$$AssertEquals(tHash1, tHash2, "Repeated hash of the same unchanged document is identical")
    Do $$$AssertEquals($Length(tHash1), 64, "Hash is a 64-character hex string (SHA-256)")
    Do $$$AssertEquals($Translate(tHash1, "0123456789ABCDEF"), "", "Hash contains only hex digits")
}

/// AC 27.0.2 — two documents with genuinely different source produce DIFFERENT hashes
/// (content-sensitivity; the same property "a source edit changes the hash" tests, via
/// two known-distinct fixtures rather than a mid-test mutation).
Method TestHashDocDiffersForDifferentDocuments()
{
    Set tSC1 = ##class(ExecuteMCPv2.REST.EnvSync).HashDoc("ExecuteMCPv2.Tests.LocFixtureBase.cls", .tHashBase)
    Do $$$AssertStatusOK(tSC1, "Hash of LocFixtureBase succeeds")
    Set tSC2 = ##class(ExecuteMCPv2.REST.EnvSync).HashDoc("ExecuteMCPv2.Tests.LocFixtureChild.cls", .tHashChild)
    Do $$$AssertStatusOK(tSC2, "Hash of LocFixtureChild succeeds")
    Do $$$AssertNotEquals(tHashBase, tHashChild, "Different document content -> different hash")
}

/// EnumerateDocsWithDate returns BOTH the document name and a non-empty timestamp
/// (the query's own Date column, ROWSPEC "Date:%TimeStamp") in one pass, filtered to
/// CLS/MAC/INT/INC.
Method TestEnumerateDocsWithDateReturnsNameAndTimestamp()
{
    Set tSC = ##class(ExecuteMCPv2.REST.EnvSync).EnumerateDocsWithDate("ExecuteMCPv2.Tests.LocFixtureBase.cls", 0, .tNames, .tDates)
    Do $$$AssertStatusOK(tSC, "Enumeration succeeds")
    Do $$$AssertEquals(+$Get(tNames), 1, "Exactly one document matched the exact-name spec")
    Do $$$AssertEquals(tNames(1), "ExecuteMCPv2.Tests.LocFixtureBase.cls", "Matched document name is exact")
    Do $$$AssertTrue($Get(tDates(1)) '= "", "Timestamp captured alongside the name")
}

/// AC 27.0.2 — a spec matching NO documents returns an empty result (not an error).
Method TestComputeHashesEmptyResultForNonMatchingSpec()
{
    Set tSC = ##class(ExecuteMCPv2.REST.EnvSync).ComputeHashes("ExecuteMCPv2.Tests.ZZZNoSuchDocument999.cls", 0, 0, .tResult)
    Do $$$AssertStatusOK(tSC, "Non-matching spec is not an error")
    Do $$$AssertEquals(tResult.%Get("count"), 0, "count is 0 for a non-matching spec")
    Do $$$AssertEquals(tResult.%Get("documents").%Size(), 0, "documents array is empty for a non-matching spec")
}

/// AC 27.0.2 — an empty/missing spec is refused, naming 'spec'.
Method TestComputeHashesRequiresSpec()
{
    Set tSC = ##class(ExecuteMCPv2.REST.EnvSync).ComputeHashes("", 0, 0, .tResult)
    Do $$$AssertStatusNotOK(tSC, "Empty spec is refused")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "spec", "Refusal names 'spec' (got: " _ tText _ ")")
    Set tSCWs = ##class(ExecuteMCPv2.REST.EnvSync).ComputeHashes("   ", 0, 0, .tResultWs)
    Do $$$AssertStatusNotOK(tSCWs, "Whitespace-only spec is refused")
}

/// AC 27.0.2 — ComputeHashes itself refuses a bare-'*' spec without allowWide (the gate
/// is actually wired in, not just unit-tested in isolation).
Method TestComputeHashesRefusesBareStarSpec()
{
    Set tSC = ##class(ExecuteMCPv2.REST.EnvSync).ComputeHashes("*", 0, 0, .tResult)
    Do $$$AssertStatusNotOK(tSC, "ComputeHashes refuses a bare '*' spec without allowWide")
}

/// AC 27.0.2 — the response shape is exactly {name, hash, timestamp} per document, with
/// the correct JSON types (string/string/string), and count matches the array size.
Method TestComputeHashesShapeNameHashTimestamp()
{
    Set tSC = ##class(ExecuteMCPv2.REST.EnvSync).ComputeHashes("ExecuteMCPv2.Tests.LocFixtureBase.cls", 0, 0, .tResult)
    Do $$$AssertStatusOK(tSC, "ComputeHashes succeeds for an exact document name")
    Do $$$AssertEquals(tResult.%Get("count"), 1, "count is 1")
    Set tDocs = tResult.%Get("documents")
    Do $$$AssertEquals(tDocs.%Size(), 1, "documents array has 1 entry")
    Set tEntry = tDocs.%Get(0)
    Do $$$AssertEquals(tEntry.%Get("name"), "ExecuteMCPv2.Tests.LocFixtureBase.cls", "name field is the document name")
    Do $$$AssertEquals($Length(tEntry.%Get("hash")), 64, "hash field is a 64-character hex string")
    Do $$$AssertTrue(tEntry.%Get("timestamp") '= "", "timestamp field is non-empty")
    Do $$$AssertEquals(tEntry.%GetTypeOf("name"), "string", "name is a JSON string")
    Do $$$AssertEquals(tEntry.%GetTypeOf("hash"), "string", "hash is a JSON string")
    Do $$$AssertEquals(tEntry.%GetTypeOf("timestamp"), "string", "timestamp is a JSON string")
}

/// ==================== Section B: envelope contract over the real REST surface ====================

/// Resolve the local web server port (mirrors LocRestTest/MessageResendTest); override
/// via <code>^UnitTestConfig("EnvSync",...)</code>.
Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("EnvSync", "Port"))
    If tPort > 0 Quit tPort
    Set tPort = 52773
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.Startup).Get(.tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISOK(tSC) && (+$Get(tProps("WebServerPort")) > 0) { Set tPort = +tProps("WebServerPort") }
    } Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Quit tPort
}

/// GET the deployed <code>/dev/doc/hashes</code> route with query params.
Method GetHashes(ByRef pParams, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Get(^UnitTestConfig("EnvSync", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("EnvSync", "Password"), "SYS")
        Set tRequest.Timeout = 60
        Set tName = ""
        For {
            Set tName = $Order(pParams(tName), 1, tValue)
            Quit:tName=""
            Do tRequest.SetParam(tName, tValue)
        }
        Set tSC = tRequest.Get("/api/executemcp/v2/dev/doc/hashes")
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set pEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// POST a JSON body to the deployed <code>/dev/doc/hashes</code> route.
Method PostHashes(pJsonBody As %String, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Get(^UnitTestConfig("EnvSync", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("EnvSync", "Password"), "SYS")
        Set tRequest.Timeout = 60
        Set tRequest.ContentType = "application/json"
        Do tRequest.EntityBody.Write(pJsonBody)
        Set tSC = tRequest.Post("/api/executemcp/v2/dev/doc/hashes")
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set pEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Number of entries in the envelope's status.errors array.
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

/// AC 27.0.2 — happy path over the real dispatch surface: Dispatch route -> EnvSync
/// handler -> envelope render. Verifies the envelope contract and result shape.
Method TestHttpHappyPathGet()
{
    Set tParams("spec") = "ExecuteMCPv2.Tests.LocFixtureBase.cls"
    Set tSC = ..GetHashes(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "HTTP round-trip and JSON envelope parse succeed")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "HTTP 200")
    Do $$$AssertEquals(..ErrorCount(tEnv), 0, "status.errors is empty")
    Set tResult = tEnv.%Get("result")
    Do $$$AssertEquals(tResult.%Get("count"), 1, "count is 1 for the exact-name spec")
    Set tEntry = tResult.%Get("documents").%Get(0)
    Do $$$AssertEquals(tEntry.%Get("name"), "ExecuteMCPv2.Tests.LocFixtureBase.cls", "name matches")
    Do $$$AssertEquals($Length(tEntry.%Get("hash")), 64, "hash is 64 hex characters over the wire")
}

/// AC 27.0.2 — a request with NO spec is refused with a clean JSON error envelope
/// (Rule #7 — the "non-JSON response" defect class never recurs).
Method TestHttpMissingSpecRejected()
{
    Kill tParams
    Set tSC = ..GetHashes(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Rejection path still renders a parseable JSON envelope (Rule #7)")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "Rejection still renders HTTP 200 + envelope")
    Do $$$AssertTrue(..ErrorCount(tEnv) >= 1, "Envelope carries at least one error")
    Do $$$AssertTrue(..FirstError(tEnv) [ "spec", "Error names 'spec' (got: " _ ..FirstError(tEnv) _ ")")
}

/// Rule #38 — a bare '*' spec is refused over HTTP (allowWide omitted), naming the risk.
/// The PERMIT path (allowWide:true) is deliberately not exercised here — see class doc
/// comment (that would require a genuine whole-namespace scan, a live-smoke concern).
Method TestHttpWideSpecRefusedOverHttp()
{
    Set tParams("spec") = "*"
    Set tSC = ..GetHashes(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Wide-spec rejection renders a parseable JSON envelope")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "Rejection still renders HTTP 200 + envelope")
    Do $$$AssertTrue(..ErrorCount(tEnv) >= 1, "Envelope carries at least one error")
    Do $$$AssertTrue(..FirstError(tEnv) [ "allowWide", "Error names 'allowWide' (got: " _ ..FirstError(tEnv) _ ")")
}

/// AC 27.0.2 — the POST JSON-body variant reaches the SAME handler and produces the
/// same shape as the GET variant.
Method TestHttpPostVariantWorks()
{
    Set tJson = "{""spec"":""ExecuteMCPv2.Tests.LocFixtureBase.cls""}"
    Set tSC = ..PostHashes(tJson, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "POST round-trip and JSON envelope parse succeed")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "HTTP 200")
    Do $$$AssertEquals(..ErrorCount(tEnv), 0, "status.errors is empty")
    Set tResult = tEnv.%Get("result")
    Do $$$AssertEquals(tResult.%Get("count"), 1, "count is 1 via POST too")
}

/// AC 27.0.2 — a bad namespace fails as a clean JSON error envelope (no worker crash,
/// no non-JSON response), and the endpoint keeps serving afterwards (namespace restored).
Method TestHttpBadNamespaceCleanErrorAndRecovery()
{
    Set tParams("namespace") = "ZZZNOSUCHNS"
    Set tParams("spec") = "*.cls"
    Set tSC = ..GetHashes(.tParams, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Bad-namespace rejection renders a parseable JSON envelope (Rule #7)")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "Bad namespace still renders HTTP 200 + envelope")
    Do $$$AssertTrue(..ErrorCount(tEnv) >= 1, "Envelope carries the namespace failure")
    ; follow-up request succeeds — the failure left no wedged worker state
    Kill tParams
    Set tParams("spec") = "ExecuteMCPv2.Tests.LocFixtureBase.cls"
    Set tSC2 = ..GetHashes(.tParams, .tHttp2, .tEnv2)
    Do $$$AssertStatusOK(tSC2, "Follow-up request succeeds after the namespace failure")
    If $$$ISERR(tSC2) Quit
    Do $$$AssertEquals(..ErrorCount(tEnv2), 0, "Follow-up request returns a clean result")
    Do $$$AssertEquals(tEnv2.%Get("result").%Get("count"), 1, "Follow-up count matches the happy path")
}

}
