/// The runner of one line-coverage run (Story 40.1): the one suite job that starts, uses and stops its own
/// Line-by-Line session (AD-27).
/// <p>A Line-by-Line session counts only the processes in its process list, and only a process that is in that
/// list can read the session's line counts. The runner therefore starts the session scoped to itself and to its
/// supervisor (<code>$ListBuild($JOB, supervisorPid)</code>, never all processes). The supervisor runs only
/// <code>ExecuteMCPv2</code> and system code, so it adds counts only to those classes, and only when they are listed;
/// being in the list is what lets it read the counts after the runner is terminated. The runner runs the tests
/// through <method>%UnitTest.Manager:RunTest</method> in this same process, reads the line counts and stops the session.
/// It never reads the cancel flag: <method>ExecuteMCPv2.Coverage.Job:Supervise</method> turns a cancel or the time
/// limit into terminating this process, and releases a session this process leaves behind.</p>
/// <p>This class extends <class>%UnitTest.Manager</class> only to hook <method>OnBeforeAllTests</method>, which
/// records the <code>%UnitTest_Result</code> run index before any test runs.</p>
Class ExecuteMCPv2.Coverage.Runner Extends %UnitTest.Manager
{

/// The job entry point for run <var>pId</var>. It holds its owner lock for its whole life, switches to the run's
/// namespace, starts the session, runs the tests, and afterwards (also after an error) reads the counts and stops the
/// session it started, as long as that session proves to be its own (see <method>StopOwnSession</method>). If
/// <code>Start</code> fails it records the IRIS text and ends without calling <code>Stop</code>: the session that
/// blocked it belongs to someone else.
ClassMethod Run(pId As %Integer)
{
    Set tHeld = 0
    Set tStarted = 0
    Try {
        Lock +^IRIS.TempExecuteMCPv2Coverage("owner", pId, "runner"):10
        If '$Test {
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "startError") = "The test process could not take its owner lock."
            Quit
        }
        Set tHeld = 1
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "runnerUp") = 1

        Set $NAMESPACE = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "namespace")
        Set tRoutines = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "routineList")
        Set tSupervisorPid = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "pid")
        Set tSC = ##class(%Monitor.System.LineByLine).Start(tRoutines, $ListBuild("RtnLine"), $ListBuild($Job, tSupervisorPid))
        If $$$ISERR(tSC) {
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "startError") = $System.Status.GetErrorText(tSC)
            Quit
        }
        Set tStarted = 1
        Set tSession = $ListBuild(pId, ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "pid"), $Job, ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "startedAt"), tRoutines)
        Set ^IRIS.TempExecuteMCPv2Coverage("session") = tSession
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "sessionStarted") = 1

        Set tUser("ExecuteMCPv2CoverageRun") = pId
        Set tSpec = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "spec")
        Try {
            Set tTestSC = ..RunTest(tSpec, "/noload/nodelete/norecursive", .tUser)
        } Catch exTest {
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "runnerError") = exTest.DisplayString()
        }
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "testsDone") = 1
    } Catch ex {
        If 'tStarted Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "startError") = ex.DisplayString()
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "runnerError") = ex.DisplayString()
    }
    If tStarted Do ..StopOwnSession(pId)
    If tHeld Lock -^IRIS.TempExecuteMCPv2Coverage("owner", pId, "runner")
}

/// Record the counts, then stop this process's own session and record that it was released. Nothing is read or
/// stopped unless the active session proves to be this run's
/// (<method>ExecuteMCPv2.Coverage.Job:RunnerOwnsSession</method>): process-scoped, listing this process and no process
/// but this run's supervisor, with this run's routine names. The supervisor may already have read the counts and
/// stopped the session (it does when this process's owner lock is gone, for example after test code released every
/// lock of the process, or when this process outlived a cancel), and a session someone else started since is never
/// touched; the supervisor's <method>ExecuteMCPv2.Coverage.Job:Finish</method> reports what it finds.
/// <p>The proof, the read and the <code>Stop</code> run under the release locks
/// (<method>ExecuteMCPv2.Coverage.Job:TakeReleaseLocks</method>), so the supervisor cannot release at the same time and
/// no other <code>Start</code> or <code>Stop</code> lands in between. Under them, a session already released or counts
/// already read are not done again. A lock that cannot be taken in time stops nothing, and is recorded as
/// <code>releaseError</code>. When the counts cannot be read, the IRIS text is recorded as <code>readError</code> and the
/// counts are never marked as read; the session is stopped all the same.</p>
ClassMethod StopOwnSession(pId As %Integer) [ Private ]
{
    If '##class(ExecuteMCPv2.Coverage.Job).ListsProcess($Job) Quit
    Do ##class(ExecuteMCPv2.Coverage.Job).AwaitNamesReadable()
    If '##class(ExecuteMCPv2.Coverage.Job).TakeReleaseLocks(pId, .tLockText) {
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "releaseError") = "The test process left its session as it was: "_tLockText
        Quit
    }
    Try {
        If '##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "sessionReleased") && ##class(ExecuteMCPv2.Coverage.Job).RunnerOwnsSession(pId) {
            If '##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "hasCounts") {
                Try {
                    Set tReadSC = ..ReadCounts(pId)
                    If $$$ISERR(tReadSC) Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "readError") = $System.Status.GetErrorText(tReadSC)
                } Catch exRead {
                    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "readError") = exRead.DisplayString()
                }
            }
            Set tSC = ##class(%Monitor.System.LineByLine).Stop()
            If $$$ISOK(tSC) {
                Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "sessionReleased") = 1
                Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "releasedBy") = "runner"
            } Else {
                Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "releaseError") = $System.Status.GetErrorText(tSC)
            }
        }
    } Catch ex {
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "releaseError") = ex.DisplayString()
    }
    Do ##class(ExecuteMCPv2.Coverage.Job).DropReleaseLocks(pId)
}

/// Read the <code>RtnLine</code> count of every line of every measured routine of run <var>pId</var> from the active
/// session through the <class>%Monitor.System.LineByLine</class>:Result query, and record the lines with a count above
/// 0 in <code>("run",id,"hits",routineIndex,line)</code>. Row n of a routine's result is INT line n, and a routine that
/// never ran returns no rows, so every count is 0.
ClassMethod ReadCounts(pId As %Integer) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tRoutines = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "routines")
        Kill ^IRIS.TempExecuteMCPv2Coverage("run", pId, "hits")
        For tN = 1:1:$ListLength(tRoutines) {
            Set tName = $List($List(tRoutines, tN), 2)
            Set tResult = ##class(%ResultSet).%New("%Monitor.System.LineByLine:Result")
            Set tSC = tResult.Execute(tName)
            If $$$ISERR(tSC) Quit
            Set tLine = 0
            While tResult.Next() {
                Set tLine = tLine + 1
                Set tData = tResult.GetData(1)
                Set tCount = +$List(tData, 1)
                If tCount > 0 Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "hits", tN, tLine) = tCount
            }
            Do tResult.Close()
        }
        If $$$ISOK(tSC) Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "hasCounts") = 1
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Record the <code>%UnitTest_Result</code> run index (<code>manager.ResultId</code>) of the coverage run before any
/// test runs. The run is identified by the <code>ExecuteMCPv2CoverageRun</code> user parameter.
ClassMethod OnBeforeAllTests(manager As %UnitTest.Manager, dir As %String, ByRef qstruct, ByRef userparam) As %Status
{
    Set tId = $Get(userparam("ExecuteMCPv2CoverageRun"))
    If tId '= "" Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "runIndex") = manager.ResultId
    Quit $$$OK
}

}
