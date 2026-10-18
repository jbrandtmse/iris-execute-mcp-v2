/// Unit tests for <class>ExecuteMCPv2.Coverage.Job</class> and the request validation of
/// <class>ExecuteMCPv2.REST.Coverage</class> (Story 40.1).
/// <p>No test here starts a Line-by-Line session or terminates a process: the monitor is instance-wide, so only the
/// iris-mcp-all live gate does that. The tests that need a run record write one with an id far above any real
/// run, and remove it afterwards.</p>
Class ExecuteMCPv2.Tests.CoverageJobTest Extends %UnitTest.TestCase
{

/// The id of the fake run record some tests write.
Parameter FAKERUN = 990000001;

Method OnAfterOneTest(testname As %String) As %Status
{
    Kill ^IRIS.TempExecuteMCPv2Coverage("run", ..#FAKERUN), ^IRIS.TempExecuteMCPv2Coverage("fakeStop")
    For tId = -40:1:-1 Kill ^IRIS.TempExecuteMCPv2Coverage("run", tId)
    Quit $$$OK
}

/// Prune deletes the oldest records first. The fake records have negative ids, so they sort before every real run.
Method TestPruneDeletesTheOldestRecordsFirst() As %Status
{
    For tId = -4, -3, -2, -1 {
        Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "status") = $Select(tId = -4: "running", 1: "completed")
    }
    Set tCount = 0
    Set tKey = ""
    For {
        Set tKey = $Order(^IRIS.TempExecuteMCPv2Coverage("run", tKey))
        If tKey = "" Quit
        Set tCount = tCount + 1
    }
    Do ##class(ExecuteMCPv2.Coverage.Job).Prune(-1, tCount - 2)
    Do $$$AssertEquals($Data(^IRIS.TempExecuteMCPv2Coverage("run", -4)), 0, "the oldest record, non-terminal with a dead supervisor, is deleted")
    Do $$$AssertEquals($Data(^IRIS.TempExecuteMCPv2Coverage("run", -3)), 0, "then the next oldest")
    Do $$$AssertTrue($Data(^IRIS.TempExecuteMCPv2Coverage("run", -2)) > 0, "the third oldest stays: the count is within the limit")
    Do $$$AssertTrue($Data(^IRIS.TempExecuteMCPv2Coverage("run", -1)) > 0, "the newest stays")
    Quit $$$OK
}

/// Prune with its default limit keeps at most 20 records (plus the one it is told to keep): with 25 fake terminal records
/// ahead of every real one, the oldest fakes go first.
Method TestPruneDefaultKeepsTheTwentyMostRecentRuns() As %Status
{
    For tId = -30:1:-6 Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "status") = "completed"
    Set ^IRIS.TempExecuteMCPv2Coverage("run", -1, "status") = "completed"
    Do ##class(ExecuteMCPv2.Coverage.Job).Prune(-1)
    Set tCount = 0
    Set tKey = ""
    For {
        Set tKey = $Order(^IRIS.TempExecuteMCPv2Coverage("run", tKey))
        If tKey = "" Quit
        Set tCount = tCount + 1
    }
    Do $$$AssertTrue(tCount <= (##class(ExecuteMCPv2.Coverage.Job).#MAXRUNS + 1), "at most 20 records remain, plus the record Prune was told to keep: "_tCount)
    Do $$$AssertEquals($Data(^IRIS.TempExecuteMCPv2Coverage("run", -30)), 0, "the oldest record is gone")
    Do $$$AssertTrue($Data(^IRIS.TempExecuteMCPv2Coverage("run", -1)) > 0, "the record to keep stays")
    Quit $$$OK
}

/// The test spec: a class or method target is BuildTestSpec's, and the classes of a package follow one colon and are
/// separated by a semicolon alone (":A;B"); ":A;:B" would make RunTest read B as a method of A, and run no test.
Method TestTestSpecSeparatesPackageClassesBySemicolon() As %Status
{
    Set tClass = "ExecuteMCPv2.REST.Coverage"
    Do $$$AssertEquals($ClassMethod(tClass, "TestSpec", "A.B", "class"), ":A.B", "class level")
    Do $$$AssertEquals($ClassMethod(tClass, "TestSpec", "A.B:TestOne", "method"), ":A.B:TestOne", "method level")
    Set tSpec = $ClassMethod(tClass, "TestSpec", "ExecuteMCPv2.Tests", "package")
    Do $$$AssertEquals($Extract(tSpec), ":", "the spec starts with the empty suite and one colon")
    Do $$$AssertTrue(tSpec [ "ExecuteMCPv2.Tests.CoverageJobTest", "the package's test classes are in the spec")
    Do $$$AssertTrue(tSpec [ ";ExecuteMCPv2.Tests.", "with a bare semicolon between two of them")
    Do $$$AssertTrue(tSpec '[ ";:", "and no colon after a semicolon")
    Do $$$AssertEquals($Length(tSpec, ":"), 2, "so the spec has the one colon only")
    Quit $$$OK
}

/// Validate the request <var>pJson</var> and return the status.
Method Validate(pJson As %String, Output pParams) As %Status
{
    Quit ##class(ExecuteMCPv2.REST.Coverage).ValidateStart(##class(%DynamicObject).%FromJSON(pJson), .pParams)
}

/// A request body (JSON text) with all the required fields. <var>pKey</var> names a field to replace with the JSON
/// text <var>pRaw</var>, or to leave out when <var>pRaw</var> is empty.
Method Body(pKey As %String = "", pRaw As %String = "") As %String
{
    Set tParts("target") = """ExecuteMCPv2.Tests.CoverageFixtureTest"""
    Set tParts("level") = """class"""
    Set tParts("classes") = "[""ExecuteMCPv2.Tests.CoverageFixture""]"
    Set tParts("maxSeconds") = "3600"
    Set tParts("maxLines") = "200000"
    If pKey '= "" {
        If pRaw = "" {
            Kill tParts(pKey)
        } Else {
            Set tParts(pKey) = pRaw
        }
    }
    Set tJson = ""
    Set tKey = ""
    For {
        Set tKey = $Order(tParts(tKey))
        If tKey = "" Quit
        Set tJson = tJson_$Select(tJson = "": "", 1: ",")_""""_tKey_""":"_tParts(tKey)
    }
    Quit "{"_tJson_"}"
}

/// BusyDecision(monitorActive, sessionDefined, ownersAlive, listMatches, liveRun): the seven rows of the decision table.
Method TestBusyDecisionTable() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 0, 1, 1, 0, 0), "busy-suite", "row 1: session set, owners alive, monitor idle")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 1, 1, 1, 1, 1), "busy-suite", "row 1: session set, owners alive, monitor active")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 1, 1, 0, 1, 0), "reclaim", "row 2: session set, owners dead, monitor active, list matches")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 1, 1, 0, 1, 1), "reclaim", "row 2: a live run does not change a reclaim")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 1, 1, 0, 0, 0), "clear-busy-foreign", "row 3: session set, owners dead, monitor active, list differs")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 0, 1, 0, 0, 0), "clear-and-proceed", "row 4: session set, owners dead, monitor idle")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 0, 1, 0, 1, 1), "clear-and-proceed", "row 4: whatever the list and live run")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 0, 0, 0, 0, 1), "busy-suite", "row 5: no session node, a live run, monitor idle")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 1, 0, 0, 0, 1), "busy-suite", "row 5: no session node, a live run, monitor active")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 1, 0, 0, 0, 0), "busy-foreign", "row 6: no session node, no live run, monitor active")
    Do $$$AssertEquals($ClassMethod(tJob, "BusyDecision", 0, 0, 0, 0, 0), "proceed", "row 7: nothing active")
    Quit $$$OK
}

