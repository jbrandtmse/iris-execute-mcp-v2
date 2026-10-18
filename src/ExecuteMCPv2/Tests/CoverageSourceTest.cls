/// Unit tests for the class-source map, the <code>minCoverage</code> request field and the loaded-routines check of
/// <class>ExecuteMCPv2.Coverage.Job</class> and <class>ExecuteMCPv2.REST.Coverage</class> (Story 40.2).
/// <p>No test here starts a Line-by-Line session or terminates a process. The map is read from the compiled test
/// fixture <class>ExecuteMCPv2.Tests.CoverageSourceFixture</class> (the body of the live gate's <code>Story402.Fixture</code>
/// under its own name). The expected values are the live capture of <code>SourceMap</code> on that fixture, IRIS 2026.2
/// build 221U, 2026-10-18: INT line numbers are the compiler's own, so the fixture's text must not change.</p>
Class ExecuteMCPv2.Tests.CoverageSourceTest Extends %UnitTest.TestCase
{

/// The disposable class that the not-up-to-date test compiles and then changes.
Parameter STALECLASS = "ExecuteMCPv2.Temp.Story402Stale";

/// The id of the fake run whose record the <code>RecordUnstoppedSession</code> tests write, far above any real run id. The
/// session node of a fake run is written only while no session node exists, and is removed again.
Parameter FAKERUN = 990000003;

Method OnAfterOneTest(testname As %String) As %Status
{
    Do $System.OBJ.Delete(..#STALECLASS, "-d")
    Kill ^IRIS.TempExecuteMCPv2Coverage("run", ..#FAKERUN)
    Set tNodeId = $ListGet($Get(^IRIS.TempExecuteMCPv2Coverage("session")), 1)
    If (tNodeId = ..#FAKERUN) || (tNodeId = (..#FAKERUN + 1)) Kill ^IRIS.TempExecuteMCPv2Coverage("session")
    Quit $$$OK
}

/// SourceMap of the fixture: for every method the class source defines, in document order, the declaration line, the
/// routine and the INT line of each body line (0 when that line has none), or the reason it has no body map.
Method TestSourceMapOfTheFixture() As %Status
{
    Set tClass = "ExecuteMCPv2.Tests.CoverageSourceFixture"
    Set tRoutine = tClass_".1"
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tClass, .tMap)
    Do $$$AssertStatusOK(tSC, "the fixture's map is built")
    Do $$$AssertEquals(tMap, $ListBuild(tClass, ""), "a class with a map has no class reason")
    Do ..AssertMethod(.tMap, 1, "ScoreSet", 11, tRoutine, "47 48", "")
    Do ..AssertMethod(.tMap, 2, "LabelGet", 17, tRoutine, "26", "")
    Do ..AssertMethod(.tMap, 3, "Plain", 22, tRoutine, "44 45", "")
    Do ..AssertMethod(.tMap, 4, "Macro", 28, tRoutine, "28 29 30 31 0 32 33", "")
    Do ..AssertMethod(.tMap, 5, "MultiLine", 39, tRoutine, "35 36 37 38 39 40 41 42", "")
    Do ..AssertMethod(.tMap, 6, "Sql", 51, tRoutine, "50 53 54 55", "")
    Do ..AssertMethod(.tMap, 7, "Generated", 59, "", "", "generator")
    Do ..AssertMethod(.tMap, 8, "Expr", 66, tRoutine, "21", "")
    Do ..AssertMethod(.tMap, 9, "Constant", 71, "", "0", "")
    Do ..AssertMethod(.tMap, 10, "Comments", 76, tRoutine, "15 16 17 18 19", "")
    Do ..AssertMethod(.tMap, 11, "TwoOnOne", 85, tRoutine, "66 67", "")
    Do $$$AssertEquals($Order(tMap("m", ""), -1), 11, "the fixture's own methods are all there is: the inherited and generated ones are not mapped")
    Quit $$$OK
}

/// Assert one method entry of a map: its head, and the INT lines of its body lines (a space-separated list).
Method AssertMethod(ByRef pMap, pIndex As %Integer, pName As %String, pLine As %Integer, pRoutine As %String, pLines As %String, pReason As %String)
{
    Do $$$AssertEquals($Get(pMap("m", pIndex)), $ListBuild(pName, pLine, pRoutine, pReason), pName_": name, declaration line, routine and reason")
    Set tActual = ""
    Set tK = ""
    For {
        Set tK = $Order(pMap("m", pIndex, tK))
        If tK = "" Quit
        Set tActual = tActual_$Select(tActual = "": "", 1: " ")_pMap("m", pIndex, tK)
    }
    Do $$$AssertEquals(tActual, pLines, pName_": the INT line of each body line")
}

/// A class whose definition changed after it was compiled has no class-source result: its compiled code no longer
/// matches its document. A class that is not compiled at all has none either, and the namespace switch is undone.
Method TestSourceMapWithoutAMap() As %Status
{
    Set tName = ..#STALECLASS
    Do ..MakeStaleClass(tName)
    Do $$$AssertEquals($System.OBJ.IsUpToDate(tName), 0, "the class changed after it was compiled")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "a stale class is a result, not an error")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "not-up-to-date"), "the class reason")
    Do $$$AssertEquals($Data(tMap("m")), 0, "no method is mapped")

    Set tHome = $NAMESPACE
    Kill tMap
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("%SYS", "ExecuteMCPv2.Temp.Story402Missing", .tMap)
    Do $$$AssertStatusOK(tSC, "a class that is not compiled is a result, not an error")
    Do $$$AssertEquals(tMap, $ListBuild("ExecuteMCPv2.Temp.Story402Missing", "not-compiled"), "the class reason")
    Do $$$AssertEquals($NAMESPACE, tHome, "the namespace is restored")
    Quit $$$OK
}

