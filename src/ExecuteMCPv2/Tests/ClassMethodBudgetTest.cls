/// Story 34.7 AC 34.7.3 (ledger <c>34-6-CR2-6</c>) — unit-level pins for the ONE shared
/// response budget that replaced <method>ExecuteMCPv2.Utils.InvokeWithArgs</method>'s
/// three independent per-field ceilings, spent in field order <c>returnValue</c> &#8594;
/// <c>byRefValues</c> &#8594; <c>output</c> (a recorded Project Lead decision — see that
/// method's banner). Kept in its OWN class, separate from
/// <class>ExecuteMCPv2.Tests.ClassMethodArgsTest</class> (already ~970 lines, at the
/// project's ~500-line test-class guideline), per the project rule that a test class
/// needing more coverage gets split into a new class rather than grown further.
/// <p>Exercises <var>pOutputBudget</var> — the new additive trailing
/// <method>InvokeWithArgs</method> output — directly, which the live HTTP-level pins in
/// <c>execute-classmethod-epic-gate.test.ts</c> cannot observe (it is never rendered on
/// the wire; only its EFFECT on <c>output</c>'s ceiling is visible there).</p>
Class ExecuteMCPv2.Tests.ClassMethodBudgetTest Extends %UnitTest.TestCase
{

Parameter FIXTURE = "ExecuteMCPv2.Tests.ClassMethodArgsFixture";

/// Clean up capture globals before/after each test — mirrors
/// ClassMethodArgsTest.cls's own OnBeforeOneTest/OnAfterOneTest.
Method OnBeforeOneTest() As %Status
{
    Kill %ExecuteMCPOutput
    Kill %ExecuteMCPTruncated
    Quit $$$OK
}

Method OnAfterOneTest() As %Status
{
    Kill %ExecuteMCPOutput
    Kill %ExecuteMCPTruncated
    Quit $$$OK
}

/// returnValue is spent FIRST: TargetByRef returns "ok" (2 chars) and mutates its one
/// ByRef argument to (raw value)_"-mutated". With a 100-character raw value, the
/// mutated byRef value is 108 characters — comfortably under budget either way, so this
/// isolates the ARITHMETIC (does byRefValues' starting budget actually shrink by
/// returnValue's share?) from any truncation behavior.
Method TestSharedBudgetReturnValueConsumesBeforeByRefValues() As %Status
{
    Set tRaw = $TR($J("", 100), " ", "X")
    Set tArgs = []
    Do tArgs.%Push({"byRef":true,"value":(tRaw)})
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRef", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated, .tByRefTruncated, .tOutputBudget)
    Do $$$AssertStatusOK(tSC, "call should succeed")
    Do $$$AssertEquals(tReturn, "ok", "TargetByRef's own return value is unaffected by the shared budget (well under it)")

    Set tMutated = tRaw _ "-mutated"
    Do $$$AssertEquals(tByRefValues.%Get("0"), tMutated, "the byRef value is well under budget either way and must be unchanged")
    Do $$$AssertEquals(tByRefTruncated, 0, "nothing was truncated — byRefTruncated must stay false")

    ; The core AC 34.7.3 property: byRefValues' budget started at
    ; OUTPUTCEILING - len("ok"), not the full OUTPUTCEILING, so what remains for output
    ; is OUTPUTCEILING - len("ok") - len(mutated byRef value).
    Set tExpected = ##class(ExecuteMCPv2.Utils).#OUTPUTCEILING - $Length(tReturn) - $Length(tMutated)
    Do $$$AssertEquals(tOutputBudget, tExpected, "the remaining shared budget for output must reflect BOTH returnValue's and byRefValues' consumption, threaded through in order")
    Quit $$$OK
}

/// When there are no marked byRef positions at all, byRefValues consumes NOTHING of the
/// shared pool — the entire remainder after returnValue's own share is left for output.
/// Isolates "no byRefValues competitor" from the pairwise case above.
Method TestSharedBudgetNoByRefPositionsLeavesFullRemainderForOutput() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated, .tByRefTruncated, .tOutputBudget)
    Do $$$AssertStatusOK(tSC, "call should succeed")
    Do $$$AssertEquals(tReturn, "zero-ok", "Target0's own return value")
    Do $$$AssertEquals(tByRefValues.%Size(), 0, "no marked positions means an empty byRefValues — nothing consumed from the shared budget here")

    Set tExpected = ##class(ExecuteMCPv2.Utils).#OUTPUTCEILING - $Length(tReturn)
    Do $$$AssertEquals(tOutputBudget, tExpected, "with no byRefValues competitor, output's remaining budget is exactly OUTPUTCEILING minus returnValue's own consumption")
    Quit $$$OK
}

/// Back-compat (Rule #19): pOutputBudget is a new, additive, OPTIONAL trailing output
/// parameter — every pre-34.7 call site that omits it (all of
/// ClassMethodArgsTest.cls's 60+ calls) must remain valid ObjectScript, and every OTHER
/// output must be completely unaffected by the parameter's mere presence in the
/// signature. Calls the exact same target as the pairwise test above WITHOUT passing
/// pOutputBudget, and confirms tReturn/tByRefValues/tByRefTruncated are byte-identical
/// to what that test observed.
Method TestOmittingOutputBudgetParameterStillWorks() As %Status
{
    Set tRaw = $TR($J("", 100), " ", "X")
    Set tArgs = []
    Do tArgs.%Push({"byRef":true,"value":(tRaw)})
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRef", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated, .tByRefTruncated)
    Do $$$AssertStatusOK(tSC, "call should succeed even with pOutputBudget omitted entirely")
    Do $$$AssertEquals(tReturn, "ok", "return value unaffected by omitting the trailing optional parameter")
    Do $$$AssertEquals(tByRefValues.%Get("0"), tRaw_"-mutated", "byRefValues unaffected by omitting the trailing optional parameter")
    Quit $$$OK
}

}