Method TestResolveRoutinesFixtureAndMissingClass() As %Status
{
    Set tHome = $NAMESPACE
    Set tClasses = $ListBuild("ExecuteMCPv2.Tests.CoverageFixture", "ExecuteMCPv2.Tests.CoverageMissing")
    Set tRoutines = ##class(ExecuteMCPv2.Coverage.Job).ResolveRoutines(tHome, tClasses, .tUnmeasured, .tLines, .tError)
    Do $$$AssertEquals(tError, "", "nothing went wrong")
    Do $$$AssertEquals($NAMESPACE, tHome, "the namespace is restored")
    Do $$$AssertEquals($ListLength(tRoutines), 1, "one measured routine")
    Set tEntry = $List(tRoutines, 1)
    Do $$$AssertEquals($List(tEntry, 1), "ExecuteMCPv2.Tests.CoverageFixture", "the class")
    Do $$$AssertEquals($List(tEntry, 2), "ExecuteMCPv2.Tests.CoverageFixture.1", "the .1 routine, never .0")
    Do $$$AssertEquals($List(tEntry, 3), 48, "the INT line count of the oracle fixture")
    Do $$$AssertEquals(tLines, 48, "the total of the measured lines")
    Do $$$AssertEquals($ListLength(tUnmeasured), 1, "one unmeasured class")
    Do $$$AssertEquals($List($List(tUnmeasured, 1), 1), "ExecuteMCPv2.Tests.CoverageMissing", "the missing class is named")
    Do $$$AssertEquals($List($List(tUnmeasured, 1), 2), "not-compiled", "the reason is not-compiled")
    Quit $$$OK
}