/// Compile a one-method class, then change its method and save without compiling.
ClassMethod MakeStaleClass(pName As %String)
{
    Set tDef = ##class(%Dictionary.ClassDefinition).%New()
    Set tDef.Name = pName
    Set tDef.Super = "%RegisteredObject"
    Set tMethod = ##class(%Dictionary.MethodDefinition).%New()
    Set tMethod.parent = tDef
    Set tMethod.Name = "Run"
    Set tMethod.ClassMethod = 1
    Set tMethod.ReturnType = "%Integer"
    Do tMethod.Implementation.WriteLine("    Quit 1")
    Set tSC = tDef.%Save()
    Set tSC = $System.OBJ.Compile(pName, "-d")
    Set tDef = ##class(%Dictionary.ClassDefinition).%OpenId(pName)
    Set tMethod = tDef.Methods.GetAt(1)
    Do tMethod.Implementation.Clear()
    Do tMethod.Implementation.WriteLine("    Quit 2")
    Set tSC = tDef.%Save()
}

/// The layout of a method: its declaration line D, with <code>{</code> on D+1 and <code>}</code> on D+2+n.
Method TestDeclarationLine() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"

    Kill tText
    Set tText(0) = 4
    Set tText(1) = "ClassMethod Foo() As %Integer"
    Set tText(2) = "{"
    Set tText(3) = "    Quit 1"
    Set tText(4) = "}"
    Do ..Declarations(.tText, .tDecl)
    Do $$$AssertEquals($ClassMethod(tJob, "DeclarationLine", .tText, .tDecl, "Foo", 1, .tOK), 1, "a method in the stored layout")
    Do $$$AssertEquals(tOK, 1, "its braces are where they should be")

    Kill tText
    Set tText(0) = 3
    Set tText(1) = "ClassMethod Foo() As %Integer"
    Set tText(2) = "    Quit 1"
    Set tText(3) = "}"
    Do ..Declarations(.tText, .tDecl)
    Do $$$AssertEquals($ClassMethod(tJob, "DeclarationLine", .tText, .tDecl, "Foo", 1, .tOK), 1, "the declaration is found even when the layout is not")
    Do $$$AssertEquals(tOK, 0, "no { on the next line")

    Kill tText
    Set tText(0) = 4
    Set tText(1) = "ClassMethod Foo() As %Integer"
    Set tText(2) = "{"
    Set tText(3) = "    Quit 1"
    Set tText(4) = "}"
    Do ..Declarations(.tText, .tDecl)
    Do $$$AssertEquals($ClassMethod(tJob, "DeclarationLine", .tText, .tDecl, "Foo", 2, .tOK), 1, "a body of 2 lines was expected")
    Do $$$AssertEquals(tOK, 0, "the closing brace is not on line D+2+n")

    ; a name declared twice: the one whose braces are where the layout says
    Kill tText
    Set tText(0) = 8
    Set tText(1) = "Method Foo()"
    Set tText(2) = "    Quit 1"
    Set tText(3) = "}"
    Set tText(4) = ""
    Set tText(5) = "ClassMethod Foo() As %Integer"
    Set tText(6) = "{"
    Set tText(7) = "    Quit 1"
    Set tText(8) = "}"
    Do ..Declarations(.tText, .tDecl)
    Do $$$AssertEquals($ClassMethod(tJob, "DeclarationLine", .tText, .tDecl, "Foo", 1, .tOK), 5, "two declarations, one valid")
    Do $$$AssertEquals(tOK, 1, "the valid one wins")

    Set tText(2) = "{"
    Set tText(3) = "    Quit 1"
    Set tText(4) = "}"
    Set tText(5) = "ClassMethod Foo() As %Integer"
    Do ..Declarations(.tText, .tDecl)
    Do $$$AssertEquals($ClassMethod(tJob, "DeclarationLine", .tText, .tDecl, "Foo", 1, .tOK), "", "two valid declarations cannot be told apart")
    Do $$$AssertEquals(tOK, 0, "so the layout is not trusted")

    Kill tText
    Set tText(0) = 3
    Set tText(1) = "{"
    Set tText(2) = "    Quit 1"
    Set tText(3) = "}"
    Do ..Declarations(.tText, .tDecl)
    Do $$$AssertEquals($ClassMethod(tJob, "DeclarationLine", .tText, .tDecl, "Foo", 1, .tOK), "", "a method that is not declared")
    Do $$$AssertEquals(tOK, 0, "has no layout")
    Quit $$$OK
}

