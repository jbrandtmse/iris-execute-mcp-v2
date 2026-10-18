/// Unit tests for the TestProduction guard of <class>ExecuteMCPv2.REST.UnitTest</class> (Story 40.3).
/// <p>Covers the pure decision <method>ExecuteMCPv2.REST.UnitTest:GuardOutcome</method> (every row of its table), the
/// test discovery <method>ExecuteMCPv2.REST.UnitTest:TestProductions</method> and the guard
/// <method>ExecuteMCPv2.REST.UnitTest:ProductionGuard</method> on runs that hold no TestProduction test, and the coverage
/// <method>ExecuteMCPv2.REST.Coverage:ValidateStart</method> rule that keeps a target with an empty class part away from it.
/// This class starts no production and defines no TestProduction class: a TestProduction subclass in this
/// namespace would stop a running production when it ran (the live gate covers the positive cases in a disposable
/// namespace).</p>
Class ExecuteMCPv2.Tests.ProductionGuardTest Extends %UnitTest.TestCase
{

/// One run's TestProduction list: a single test whose production is <var>pProduction</var>.
ClassMethod One(pProduction As %String) As %List [ Private ]
{
    Quit $ListBuild($ListBuild("Story403.PassTest", pProduction))
}

/// No TestProduction test: the answer is proceed whatever the state, and nothing is read.
Method TestGuardOutcomeNoTests()
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome("", 0, "", ""), "proceed", "no tests, state not asked")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome("", 1, 1, "Other"), "proceed", "no tests, another production running")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome("", 1, 2, ""), "proceed", "no tests, stopped")
}

/// Tests present and the state not read (lock, error or exception): busy.
Method TestGuardOutcomeStateNotRead()
{
    Set tTests = ..One("A.Prod")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 0, "", ""), "busy", "state not read")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 0, 2, "A.Prod"), "busy", "state not read, even if values were left behind")
}

/// Tests present and the namespace's production stopped (2, or -2 on a mirror backup member): proceed.
Method TestGuardOutcomeStopped()
{
    Set tTests = ..One("A.Prod")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 1, 2, ""), "proceed", "stopped, no production name")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 1, -2, ""), "proceed", "mirror backup stopped")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 1, 2, "Other"), "proceed", "stopped, a stale name")
}

/// Tests present, a production running, and it is one of the tests' own: proceed.
Method TestGuardOutcomeOwnProduction()
{
    Set tTests = $ListBuild($ListBuild("A.OneTest", "A.Prod"), $ListBuild("A.TwoTest", "B.Prod"))
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 1, 1, "A.Prod"), "proceed", "running, first own production")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 1, 1, "B.Prod"), "proceed", "running, second own production")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 1, 4, "A.Prod"), "proceed", "troubled, own production")
}

/// Tests present, a production running, and it is not one of the tests' own: busy, in every non-stopped state.
Method TestGuardOutcomeForeignProduction()
{
    Set tTests = ..One("A.Prod")
    For tState = 0, 1, 3, 4, 5, 6 {
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 1, tState, "Other"), "busy", "state "_tState_", another production")
    }
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 1, 1, "A.Prod2"), "busy", "a name that only starts like an own production")
}

/// An empty production name never matches, even when a test's own production is empty.
Method TestGuardOutcomeEmptyName()
{
    Set tTests = ..One("")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(tTests, 1, 1, ""), "busy", "empty name, empty own production")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).GuardOutcome(..One("A.Prod"), 1, 3, ""), "busy", "empty name, suspended")
}

/// A class-level and a method-level target that is not a TestProduction test has no TestProduction tests.
Method TestTestProductionsClassAndMethod()
{
    Set tClass = "ExecuteMCPv2.Tests.UnitTestTest"
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions(tClass, "class", 1), "", "class level, run compiles")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions(tClass, "class", 0), "", "class level, compiled only")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions(tClass_":TestX", "method", 1), "", "method level")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions(" "_tClass_" : TestX", "method", 0), "", "method level, padded segments")
}

/// A class that is neither compiled nor defined, an invalid name and an empty class segment are not TestProduction tests.
Method TestTestProductionsMissingClass()
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions("ExecuteMCPv2.Tests.NoSuchClassAnywhere", "class", 1), "", "missing class")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions("ExecuteMCPv2.Tests.NoSuchClassAnywhere:TestX", "method", 0), "", "missing class, method level")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions("not a class name", "class", 1), "", "invalid name")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions(":TestX", "method", 1), "", "empty class segment")
}

/// The project's own test package holds no TestProduction subclass, so a package-level run of it is never guarded.
Method TestTestProductionsPackage()
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions("ExecuteMCPv2.Tests", "package", 1), "", "ExecuteMCPv2.Tests, run compiles")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions("ExecuteMCPv2.Tests", "package", 0), "", "ExecuteMCPv2.Tests, compiled only")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.UnitTest).TestProductions("NoSuchPackageAnywhere", "package", 1), "", "a package with no classes")
}

