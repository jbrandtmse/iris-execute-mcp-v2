/// Regression tests for global subscript-level mapping handling in
/// <class>ExecuteMCPv2.REST.Config</class>.
/// <p>Guards against the defect documented in
/// <code>docs/known-bugs-2026-05-29-mapping-subscript.md</code>: the
/// <code>iris_mapping_manage</code> handler ignored the <code>subscript</code>
/// parameter and operated on the base global instead of the subscript node,
/// silently remapping base globals such as <code>%SYS</code>.</p>
/// <p>These tests cover the handler's own decision logic, fast and
/// deterministically:</p>
/// <ul>
/// <li><method>ExecuteMCPv2.REST.Config.BuildMappingName</method> — composes the
/// effective mapped name (subscript encoded into the name) and validates the
/// subscript syntax.</li>
/// <li><method>ExecuteMCPv2.REST.Config.IsGuardedBaseMapping</method> — the
/// %-prefixed base-global safety guard.</li>
/// </ul>
/// <p>The end-to-end create/delete round-trip through <class>Config.MapGlobals</class>
/// is verified separately against the live REST endpoint (it mutates the CPF and
/// is too slow for the fast unit suite). See the story dev notes / live
/// verification log.</p>
Class ExecuteMCPv2.Tests.MappingTest Extends %UnitTest.TestCase
{

/// Constructor — must accept and forward initvalue to the parent.
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// BuildMappingName: a single-subscript global composes name + subscript.
Method TestBuildNameSingleSubscript() As %Status
{
    Set tEff = ..ComposeInSys("global", "%SYS", "(""HealthShare"")", .tSC)
    Do $$$AssertStatusOK(tSC, "Valid single subscript should compose successfully")
    Do $$$AssertEquals(tEff, "%SYS(""HealthShare"")", "Effective name must embed the subscript")
    Quit $$$OK
}

/// BuildMappingName: a subscript range composes name + range.
Method TestBuildNameRangeSubscript() As %Status
{
    Set tEff = ..ComposeInSys("global", "GTEST", "(1):(100)", .tSC)
    Do $$$AssertStatusOK(tSC, "Valid range subscript should compose successfully")
    Do $$$AssertEquals(tEff, "GTEST(1):(100)", "Effective name must embed the range subscript")
    Quit $$$OK
}

/// BuildMappingName: no subscript leaves the base name unchanged.
Method TestBuildNameNoSubscript() As %Status
{
    Set tEff = ..ComposeInSys("global", "GTEST", "", .tSC)
    Do $$$AssertStatusOK(tSC, "Empty subscript should be OK")
    Do $$$AssertEquals(tEff, "GTEST", "No subscript means the base name is returned unchanged")
    Quit $$$OK
}

/// BuildMappingName: an invalid subscript is rejected with an error status.
Method TestBuildNameInvalidSubscript() As %Status
{
    Do ..ComposeInSys("global", "GTEST", "garbage[[", .tSC)
    Do $$$AssertStatusNotOK(tSC, "Malformed subscript should be rejected")
    Quit $$$OK
}

/// BuildMappingName: routine mappings ignore the subscript entirely.
Method TestBuildNameRoutineIgnoresSubscript() As %Status
{
    Set tEff = ..ComposeInSys("routine", "MyRoutine", "(""X"")", .tSC)
    Do $$$AssertStatusOK(tSC, "Routine mapping name composition should succeed")
    Do $$$AssertEquals(tEff, "MyRoutine", "Routine mappings must ignore subscript")
    Quit $$$OK
}

/// Guard: a base mapping for a %-prefixed global without force is guarded.
Method TestGuardBlocksBasePercentGlobal() As %Status
{
    Set tGuarded = ##class(ExecuteMCPv2.REST.Config).IsGuardedBaseMapping("global", "%SYS", "%SYS", 0)
    Do $$$AssertTrue(tGuarded, "Base %-global mapping without force must be guarded")
    Quit $$$OK
}

/// Guard: force=true bypasses the guard for a base %-global.
Method TestGuardAllowsWithForce() As %Status
{
    Set tGuarded = ##class(ExecuteMCPv2.REST.Config).IsGuardedBaseMapping("global", "%SYS", "%SYS", 1)
    Do $$$AssertTrue('tGuarded, "force=true must bypass the base %-global guard")
    Quit $$$OK
}

/// Guard: a subscript-level %-mapping (eff name differs) is never guarded.
Method TestGuardAllowsSubscriptNode() As %Status
{
    Set tGuarded = ##class(ExecuteMCPv2.REST.Config).IsGuardedBaseMapping("global", "%SYS", "%SYS(""HealthShare"")", 0)
    Do $$$AssertTrue('tGuarded, "Subscript-level %-mapping must not be guarded")
    Quit $$$OK
}

/// Guard: a non-%-prefixed base global mapping is never guarded.
Method TestGuardAllowsNonPercentBase() As %Status
{
    Set tGuarded = ##class(ExecuteMCPv2.REST.Config).IsGuardedBaseMapping("global", "MyGlobal", "MyGlobal", 0)
    Do $$$AssertTrue('tGuarded, "Non-%-prefixed base mapping must not be guarded")
    Quit $$$OK
}

/// Helper: call BuildMappingName from the %SYS namespace (its validator lives
/// there) and ALWAYS restore the caller's namespace. Returns the effective
/// name; the %Status is returned by reference in <var>pSC</var>. The caller's
/// own namespace is never disturbed, so a failed assertion cannot strand the
/// %UnitTest manager.
ClassMethod ComposeInSys(pType As %String, pName As %String, pSubscript As %String, Output pSC As %Status) As %String [ Internal ]
{
    Set tOrig = $NAMESPACE
    Set tEff = pName
    Set pSC = $$$OK
    Try {
        Set $NAMESPACE = "%SYS"
        Set pSC = ##class(ExecuteMCPv2.REST.Config).BuildMappingName(pType, pName, pSubscript, 5, .tEff)
    }
    Catch ex {
        Set pSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrig
    Quit tEff
}

}
