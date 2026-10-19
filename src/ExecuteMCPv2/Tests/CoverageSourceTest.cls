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

/// The disposable class that the line-map test documents after it was compiled.
Parameter DOCUMENTEDCLASS = "ExecuteMCPv2.Temp.Story402Documented";

/// The disposable class whose class-level Language is python.
Parameter LANGUAGECLASS = "ExecuteMCPv2.Temp.Story402Language";

/// The id of the fake run whose record the <code>RecordUnstoppedSession</code> tests write, far above any real run id. The
/// session node of a fake run is written only under the coverage start lock while no session node and no live run exist,
/// and is removed again before the lock is released (see <method>StartLockWithNoRun</method>).
Parameter FAKERUN = 990000003;

Method OnAfterOneTest(testname As %String) As %Status
{
    Do $System.OBJ.Delete(..#STALECLASS, "-d")
    Do $System.OBJ.Delete(..#DOCUMENTEDCLASS, "-d")
    Do $System.OBJ.Delete(..#LANGUAGECLASS, "-d")
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
    Do $$$AssertEquals(tMap, $ListBuild(tClass, "", 10), "a class with a map has no class reason and its line map")
    Do ..AssertMethod(.tMap, 1, "ScoreSet", 11, tRoutine, "47 48", "", 46)
    Do ..AssertMethod(.tMap, 2, "LabelGet", 17, tRoutine, "26", "", 25)
    Do ..AssertMethod(.tMap, 3, "Plain", 22, tRoutine, "44 45", "", 43)
    Do ..AssertMethod(.tMap, 4, "Macro", 28, tRoutine, "28 29 30 31 0 32 33", "", 27)
    Do ..AssertMethod(.tMap, 5, "MultiLine", 39, tRoutine, "35 36 37 38 39 40 41 42", "", 34)
    Do ..AssertMethod(.tMap, 6, "Sql", 51, tRoutine, "50 53 54 55", "", 49)
    Do ..AssertMethod(.tMap, 7, "Generated", 59, "", "", "generator")
    Do ..AssertMethod(.tMap, 8, "Expr", 66, tRoutine, "21", "", 20)
    Do ..AssertMethod(.tMap, 9, "Constant", 71, "", "0", "", 0)
    Do ..AssertMethod(.tMap, 10, "Comments", 76, tRoutine, "15 16 17 18 19", "", 14)
    Do ..AssertMethod(.tMap, 11, "TwoOnOne", 85, tRoutine, "66 67", "", 65)
    Do $$$AssertEquals($Order(tMap("m", ""), -1), 11, "the fixture's own methods are all there is: the inherited and generated ones are not mapped")
    Quit $$$OK
}

/// Assert one method entry of a map: its head, and the INT lines of its body lines (a space-separated list). A method with a
/// reason has a four-element head; the others carry the INT line of their label as a fifth element (0 when none is known).
Method AssertMethod(ByRef pMap, pIndex As %Integer, pName As %String, pLine As %Integer, pRoutine As %String, pLines As %String, pReason As %String, pLabelLine As %Integer = 0)
{
    Set tHead = $Select(pReason '= "": $ListBuild(pName, pLine, pRoutine, pReason), 1: $ListBuild(pName, pLine, pRoutine, "", pLabelLine))
    Do $$$AssertEquals($Get(pMap("m", pIndex)), tHead, pName_": name, declaration line, routine, reason and label line")
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

/// A documentation-only edit saved after the compile leaves <code>$System.OBJ.IsUpToDate</code> true, and a default compile
/// rebuilds nothing, but the save removed the class's line map: the INT text and its labels are still there, and no body line maps.
Method TestSourceMapOfAClassWhoseLineMapIsGone() As %Status
{
    Set tName = ..#DOCUMENTEDCLASS
    Do $$$AssertStatusOK(..SaveClassText(tName, ""), "the class is saved")
    Do $$$AssertStatusOK($System.OBJ.Compile(tName, "cuk-d"), "the class is compiled")
    Do $$$AssertNotEquals($Get(^rMAP(tName, "CLS", "INT")), "", "a compiled class with INT code has its line map")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertEquals($Get(tMap("m", 1, 1)), 6, "while it has one, the first body line maps")

    Do $$$AssertStatusOK(..SaveClassText(tName, "/// What Go returns."_$Char(10)), "the documented class is saved")
    Do $$$AssertStatusOK($System.OBJ.Compile(tName, "cuk-d"), "the default compile skips the class")
    Do $$$AssertEquals($System.OBJ.IsUpToDate(tName), 1, "IRIS still calls the class up to date")
    Do $$$AssertEquals($Get(^rMAP(tName, "CLS", "INT")), "", "but the documentation edit removed its line map")
    Kill tMap
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the class is a result, not an error")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 0), "it has no class reason, and its line map is 0: the IRIS side records what it finds")
    Do $$$AssertEquals($Get(tMap("m", 1)), $ListBuild("Go", 5, "", "", 5), "the method has an INT label (line 5) and no mapped body line")
    Do $$$AssertEquals($Get(tMap("m", 1, 1))_" "_$Get(tMap("m", 1, 2)), "0 0", "neither body line maps")

    Do $$$AssertStatusOK($System.OBJ.Compile(tName, "ck-d"), "a forced compile rebuilds the class")
    Do $$$AssertNotEquals($Get(^rMAP(tName, "CLS", "INT")), "", "and its line map")
    Kill tMap
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertEquals($Get(tMap("m", 1, 1)), 6, "the first body line maps again")
    Quit $$$OK
}

/// Save a one-method class through the UDL text service, which is what a document save does. <var>pDoc</var> is the doc
/// comment above the method.
ClassMethod SaveClassText(pName As %String, pDoc As %String) As %Status
{
    Set tNL = $Char(10)
    Set tText = "Class "_pName_tNL_"{"_tNL_tNL_pDoc_"ClassMethod Go() As %Integer"_tNL_"{"_tNL_"    Set tX = 1"_tNL_"    Quit tX"_tNL_"}"_tNL_tNL_"}"_tNL
    Quit ##class(%Compiler.UDL.TextServices).SetTextFromString(, pName, tText, tNL)
}

/// A method inherits its class's Language default: the compiled keyword says so, the definition's does not.
Method TestSourceMapLanguageDefault() As %Status
{
    Set tName = ..#LANGUAGECLASS
    Set tNL = $Char(10)
    Set tText = "Class "_tName_" [ Language = python ]"_tNL_"{"_tNL_tNL_"ClassMethod Py() As %Integer"_tNL_"{"_tNL_"    return 7"_tNL_"}"_tNL_tNL
    Set tText = tText_"ClassMethod Os() As %Integer [ Language = objectscript ]"_tNL_"{"_tNL_"    Set tX = 1"_tNL_"    Quit tX"_tNL_"}"_tNL_tNL_"}"_tNL
    Do $$$AssertStatusOK(##class(%Compiler.UDL.TextServices).SetTextFromString(, tName, tText, tNL), "the class is saved")
    Do $$$AssertStatusOK($System.OBJ.Compile(tName, "cuk-d"), "the class is compiled")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the map is built")
    Do $$$AssertEquals($List(tMap("m", 1), 1), "Py", "the method with no Language of its own is first")
    Do $$$AssertEquals($List(tMap("m", 1), 4), "not-objectscript", "it takes the class's python")
    Do $$$AssertEquals($Data(tMap("m", 1, 1)), 0, "and has no body map")
    Do $$$AssertEquals($List(tMap("m", 2), 1), "Os", "the second method")
    Do $$$AssertEquals($List(tMap("m", 2), 4), "", "says objectscript itself, so it maps")
    Quit $$$OK
}

/// The INT labels of a class are indexed by routine in one pass, and LabelLine returns a method's compiled label line only
/// when it can be told.
Method TestLabelLine() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tClass = "ExecuteMCPv2.Tests.CoverageSourceFixture"
    Set tRoutine = tClass_".1"
    Do $ClassMethod(tJob, "IndexLabels", tClass, .tLabels)
    Do $$$AssertEquals($Get(tLabels(tRoutine, "Plain")), 43, "the label of a method: its INT line in its routine")
    Do $$$AssertEquals($Data(tLabels(tRoutine, "Constant")), 0, "a method that compiled to no INT code has none")
    Do $$$AssertEquals($ClassMethod(tJob, "LabelLine", tClass, "Plain", tRoutine, .tLabels), 43, "a method with a compiled label")
    Do $$$AssertEquals($ClassMethod(tJob, "LabelLine", tClass, "Plain", "", .tLabels), 43, "any routine when the body maps nowhere")
    Do $$$AssertEquals($ClassMethod(tJob, "LabelLine", tClass, "Plain", tClass_".2", .tLabels), 0, "a method whose body maps to another routine than its label is not mapped")
    Do $$$AssertEquals($ClassMethod(tJob, "LabelLine", tClass, "Constant", "", .tLabels), 0, "a compiled label that is not label^routine, no line")
    Do $$$AssertEquals($ClassMethod(tJob, "LabelLine", tClass, "NoSuchMethod", "", .tLabels), 0, "a name that is not a method of the class, no line")
    Set tLabels(tRoutine, "Plain") = 99
    Do $$$AssertEquals($ClassMethod(tJob, "LabelLine", tClass, "Plain", tRoutine, .tLabels), 99, "the line is the index's")
    Kill tLabels(tRoutine, "Plain")
    Do $$$AssertEquals($ClassMethod(tJob, "LabelLine", tClass, "Plain", tRoutine, .tLabels), 0, "a label that is not in the INT text, no line")
    Quit $$$OK
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
    Set tFree = ..StartLockWithNoRun(.tLocked)
    Do $$$AssertTrue(tFree, "no coverage run is active and no coverage session node exists (run this class when no coverage run is active)")
    Set tNode = ""
    Set tError = ""
    Try {
        If tFree {
            Set ^IRIS.TempExecuteMCPv2Coverage("session") = $ListBuild(tId, 100, 200, "2026-10-18T00:00:00.000Z", tListed)
            Do ##class(ExecuteMCPv2.Coverage.Runner).RecordUnstoppedSession(tId, tLoaded, "The Line-by-Line session did not load routine Pkg.B.1 of the run's routine list.")
            Set tNode = $Get(^IRIS.TempExecuteMCPv2Coverage("session"))
        }
    } Catch ex {
        Set tError = ex.DisplayString()
    }
    Do ..ReleaseStartLock(tLocked, tId)
    If 'tFree Quit $$$OK
    Do $$$AssertEquals(tError, "", "RecordUnstoppedSession ran without an error")

    Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("run", tId, "routineList")), tLoaded, "the run's routine list is the routines the session loaded")
    Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("run", tId, "sessionStarted")), 1, "the session is marked started, so it is released")
    Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("run", tId, "startError")), "The Line-by-Line session did not load routine Pkg.B.1 of the run's routine list. No test was run.", "the start error says no test was run")
    Do $$$AssertEquals(tNode, $ListBuild(tId, 100, 200, "2026-10-18T00:00:00.000Z", tLoaded), "the ownership node that names the run lists what the session loaded")
    Quit $$$OK
}