/// IndexDeclarations indexes the lines that begin with Method or ClassMethod and a name, and nothing else.
Method TestIndexDeclarations() As %Status
{
    Set tText(0) = 7
    Set tText(1) = "Method Alpha(pA As %String) As %Status"
    Set tText(2) = "ClassMethod  Beta ()"
    Set tText(3) = "classmethod ""Gamma""(pX)"
    Set tText(4) = "    Method Indented()"
    Set tText(5) = "Property Method As %String;"
    Set tText(6) = "/// Method Doc()"
    Set tText(7) = "MethodX()"
    Do ..Declarations(.tText, .tDecl)
    Do $$$AssertEquals($Data(tDecl("Alpha", 1)), 1, "Method and a name")
    Do $$$AssertEquals($Data(tDecl("Beta", 2)), 1, "ClassMethod, extra spaces, a space before the arguments")
    Do $$$AssertEquals($Data(tDecl("Gamma", 3)), 1, "any letter case, and the quotes of a quoted name are dropped")
    Do $$$AssertEquals($Data(tDecl("Indented")), 0, "a line in a method body is not a declaration")
    Do $$$AssertEquals($Data(tDecl("Method")), 0, "a property is not a method")
    Do $$$AssertEquals($Data(tDecl("Doc")), 0, "a doc comment is not a declaration")
    Do $$$AssertEquals($Data(tDecl("MethodX")), 0, "a word that merely begins with Method is not")
    Quit $$$OK
}

Method Declarations(ByRef pText, Output pDecl)
{
    Do ##class(ExecuteMCPv2.Coverage.Job).IndexDeclarations(.pText, .pDecl)
}