Method TestResolveRoutinesReasons() As %Status
{
    Set tClasses = $ListBuild("ExecuteMCPv2.Tests.CoverageFixtureEmpty", "%Library.RegisteredObject")
    Set tRoutines = ##class(ExecuteMCPv2.Coverage.Job).ResolveRoutines($NAMESPACE, tClasses, .tUnmeasured, .tLines)
    Do $$$AssertEquals(tRoutines, "", "no class here is measurable")
    Do $$$AssertEquals(tLines, 0, "no lines")
    Do $$$AssertEquals($List($List(tUnmeasured, 1), 2), "no-routines", "a class with no method compiles no routine")
    Do $$$AssertEquals($List($List(tUnmeasured, 2), 2), "no-int-source", "a system class keeps no INT source")
    Quit $$$OK
}

/// A namespace that cannot be entered is IRIS's own error text in pError, not an empty result with no reason.
Method TestResolveRoutinesReportsANamespaceErrorAndRestores() As %Status
{
    Set tHome = $NAMESPACE
    Set tRoutines = ##class(ExecuteMCPv2.Coverage.Job).ResolveRoutines("NOSUCHNS401", $ListBuild("ExecuteMCPv2.Tests.CoverageFixture"), .tUnmeasured, .tLines, .tError)
    Do $$$AssertEquals(tRoutines, "", "nothing is measured")
    Do $$$AssertEquals(tUnmeasured, "", "and no class is reported unmeasured")
    Do $$$AssertEquals(tLines, 0, "no lines")
    Do $$$AssertTrue(tError '= "", "the error text is returned")
    Do $$$AssertEquals($NAMESPACE, tHome, "the namespace is restored on the error path")
    Quit $$$OK
}

Method TestSkeletonStringsOfTheOracleRoutine() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).Skeleton($NAMESPACE, "ExecuteMCPv2.Tests.CoverageFixture.1", .tSkeleton)
    Do $$$AssertStatusOK(tSC, "the skeleton is built")
    Do $$$AssertEquals($Get(tSkeleton(5)), "L C:methodimpl {", "line 5, a method label")
    Do $$$AssertEquals($Get(tSkeleton(6)), "C:set", "line 6")
    Do $$$AssertEquals($Get(tSkeleton(9)), "} C:elseif {", "line 9")
    Do $$$AssertEquals($Get(tSkeleton(11)), "} C:else {", "line 11")
    Do $$$AssertEquals($Get(tSkeleton(14)), "C:quit }", "line 14")
    Do $$$AssertEquals($Get(tSkeleton(21)), "C:try {", "line 21")
    Do $$$AssertEquals($Get(tSkeleton(26)), "} C:catch {", "line 26")
    Do $$$AssertEquals($Get(tSkeleton(35)), "C:do {", "line 35")
    Do $$$AssertEquals($Get(tSkeleton(37)), "} C:while", "line 37")
    Do $$$AssertEquals($Get(tSkeleton(41)), "C:for {", "line 41")
    Quit $$$OK
}

Method TestSkeletonHasNoEntryForCommentsAndLoneBraces() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).Skeleton($NAMESPACE, "ExecuteMCPv2.Tests.CoverageFixture.1", .tSkeleton)
    Do $$$AssertStatusOK(tSC, "the skeleton is built")
    For tLine = 1, 2, 3, 4, 46 {
        Do $$$AssertEquals($Data(tSkeleton(tLine)), 0, "line "_tLine_" is a comment: no entry")
    }
    For tLine = 13, 34, 43 {
        Do $$$AssertEquals($Data(tSkeleton(tLine)), 0, "line "_tLine_" is a lone brace: no entry")
    }
    Quit $$$OK
}

