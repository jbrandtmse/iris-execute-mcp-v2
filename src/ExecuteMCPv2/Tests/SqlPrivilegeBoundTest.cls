/// Regression coverage for Story 35.4 — <method>ExecuteMCPv2.REST.Security:SqlPrivilegeList</method>'s
/// <code>maxRows</code> fetch-loop cap and <code>%All</code> super-role short-circuit.
/// <p><b>Why this class exists (Rule #59).</b> Story 35.4's behavior change is entirely
/// ObjectScript, but its only automated coverage shipped as TypeScript suites that mock the
/// HTTP layer and hand-write the very response fields under test. Those suites stay green if
/// the cap, the short-circuit, and the response fields are deleted from
/// <class>ExecuteMCPv2.REST.Security</class> outright — they prove the tool layer FORWARDS a
/// signal, never that the server PRODUCES one. This class drives the DEPLOYED
/// <code>/api/executemcp/v2/security/sqlprivilege</code> route with
/// <class>%Net.HttpRequest</class> (mirroring <class>ExecuteMCPv2.Tests.AdvisorDataTest</class>'s
/// <method>PostAdvise</method> pattern) so the guards are exercised on the path they actually
/// guard.</p>
/// <p><b>Section A — the cap must not corrupt the omitted-count.</b> Derived
/// (<code>GRANTED_VIA=SuperUser</code>) rows never consume the <code>maxRows</code> budget, so
/// the code review's Finding A was that the cap's loop-exit froze
/// <code>superUserPrivilegesOmitted</code> mid-scan and reported a partial figure as though it
/// were the total (live-captured pre-fix: 10,961 at <code>maxRows=7</code> against a true 15,333).
/// <method>TestOmittedCountStaysExactWhenCapped</method> asserts the capped count EQUALS the
/// uncapped one, derived from the same live instance in the same test rather than hardcoded —
/// so it travels to any instance and still fails if the loop-exit is restored.</p>
/// <p><b>Section B — <code>%All</code> reached through a nested role chain.</b> Finding B:
/// an earlier revision decided whether to omit derived rows by resolving the GRANTEE's roles
/// in <code>%SYS</code>, and <class>Security.Users</class>'s <code>Roles</code> property is
/// DIRECT-only, so a user whose role chain reached <code>%All</code> indirectly bypassed the
/// short-circuit entirely and drew the full derived cross-product. Live-probed during the
/// review on a 3-level chain (user -> outer role -> inner role -> <code>%All</code>): 15,333
/// <code>SuperUser</code> rows, identical to <code>_SYSTEM</code>'s. The fixture here rebuilds
/// that exact chain.</p>
/// <p>The handler no longer resolves roles at all — it omits on the ROW's
/// <code>GRANTED_VIA</code> value, which the query has already computed — so this class of
/// defect is now structurally impossible at any chain depth. These tests pin BEHAVIOR, not
/// mechanism, which is why they survived that reimplementation unchanged; both were
/// re-mutation-verified RED against the row-filter implementation rather than being trusted
/// because they stayed green across it (Rule #59).</p>
/// <p><b>The asymmetry worth pinning.</b> A ROLE grantee holding <code>%All</code> via
/// <code>GrantedRoles</code> emits ZERO <code>SuperUser</code> rows (live-probed three times:
/// 11 rows, 0 derived), and so does the literal <code>%All</code> role itself. Nothing is
/// omitted for them, and because the response fields are gated on a non-zero omitted count,
/// they correctly receive the untouched pre-Story-35.4 shape.
/// <method>TestRoleHoldingAllViaGrantedRolesIsUntouched</method> pins exactly that.</p>
/// <p><b>Fixtures are disposable security principals</b> and are removed in BOTH
/// <method>OnBeforeOneTest</method> and <method>OnAfterOneTest</method> — teardown is not
/// guaranteed to run (<class>%UnitTest.Manager</class> skips it when setup errors, and an
/// aborted run skips it too), so setup-side cleanup makes every test order-independent and
/// self-healing after a killed run. They are never granted any resource: the chain exists only
/// to make <code>%All</code> reachable indirectly.</p>
Class ExecuteMCPv2.Tests.SqlPrivilegeBoundTest Extends %UnitTest.TestCase
{

Parameter INNERROLE = "Story354InnerRole";

Parameter OUTERROLE = "Story354OuterRole";

Parameter CHAINUSER = "Story354ChainUser";

/// Remove any fixture left behind by an aborted run, then build the chain fresh.
Method OnBeforeOneTest() As %Status
{
    Do ..DropFixture()
    Do ..BuildFixture()
    Quit $$$OK
}

Method OnAfterOneTest() As %Status
{
    Do ..DropFixture()
    Quit $$$OK
}

/// user -> OUTERROLE -> INNERROLE -> %All (three levels of indirection).
Method BuildFixture() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Do ##class(Security.Roles).Create(..#INNERROLE, "Story 35.4 test fixture", "", "%All")
        Do ##class(Security.Roles).Create(..#OUTERROLE, "Story 35.4 test fixture", "", ..#INNERROLE)
        Do ##class(Security.Users).Create(..#CHAINUSER, ..#OUTERROLE, "Story354FixturePw", "Story 35.4 test fixture")
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

Method DropFixture() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        If ##class(Security.Users).Exists(..#CHAINUSER) { Do ##class(Security.Users).Delete(..#CHAINUSER) }
        If ##class(Security.Roles).Exists(..#OUTERROLE) { Do ##class(Security.Roles).Delete(..#OUTERROLE) }
        If ##class(Security.Roles).Exists(..#INNERROLE) { Do ##class(Security.Roles).Delete(..#INNERROLE) }
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("SqlPrivilege", "Port"))
    If tPort > 0 Quit tPort
    Set tPort = 52773
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.Startup).Get(.tProps)
        If $$$ISOK(tSC) && (+$Get(tProps("WebServerPort")) > 0) { Set tPort = +tProps("WebServerPort") }
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Quit tPort
}