/// minCoverage is optional, a number from 0 to 100, and JSON null means absent.
Method TestValidateStartMinCoverage() As %Status
{
    Set tRoute = "ExecuteMCPv2.REST.Coverage"
    Set tBase = "{""target"":""A.B"",""level"":""class"",""classes"":[""A.B""],""maxSeconds"":60,""maxLines"":1000"

    Set tSC = $ClassMethod(tRoute, "ValidateStart", {}.%FromJSON(tBase_"}"), .tParams)
    Do $$$AssertStatusOK(tSC, "a 40.1 request is unchanged")
    Do $$$AssertEquals(tParams("minCoverage"), "", "absent")

    Set tSC = $ClassMethod(tRoute, "ValidateStart", {}.%FromJSON(tBase_",""minCoverage"":null}"), .tParams)
    Do $$$AssertStatusOK(tSC, "null is absent")
    Do $$$AssertEquals(tParams("minCoverage"), "", "null is absent")

    Set tSC = $ClassMethod(tRoute, "ValidateStart", {}.%FromJSON(tBase_",""minCoverage"":0}"), .tParams)
    Do $$$AssertStatusOK(tSC, "0 is a minimum")
    Do $$$AssertEquals(tParams("minCoverage"), 0, "0 is kept, not read as absent")

    Set tSC = $ClassMethod(tRoute, "ValidateStart", {}.%FromJSON(tBase_",""minCoverage"":100}"), .tParams)
    Do $$$AssertStatusOK(tSC, "100 is a minimum")
    Do $$$AssertEquals(tParams("minCoverage"), 100, "100")

    Set tSC = $ClassMethod(tRoute, "ValidateStart", {}.%FromJSON(tBase_",""minCoverage"":79.995}"), .tParams)
    Do $$$AssertStatusOK(tSC, "a decimal is a minimum")
    Do $$$AssertEquals(tParams("minCoverage"), 79.995, "the decimal is kept exactly")

    For tBad = "100.5", "-1", "101", """x""", "true", "[1]" {
        Set tSC = $ClassMethod(tRoute, "ValidateStart", {}.%FromJSON(tBase_",""minCoverage"":"_tBad_"}"), .tParams)
        Do $$$AssertStatusNotOK(tSC, "minCoverage "_tBad_" is refused")
        Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "'minCoverage' must be a number from 0 to 100", "the error names the parameter and the range: "_tBad)
    }
    Quit $$$OK
}

/// A session that loaded fewer routines than the run listed can be proven, and so stopped by the supervisor or reclaimed by the
/// next start, only once the ownership node and the run record name the routines it loaded (WithRoutineList).
Method TestRewrittenOwnershipLetsTheSessionBeProven() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tListed = $ListBuild("Pkg.A.1", "Pkg.B.1")
    Set tLoaded = $ListBuild("Pkg.A.1")
    Set tNode = $ListBuild(7, 100, 200, "2026-10-18T00:00:00.000Z", tListed)
    Set tRewritten = $ClassMethod(tJob, "WithRoutineList", tNode, tLoaded)
    Do $$$AssertEquals(tRewritten, $ListBuild(7, 100, 200, "2026-10-18T00:00:00.000Z", tLoaded), "only the routine list of the node changes")

    Do $$$AssertEquals($ClassMethod(tJob, "NodeMatches", tNode, "100 200", 1), 0, "the original node does not match a session of one routine")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeMatches", tRewritten, "100 200", 1), 1, "the rewritten node does: the next start can reclaim the session")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeMatches", tRewritten, "300", 1), 0, "and still only for the run's own processes")

    Set tWhy = $ClassMethod(tJob, "ProofFailure", "100 200", 100, 100, 200, tListed, tLoaded)
    Do $$$AssertTrue(tWhy [ "not this run's routine list", "the original list does not prove the session: "_tWhy)
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "100 200", 100, 100, 200, tLoaded, tLoaded), "", "the rewritten list does")
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "100 200 300", 100, 100, 200, tLoaded, tLoaded)
    Do $$$AssertTrue(tWhy [ "neither this run's test process nor its supervisor", "a foreign process in the list still disproves it: "_tWhy)
    Quit $$$OK
}