Method TestSkeletonOfAMissingRoutineIsAnError() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).Skeleton($NAMESPACE, "ExecuteMCPv2.Tests.CoverageNoSuchClass.1", .tSkeleton)
    Do $$$AssertStatusNotOK(tSC, "a routine that does not exist has no skeleton")
    Quit $$$OK
}

Method TestLineSkeletonFromTokens() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tTokens = $ListBuild($ListBuild("COS", "Label", "Foo"), $ListBuild("COS", "Delimiter", "("), $ListBuild("COS", "Delimiter", ")"), $ListBuild("COS", "White Space", " "), $ListBuild("COS", "Command", "methodimpl"), $ListBuild("COS", "Brace", "{"))
    Do $$$AssertEquals($ClassMethod(tJob, "LineSkeleton", tTokens), "L C:methodimpl {", "label, command and brace are kept, delimiters dropped")
    Set tTokens = $ListBuild($ListBuild("COS", "Brace", "}"), $ListBuild("COS", "Command", "ElseIf"), $ListBuild("COS", "Parameter", "pN"), $ListBuild("COS", "Brace", "{"))
    Do $$$AssertEquals($ClassMethod(tJob, "LineSkeleton", tTokens), "} C:elseif {", "command text is lower case")
    Set tTokens = $ListBuild($ListBuild("COS", "Brace", "}"))
    Do $$$AssertEquals($ClassMethod(tJob, "LineSkeleton", tTokens), "", "a line with no command has no skeleton")
    Do $$$AssertEquals($ClassMethod(tJob, "LineSkeleton", ""), "", "an empty line has no skeleton")
    Quit $$$OK
}

Method TestValidateStartAcceptsACompleteRequest() As %Status
{
    Set tSC = ..Validate(..Body(), .tParams)
    Do $$$AssertStatusOK(tSC, "a complete request is valid")
    Do $$$AssertEquals(tParams("target"), "ExecuteMCPv2.Tests.CoverageFixtureTest", "target")
    Do $$$AssertEquals(tParams("level"), "class", "level")
    Do $$$AssertEquals(tParams("namespace"), "", "no namespace")
    Do $$$AssertEquals(tParams("maxSeconds"), 3600, "maxSeconds")
    Do $$$AssertEquals(tParams("maxLines"), 200000, "maxLines")
    Do $$$AssertEquals($ListLength(tParams("classes")), 1, "one class")
    Quit $$$OK
}

Method TestValidateStartDeduplicatesClassesAndKeepsOrder() As %Status
{
    Set tSC = ..Validate(..Body("classes", "[""B.One"",""A.Two"",""B.One"",""%Sys.Three""]"), .tParams)
    Do $$$AssertStatusOK(tSC, "valid")
    Do $$$AssertEquals($ListToString(tParams("classes")), "B.One,A.Two,%Sys.Three", "first occurrence order, no duplicates")
    Quit $$$OK
}

Method TestValidateStartRejectsAMissingTarget() As %Status
{
    Set tSC = ..Validate(..Body("target"), .tParams)
    Do $$$AssertStatusNotOK(tSC, "a request without a target is invalid")
    Do $$$AssertStatusNotOK(..Validate(..Body("target", """"""), .tParams), "an empty target is invalid")
    Do $$$AssertStatusNotOK(##class(ExecuteMCPv2.REST.Coverage).ValidateStart("", .tParams), "no body at all")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "target", "the error names the field")
    Quit $$$OK
}

Method TestValidateStartRejectsABadLevel() As %Status
{
    Set tSC = ..Validate(..Body("level", """suite"""), .tParams)
    Do $$$AssertStatusNotOK(tSC, "an unknown level is invalid")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "level", "the error names the field")
    Quit $$$OK
}

Method TestValidateStartRejectsEmptyAndTooManyClasses() As %Status
{
    Set tSC = ..Validate(..Body("classes", "[]"), .tParams)
    Do $$$AssertStatusNotOK(tSC, "an empty class list is invalid")
    Set tList = ""
    For tI = 1:1:51 Set tList = tList_$Select(tI = 1: "", 1: ",")_"""Pkg.C"_tI_""""
    Set tSC = ..Validate(..Body("classes", "["_tList_"]"), .tParams)
    Do $$$AssertStatusNotOK(tSC, "51 classes are too many")
    Set tList = ""
    For tI = 1:1:50 Set tList = tList_$Select(tI = 1: "", 1: ",")_"""Pkg.C"_tI_""""
    Set tSC = ..Validate(..Body("classes", "["_tList_"]"), .tParams)
    Do $$$AssertStatusOK(tSC, "50 classes are the most")
    Quit $$$OK
}