/// An ownership node that names another run is not rewritten.
Method TestRecordUnstoppedSessionLeavesAnotherRunsNode() As %Status
{
    Set tId = ..#FAKERUN
    Set tListed = $ListBuild("Pkg.A.1", "Pkg.B.1")
    Set tOther = $ListBuild(tId + 1, 100, 200, "2026-10-18T00:00:00.000Z", tListed)
    Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "routineList") = tListed
    Set tFree = ..StartLockWithNoRun(.tLocked)
    Do $$$AssertTrue(tFree, "no coverage run is active and no coverage session node exists (run this class when no coverage run is active)")
    Set tNode = ""
    Set tError = ""
    Try {
        If tFree {
            Set ^IRIS.TempExecuteMCPv2Coverage("session") = tOther
            Do ##class(ExecuteMCPv2.Coverage.Runner).RecordUnstoppedSession(tId, $ListBuild("Pkg.A.1"), "The Line-by-Line session did not load routine Pkg.B.1 of the run's routine list.")
            Set tNode = $Get(^IRIS.TempExecuteMCPv2Coverage("session"))
        }
    } Catch ex {
        Set tError = ex.DisplayString()
    }
    Do ..ReleaseStartLock(tLocked, tId + 1)
    If 'tFree Quit $$$OK
    Do $$$AssertEquals(tError, "", "RecordUnstoppedSession ran without an error")

    Do $$$AssertEquals(tNode, tOther, "the other run's node is untouched")
    Do $$$AssertEquals($Get(^IRIS.TempExecuteMCPv2Coverage("run", tId, "routineList")), $ListBuild("Pkg.A.1"), "the run's own record is still rewritten")
    Quit $$$OK
}

