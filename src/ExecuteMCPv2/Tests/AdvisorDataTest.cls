/// Unit tests for <class>ExecuteMCPv2.REST.SqlAdvisor</class> (Story 28.1, AC 28.1.1).
/// <p><b>Section A</b> — direct classmethod tests against the <var>%request</var>
/// -independent seams (<method>BuildAdviceData</method>, <method>RunExplain</method>,
/// <method>ExtractTables</method>, <method>ResolveClassForTable</method>,
/// <method>IndexRowsForClass</method>) — fast, deterministic, no HTTP or live CSP
/// context required (mirrors <class>ExecuteMCPv2.Tests.EnvSyncTest</class>'s Section A
/// pattern). Uses the always-present <code>Ens.Config.Item</code> system table as the
/// "known table" (a real interoperability config table with one genuinely unindexed
/// column, <code>ClassName</code>, and two real compiled indexes, <code>AlertGroup</code>
/// and <code>Name</code>) rather than building a new disposable fixture — the durable
/// <code>ExecuteMCPv2.Tests.AdvisorFixture</code> table is Story 28.2's to build (Story
/// 28.0 Rule #47 correction). The multi-table join case is proven via a REFERENCE
/// -CAPTURED plan-text literal from the Story 28.0 live probe (Rule #36 — never
/// hand-reasoned) rather than standing up a fresh probe schema.</p>
/// <p><b>Section B</b> — envelope-contract tests over the REAL deployed REST dispatch
/// surface (<code>%Net.HttpRequest</code>, mirrors <class>ExecuteMCPv2.Tests.EnvSyncTest
/// </class> Section B): the Rule #7 JSON-envelope contract on both the happy path and
/// every rejection path.</p>
Class ExecuteMCPv2.Tests.AdvisorDataTest Extends %UnitTest.TestCase
{

/// ==================== Section A: direct classmethod tests ====================

/// AC 28.1.1 — a WHERE on a genuinely unindexed column (<code>ClassName</code> on
/// <code>Ens.Config.Item</code> carries no index) produces a non-empty plan containing
/// the "Read master map" marker, and the indexes block lists the table's REAL indexes
/// with the verbatim order-preserving Properties string (live-confirmed:
/// "Production:Exact,Name:Exact" on the composite "Name" index — Story 28.0 finding,
/// re-verified here).
Method TestBuildAdviceDataKnownTableUnindexedWhere()
{
    Set tSC = ##class(ExecuteMCPv2.REST.SqlAdvisor).BuildAdviceData("SELECT ID, ClassName FROM Ens_Config.Item WHERE ClassName = 'ZZZNoSuchClass999'", .tResult)
    Do $$$AssertStatusOK(tSC, "BuildAdviceData succeeds for a known table")
    If $$$ISERR(tSC) Quit

    Set tPlan = tResult.%Get("plan")
    Do $$$AssertTrue(tPlan '= "", "plan is non-empty")
    Do $$$AssertTrue(tPlan [ "Read master map", "plan contains the 'Read master map' marker (got: "_tPlan_")")

    Set tTables = tResult.%Get("tables")
    Do $$$AssertTrue(tTables.%Size() >= 1, "at least one table enumerated")
    Set tFoundTable = 0
    For tI = 0:1:tTables.%Size()-1 {
        Set tEntry = tTables.%Get(tI)
        If (tEntry.%Get("schema") = "Ens_Config") && (tEntry.%Get("table") = "Item") {
            Set tFoundTable = 1
            Do $$$AssertEquals(tEntry.%Get("className"), "Ens.Config.Item", "className resolved for Ens_Config.Item")
        }
    }
    Do $$$AssertTrue(tFoundTable, "Ens_Config.Item is listed in tables")

    Set tIndexes = tResult.%Get("indexes")
    Set tFoundGroup = 0
    For tI = 0:1:tIndexes.%Size()-1 {
        Set tGroup = tIndexes.%Get(tI)
        If tGroup.%Get("className") '= "Ens.Config.Item" Continue
        Set tFoundGroup = 1
        Set tRows = tGroup.%Get("rows")
        Set tFoundNameIdx = 0
        For tJ = 0:1:tRows.%Size()-1 {
            Set tRow = tRows.%Get(tJ)
            If tRow.%Get("indexName") = "Name" {
                Set tFoundNameIdx = 1
                Do $$$AssertEquals(tRow.%Get("properties"), "Production:Exact,Name:Exact", "verbatim order-preserving Properties string for the composite Name index")
            }
        }
        Do $$$AssertTrue(tFoundNameIdx, "the real 'Name' index is listed with its verbatim Properties")
    }
    Do $$$AssertTrue(tFoundGroup, "an indexes group exists for Ens.Config.Item")
}

/// AC 28.1.1 — a garbage/non-preparable query returns a clean error status (no crash,
/// no raw dump) rather than throwing an uncaught exception.
Method TestBuildAdviceDataGarbageQueryCleanError()
{
    Set tSC = ##class(ExecuteMCPv2.REST.SqlAdvisor).BuildAdviceData("@@@ not valid sql at all ???", .tResult)
    Do $$$AssertStatusNotOK(tSC, "Garbage query returns a clean error status")
}

/// AC 28.1.1 — EXPLAIN of an unrecognized statement type (live-verified: IRIS's SQL
/// parser classifies "SELEKT GARBAGE FROM NoSuchTable" as statement type "UNKNOWN",
/// which EXPLAIN explicitly refuses with SQLCODE -481 rather than throwing) also
/// returns a clean error status, not a crash. (Note: EXPLAIN DOES support DELETE —
/// verified live before assuming otherwise, Rule #16.)
Method TestBuildAdviceDataUnrecognizedStatementTypeCleanError()
{
    Set tSC = ##class(ExecuteMCPv2.REST.SqlAdvisor).BuildAdviceData("SELEKT GARBAGE FROM NoSuchTable", .tResult)
    Do $$$AssertStatusNotOK(tSC, "EXPLAIN-unrecognized statement type returns a clean error status")
}

/// An empty/missing query is refused, naming 'query'.
Method TestBuildAdviceDataRequiresQuery()
{
    Set tSC = ##class(ExecuteMCPv2.REST.SqlAdvisor).BuildAdviceData("", .tResult)
    Do $$$AssertStatusNotOK(tSC, "Empty query is refused")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "query", "Refusal names 'query' (got: "_tText_")")
}

/// RunExplain reproduces the SAME plan text the existing 'explain' action's
/// action/query Atelier call would produce (Rule #16 — pinned live against
/// Ens.Config.Item; see class doc comment on SqlAdvisor for the cross-check).
Method TestRunExplainProducesPlanText()
{
    Set tSC = ##class(ExecuteMCPv2.REST.SqlAdvisor).RunExplain("SELECT ID, Name FROM Ens_Config.Item WHERE Name = 'ZZZNoSuchName999'", .tPlan)
    Do $$$AssertStatusOK(tSC, "RunExplain succeeds")
    Do $$$AssertTrue(tPlan [ "Read master map Ens_Config.Item.IDKEY", "Plan contains the expected master-map marker (got: "_tPlan_")")
}

/// ExtractTables on a single-table full-scan plan returns exactly one {schema,table}.
Method TestExtractTablesSingleTable()
{
    Set tPlanText = "Read master map Ens_Config.Item.IDKEY, looping on ID."_$Char(10)_"For each row:"_$Char(10)_"    Output the row."
    Set tSC = ##class(ExecuteMCPv2.REST.SqlAdvisor).ExtractTables(tPlanText, .tTables)
    Do $$$AssertStatusOK(tSC, "ExtractTables succeeds")
    Do $$$AssertEquals(+$Get(tTables), 1, "exactly one table found")
    Do $$$AssertEquals(tTables(1,"schema"), "Ens_Config", "schema is Ens_Config")
    Do $$$AssertEquals(tTables(1,"table"), "Item", "table is Item")
}

/// AC 28.1.1 / Task 1 subtask 2 — ExtractTables handles a multi-table (join) plan,
/// resolving BOTH tables and stripping the parenthetical join alias
/// (e.g. "AdvisorProbeChild(C).IDKEY"). Plan text is REFERENCE-CAPTURED verbatim from
/// the Story 28.0 live probe (28-0-advisor-probe-matrix.md Probe Finding #4) — never
/// hand-reasoned (Rule #36).
Method TestExtractTablesJoinPlanDedupesAndStripsAlias()
{
    Set tPlanText = ""
    Set tPlanText = tPlanText_"Warning:"_$Char(10)
    Set tPlanText = tPlanText_"Table ExecuteMCPv2_Temp.AdvisorProbeChild is not tuned."_$Char(10)_$Char(10)
    Set tPlanText = tPlanText_"Read master map ExecuteMCPv2_Temp.AdvisorProbeChild(C).IDKEY, looping on C.ID."_$Char(10)
    Set tPlanText = tPlanText_"For each row:"_$Char(10)
    Set tPlanText = tPlanText_"    Test the NOT NULL condition on %SQLUPPER(ParentKey)."_$Char(10)
    Set tPlanText = tPlanText_"      Call Module-C once, which populates temp-file A."_$Char(10)
    Set tPlanText = tPlanText_"        Read master map ExecuteMCPv2_Temp.AdvisorProbe(P).IDKEY, looping on P.ID."_$Char(10)
    Set tPlanText = tPlanText_"        For each row:"_$Char(10)
    Set tPlanText = tPlanText_"            Add a row to temp-file A, subscripted by %SQLUPPER(JoinKey) and P.ID, with node data of P.JoinKey."_$Char(10)
    Set tPlanText = tPlanText_"      Read temp-file A, using the given %SQLUPPER(JoinKey), and looping on P.ID."

    Set tSC = ##class(ExecuteMCPv2.REST.SqlAdvisor).ExtractTables(tPlanText, .tTables)
    Do $$$AssertStatusOK(tSC, "ExtractTables succeeds on a join plan")
    Do $$$AssertEquals(+$Get(tTables), 2, "exactly two distinct tables found (alias-stripped, deduped)")
    Do $$$AssertEquals(tTables(1,"schema"), "ExecuteMCPv2_Temp", "first table schema")
    Do $$$AssertEquals(tTables(1,"table"), "AdvisorProbeChild", "first table name (alias stripped)")
    Do $$$AssertEquals(tTables(2,"schema"), "ExecuteMCPv2_Temp", "second table schema")
    Do $$$AssertEquals(tTables(2,"table"), "AdvisorProbe", "second table name (alias stripped)")
}

/// ResolveClassForTable resolves a known schema/table to its dot-form class name, and
/// returns "" for an unresolvable pair (never errors).
Method TestResolveClassForTable()
{
    Set tClassName = ##class(ExecuteMCPv2.REST.SqlAdvisor).ResolveClassForTable("Ens_Config", "Item")
    Do $$$AssertEquals(tClassName, "Ens.Config.Item", "known schema/table resolves to its class")

    Set tUnknown = ##class(ExecuteMCPv2.REST.SqlAdvisor).ResolveClassForTable("ZZZNoSuchSchema999", "ZZZNoSuchTable999")
    Do $$$AssertEquals(tUnknown, "", "unresolvable schema/table returns empty string, not an error")
}

/// IndexRowsForClass enumerates the real compiled indexes of a known class, including
/// the verbatim order-preserving Properties string.
Method TestIndexRowsForClass()
{
    Set tSC = ##class(ExecuteMCPv2.REST.SqlAdvisor).IndexRowsForClass("Ens.Config.Item", .tRows)
    Do $$$AssertStatusOK(tSC, "IndexRowsForClass succeeds")
    Do $$$AssertTrue(+$Get(tRows) >= 2, "at least the IDKEY and Name indexes are present")
    Set tFoundName = 0
    Set tCount = +$Get(tRows)
    For tI = 1:1:tCount {
        If tRows(tI,"indexName") = "Name" {
            Set tFoundName = 1
            Do $$$AssertEquals(tRows(tI,"properties"), "Production:Exact,Name:Exact", "verbatim Properties for the Name index")
        }
    }
    Do $$$AssertTrue(tFoundName, "the Name index is present")
}

/// ==================== Section B: envelope contract over the real REST surface ====================

/// Resolve the local web server port (mirrors EnvSyncTest/LocRestTest); override via
/// <code>^UnitTestConfig("SqlAdvisor",...)</code>.
Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("SqlAdvisor", "Port"))
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

/// POST a JSON body to the deployed <code>/dev/sql/advise-data</code> route.
Method PostAdvise(pJsonBody As %String, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Get(^UnitTestConfig("SqlAdvisor", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("SqlAdvisor", "Password"), "SYS")
        Set tRequest.Timeout = 60
        Set tRequest.ContentType = "application/json"
        Do tRequest.EntityBody.Write(pJsonBody)
        Set tSC = tRequest.Post("/api/executemcp/v2/dev/sql/advise-data")
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

/// AC 28.1.1 — happy path over the real dispatch surface: Dispatch route -> SqlAdvisor
/// handler -> single-render envelope. Verifies the envelope contract and result shape.
Method TestHttpHappyPath()
{
    Set tJson = "{""query"":""SELECT ID, ClassName FROM Ens_Config.Item WHERE ClassName = 'ZZZNoSuchClass999'""}"
    Set tSC = ..PostAdvise(tJson, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "HTTP round-trip and JSON envelope parse succeed")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "HTTP 200")
    Do $$$AssertEquals(..ErrorCount(tEnv), 0, "status.errors is empty")
    Set tResult = tEnv.%Get("result")
    Do $$$AssertTrue(tResult.%Get("plan") '= "", "plan is non-empty over the wire")
    Do $$$AssertTrue(tResult.%Get("tables").%Size() >= 1, "tables enumerated over the wire")
}

/// AC 28.1.1 — a request with NO query is refused with a clean, single-rendered JSON
/// error envelope (Rule #7 — the "non-JSON response" defect class never recurs).
Method TestHttpMissingQueryRejected()
{
    Set tSC = ..PostAdvise("{}", .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Rejection path still renders a parseable JSON envelope (Rule #7)")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "Rejection still renders HTTP 200 + envelope")
    Do $$$AssertTrue(..ErrorCount(tEnv) >= 1, "Envelope carries at least one error")
    Do $$$AssertTrue(..FirstError(tEnv) [ "query", "Error names 'query' (got: "_..FirstError(tEnv)_")")
}

/// AC 28.1.1 — a garbage query is refused over HTTP as a clean, single-rendered JSON
/// error envelope — no crash, no non-JSON response, and the worker keeps serving
/// afterwards (a follow-up request succeeds).
Method TestHttpGarbageQueryRejectedAndRecovers()
{
    Set tJson = "{""query"":""@@@ not valid sql at all ???""}"
    Set tSC = ..PostAdvise(tJson, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Garbage-query rejection renders a parseable JSON envelope (Rule #7)")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "Rejection still renders HTTP 200 + envelope")
    Do $$$AssertTrue(..ErrorCount(tEnv) >= 1, "Envelope carries at least one error")

    ; follow-up request succeeds — the failure left no wedged worker state
    Set tJson2 = "{""query"":""SELECT ID, ClassName FROM Ens_Config.Item WHERE ClassName = 'ZZZNoSuchClass999'""}"
    Set tSC2 = ..PostAdvise(tJson2, .tHttp2, .tEnv2)
    Do $$$AssertStatusOK(tSC2, "Follow-up request succeeds after the garbage-query failure")
    If $$$ISERR(tSC2) Quit
    Do $$$AssertEquals(..ErrorCount(tEnv2), 0, "Follow-up request returns a clean result")
}

/// AC 28.1.1 — the "namespace" body param drives an explicit save/restore
/// (<method>ExecuteMCPv2.Utils:SwitchNamespace</method>), never <code>New $NAMESPACE</code>
/// (basics rule); a bad namespace fails as a clean JSON error envelope (no worker crash, no
/// non-JSON response), and the endpoint keeps serving afterwards with $NAMESPACE correctly
/// restored — mirrors <class>ExecuteMCPv2.Tests.EnvSyncTest</class>'s
/// <method>TestHttpBadNamespaceCleanErrorAndRecovery</method>. This is the ONLY test in this
/// suite that exercises <method>AdviseData</method>'s namespace-switch wiring: every Section
/// A test calls <method>BuildAdviceData</method> directly (which has no namespace param and
/// runs in the current namespace only, per its own doc comment), and every OTHER Section B
/// test omits "namespace" entirely — without this test the explicit save/restore path in AC
/// 28.1.1 goes completely unexercised.
Method TestHttpBadNamespaceCleanErrorAndRecovery()
{
    Set tJson = "{""query"":""SELECT ID FROM Ens_Config.Item"",""namespace"":""ZZZNOSUCHNS""}"
    Set tSC = ..PostAdvise(tJson, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "Bad-namespace rejection renders a parseable JSON envelope (Rule #7)")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, "Bad namespace still renders HTTP 200 + envelope")
    Do $$$AssertTrue(..ErrorCount(tEnv) >= 1, "Envelope carries the namespace failure")

    ; follow-up request (no namespace override) succeeds — the failure left no wedged
    ; worker state and $NAMESPACE was correctly restored to the original namespace
    Set tJson2 = "{""query"":""SELECT ID, ClassName FROM Ens_Config.Item WHERE ClassName = 'ZZZNoSuchClass999'""}"
    Set tSC2 = ..PostAdvise(tJson2, .tHttp2, .tEnv2)
    Do $$$AssertStatusOK(tSC2, "Follow-up request succeeds after the namespace failure")
    If $$$ISERR(tSC2) Quit
    Do $$$AssertEquals(..ErrorCount(tEnv2), 0, "Follow-up request returns a clean result")
}

}