/// <method>ResolveTest</method> on classes that exist: the root answers yes with an empty production, other system
/// classes answer no, whichever way the class is resolved.
Method TestResolveTestSystemClasses()
{
    Kill tSeen
    Set tCount = 0
    Do $$$AssertTrue(##class(ExecuteMCPv2.REST.UnitTest).ResolveTest("%UnitTest.TestProduction", 1, .tSeen, .tCount, .tProduction), "the root is a TestProduction")
    Do $$$AssertEquals(tProduction, "", "the root declares no production")
    For tCompiles = 0, 1 {
        For tClass = "%UnitTest.TestCase", "%Library.RegisteredObject", "ExecuteMCPv2.REST.UnitTest", "ExecuteMCPv2.Tests.UnitTestTest" {
            Kill tSeen
            Set tCount = 0
            Do $$$AssertTrue('##class(ExecuteMCPv2.REST.UnitTest).ResolveTest(tClass, tCompiles, .tSeen, .tCount, .tProduction), tClass_" is not a TestProduction (compiles="_tCompiles_")")
            Do $$$AssertEquals(tProduction, "", tClass_" has no production")
        }
    }
}

/// A run with no TestProduction test is proceed, in the current namespace, and reads nothing: the result holds no
/// production, state, state code or error.
Method TestProductionGuardPlainTarget()
{
    For tCompiles = 0, 1 {
        Set tSC = ##class(ExecuteMCPv2.REST.UnitTest).ProductionGuard("ExecuteMCPv2.Tests.UnitTestTest", "class", tCompiles, .tResult)
        Do $$$AssertStatusOK(tSC, "the guard succeeds (compiles="_tCompiles_")")
        Do $$$AssertEquals(tResult.%Get("decision"), "proceed", "decision")
        Do $$$AssertEquals(tResult.%Get("namespace"), $NAMESPACE, "namespace")
        Do $$$AssertEquals(tResult.%Get("testProductions").%Size(), 0, "no TestProduction tests")
        Do $$$AssertTrue('tResult.%IsDefined("stateCode"), "no state code: the state was not read")
        Do $$$AssertTrue('tResult.%IsDefined("state") && '(tResult.%IsDefined("production")) && '(tResult.%IsDefined("error")), "no state, production or error")
    }
    Set tSC = ##class(ExecuteMCPv2.REST.UnitTest).ProductionGuard("ExecuteMCPv2.Tests", "package", 1, .tResult)
    Do $$$AssertStatusOK(tSC, "the guard succeeds at package level")
    Do $$$AssertEquals(tResult.%Get("decision"), "proceed", "package level decision")
    Do $$$AssertTrue('tResult.%IsDefined("stateCode"), "package level: no state code")
}

/// The Start request for <var>pTarget</var>, with every other field valid, run through
/// <method>ExecuteMCPv2.REST.Coverage:ValidateStart</method>. Nothing is started.
ClassMethod ValidateTarget(pTarget As %String, Output pParams) As %Status [ Private ]
{
    Set tBody = {}
    Do tBody.%Set("target", pTarget)
    Do tBody.%Set("level", "class")
    Do tBody.%Set("classes", ["ExecuteMCPv2.Tests.UnitTestTest"])
    Do tBody.%Set("maxSeconds", 3600, "number")
    Do tBody.%Set("maxLines", 200000, "number")
    Quit ##class(ExecuteMCPv2.REST.Coverage).ValidateStart(tBody, .pParams)
}

/// A coverage target whose package or class part (before the first colon) is empty is refused by the validation, before
/// any namespace switch, run record or session: the runner reads the spec <code>::</code> as every compiled test class
/// under <code>^UnitTestRoot</code>, and the TestProduction guard asks about the class part, which is empty.
Method TestValidateStartRejectsAnEmptyClassPart()
{
    For tTarget = ":", ":TestControl", "::", ":A:B", " :TestControl", $Char(9)_":TestControl" {
        Kill tParams
        Set tSC = ..ValidateTarget(tTarget, .tParams)
        Do $$$AssertStatusNotOK(tSC, "'"_tTarget_"' has no package or class part")
        Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "must start with a package or class name", "the error says what is missing for '"_tTarget_"'")
        Do $$$AssertTrue('$Data(tParams("target")), "no target is returned for '"_tTarget_"'")
    }
    For tTarget = "ExecuteMCPv2.Tests.UnitTestTest", "ExecuteMCPv2.Tests.UnitTestTest:TestX", "%UnitTest.TestCase", "ExecuteMCPv2.Tests" {
        Kill tParams
        Set tSC = ..ValidateTarget(tTarget, .tParams)
        Do $$$AssertStatusOK(tSC, "'"_tTarget_"' names a package or class")
        Do $$$AssertEquals($Get(tParams("target")), tTarget, "the target is returned as given for '"_tTarget_"'")
    }
}

}