/// LoadedRoutinesFailure is empty when the session loaded the run's routines (whatever the order), and otherwise names
/// the routines that were not loaded.
Method TestLoadedRoutinesFailure() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tRun = $ListBuild("Pkg.A.1", "Pkg.B.1")
    Do $$$AssertEquals($ClassMethod(tJob, "LoadedRoutinesFailure", tRun, tRun), "", "equal lists")
    Do $$$AssertEquals($ClassMethod(tJob, "LoadedRoutinesFailure", tRun, $ListBuild("Pkg.B.1", "Pkg.A.1")), "", "the order is ignored")

    Set tText = $ClassMethod(tJob, "LoadedRoutinesFailure", tRun, $ListBuild("Pkg.A.1"))
    Do $$$AssertTrue(tText [ "did not load routine Pkg.B.1", "one missing is named: "_tText)
    Do $$$AssertTrue(tText '[ "Pkg.A.1", "the routine that was loaded is not named: "_tText)

    Set tText = $ClassMethod(tJob, "LoadedRoutinesFailure", tRun, "")
    Do $$$AssertTrue((tText [ "Pkg.A.1, Pkg.B.1") && (tText [ "did not load routines"), "all missing are named: "_tText)

    Set tText = $ClassMethod(tJob, "LoadedRoutinesFailure", tRun, tRun_$ListBuild("Other.1"))
    Do $$$AssertTrue(tText [ "loaded routine Other.1 that the run did not list", "an extra routine is named: "_tText)

    Set tText = $ClassMethod(tJob, "LoadedRoutinesFailure", tRun, $ListBuild("Pkg.A.1", ""))
    Do $$$AssertTrue((tText [ "did not load routine Pkg.B.1") && (tText [ "a name that could not be read"), "an unreadable name is an extra: "_tText)
    Do $$$AssertEquals($Extract(tText, *), ".", "the text ends the sentence, so the runner can append to it")
    Quit $$$OK
}

/// SessionScopeFailure(pids, self, supervisor, runner) is the scope part of the proof of a session: it is all there is
/// to prove of a session that monitors no routine, and it is the first part of ProofFailure, with the same texts.
Method TestSessionScopeFailure() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tNotScoped = "The active monitor session is not scoped to listed processes."
    Set tNotListed = "The active monitor session does not list this process."
    Set tForeign = "The active monitor session lists a process that is neither this run's test process nor its supervisor."
    Set tNoNames = "This process could not read the routine names of the active monitor session."

    Do $$$AssertEquals($ClassMethod(tJob, "SessionScopeFailure", "100 200", 200, 100, 200), "", "the runner: both processes alive and listed")
    Do $$$AssertEquals($ClassMethod(tJob, "SessionScopeFailure", "200", 200, 100, 200), "", "the runner: the supervisor has ended and left the list")
    Do $$$AssertEquals($ClassMethod(tJob, "SessionScopeFailure", "200 100", 100, 100, 200), "", "the order of the list does not matter")
    Do $$$AssertEquals($ClassMethod(tJob, "SessionScopeFailure", "", 200, 100, 200), tNotScoped, "an empty list is a session of all processes or a paused one")
    Do $$$AssertEquals($ClassMethod(tJob, "SessionScopeFailure", "100", 200, 100, 200), tNotListed, "a list that names only the other process")
    Do $$$AssertEquals($ClassMethod(tJob, "SessionScopeFailure", "100 200", "", 100, 200), tNotListed, "no process id for this process")
    Do $$$AssertEquals($ClassMethod(tJob, "SessionScopeFailure", "200 300", 200, 100, 200), tForeign, "a list with a foreign process")
    Do $$$AssertEquals($ClassMethod(tJob, "SessionScopeFailure", "200 200", 200, 100, 200), tForeign, "the same process twice")

    ; ProofFailure returns the same texts, and the routine checks come after the scope.
    Set tRun = $ListBuild("Pkg.Fixture.1")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "", 200, 100, 200, tRun, tRun), tNotScoped, "ProofFailure: not scoped")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "100", 200, 100, 200, tRun, tRun), tNotListed, "ProofFailure: not listed")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "200 300", 200, 100, 200, tRun, tRun), tForeign, "ProofFailure: a foreign process")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "100 200", 200, 100, 200, tRun, ""), tNoNames, "ProofFailure: no name to read")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "100 200", 200, 100, 200, tRun, $ListBuild("Other.1")), "The routines the monitor session reports are not this run's routine list.", "ProofFailure: other routines")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "100 200", 200, 100, 200, tRun, tRun), "", "ProofFailure: the run's session")

    ; The case the scope alone settles: a session that monitors no routine has no name for ProofFailure to read.
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "100 200", 200, 100, 200, tRun, ""), tNoNames, "a session of no routine is never proven by ProofFailure")
    Do $$$AssertEquals($ClassMethod(tJob, "SessionScopeFailure", "100 200", 200, 100, 200), "", "but its scope is")
    Quit $$$OK
}