/// Take the coverage start lock, so that no coverage run starts while a test holds a fake run's session node, and return
/// whether the instance has no coverage run: no session node and no live run (whose runner could write one). Only then may a
/// test write a fake node; the real ownership node of a run is never written or removed by a test. <var>pLocked</var> says
/// whether the lock is held; the caller releases it with <method>ReleaseStartLock</method>.
Method StartLockWithNoRun(Output pLocked As %Boolean) As %Boolean
{
    Lock +^IRIS.TempExecuteMCPv2Coverage("start"):10
    Set pLocked = $Test
    If 'pLocked Quit 0
    Quit ($Data(^IRIS.TempExecuteMCPv2Coverage("session")) = 0) && (##class(ExecuteMCPv2.Coverage.Job).LiveRunId() = "")
}

/// Remove the fake session node that names run <var>pNodeId</var>, if one is there, then release the start lock when
/// <var>pLocked</var> says it is held (see <method>StartLockWithNoRun</method>).
Method ReleaseStartLock(pLocked As %Boolean, pNodeId As %Integer) As %Status
{
    If pLocked && ($ListGet($Get(^IRIS.TempExecuteMCPv2Coverage("session")), 1) = pNodeId) Kill ^IRIS.TempExecuteMCPv2Coverage("session")
    If pLocked Lock -^IRIS.TempExecuteMCPv2Coverage("start")
    Quit $$$OK
}

}
