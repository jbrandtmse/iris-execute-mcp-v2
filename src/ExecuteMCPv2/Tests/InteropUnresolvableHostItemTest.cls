/// Regression coverage for Story 35.1 Task 7 (AC 35.1.7, closes ledger HIGH <code>35-1-CR-1</code>):
/// <method>ExecuteMCPv2.REST.Interop:ItemManage</method>'s <code>set</code> AND
/// <code>remove</code> branches must stay able to reach a config item whose
/// <var>ClassName</var> no longer resolves to a business type.
/// <p><code>Ens.Config.Production:findItemIdByName</code> SKIPS such an item outright
/// (irislib/Ens/Config/Production.cls:739 —
/// <code>Continue:$$$eHostTypeUnknown=##class(Ens.Config.Item).GetBusinessType(tClassname,$$$NULLOREF)</code>),
/// so <code>FindItemByConfigName</code> returns <code>$$$NULLOREF</code> for it — while raw-SQL
/// <code>get</code> (Interop.cls's <code>get</code> branch) still resolves it happily. Pre-fix,
/// this made the item unrepairable through the tool: <code>set</code> could not apply a valid
/// <var>className</var> to fix it, and <code>remove</code> could not delete it, while
/// <code>get</code> reported it as present all along — the same <code>get</code>/<code>set</code>
/// contradiction AC 35.1.1 exists to kill, reached by a second route (live-reproduced during the
/// Story 35.1 code review that ledgered <code>35-1-CR-1</code>).</p>
/// <p>Fixture: <class>ExecuteMCPv2.Tests.InteropUnresolvableHostFixtureProd</class> (durable,
/// never started), whose two items both carry <var>ClassName="%Stream.GlobalCharacter"</var> —
/// compiled but not an <code>Ens.Host</code> subclass, live-probed (Story 35.1 Dev Notes) to make
/// <code>GetBusinessType</code> return <code>$$$eHostTypeUnknown</code>. <var>UnresolvableSetOp</var>
/// is repaired in place by <code>set</code>; <var>UnresolvableRemoveOp</var> is deleted by
/// <code>remove</code>. Both, plus <var>DeletedHostOp</var>, are restored in
/// <method>OnAfterOneTest</method>/<method>OnBeforeOneTest</method> via
/// <method>RestoreFixtureBaseline</method> — a single whole-class XData rewrite + recompile
/// (mirrors <class>ExecuteMCPv2.Tests.InteropItemCompositeKeyTest</class>'s restore-in-both-hooks
/// pattern, CR 35.1-10 — self-healing regardless of execution order or a prior aborted run).
/// <b>Fixture self-corruption repair (cycle_iteration=4):</b> a PRIOR per-item, object-mutation
/// restore helper live-corrupted this exact fixture's deployed XData with XML
/// <code>nil="true"</code> placeholders (see <method>RestoreFixtureBaseline</method>'s doc
/// comment for the full root-cause). The whole-XData-rewrite approach never opens or mutates an
/// <class>Ens.Config.Item</class>/<class>Ens.Config.Production</class> object during restore, so
/// it is immune to that failure mode, and <method>VerifyFixtureIntegrity</method> guards against
/// it recurring invisibly.</p>
/// <p>HTTP helpers (<method>ResolvePort</method>/<method>PostJson</method>/
/// <method>EnvelopeErrorCount</method>) duplicate <class>ExecuteMCPv2.Tests.InteropItemCompositeKeyTest</class>'s
/// — this project's established per-file pattern (see that class's own doc comment referencing
/// <class>ExecuteMCPv2.Tests.AdvisorDataTest</class>) rather than a shared base, to keep each test
/// class independently readable and within the ~500-line guideline.</p>
Class ExecuteMCPv2.Tests.InteropUnresolvableHostItemTest Extends %UnitTest.TestCase
{

Parameter PRODNAME = "ExecuteMCPv2.Tests.InteropUnresolvableHostFixtureProd";

Parameter SETITEM = "UnresolvableSetOp";

Parameter REMOVEITEM = "UnresolvableRemoveOp";

Parameter UNRESOLVABLECLASS = "%Stream.GlobalCharacter";

Parameter VALIDHOSTCLASS = "EnsLib.File.PassthroughOperation";

/// Third fixture item (CR 35.1-14/15): its ClassName names a class that does NOT EXIST at all,
/// as opposed to SETITEM/REMOVEITEM's compiled-but-non-host class. See the fixture class doc
/// for why the two shapes diverge inside SaveToClass.
Parameter DELETEDITEM = "DeletedHostOp";

Parameter DELETEDCLASS = "ExecuteMCPv2.Tests.NoSuchHostClassDoesNotExist";

/// Restore the fixture production to its checked-in baseline before every test — self-healing
/// even if a previous run aborted before its own teardown ran (CR 35.1-10). See
/// <method>RestoreFixtureBaseline</method>'s doc comment for why this is a single whole-XData
/// rewrite rather than three per-item object mutations (fixture self-corruption repair,
/// cycle_iteration=4).
Method OnBeforeOneTest() As %Status
{
    Do $$$AssertStatusOK(..RestoreFixtureBaseline(), "fixture '"_..#PRODNAME_"' must be restored to its checked-in baseline before the test")
    Quit $$$OK
}

/// Restore the fixture production back to baseline after every test, so a repair ('set') or a
/// deletion ('remove') never permanently drifts the live fixture class XData away from its
/// checked-in baseline for the next consumer.
Method OnAfterOneTest() As %Status
{
    Do $$$AssertStatusOK(..RestoreFixtureBaseline(), "fixture '"_..#PRODNAME_"' must be restored to its checked-in baseline after the test")
    Quit $$$OK
}

/// The checked-in <var>ProductionDefinition</var> XData text, byte-identical to
/// <class>ExecuteMCPv2.Tests.InteropUnresolvableHostFixtureProd</class>'s own <code>.cls</code>
/// source. The single source of truth <method>RestoreFixtureBaseline</method> rewrites the
/// deployed class XData to on every restore.
ClassMethod BaselineXData() As %String
{
    Set tOut = ""
    Set tOut = tOut_"<Production Name=""ExecuteMCPv2.Tests.InteropUnresolvableHostFixtureProd"" LogGeneralTraceEvents=""false"">"_$Char(10)
    Set tOut = tOut_"  <Description>Durable fixture production for Story 35.1 Task 7 (AC 35.1.7) unresolvable-host-class regression coverage. Never started.</Description>"_$Char(10)
    Set tOut = tOut_"  <ActorPoolSize>2</ActorPoolSize>"_$Char(10)
    Set tOut = tOut_"  <Item Name=""UnresolvableSetOp"" Category="""" ClassName=""%Stream.GlobalCharacter"" PoolSize=""1"" Enabled=""false"" Foreground=""false"" Comment=""unresolvable-set-baseline"" LogTraceEvents=""false"" Schedule="""">"_$Char(10)
    Set tOut = tOut_"  </Item>"_$Char(10)
    Set tOut = tOut_"  <Item Name=""UnresolvableRemoveOp"" Category="""" ClassName=""%Stream.GlobalCharacter"" PoolSize=""1"" Enabled=""false"" Foreground=""false"" Comment=""unresolvable-remove-baseline"" LogTraceEvents=""false"" Schedule="""">"_$Char(10)
    Set tOut = tOut_"  </Item>"_$Char(10)
    Set tOut = tOut_"  <Item Name=""DeletedHostOp"" Category="""" ClassName=""ExecuteMCPv2.Tests.NoSuchHostClassDoesNotExist"" PoolSize=""1"" Enabled=""false"" Foreground=""false"" Comment=""deleted-host-baseline"" LogTraceEvents=""false"" Schedule="""">"_$Char(10)
    Set tOut = tOut_"  </Item>"_$Char(10)
    Set tOut = tOut_"</Production>"
    Quit tOut
}

/// Restore the fixture production's ENTIRE <var>ProductionDefinition</var> XData to
/// <method>BaselineXData</method> by rewriting the class's XData block directly
/// (<class>%Dictionary.ClassDefinition</class>/<class>%Dictionary.XDataDefinition</class>,
/// the same primitive <code>Ens.Config.Production:SaveToClass</code> itself uses) and
/// recompiling — it never opens or mutates an <class>Ens.Config.Item</class>/
/// <class>Ens.Config.Production</class> OBJECT to do it.
/// <p><b>Fixture self-corruption repair (cycle_iteration=4).</b> The PRIOR restore helper
/// (<code>RestoreFixtureItem</code>, since removed — see git history) opened the fixture
/// production THREE TIMES per hook invocation (once per item) via <code>LoadFromClass</code> +
/// <code>%OpenId</code>, mutated fields on an item taken from <code>tProd.Items</code>, and
/// called <code>SaveToClass</code>. Live-reproduced (Debug Log): <code>%OpenId(PRODNAME)</code>
/// inside the 2nd/3rd call of the SAME hook invocation returned a STALE cached oref left
/// resident from the FIRST call — IRIS's per-process object/swizzle cache is keyed by OID and
/// is not invalidated by a DIFFERENT <code>LoadFromClass</code> (<code>%DeleteId</code> +
/// recreate) cycle running earlier in the SAME process — so <code>tProd.Items.GetAt(pos)</code>
/// returned an unpopulated placeholder <class>Ens.Config.Item</class> instead of the persisted
/// row. <code>%Save()</code> on that placeholder failed with <code>#5659</code> ("Name"/
/// "ClassName" required), and the following <code>SaveToClass</code> serialized that empty
/// collection slot as an XML <code>xsi:nil</code> placeholder (<code>&lt;Item nil="true"/&gt;</code>),
/// permanently corrupting the DEPLOYED class XData for the next run — while the suite itself
/// still reported red (never silently green), which is how this was caught. Rewriting the
/// XData TEXT and recompiling instead of touching objects is immune to that cache staleness
/// by construction.</p>
Method RestoreFixtureBaseline() As %Status
{
    Set tSC = $$$OK
    Try {
        Set tClassDefinition = ##class(%Dictionary.ClassDefinition).%OpenId(..#PRODNAME)
        If '$IsObject(tClassDefinition) {
            Set tSC = $$$ERROR($$$GeneralError, "fixture class '"_..#PRODNAME_"' could not be opened for restore")
            Quit
        }

        Set tIndex = tClassDefinition.XDatas.FindObjectId(..#PRODNAME_"||ProductionDefinition")
        If tIndex '= "" Do tClassDefinition.XDatas.RemoveAt(tIndex)

        Set tXDataDefinition = ##class(%Dictionary.XDataDefinition).%New()
        Set tXDataDefinition.Name = "ProductionDefinition"
        Set tXDataDefinition.parent = tClassDefinition
        Do tXDataDefinition.Data.Write(..BaselineXData())

        Set tSC = tClassDefinition.%Save()
        If $$$ISERR(tSC) Quit

        Set tSC = $System.OBJ.Compile(..#PRODNAME, "ck-d")
        If $$$ISERR(tSC) Quit

        ; Belt-and-suspenders re-sync (the recompile's own CreateProjection already calls
        ; this — Ens.Production's Projection dispatches to LoadFromClass), so an immediate
        ; 'get' (raw SQL, no LoadFromClass) sees the restored baseline right away either way.
        Set tSC = ##class(Ens.Config.Production).LoadFromClass(..#PRODNAME)
        If $$$ISERR(tSC) Quit

        ; Guard (this repair's whole point, Rule #58/#59): never let a corrupted deploy go
        ; unnoticed again. If the write above somehow still produced a bad XData, fail here,
        ; loudly, in THIS test run — rather than silently poisoning the next one.
        Set tSC = ..VerifyFixtureIntegrity()
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Assert the deployed fixture class XData contains exactly the three expected items by name
/// and no XML <code>nil="true"</code> placeholder. Called by <method>RestoreFixtureBaseline</method>
/// after every restore so a corrupted write is a loud, immediate test failure instead of a
/// silent, durable fixture-poisoning defect invisible to a green suite.
Method VerifyFixtureIntegrity() As %Status
{
    Set tSC = $$$OK
    Try {
        Set tXData = ..ProductionXData()
        If tXData [ "nil=""true""" {
            Set tSC = $$$ERROR($$$GeneralError, "fixture '"_..#PRODNAME_"' XData contains an XML nil placeholder after restore — the fixture is corrupted")
            Quit
        }
        If '(tXData [ ("Name="""_..#SETITEM_"""")) {
            Set tSC = $$$ERROR($$$GeneralError, "fixture '"_..#PRODNAME_"' XData is missing item '"_..#SETITEM_"' after restore")
            Quit
        }
        If '(tXData [ ("Name="""_..#REMOVEITEM_"""")) {
            Set tSC = $$$ERROR($$$GeneralError, "fixture '"_..#PRODNAME_"' XData is missing item '"_..#REMOVEITEM_"' after restore")
            Quit
        }
        If '(tXData [ ("Name="""_..#DELETEDITEM_"""")) {
            Set tSC = $$$ERROR($$$GeneralError, "fixture '"_..#PRODNAME_"' XData is missing item '"_..#DELETEDITEM_"' after restore")
            Quit
        }
        Set tItemCount = ..CountOccurrences(tXData, "<Item ")
        If tItemCount '= 3 {
            Set tSC = $$$ERROR($$$GeneralError, "fixture '"_..#PRODNAME_"' XData has "_tItemCount_" <Item> elements after restore, expected exactly 3")
            Quit
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Resolve the WebServer port the same way ExecuteMCPv2.Tests.InteropItemCompositeKeyTest does.
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

/// Number of entries in the envelope's status.errors array.
Method EnvelopeErrorCount(pEnvelope As %DynamicObject) As %Integer
{
    ; CR 35.1-17 (code review): guard the 3-level dereference. A non-envelope body (401/500,
    ; or a handler regression that renders a differently-shaped payload) makes
    ; pEnvelope.status "" and the next dot raises <INVALID OREF> mid-test — which, in the
    ; destructive remove test, can abort AFTER the delete and before any restore. Report a
    ; sentinel the assertions will fail on instead of throwing.
    If '$IsObject(pEnvelope) Quit -1
    If '$IsObject(pEnvelope.status) Quit -1
    If '$IsObject(pEnvelope.status.errors) Quit -1
    Quit pEnvelope.status.errors.%Size()
}

/// Read a result field without risking <INVALID OREF> when the envelope carried an error
/// (in which case 'result' is an empty object or absent). Returns "" when unavailable.
Method ResultField(pEnvelope As %DynamicObject, pField As %String) As %String
{
    If '$IsObject(pEnvelope) Quit ""
    If '$IsObject(pEnvelope.result) Quit ""
    If 'pEnvelope.result.%IsDefined(pField) Quit ""
    Quit pEnvelope.result.%Get(pField)
}

/// Baseline sanity (documents the AC 35.1.7 probe (a) as an automated pin, not just Dev
/// Notes): 'get' (raw SQL) resolves the fixture item despite its unresolvable className —
/// this branch was NEVER broken; it is what makes the set/remove contradiction visible.
Method TestGetResolvesItemWithUnresolvableHostClassName() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    Set tGetBody = "{""action"":""get"",""itemName"":"""_..#SETITEM_""",""production"":"""_..#PRODNAME_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "'get' HTTP 200")
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "'get' resolves the item even though its className is unresolvable")
    Do $$$AssertEquals(..ResultField(tEnv, "itemName"), ..#SETITEM, "'get' returns the fixture item")
    Do $$$AssertEquals(..ResultField(tEnv, "className"), ..#UNRESOLVABLECLASS, "'get' reports the unresolvable className as-is")
    Quit $$$OK
}

/// AC 35.1.7 core test: 'set' must reach an item FindItemByConfigName cannot resolve, and
/// repairing its className (the user-visible point of the fix) must restore normal
/// resolution. Pre-fix, this exact 'set' call reported "Config item not found" on an item
/// 'get' had just resolved.
Method TestSetReachesUnresolvableHostItemAndRepairPersists() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    ; Precondition, asserted directly against the library API (not just documented in Dev
    ; Notes): FindItemByConfigName genuinely cannot resolve the item before the repair.
    Set tSC = ##class(Ens.Config.Production).LoadFromClass(..#PRODNAME)
    Do $$$AssertStatusOK(tSC, "LoadFromClass must succeed")
    Set tProdPre = ##class(Ens.Config.Production).%OpenId(..#PRODNAME)
    Do $$$AssertTrue($IsObject(tProdPre), "the fixture production must open")
    Set tFindStatusPre = $$$OK
    Set tItemPre = tProdPre.FindItemByConfigName(..#SETITEM, .tFindStatusPre)
    Do $$$AssertTrue('$IsObject(tItemPre), "precondition: FindItemByConfigName cannot resolve an item with an unresolvable host className — this is the defect AC 35.1.7 exists to route around")

    ; The repair: 'set' a VALID host className via the composite-key fallback.
    Set tSetBody = "{""action"":""set"",""itemName"":"""_..#SETITEM_""",""production"":"""_..#PRODNAME_""",""namespace"":"""_tNS_""",""settings"":{""className"":"""_..#VALIDHOSTCLASS_"""}}"
    Set tSC = ..PostJson(tBasePath, tSetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the repair 'set' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "repair 'set' HTTP 200")
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "repair 'set' carries no errors — this is the Story 35.1 Task 7 defect: 'set' used to report 'Config item not found' here despite 'get' resolving the same item")
    Do $$$AssertEquals(..ResultField(tEnv, "action"), "set", "'set' response action")

    ; Follow-up 'get' confirms the repair landed.
    Set tGetBody = "{""action"":""get"",""itemName"":"""_..#SETITEM_""",""production"":"""_..#PRODNAME_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the follow-up 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(..ResultField(tEnv, "className"), ..#VALIDHOSTCLASS, "the repair className landed and is visible to a follow-up 'get'")

    ; The repair path is the user-visible point of the fix: confirm it restores NORMAL
    ; resolution, not just that the fallback keeps working. Directly re-check
    ; FindItemByConfigName now succeeds without any fallback involved.
    Set tSC = ##class(Ens.Config.Production).LoadFromClass(..#PRODNAME)
    Do $$$AssertStatusOK(tSC, "LoadFromClass must succeed post-repair")
    Set tProdPost = ##class(Ens.Config.Production).%OpenId(..#PRODNAME)
    Do $$$AssertTrue($IsObject(tProdPost), "the fixture production must open post-repair")
    Set tFindStatusPost = $$$OK
    Set tItemPost = tProdPost.FindItemByConfigName(..#SETITEM, .tFindStatusPost)
    Do $$$AssertTrue($IsObject(tItemPost), "post-repair: FindItemByConfigName resolves the item directly — the composite-key fallback is no longer needed once the className is valid, proving the repair restores NORMAL resolution")
    Do $$$AssertEquals(tItemPost.ClassName, ..#VALIDHOSTCLASS, "the directly-resolved post-repair item carries the repaired className")
    Quit $$$OK
}

/// AC 35.1.7: 'remove' must reach an item FindItemByConfigName cannot resolve — pre-fix this
/// reported "Config item not found" even though 'get' resolved the same item, making the
/// item permanently undeletable through this tool.
Method TestRemoveReachesUnresolvableHostItem() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    ; CR 35.1-18 (code review): assert the DEFECT PRECONDITION, exactly as the sibling 'set'
    ; test does. Without it this test passes vacuously through the ORDINARY
    ; FindItemByConfigName path — never touching the fallback it exists to pin — if the
    ; fixture item ever drifts to a resolvable className.
    Set tSC = ##class(Ens.Config.Production).LoadFromClass(..#PRODNAME)
    Do $$$AssertStatusOK(tSC, "LoadFromClass must succeed")
    Set tProdPre = ##class(Ens.Config.Production).%OpenId(..#PRODNAME)
    Do $$$AssertTrue($IsObject(tProdPre), "the fixture production must open")
    Set tFindStatusPre = $$$OK
    Set tItemPre = tProdPre.FindItemByConfigName(..#REMOVEITEM, .tFindStatusPre)
    Do $$$AssertTrue('$IsObject(tItemPre), "precondition: FindItemByConfigName cannot resolve the remove-fixture item — without this the test would exercise the ordinary path and pin nothing")

    Set tGetBody = "{""action"":""get"",""itemName"":"""_..#REMOVEITEM_""",""production"":"""_..#PRODNAME_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the baseline 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "'get' resolves the item pre-removal despite its unresolvable className")

    Set tRemoveBody = "{""action"":""remove"",""itemName"":"""_..#REMOVEITEM_""",""production"":"""_..#PRODNAME_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tRemoveBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the 'remove' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(tHttp, 200, "'remove' HTTP 200")
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "'remove' carries no errors — this is the Story 35.1 Task 7 defect: 'remove' used to report 'Config item not found' here despite 'get' resolving the same item")
    Do $$$AssertEquals(..ResultField(tEnv, "action"), "removed", "'remove' response action")

    ; Follow-up 'get' confirms the item is genuinely gone.
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the follow-up 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertTrue(..EnvelopeErrorCount(tEnv) >= 1, "the removed item is genuinely gone — follow-up 'get' reports not found")
    ; CR 35.1-19 (code review): "any error at all" would also be satisfied by an auth/route
    ; regression or a corrupted production. Pin the item's actual absence independently of the
    ; envelope, against the Rule #27 source of truth AND the extent.
    Set tGoneID = ""
    Do $$$AssertTrue('##class(Ens.Config.Item).NameExists(..#PRODNAME, ..#REMOVEITEM, .tGoneID), "the removed item is gone from the Ens_Config.Item extent, not merely erroring on read")
    Set tXData = ..ProductionXData()
    Do $$$AssertTrue(tXData [ "Name=""", "the production XData is still readable and well-formed after the remove")
    Do $$$AssertTrue('(tXData [ ("Name="""_..#REMOVEITEM_"""")), "the removed item is gone from the production class XData (Rule #27 source of truth), proving 'remove' wrote through rather than only erroring")
    Quit $$$OK
}

/// Current ProductionDefinition XData of the fixture production, as raw text.
Method ProductionXData() As %String
{
    Set tOut = ""
    Try {
        Set tCD = ##class(%Dictionary.ClassDefinition).%OpenId(..#PRODNAME)
        If '$IsObject(tCD) Quit
        For i = 1:1:tCD.XDatas.Count() {
            Set tX = tCD.XDatas.GetAt(i)
            If tX.Name = "ProductionDefinition" {
                Do tX.Data.Rewind()
                Set tOut = tX.Data.Read(32000)
            }
        }
    } Catch ex {
        Set tOut = ""
    }
    Quit tOut
}

/// CR 35.1-14 (Rule #56 enumeration gap found at the Task 7 code review): 'add's duplicate-name
/// guard resolves through the SAME FindItemByConfigName that skips unresolvable-host items, so
/// it believed the name was FREE and inserted a SECOND item with the same Name — durably
/// corrupting the production the guard exists to protect (live-reproduced over real HTTP:
/// HTTP 200 "added", two <Item Name="..."> entries in the class XData). Pins the fallback the
/// guard now carries.
Method TestAddRejectsDuplicateOfUnresolvableHostItem() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    ; Precondition: the guard's own expression genuinely cannot see the item.
    Set tSC = ##class(Ens.Config.Production).LoadFromClass(..#PRODNAME)
    Do $$$AssertStatusOK(tSC, "LoadFromClass must succeed")
    Set tProdPre = ##class(Ens.Config.Production).%OpenId(..#PRODNAME)
    Do $$$AssertTrue($IsObject(tProdPre), "the fixture production must open")
    Do $$$AssertTrue('$IsObject(tProdPre.FindItemByConfigName(..#SETITEM)), "precondition: 'add's dup-guard expression (FindItemByConfigName) cannot see the unresolvable-host item")

    Set tCountBefore = ..CountItemRows(..#SETITEM)
    Do $$$AssertEquals(tCountBefore, 1, "exactly one fixture row carries this name before the add attempt")

    Set tAddBody = "{""action"":""add"",""itemName"":"""_..#SETITEM_""",""production"":"""_..#PRODNAME_""",""className"":"""_..#VALIDHOSTCLASS_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tAddBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the duplicate 'add' HTTP call must succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK

    Do $$$AssertTrue(..EnvelopeErrorCount(tEnv) >= 1, "'add' must REJECT a name already taken by an unresolvable-host item — pre-fix it returned 200 'added' and created a duplicate")
    Do $$$AssertTrue(..EnvelopeSummary(tEnv) [ "already exists", "the rejection uses the guard's existing 'already exists' message")

    ; The decisive assertion: no duplicate landed in either store.
    Do $$$AssertEquals(..CountItemRows(..#SETITEM), 1, "still exactly ONE row with this name — no duplicate was inserted into the extent")
    Set tXData = ..ProductionXData()
    Do $$$AssertEquals(..CountOccurrences(tXData, "Name="""_..#SETITEM_""""), 1, "still exactly ONE <Item> with this name in the production class XData (Rule #27 source of truth)")
    Quit $$$OK
}

/// CR 35.1-15 (found at the Task 7 code review): a 'set' that does NOT repair className, on an
/// item whose host class does not EXIST, used to commit the class XData and THEN report failure —
/// because SaveToClass(pItem) writes the XData first (Production.cls:146) and only then
/// dispatches OnConfigChange, whose <CLASS DOES NOT EXIST> its Catch does not swallow
/// (only <METHOD DOES NOT EXIST>). The caller was told the write failed while 'get' reported it
/// applied — the get/set contradiction this story exists to kill, inverted, and newly reachable
/// because the AC 35.1.7 fallback is what first lets such an item get this far.
/// Live-reproduced over real HTTP before the fix.
Method TestSetOnDeletedHostClassReportsTruthfully() As %Status
{
    Set tBasePath = "/api/executemcp/v2/interop/production/item"
    Set tNS = $NAMESPACE

    ; The DELETEDITEM fixture is a genuinely different state from the other two items: its
    ; class does not exist at all, so it reaches the SaveToClass path they cannot (Rule #54).
    Do $$$AssertTrue('##class(%Dictionary.CompiledClass).%ExistsId(..#DELETEDCLASS), "precondition: the fixture's host class genuinely does not exist on this system")
    Do $$$AssertTrue(##class(%Dictionary.CompiledClass).%ExistsId(..#UNRESOLVABLECLASS), "contrast: the OTHER fixture items' class DOES exist (compiled non-host), which is why they cannot reach this path")

    Set tSC = ##class(Ens.Config.Production).LoadFromClass(..#PRODNAME)
    Do $$$AssertStatusOK(tSC, "LoadFromClass must succeed")
    Set tProdPre = ##class(Ens.Config.Production).%OpenId(..#PRODNAME)
    Do $$$AssertTrue($IsObject(tProdPre), "the fixture production must open")
    Do $$$AssertTrue('$IsObject(tProdPre.FindItemByConfigName(..#DELETEDITEM)), "precondition: the deleted-host item is unreachable via FindItemByConfigName, so it only gets here through the AC 35.1.7 fallback")

    ; A comment-only 'set' — deliberately NOT a className repair, so SaveToClass still
    ; dispatches OnConfigChange against the missing class.
    Set tMarker = "deleted-host-set-marker"
    Set tSetBody = "{""action"":""set"",""itemName"":"""_..#DELETEDITEM_""",""production"":"""_..#PRODNAME_""",""namespace"":"""_tNS_""",""settings"":{""comment"":"""_tMarker_"""}}"
    Set tSC = ..PostJson(tBasePath, tSetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the 'set' HTTP call must succeed at the transport level")
    If $$$ISERR(tSC) Quit $$$OK

    Do $$$AssertEquals(tHttp, 200, "'set' HTTP 200")
    Do $$$AssertEquals(..EnvelopeErrorCount(tEnv), 0, "'set' on a DELETED host class must not report failure — pre-fix it returned <CLASS DOES NOT EXIST>SaveToClass while the write had ALREADY committed")

    ; The point of the fix: what the caller was told must match what actually happened.
    Set tGetBody = "{""action"":""get"",""itemName"":"""_..#DELETEDITEM_""",""production"":"""_..#PRODNAME_""",""namespace"":"""_tNS_"""}"
    Set tSC = ..PostJson(tBasePath, tGetBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, "the follow-up 'get' HTTP call must succeed")
    If $$$ISERR(tSC) Quit $$$OK
    Do $$$AssertEquals(..ResultField(tEnv, "comment"), tMarker, "'get' agrees with the success 'set' just reported — no get/set contradiction")
    Do $$$AssertTrue(..ProductionXData() [ tMarker, "the change is in the production class XData too (Rule #27 source of truth), so a later LoadFromClass cannot silently revert it")
    Quit $$$OK
}

/// Count Ens_Config.Item rows carrying the given Name in the fixture production.
Method CountItemRows(pItemName As %String) As %Integer
{
    Set tCnt = 0
    Set tProd = ..#PRODNAME
    &sql(SELECT COUNT(*) INTO :tCnt FROM Ens_Config.Item WHERE Production = :tProd AND Name = :pItemName)
    Quit tCnt
}

/// Number of non-overlapping occurrences of pNeedle in pHaystack.
Method CountOccurrences(pHaystack As %String, pNeedle As %String) As %Integer
{
    If pNeedle = "" Quit 0
    Quit $Length(pHaystack, pNeedle) - 1
}

/// The envelope's status.summary, guarded against a non-envelope shape.
Method EnvelopeSummary(pEnvelope As %DynamicObject) As %String
{
    If '$IsObject(pEnvelope) Quit ""
    If '$IsObject(pEnvelope.status) Quit ""
    If 'pEnvelope.status.%IsDefined("summary") Quit ""
    Quit pEnvelope.status.%Get("summary")
}

}
