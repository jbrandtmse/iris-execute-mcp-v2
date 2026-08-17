/// Regression coverage for Story 35.1 — <method>ExecuteMCPv2.REST.Interop:ItemManage</method>'s
/// <code>set</code> branch resolving <class>Ens.Config.Item</class> by its FULL composite
/// key (<var>Production</var>, <var>Name</var>) instead of the pre-fix one-arg
/// <code>NameExists(tItemName, .tID)</code>, which bound <var>tItemName</var> to the
/// <var>Production</var> slot and could never match (irislib/Ens/Config/Item.cls:150 —
/// <code>Index Name On (Production As Exact, Name As Exact)</code>).
/// <p><b>Section A</b> — a direct classmethod pin of the live-probed API contract
/// (Dev Notes, AC 35.1.2): one-arg <code>NameExists</code> always returns 0 against a
/// composite-key row; two-arg <code>NameExists</code> and <method>FindItemByConfigName</method>
/// (the instance method <code>set</code>/<code>add</code>/<code>remove</code> now share)
/// both resolve it and agree on the same row ID.</p>
/// <p><b>Section B</b> — real end-to-end HTTP coverage (Rule #26/#59, mirrors
/// <class>ExecuteMCPv2.Tests.AdvisorDataTest</class>'s <method>PostAdvise</method> pattern):
/// drives the DEPLOYED <code>/api/executemcp/v2/interop/production/item</code> route with
/// <class>%Net.HttpRequest</class>. Proves the exact defect scenario — an item <code>get</code>
/// resolves is the SAME item <code>set</code> can now update — and that the fix never lets a
/// write land on a DIFFERENT production's same-named item (#29/#50).</p>
/// <p>Fixtures: <class>ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd</class> and
/// <class>ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd2</class> (durable, never
/// started). Since this story's fix, <code>set</code> mutations are NO LONGER extent-only —
/// they durably rewrite the fixture production's class XData — so <method>OnBeforeOneTest</method>'s
/// former <code>LoadFromClass</code>-only resync is no longer sufficient on its own (it would
/// load a drifted baseline rather than undo it). Isolation is therefore achieved by restoring
/// the checked-in baseline in BOTH <method>OnBeforeOneTest</method> and
/// <method>OnAfterOneTest</method> (CR 35.1-10): teardown keeps the live classes clean for the
/// next consumer, and setup makes every test order-independent and self-healing even when a
/// previous run aborted before its teardown ran.</p>
/// <p>Deliberately scoped to <code>get</code>/<code>set</code> (what this story's fix
/// touches) plus the composite-key primitives. <code>enable</code>/<code>disable</code>
/// operate against the namespace's RUNNING production and were live-HTTP-proven manually
/// during Story 35.1 dev (Dev Notes) rather than automated here — starting/stopping a real
/// production inside the default suite on every run is the kind of slow, state-changing
/// operation this project's fixtures deliberately avoid (see class doc comments on
/// <class>ExecuteMCPv2.Tests.AdvisorFixture</class> for the same design principle applied
/// to SQL fixtures).</p>
Class ExecuteMCPv2.Tests.InteropItemCompositeKeyTest Extends %UnitTest.TestCase
{

Parameter PROD1 = "ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd";

Parameter PROD2 = "ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd2";

Parameter ITEMNAME = "FixtureOp";

/// Restore both fixture productions to their checked-in XData baseline before every test.
/// <p>Story 35.1 code review (CR 35.1-10): this hook previously called only
/// <method>LoadFromClass</method>, which re-syncs the extent FROM the class XData — that
/// healed a pre-fix extent-only mutation, but now that <code>set</code> writes XData
/// durably it would load a DRIFTED baseline rather than undo it. Restoration must exist on
/// the SETUP side too, not only in teardown, because teardown is not guaranteed to run:
/// <class>%UnitTest.Manager</class> skips <method>OnAfterOneTest</method> entirely when
/// <method>OnBeforeOneTest</method> errors, and an aborted/killed run skips it as well. With
/// the restore here, every test starts from the checked-in baseline regardless of execution
/// order or how the previous run ended, so a single failed cleanup can no longer poison
/// every subsequent run.</p>
Method OnBeforeOneTest() As %Status
{
    Do ..RestoreFixtureBaseline(..#PROD1, "")
    Do ..RestoreFixtureBaseline(..#PROD2, "fixture2-baseline")
    Quit $$$OK
}

/// Story 35.1 cycle_iteration=2 (QA HIGH gap-close): restore both fixture productions'
/// FixtureOp item back to their checked-in XData baseline after EVERY test. This is now
/// REQUIRED (it was a no-op safety net pre-fix): 'set' durably persists to the production
/// class XData, so <method>OnBeforeOneTest</method>'s <method>LoadFromClass</method> no
/// longer undoes a mutating test's write the way it did before this story's fix — without
/// this restore, a mutating test would permanently drift the LIVE fixture class definition
/// away from its on-disk checked-in baseline.
Method OnAfterOneTest() As %Status
{
    ; CR 35.1-10 (code review): assert the restore actually succeeded. Swallowing the status
    ; made a failed cleanup indistinguishable from a successful one — the run stayed green
    ; while the LIVE fixture class XData silently drifted from its checked-in .cls, and the
    ; damage surfaced on a LATER run as an unrelated-looking baseline assertion failure.
    Do $$$AssertStatusOK(..RestoreFixtureBaseline(..#PROD1, ""), "fixture PROD1 must be restored to its checked-in XData baseline after the test")
    Do $$$AssertStatusOK(..RestoreFixtureBaseline(..#PROD2, "fixture2-baseline"), "fixture PROD2 must be restored to its checked-in XData baseline after the test")
    Quit $$$OK
}

/// Reset the named fixture production's FixtureOp item back to its checked-in XData
/// baseline (PoolSize=1, Enabled=false, Category="", ClassName=EnsLib.File.PassthroughOperation,
/// and the given baseline Comment — see InteropCompositeKeyFixtureProd(2).cls XData) via the
/// SAME %Save + SaveToClass durability pair the fix under test uses, so a test's mutation
/// never permanently drifts the live class definition from the on-disk fixture.
/// <p>CR 35.1-10 (code review): now RETURNS a %Status instead of swallowing every failure,
/// so a cleanup that did not actually work fails loudly in <method>OnAfterOneTest</method>
/// on the run that caused it, rather than silently on some later run.</p>
Method RestoreFixtureBaseline(pProdName As %String, pBaselineComment As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tSC = ##class(Ens.Config.Production).LoadFromClass(pProdName)
        If $$$ISERR(tSC) Quit
        Set tProd = ##class(Ens.Config.Production).%OpenId(pProdName)
        If '$IsObject(tProd) {
            Set tSC = $$$ERROR($$$GeneralError, "fixture production '"_pProdName_"' could not be opened for restore")
            Quit
        }
        Set tItem = tProd.FindItemByConfigName(..#ITEMNAME)
        If '$IsObject(tItem) {
            Set tSC = $$$ERROR($$$GeneralError, "fixture item '"_..#ITEMNAME_"' not found in production '"_pProdName_"' during restore")
            Quit
        }
        Set tItem.PoolSize = 1
        Set tItem.Enabled = 0
        Set tItem.Category = ""
        Set tItem.ClassName = "EnsLib.File.PassthroughOperation"
        Set tItem.Comment = pBaselineComment
        Set tSC = tItem.%Save()
        If $$$ISERR(tSC) Quit
        Set tSC = tProd.SaveToClass(tItem)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// ==================== Section A: composite-key primitive pin ====================
/// AC 35.1.2 — live-probed (Dev Notes) API contract: one-arg <code>NameExists(name)</code>
/// — the EXACT pre-fix Interop.cls:473 call shape — can never resolve a composite
/// (Production, Name) index row; two-arg <code>NameExists(prod,name)</code> and
/// <method>FindItemByConfigName</method> both resolve it and agree.
Method TestOneArgNameExistsCannotResolveCompositeKey() As %Status
{
    Set tOneArgId = ""
    Set tOneArgReturn = ##class(Ens.Config.Item).NameExists(..#ITEMNAME, .tOneArgId)
    Do $$$AssertEquals(tOneArgReturn, 0, "one-arg NameExists(name) can never resolve a composite (Production,Name) index row — the pre-fix Interop.cls:473 shape")

    Set tTwoArgId = ""
    Set tTwoArgReturn = ##class(Ens.Config.Item).NameExists(..#PROD1, ..#ITEMNAME, .tTwoArgId)
    Do $$$AssertEquals(tTwoArgReturn, 1, "two-arg NameExists(production,name) resolves the composite key")
    Do $$$AssertTrue(+tTwoArgId > 0, "two-arg NameExists returns a real item ID")

    Set tProd = ##class(Ens.Config.Production).%OpenId(..#PROD1)
    Do $$$AssertTrue($IsObject(tProd), "the fixture production must open")
    Set tFindStatus = $$$OK
    Set tItem = tProd.FindItemByConfigName(..#ITEMNAME, .tFindStatus)
    Do $$$AssertTrue($IsObject(tItem), "FindItemByConfigName must resolve the item — the API Interop.cls 'set' now uses, matching add/remove")
    Do $$$AssertEquals(tItem.%Id(), tTwoArgId, "FindItemByConfigName and two-arg NameExists must agree on the same row")
    Quit $$$OK
}

/// ==================== Section B: real end-to-end HTTP (Rule #26/#59) ====================
/// Resolve the WebServer port the same way <class>ExecuteMCPv2.Tests.AdvisorDataTest</class> does.
Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("Interop", "Port"))
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

/// POST a JSON body to a deployed ExecuteMCPv2 REST route and parse the envelope.
Method PostJson(pPath As %String, pJsonBody As %String, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Get(^UnitTestConfig("Interop", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("Interop", "Password"), "SYS")
        Set tRequest.Timeout = 60
        Set tRequest.ContentType = "application/json"
        Do tRequest.EntityBody.Write(pJsonBody)
        Set tSC = tRequest.Post(pPath)
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set pEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Number of entries in the envelope's status.errors array (mirrors
/// ExecuteMCPv2.Tests.AdvisorDataTest.ErrorCount).
Method EnvelopeErrorCount(pEnvelope As %DynamicObject) As %Integer
{
    Quit pEnvelope.status.errors.%Size()
}

/// AC 35.1.1/35.1.5 — get -> set -> get over the REAL deployed endpoint: the item
/// 'get' resolves is the SAME item 'set' can now update. Before this story's fix,
/// this exact 'set' call reported "Config item not found" on an item 'get' had just
/// resolved (the story's defect, live-verified in Dev Notes with revert/restore).
Method TestSetResolvesCompositeKeyOverRealHttp() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    Set tGetBody = "{""action"":""get"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the baseline 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "baseline 'get' HTTP 200")
    Do $$$AssertEquals(tEnv.result.itemName, ..#ITEMNAME, "'get' resolves the fixture item")

    Set tSetBody = "{""action"":""set"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_""",""settings"":{""comment"":""story-35-1-regression""}}"
    Set tSC = ..PostJson(tBasePath, tSetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the 'set' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "'set' HTTP 200")
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "'set' envelope carries no errors — this is the Story 35.1 defect: 'set' used to report 'Config item not found' here")
    Do $$$AssertEquals(tEnv.result.action, "set", "'set' response action")
    Do $$$AssertEquals(tEnv.result.production, ..#PROD1, "'set' echoes the resolved production")

    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the follow-up 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tEnv.result.comment, "story-35-1-regression", "the 'set' mutation landed and is visible to a follow-up 'get'")
    Quit $$$OK
}

/// AC 35.1.3 — a write to PROD2's item never lands on PROD1's same-named item
/// (#29/#50: never a silent wrong-row write).
Method TestSetNeverWritesWrongProductionRow() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    Set tGetProd2 = "{""action"":""get"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD2_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetProd2, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "PROD2 baseline 'get' must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tEnv.result.comment, "fixture2-baseline", "PROD2's fixture item carries its own baseline comment")

    Set tSetProd2 = "{""action"":""set"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD2_""",""namespace"":"""_tNS_""",""settings"":{""comment"":""prod2-written""}}"
    Set tSC = ..PostJson(tBasePath, tSetProd2, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "PROD2 'set' must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "PROD2 'set' carries no errors")

    Set tGetProd1 = "{""action"":""get"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_"""}"
    ; CR 35.1-11 (code review): assert PROD1 is at its EXACT checked-in baseline on every
    ; field a 'set' can write, not merely that one field is not one magic string. The former
    ; assertion inspected only 'comment', so a regression letting a PROD2 write land on PROD1's
    ; poolSize/enabled/category/className was invisible — and its 'field is absent' disjunct
    ; also passed whenever 'get' returned a degenerate result object.
    Set tSC = ..PostJson(tBasePath, tGetProd1, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "PROD1 'get' must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tEnv.result.itemName, ..#ITEMNAME, "PROD1 'get' resolves PROD1's own item")
    Do $$$AssertTrue('tEnv.result.%IsDefined("comment"), "PROD1's item keeps its empty baseline comment — PROD2's write must NOT have landed here")
    Do $$$AssertEquals(+tEnv.result.poolSize, 1, "PROD1's poolSize is untouched by a write to PROD2")
    Do $$$AssertEquals(tEnv.result.className, "EnsLib.File.PassthroughOperation", "PROD1's className is untouched by a write to PROD2")
    Do $$$AssertTrue('tEnv.result.%IsDefined("category"), "PROD1's category is untouched by a write to PROD2")

    ; And confirm the write DID land where it was addressed — otherwise this test would also
    ; pass if 'set' silently wrote nothing at all.
    Set tSC = ..PostJson(tBasePath, tGetProd2, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "PROD2 follow-up 'get' must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tEnv.result.comment, "prod2-written", "PROD2's item DID receive the write addressed to it")
    Quit $$$OK
}

/// AC 35.1.4 gap-close (QA pass, Story 35.1) — 'get' with an explicit 'production'
/// filter that does NOT contain the item reports a not-found error naming the
/// production, exercising the get-branch's optional Production SQL predicate
/// (Interop.cls ItemManage 'get' branch) down its not-found path — no other Story
/// 35.1 test drives this branch (the existing get/production tests only cover the
/// FOUND case).
Method TestGetWithProductionFilterReportsNotFoundNamingProduction() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    Set tGetBody = "{""action"":""get"",""itemName"":"""_..#ITEMNAME_""",""production"":""ExecuteMCPv2.Tests.NoSuchFixtureProdZZZ"",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the 'get' HTTP call must succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "not-found still renders HTTP 200 + envelope (Rule #7)")
    Do $$$AssertTrue(..EnvelopeErrorCount(tEnv) >= 1, "envelope carries an error for the item/production combination")

    Set tErrorText = tEnv.status.errors.%Get(0).%Get("error")
    Do $$$AssertTrue(tErrorText [ ..#ITEMNAME, "error names the item")
    Do $$$AssertTrue(tErrorText [ "NoSuchFixtureProdZZZ", "error names the production filter (not just the item) — the get-branch production-aware not-found text")
    Quit $$$OK
}

/// AC 35.1.3 — an unresolvable 'production' rejects cleanly and writes nothing to
/// either fixture production.
Method TestSetRejectsUnknownProductionWithoutWritingAnywhere() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    Set tSetBody = "{""action"":""set"",""itemName"":"""_..#ITEMNAME_""",""production"":""ExecuteMCPv2.Tests.NoSuchFixtureProdZZZ"",""namespace"":"""_tNS_""",""settings"":{""comment"":""should-not-land""}}"
    Set tSC = ..PostJson(tBasePath, tSetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the rejected 'set' HTTP call must still succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "rejection still renders HTTP 200 + envelope (Rule #7)")
    Do $$$AssertTrue(..EnvelopeErrorCount(tEnv) >= 1, "envelope carries an error for the unresolvable production")

    ; CR 35.1-11 (code review): the method name promises "without writing ANYWHERE", so check
    ; BOTH fixture productions, not just PROD1, and pin each against its exact checked-in
    ; baseline comment rather than merely against the one string this test happens to send.
    Set tGetProd1 = "{""action"":""get"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetProd1, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "PROD1 'get' must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertTrue('tEnv.result.%IsDefined("comment"), "PROD1's item keeps its empty baseline comment — the rejected write touched nothing")
    Do $$$AssertEquals(+tEnv.result.poolSize, 1, "PROD1's poolSize is untouched by the rejected write")

    Set tGetProd2 = "{""action"":""get"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD2_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetProd2, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "PROD2 'get' must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tEnv.result.comment, "fixture2-baseline", "PROD2's item is also untouched by the rejected write — 'anywhere' means both fixtures")
    Quit $$$OK
}

/// AC 35.1 cycle_iteration=2 — QA HIGH regression pin (Rule #48/#59): pre-fix, 'set'
/// persisted via <code>tItem.%Save()</code> alone — the SQL extent only, never the
/// production class XData that Rule #27 makes the source of truth. Because every
/// set/add/remove call begins with its own <method>LoadFromClass</method> resync (and a
/// bare class recompile does the same), a SECOND independent 'set' call silently
/// discarded the FIRST call's change back to the XData baseline — confirmed live three
/// ways during QA (sequential 'set' calls, and a production-class recompile). This test
/// makes TWO sequential mutating 'set' calls to DIFFERENT fields on the SAME item (field
/// A: poolSize, then field B: comment), asserts field A still holds after field B's
/// write, then recompiles the fixture production class directly and asserts BOTH fields
/// still hold.
Method TestSetSequentialMutationsBothPersistAndSurviveRecompile() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    ; First mutating 'set' call: field A (poolSize).
    Set tSetPoolSize = "{""action"":""set"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_""",""settings"":{""poolSize"":5}}"
    Set tSC = ..PostJson(tBasePath, tSetPoolSize, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the first 'set' (poolSize) HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "the first 'set' (poolSize) carries no errors")

    ; Second, INDEPENDENT mutating 'set' call: field B (comment) on the SAME item.
    ; Interop.cls's set branch re-runs LoadFromClass on every call (Rule #27) — pre-fix,
    ; this resync silently reverted poolSize back to the XData baseline (1) because the
    ; first 'set' never reached XData.
    Set tSetComment = "{""action"":""set"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_""",""settings"":{""comment"":""story-35-1-sequential""}}"
    Set tSC = ..PostJson(tBasePath, tSetComment, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the second 'set' (comment) HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "the second 'set' (comment) carries no errors")

    ; Follow-up 'get': field A (poolSize) must STILL hold — this is the exact defect QA
    ; reproduced live: a later 'set' call silently reverted an earlier one.
    Set tGetBody = "{""action"":""get"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the follow-up 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(+tEnv.result.poolSize, 5, "field A (poolSize) from the FIRST 'set' must still hold after the SECOND 'set' wrote a DIFFERENT field — the Story 35.1 cycle_iteration=2 durability defect")
    Do $$$AssertEquals(tEnv.result.comment, "story-35-1-sequential", "field B (comment) from the SECOND 'set' also landed")

    ; Recompile the fixture production class DIRECTLY (not through the tool) and confirm
    ; BOTH fields survive — a bare recompile re-syncs from XData exactly like the next
    ; set/add/remove call's own LoadFromClass would; this is the QA-reproduced
    ; "production-class recompile" reversion path, distinct from the sequential-set path
    ; already exercised above.
    Set tCompileSC = $System.OBJ.Compile(..#PROD1, "ck-d")
    Do $$$AssertStatusOK(tCompileSC, "the direct recompile of the fixture production class must succeed")
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the post-recompile 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(+tEnv.result.poolSize, 5, "field A (poolSize) survives a production-class recompile")
    Do $$$AssertEquals(tEnv.result.comment, "story-35-1-sequential", "field B (comment) survives a production-class recompile")
    Quit $$$OK
}

/// ==================== Section C: className-guard coverage (code review) ====================
/// CR 35.1-12 (code review, Rule #59 / skill-rule 3): Story 35.1 cycle_iteration=2 added a
/// <method>ValidateHostClassName</method> guard on <code>set</code>'s
/// <code>settings.className</code> path, but shipped NO test that sends a
/// <code>className</code> to <code>set</code> at all — neither an accepting nor a rejecting
/// case. The pre-existing <class>ExecuteMCPv2.Tests.InteropHostGuardTest</class> pins the
/// classification primitives independently and never calls into
/// <class>ExecuteMCPv2.REST.Interop</class>, so deleting the guard call left the whole suite
/// green while <code>set</code> durably wrote a broken item into the production class XData.
/// This drives the guard over the REAL deployed endpoint on all three rejection reasons.
Method TestSetRejectsInvalidClassNameWithoutWriting() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    ; Three distinct rejection reasons, matching ValidateHostClassName's three checks in order:
    ; nonexistent/uncompiled, compiled-but-not-an-Ens.Host, and compiled Ens.Host but abstract.
    Set tCases = 3
    Set tCase(1) = "ExecuteMCPv2.Tests.NoSuchHostClassZZZ"
    Set tCase(2) = "%Stream.GlobalCharacter"
    Set tCase(3) = "Ens.BusinessService"

    For i = 1:1:tCases {
        Set tSetBody = "{""action"":""set"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_""",""settings"":{""className"":"""_tCase(i)_"""}}"
        Set tSC = ..PostJson(tBasePath, tSetBody, .tHttp, .tEnv)
        Do $$$AssertStatusOK(tSC, "the rejected 'set' HTTP call must still succeed at the transport level for "_tCase(i))
        If $$$ISERR(tSC) Quit
        Do $$$AssertEquals(tHttp, 200, "rejection still renders HTTP 200 + envelope (Rule #7) for "_tCase(i))
        Do $$$AssertTrue(..EnvelopeErrorCount(tEnv) >= 1, "'set' must REJECT an invalid host className: "_tCase(i))
    }

    ; The item's className must be untouched — an unguarded override would have been persisted
    ; durably to the class XData with SaveToClass swallowing the OnConfigChange failure.
    Set tGetBody = "{""action"":""get"",""itemName"":"""_..#ITEMNAME_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the follow-up 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tEnv.result.className, "EnsLib.File.PassthroughOperation", "the fixture item's className is unchanged — no rejected className was persisted")
    Quit $$$OK
}

/// CR 35.1-1 (code review) regression pin: <code>add</code> validated only its TOP-LEVEL
/// <code>className</code> argument; a <code>settings.className</code> OVERRIDE was applied
/// afterwards, completely unguarded, and was what <method>SaveToClass</method> actually
/// persisted. With a compiled-but-non-host override, <method>SaveToClass</method> swallows the
/// resulting <code>&lt;METHOD DOES NOT EXIST&gt;</code> (irislib/Ens/Config/Production.cls:148-157)
/// and returns success — so the call answered HTTP 200 over a durably-broken item whose
/// reported className was the validated one, not the persisted one.
Method TestAddSettingsClassNameOverrideIsGuarded() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE
    Set tNewItem = "CRAddOverrideProbeOp"

    Set tAddBody = "{""action"":""add"",""itemName"":"""_tNewItem_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_""",""className"":""EnsLib.File.PassthroughOperation"",""settings"":{""className"":""%Stream.GlobalCharacter""}}"
    Set tSC = ..PostJson(tBasePath, tAddBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the rejected 'add' HTTP call must still succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "rejection still renders HTTP 200 + envelope (Rule #7)")
    Do $$$AssertTrue(..EnvelopeErrorCount(tEnv) >= 1, "'add' must REJECT a settings.className override that is not an Ens.Host, not persist it")

    ; Nothing may have been created: the guard fires before tProd.Items.Insert / SaveToClass.
    Set tGetBody = "{""action"":""get"",""itemName"":"""_tNewItem_""",""production"":"""_..#PROD1_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the follow-up 'get' HTTP call must succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertTrue(..EnvelopeErrorCount(tEnv) >= 1, "the rejected 'add' created no item — 'get' must report it not found")
    Quit $$$OK
}

}