Method TestValidateStartRejectsAnInvalidClassName() As %Status
{
    For tName = "has space", "Pkg..Class", "1Pkg.Class", "Pkg.Cl_ass", "Pkg.Class;Kill", "" {
        Set tSC = ..Validate(..Body("classes", "["""_tName_"""]"), .tParams)
        Do $$$AssertStatusNotOK(tSC, "'"_tName_"' is not a class name")
    }
    Set tSC = ..Validate(..Body("classes", "[1]"), .tParams)
    Do $$$AssertStatusNotOK(tSC, "a number is not a class name")
    Quit $$$OK
}

Method TestValidateStartChecksMaxSecondsAndMaxLines() As %Status
{
    Do $$$AssertStatusNotOK(..Validate(..Body("maxSeconds", "0"), .tParams), "maxSeconds 0")
    Do $$$AssertStatusNotOK(..Validate(..Body("maxSeconds", "3601"), .tParams), "maxSeconds 3601")
    Do $$$AssertStatusNotOK(..Validate(..Body("maxSeconds", "1.5"), .tParams), "maxSeconds 1.5")
    Do $$$AssertStatusNotOK(..Validate(..Body("maxSeconds", """10"""), .tParams), "maxSeconds as a string")
    Do $$$AssertStatusOK(..Validate(..Body("maxSeconds", "1"), .tParams), "maxSeconds 1")
    Do $$$AssertStatusNotOK(..Validate(..Body("maxLines", "0"), .tParams), "maxLines 0")
    Do $$$AssertStatusOK(..Validate(..Body("maxLines", "1"), .tParams), "maxLines 1")
    Quit $$$OK
}

Method TestValidateStartRejectsATargetThatAddsTestSpecs() As %Status
{
    Do $$$AssertStatusNotOK(..Validate(..Body("target", """A.B,C.D"""), .tParams), "a comma would add a second spec")
    Do $$$AssertStatusNotOK(..Validate(..Body("target", """A.B;C.D"""), .tParams), "a semicolon would add a second spec")
    Do $$$AssertStatusOK(..Validate(..Body("target", """A.B:TestOne"""), .tParams), "class:method is valid")
    Quit $$$OK
}

/// MayTerminate is true only when the PID equals the record's PID for the role and that role's owner lock is held
/// by a live process. None of the cases here holds such a lock, so every one is false; nothing is terminated.
Method TestMayTerminateIsFalseWithoutAProvenProcess() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tId = ..#FAKERUN
    Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "runner", 4242), 0, "no record at all")
    Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "status") = "running"
    Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "pid") = 4241
    Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "runnerPid") = 4242
    Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "runner", 4242), 0, "the PID matches the record but the owner lock is free")
    Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "supervisor", 4241), 0, "the supervisor's owner lock is free too")
    Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "runner", 4243), 0, "a PID that differs from the record's")
    Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "runner", 4241), 0, "the supervisor's PID is not the runner's")
    Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "runner", ""), 0, "no PID")
    Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "other", 4242), 0, "an unknown role")
    Quit $$$OK
}

/// The job <method>TestMayTerminateIsTrueOnlyForTheProcessHoldingTheRecordedRole</method> starts: it holds the runner
/// owner lock of the fake run until the stop flag is set (30 seconds at most), as a live runner would.
ClassMethod HoldRunnerLock()
{
    Lock +^IRIS.TempExecuteMCPv2Coverage("owner", ..#FAKERUN, "runner"):5
    If '$Test Quit
    For tI = 1:1:300 {
        If $Get(^IRIS.TempExecuteMCPv2Coverage("fakeStop")) Quit
        Hang 0.1
    }
    Lock -^IRIS.TempExecuteMCPv2Coverage("owner", ..#FAKERUN, "runner")
}

/// MayTerminate is true only for the PID the record names, while a process holds that role's owner lock. A helper job
/// plays the live runner; nothing is terminated.
Method TestMayTerminateIsTrueOnlyForTheProcessHoldingTheRecordedRole() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tId = ..#FAKERUN
    Kill ^IRIS.TempExecuteMCPv2Coverage("fakeStop")
    Job ##class(ExecuteMCPv2.Tests.CoverageJobTest).HoldRunnerLock()::10
    If '$Test {
        Do $$$AssertTrue(0, "the lock holder job started")
    } Else {
        Set tPid = $ZChild
        Set tHeld = 0
        For tI = 1:1:50 {
            If $ClassMethod(tJob, "OwnerAlive", tId, "runner") {
                Set tHeld = 1
                Quit
            }
            Hang 0.1
        }
        Do $$$AssertTrue(tHeld, "the helper job holds the runner lock")
        Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "status") = "running"
        Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "runnerPid") = tPid
        Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "runner", tPid), 1, "the recorded PID, with the lock held by a live process")
        Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "runner", tPid + 1), 0, "a PID that differs from the record's, the lock still held")
        Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "pid") = tPid
        Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "supervisor", tPid), 0, "the supervisor's lock is free although the PID matches its record")
        Set ^IRIS.TempExecuteMCPv2Coverage("fakeStop") = 1
        For tI = 1:1:50 {
            If '$ClassMethod(tJob, "OwnerAlive", tId, "runner") Quit
            Hang 0.1
        }
        Kill ^IRIS.TempExecuteMCPv2Coverage("fakeStop")
        Do $$$AssertEquals($ClassMethod(tJob, "MayTerminate", tId, "runner", tPid), 0, "the process has ended and released its lock: false at once")
    }
    Quit $$$OK
}

/// A lock this very process holds is not another process's lock: MayTerminate must not be fooled by it.
Method TestMayTerminateIsFalseForALockTheCallerHolds() As %Status
{
    Set tId = ..#FAKERUN
    Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "runnerPid") = $Job
    Lock +^IRIS.TempExecuteMCPv2Coverage("owner", tId, "runner")
    Set tMay = ##class(ExecuteMCPv2.Coverage.Job).MayTerminate(tId, "runner", $Job)
    Lock -^IRIS.TempExecuteMCPv2Coverage("owner", tId, "runner")
    Do $$$AssertEquals(tMay, 0, "the caller's own lock proves nothing about another process")
    Quit $$$OK
}

/// PidsMatch(pids, supervisorPid, runnerPid): the runner starts its session with $ListBuild($JOB, supervisorPid). IRIS
/// reports the processes still alive, in ascending order of process id, and 0 once none is: the supervisor 100 and
/// the runner 200 read "100 200", then "200" or "100", then "0" (probe, IRIS 2026.2 build 221U).
Method TestPidsMatchIsTheSuiteProcessesStillAliveOrZero() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "100 200", 100, 200), 1, "both processes alive, as IRIS orders them")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "200 100", 100, 200), 1, "whatever the order of the two")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "200", 100, 200), 1, "the supervisor has ended and left the list")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "100", 100, 200), 1, "the runner has ended and left the list")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "0", 100, 200), 1, "both have ended: the list reads 0")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", 0, 100, 200), 1, "and IRIS returns that 0 as a number")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "200 300", 100, 200), 0, "a second entry that is a foreign process")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "300 100", 100, 200), 0, "a first entry that is a foreign process")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "300", 100, 200), 0, "only a foreign process")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "100 200 300", 100, 200), 0, "a third process")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "100 100", 100, 200), 0, "the same process twice")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "100  200", 100, 200), 0, "an empty entry between the two")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", " 200", 100, 200), 0, "an empty first entry")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "200 ", 100, 200), 0, "an empty last entry")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "", 100, 200), 0, "an empty list says nothing")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "200 100", "", 200), 0, "no recorded supervisor")
    Do $$$AssertEquals($ClassMethod(tJob, "PidsMatch", "200 100", 100, ""), 0, "no recorded runner")
    Quit $$$OK
}

/// A run that does not own the session node is never proven to own the active session; nothing is started or stopped.
Method TestProveOwnSessionRefusesAnotherRunsNode() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).ProveOwnSession(..#FAKERUN)
    Do $$$AssertStatusNotOK(tSC, "a run id the session node does not name is not proven")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "does not name this run", "the error says why")
    Quit $$$OK
}

/// ReadRun: the id must be all digits and name a record that exists.
Method TestReadRunRejectsUnknownAndMalformedIds() As %Status
{
    Set tClass = "ExecuteMCPv2.REST.Coverage"
    For tText = "", "abc", "-1", "1.5", "12 34" {
        Set tSC = $ClassMethod(tClass, "ReadRun", tText, .tId)
        Do $$$AssertStatusNotOK(tSC, "'"_tText_"' is not a coverage handle")
        Do $$$AssertEquals(tId, "", "no id is returned for '"_tText_"'")
    }
    Set tSC = $ClassMethod(tClass, "ReadRun", "abc", .tId)
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "all digits", "a malformed id says it must be all digits")
    Set tSC = $ClassMethod(tClass, "ReadRun", ..#FAKERUN, .tId)
    Do $$$AssertStatusNotOK(tSC, "an unknown id is an error")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "was not found", "the error says the run was not found")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "20 most recent runs", "and how many runs are kept")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "do not survive an instance restart", "and that they do not survive a restart")
    Set ^IRIS.TempExecuteMCPv2Coverage("run", ..#FAKERUN, "status") = "running"
    Set tSC = $ClassMethod(tClass, "ReadRun", ..#FAKERUN, .tId)
    Do $$$AssertStatusOK(tSC, "an existing record is found")
    Do $$$AssertEquals(tId, ..#FAKERUN, "and its id is returned as a number")
    Quit $$$OK
}

Method TestListsEqualIgnoresOrderButNotContent() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Do $$$AssertEquals($ClassMethod(tJob, "ListsEqual", $ListBuild("a", "b"), $ListBuild("b", "a")), 1, "same names, other order")
    Do $$$AssertEquals($ClassMethod(tJob, "ListsEqual", $ListBuild("a", "b"), $ListBuild("a", "c")), 0, "a different name")
    Do $$$AssertEquals($ClassMethod(tJob, "ListsEqual", $ListBuild("a"), $ListBuild("a", "b")), 0, "a different length")
    Do $$$AssertEquals($ClassMethod(tJob, "ListsEqual", $ListBuild("a"), $ListBuild("")), 0, "an unreadable name")
    Do $$$AssertEquals($ClassMethod(tJob, "ListsEqual", "", ""), 1, "two empty lists")
    Quit $$$OK
}

Method TestIsClassName() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Do $$$AssertEquals($ClassMethod(tJob, "IsClassName", "Pkg.Sub.Class1"), 1, "dotted name")
    Do $$$AssertEquals($ClassMethod(tJob, "IsClassName", "%Library.String"), 1, "a system class")
    Do $$$AssertEquals($ClassMethod(tJob, "IsClassName", "Class"), 1, "one segment")
    Do $$$AssertEquals($ClassMethod(tJob, "IsClassName", "Pkg.%Class"), 0, "a percent sign after the first character")
    Do $$$AssertEquals($ClassMethod(tJob, "IsClassName", "Pkg."), 0, "a trailing dot")
    Do $$$AssertEquals($ClassMethod(tJob, "IsClassName", ""), 0, "empty")
    Quit $$$OK
}

Method TestSafeTextKeepsTheIrisCodeAndDropsGlobalReferences() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Do $$$AssertEquals($ClassMethod(tJob, "SafeText", "ERROR #6062: The Monitor is already running"), "ERROR #6062: The Monitor is already running", "the code and text stay")
    Do $$$AssertEquals($ClassMethod(tJob, "SafeText", "plain text"), "plain text", "text without a code")
    Do $$$AssertTrue($ClassMethod(tJob, "SafeText", "<UNDEFINED>x+3^Some.Routine") '[ "^Some", "a routine reference is stripped")
    Quit $$$OK
}

Method TestUtcNowIsIso8601WithZ() As %Status
{
    Set tNow = ##class(ExecuteMCPv2.Coverage.Job).UtcNow()
    Do $$$AssertTrue(tNow ? 4N1"-"2N1"-"2N1"T"2N1":"2N1":"2N1"."3N1"Z", "UTC ISO 8601 with milliseconds and Z: "_tNow)
    Quit $$$OK
}

Method TestTerminalStatuses() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    For tStatus = "completed", "cancelled", "failed", "abandoned" {
        Do $$$AssertEquals($ClassMethod(tJob, "IsTerminal", tStatus), 1, tStatus_" is terminal")
    }
    For tStatus = "starting", "running", "" {
        Do $$$AssertEquals($ClassMethod(tJob, "IsTerminal", tStatus), 0, "'"_tStatus_"' is not terminal")
    }
    Quit $$$OK
}

}