/// GET the deployed sqlprivilege route; returns the envelope's <code>result</code> object.
Method GetPrivileges(pQuery As %String, Output pHttpStatus As %Integer) As %DynamicObject
{
    Set tResult = ""
    Set pHttpStatus = 0
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Get(^UnitTestConfig("SqlPrivilege", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("SqlPrivilege", "Password"), "SYS")
        Set tRequest.Timeout = 120
        Set tSC = tRequest.Get("/api/executemcp/v2/security/sqlprivilege?"_pQuery)
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set tEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
        Set tResult = tEnvelope.%Get("result")
        Quit
    }
    Catch ex {
        Set tResult = ""
    }
    Quit tResult
}

/// Count rows in a privileges array whose grantedVia equals pVia.
Method CountVia(pPrivileges As %DynamicArray, pVia As %String) As %Integer
{
    Set tCount = 0
    If '$IsObject(pPrivileges) Quit 0
    For tI = 0:1:pPrivileges.%Size() - 1 {
        If pPrivileges.%Get(tI).%Get("grantedVia") = pVia Set tCount = tCount + 1
    }
    Quit tCount
}

/// AC 35.4.4 / review Finding A — a capped response must still report the EXACT
/// number of derived rows omitted, not however many were seen before the cap fired.
/// The expected value is taken from the SAME instance's uncapped call, so this is an
/// invariant rather than a hardcoded figure, and it goes red the moment the cap's
/// loop-exit stops the omitted-count accumulating.
Method TestOmittedCountStaysExactWhenCapped()
{
    Set tFull = ..GetPrivileges("grantee=_SYSTEM", .tHttp1)
    Do $$$AssertEquals(tHttp1, 200, "uncapped _SYSTEM listing returns HTTP 200")
    Do $$$AssertTrue($IsObject(tFull), "uncapped _SYSTEM listing returned a result object")
    If '$IsObject(tFull) Quit
    Set tOmittedFull = +tFull.%Get("superUserPrivilegesOmitted")
    Do $$$AssertTrue(tOmittedFull > 1000, "_SYSTEM holds %All, so a large derived-row count is omitted (got "_tOmittedFull_")")
    Do $$$AssertTrue('tFull.%IsDefined("rowsCapped"), "_SYSTEM's real grants fit under the default cap, so no rowsCapped")

    Set tCapped = ..GetPrivileges("grantee=_SYSTEM&maxRows=3", .tHttp2)
    Do $$$AssertEquals(tHttp2, 200, "capped _SYSTEM listing returns HTTP 200")
    If '$IsObject(tCapped) Quit
    Do $$$AssertEquals(+tCapped.%Get("count"), 3, "maxRows=3 materializes exactly 3 real rows")
    Do $$$AssertTrue(tCapped.%IsDefined("rowsCapped"), "a capped response signals rowsCapped")
    Do $$$AssertEquals(+tCapped.%Get("superUserPrivilegesOmitted"), tOmittedFull, "the omitted-count is the EXACT total even when the cap engages (review Finding A)")
}

/// AC 35.4.4 / review Finding B — %All reached through a nested GrantedRoles chain
/// must short-circuit exactly as a direct holder does. Pre-fix this grantee received
/// the full derived cross-product with no reason field at all.
Method TestIndirectAllChainIsShortCircuited()
{
    Set tRes = ..GetPrivileges("grantee="_..#CHAINUSER, .tHttp)
    Do $$$AssertEquals(tHttp, 200, "indirect-%All chain listing returns HTTP 200")
    Do $$$AssertTrue($IsObject(tRes), "indirect-%All chain listing returned a result object")
    If '$IsObject(tRes) Quit
    Do $$$AssertTrue(tRes.%IsDefined("reason"), "a user reaching %All through a nested role chain is short-circuited (review Finding B)")
    Do $$$AssertTrue(+tRes.%Get("superUserPrivilegesOmitted") > 1000, "the derived cross-product is omitted, not enumerated")
    Do $$$AssertEquals(..CountVia(tRes.%Get("privileges"), "SuperUser"), 0, "no SuperUser-derived row survives into privileges")
}

/// A ROLE grantee holding %All via GrantedRoles emits zero derived rows, so nothing
/// is omitted and the response must stay in its untouched pre-Story-35.4 shape. This
/// is the asymmetry in the row signal: effective %All does NOT imply derived rows for
/// every grantee shape, and the response fields are gated on rows actually omitted
/// rather than on any judgement about the grantee.
Method TestRoleHoldingAllViaGrantedRolesIsUntouched()
{
    Set tRes = ..GetPrivileges("grantee="_..#INNERROLE, .tHttp)
    Do $$$AssertEquals(tHttp, 200, "role-grantee listing returns HTTP 200")
    Do $$$AssertTrue($IsObject(tRes), "role-grantee listing returned a result object")
    If '$IsObject(tRes) Quit
    Do $$$AssertTrue('tRes.%IsDefined("reason"), "a role holding %All via GrantedRoles draws no derived rows, so no short-circuit reason")
    Do $$$AssertTrue('tRes.%IsDefined("superUserPrivilegesOmitted"), "and no omitted-count field")
    Do $$$AssertEquals(..CountVia(tRes.%Get("privileges"), "SuperUser"), 0, "the underlying query emits no SuperUser rows for this grantee shape")
}

/// AC 35.4.5 — a non-%All grantee under the cap gets the pre-Story-35.4 shape:
/// exactly grantee/level/privileges/count, and none of the three new fields.
Method TestNonSuperUserResponseShapeIsUnchanged()
{
    Set tRes = ..GetPrivileges("grantee=%25Developer", .tHttp)
    Do $$$AssertEquals(tHttp, 200, "%Developer control returns HTTP 200")
    Do $$$AssertTrue($IsObject(tRes), "%Developer control returned a result object")
    If '$IsObject(tRes) Quit
    Do $$$AssertTrue('tRes.%IsDefined("rowsCapped"), "under-cap control carries no rowsCapped")
    Do $$$AssertTrue('tRes.%IsDefined("reason"), "non-%All control carries no reason")
    Do $$$AssertTrue('tRes.%IsDefined("superUserPrivilegesOmitted"), "non-%All control carries no omitted-count")
    Set tKeys = 0
    Set tIter = tRes.%GetIterator()
    While tIter.%GetNext(.tKey, .tVal) { Set tKeys = tKeys + 1 }
    Do $$$AssertEquals(tKeys, 4, "exactly the pre-35.4 keys: grantee, level, privileges, count")
    Do $$$AssertEquals(+tRes.%Get("count"), tRes.%Get("privileges").%Size(), "count agrees with the materialized row count")
}

/// AC 35.4.1/35.4.3 — the cap fires on an ordinary non-%All grantee too, and a
/// degenerate maxRows falls back to the documented default rather than returning
/// nothing (mirrors the AuditStatus clamp idiom).
Method TestCapFiresAndDegenerateMaxRowsClamps()
{
    Set tCapped = ..GetPrivileges("grantee=%25Developer&maxRows=2", .tHttp1)
    Do $$$AssertEquals(tHttp1, 200, "capped control returns HTTP 200")
    If '$IsObject(tCapped) Quit
    Do $$$AssertEquals(+tCapped.%Get("count"), 2, "maxRows=2 materializes exactly 2 rows for a non-%All grantee")
    Do $$$AssertTrue(tCapped.%IsDefined("rowsCapped"), "the cap signals rowsCapped on the non-%All path as well")

    Set tZero = ..GetPrivileges("grantee=%25Developer&maxRows=0", .tHttp2)
    Do $$$AssertEquals(tHttp2, 200, "maxRows=0 returns HTTP 200")
    If '$IsObject(tZero) Quit
    Do $$$AssertTrue(+tZero.%Get("count") > 2, "maxRows=0 clamps to the 100-row default rather than returning an empty list")
    Do $$$AssertTrue('tZero.%IsDefined("rowsCapped"), "the clamped default is not a cap for this grantee")
}

}