/// RecordUnstoppedSession leaves a session that could not be stopped for the supervisor's release or the next start's
/// reclaim: the run's routine list becomes the routines the session loaded, so does the ownership node when it names the
/// run, the session is marked started, and the start error says which routines were not loaded and that no test ran.
Method TestRecordUnstoppedSessionRewritesTheRunAndItsNode() As %Status
{
    Set tId = ..#FAKERUN
    Set tListed = $ListBuild("Pkg.A.1", "Pkg.B.1")
    Set tLoaded = $ListBuild("Pkg.A.1")
    Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "routineList") = tListed
    Set tFree = ($Data(^IRIS.TempExecuteMCPv2Coverage("session")) = 0)
    If tFree Set ^IRIS.TempExecuteMCPv2Coverage("session") = $ListBuild(tId, 100, 200, "2026-10-18T00:00:00.000Z", tListed)

    Do ##class(ExecuteMCPv2.Coverage.Runner).RecordUnstoppedSession(tId, tLoaded, "The Line-by-Line session did not load routine Pkg.B.1 of the run's routine list.")

    Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("run", tId, "routineList")), tLoaded, "the run's routine list is the routines the session loaded")
    Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("run", tId, "sessionStarted")), 1, "the session is marked started, so it is released")
    Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("run", tId, "startError")), "The Line-by-Line session did not load routine Pkg.B.1 of the run's routine list. No test was run.", "the start error says no test was run")
    If tFree {
        Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("session")), $ListBuild(tId, 100, 200, "2026-10-18T00:00:00.000Z", tLoaded), "the ownership node that names the run lists what the session loaded")
    } Else {
        Do $$$LogMessage("The ownership node assertion was skipped: a coverage session node exists, and it belongs to a real run.")
    }
    Quit $$$OK
}

/// An ownership node that names another run is not rewritten.
Method TestRecordUnstoppedSessionLeavesAnotherRunsNode() As %Status
{
    Set tId = ..#FAKERUN
    Set tListed = $ListBuild("Pkg.A.1", "Pkg.B.1")
    Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "routineList") = tListed
    If $Data(^IRIS.TempExecuteMCPv2Coverage("session")) = 0 {
        Set ^IRIS.TempExecuteMCPv2Coverage("session") = $ListBuild(tId + 1, 100, 200, "2026-10-18T00:00:00.000Z", tListed)
    }
    Set tNode = $Get(^IRIS.TempExecuteMCPv2Coverage("session"))
    Do $$$AssertNotEquals($ListGet(tNode, 1), tId, "the node names another run")

    Do ##class(ExecuteMCPv2.Coverage.Runner).RecordUnstoppedSession(tId, $ListBuild("Pkg.A.1"), "The Line-by-Line session did not load routine Pkg.B.1 of the run's routine list.")

    Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("session")), tNode, "the other run's node is untouched")
    Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("run", tId, "routineList")), $ListBuild("Pkg.A.1"), "the run's own record is still rewritten")
    Quit $$$OK
}

}
