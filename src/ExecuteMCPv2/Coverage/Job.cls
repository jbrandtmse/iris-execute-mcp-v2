/// Line-coverage job mechanics for <class>ExecuteMCPv2.REST.Coverage</class> (Stories 40.1 and 40.2).
/// <p>This library owns the run record, the busy decision, routine resolution, the token skeleton,
/// the class-source map and the supervisor job. It returns raw data only: which INT lines are executable,
/// which class lines they belong to, and every percentage and verdict, is decided in TypeScript (AD-12).</p>
/// <p><b>Two suite jobs per run (AD-27).</b> The runner (<class>ExecuteMCPv2.Coverage.Runner</class>)
/// starts a Line-by-Line session scoped to itself and to the supervisor, runs the tests and stops its own
/// session. The supervisor (<method>Supervise</method>) turns a cancel or the time limit into terminating the
/// runner, and releases a session that a dead runner left behind. A session counts only the processes in its
/// process list, and <code>$SYSTEM.Process.Terminate</code> cannot be trapped, so the process that runs the
/// tests cannot be the only one that releases the monitor. Only a process in the session's process list can
/// read its routine names and line counts, which is why the supervisor is in that list.</p>
/// <p><b>Releasing the session.</b> Either releaser reads the counts and stops the session only after
/// <method>ProofFailure</method> shows that the active session is the run's own, and the two releasers never
/// act at once: both take the run's release lock and the monitor's own lock
/// (<method>TakeReleaseLocks</method>) and hold them from the proof through <code>Stop</code>. A lock that cannot
/// be taken in time stops nothing: when the runner cannot take it, the supervisor releases the session afterwards, and
/// when the supervisor cannot, the run ends <code>release-failed</code>.</p>
/// <p><b>The run record</b> lives in <code>^IRIS.TempExecuteMCPv2Coverage</code>, which is IRISTEMP:
/// instance-wide, like the monitor, and not journaled. The 20 most recent runs are kept and a record
/// does not survive an instance restart.</p>
/// <ul>
/// <li><code>("seq")</code> is the last run id allocated; <code>("run",id,field)</code> are the run's fields.</li>
/// <li><code>("session")</code> exists while a suite session may be active:
/// <code>$ListBuild(runId, supervisorPid, runnerPid, startedAt, $ListBuild(routine, ...))</code>.</li>
/// <li><code>("owner",id,"supervisor")</code> and <code>("owner",id,"runner")</code> are locks that each
/// process holds for its whole life. IRIS releases a dead process's lock, so a lock that can be taken
/// with timeout 0 belongs to a dead process.</li>
/// <li><code>("owner",id,"release")</code> is not a liveness lock: a releaser holds it only while it proves, reads
/// and stops, and <method>OwnerAlive</method> and <method>MayTerminate</method> never read it.</li>
/// <li><code>("start")</code> is the lock that makes the busy check and the launch atomic.</li>
/// <li><code>("run",id,"minCoverage")</code> is the optional target the run was started with.</li>
/// <li><code>("run",id,"sources",n)</code> is the class-source map of the n-th measured class
/// (<method>SourceMap</method>), written by <method>Finish</method> beside <code>("run",id,"skeleton",n)</code>.</li>
/// </ul>
Class ExecuteMCPv2.Coverage.Job Extends %RegisteredObject
{

/// The number of run records kept.
Parameter MAXRUNS As %Integer = 20;

/// Seconds a releaser waits for the run's release lock, which the other releaser holds while it proves and stops.
Parameter RELEASELOCKSECONDS As %Integer = 10;

/// Seconds a releaser waits for the monitor's own lock, <code>^%SYS("MON-HOLD")</code>.
Parameter MONITORLOCKSECONDS As %Integer = 5;

/// Is a Line-by-Line or PERFMON session active on this instance? This is the only place the suite calls
/// <code>$ZUtil(84,...)</code>; <code>$ZUtil(84,8)</code> is the same test <code>%Monitor.System.LineByLine:Start</code>
/// makes. <var>pPids</var> receives the process ids the session is scoped to (space-delimited), and is empty when the
/// session is not scoped to listed processes or cannot say (see <method>ScopedPids</method>).
/// <p>Any process can read the process list, but only a process that is itself in that list can read the session's
/// routine names and line counts (probe, IRIS 2026.2 build 221U: a process outside the list reads them as
/// unavailable, and a process in the list can read them after a short delay). That is why the session identity
/// check below compares process lists, and why the supervisor is in the session's process list.</p>
ClassMethod MonitorActive(Output pPids As %String) As %Boolean
{
    Set pPids = ""
    If $ZUtil(84, 8) '= 1 Quit 0
    Try {
        Set pPids = ..ScopedPids($ZUtil(84, 1), $ZUtil(84, 10, 2))
    } Catch {
        Set pPids = ""
    }
    Quit 1
}

/// The process list <var>pPids</var> as a session of collection mode <var>pMode</var> (<code>$ZUtil(84,1)</code>)
/// means it: the list itself when the session is scoped to listed processes (mode 2, as
/// <code>%Monitor.System.LineByLine:Start</code> sets it for a non-empty process list), and empty otherwise. In
/// all-processes mode (mode 1) every process is monitored, so the list is not a scope (probe, IRIS 2026.2 build 221U:
/// it read the starting process and then other processes). A paused session (mode 0) was not probed:
/// <code>%Monitor.System.LineByLine:Pause</code> saves a copy of a scoped session's list in
/// <code>^|"%SYS"|SYS("MONITOR","PAUSE","SELECTED")</code> before it sets mode 0, and <code>Resume</code> registers
/// those processes again, so what the list reads in mode 0 is not relied on. Neither mode's list says anything about the
/// active session, so neither is trusted.
ClassMethod ScopedPids(pMode As %Integer, pPids As %String) As %String
{
    If pMode '= 2 Quit ""
    Quit pPids
}

/// Does the active Line-by-Line session's process list name process <var>pPid</var>? Only a session scoped to
/// listed processes can (see <method>ScopedPids</method>). A releaser asks this of itself first: a session that does
/// not list it is not one it can prove to be its run's (see <method>ProofFailure</method>).
ClassMethod ListsProcess(pPid As %String) As %Boolean
{
    If (pPid = "") || '..MonitorActive(.tPids) Quit 0
    Quit ((" "_tPids_" ") [ (" "_pPid_" "))
}

/// The routines the active Line-by-Line session monitors, as a <class>%List</class>; empty when none is active.
/// A name this process cannot read yet is an empty element (see <method>MonitorActive</method>).
ClassMethod ActiveRoutines() As %List
{
    Set tList = ""
    If '..MonitorActive() Quit tList
    Set tCount = ##class(%Monitor.System.LineByLine).GetRoutineCount()
    For tI = 1:1:tCount {
        Set tList = tList_$ListBuild(##class(%Monitor.System.LineByLine).GetRoutineName(tI))
    }
    Quit tList
}

/// Can this process read the active session's routine names and line counts?
ClassMethod NamesReadable() As %Boolean
{
    Quit ..AllNamed(..ActiveRoutines())
}

/// Does the routine list <var>pList</var> hold at least one routine and no empty name (a name that could not be read)?
ClassMethod AllNamed(pList As %List) As %Boolean
{
    If $ListLength(pList) = 0 Quit 0
    Set tNamed = 1
    For tI = 1:1:$ListLength(pList) {
        If $List(pList, tI) = "" {
            Set tNamed = 0
            Quit
        }
    }
    Quit tNamed
}

/// Wait up to <var>pSeconds</var> for this process to be able to read the active session's routine names, which a
/// process in the session's process list can do after a short delay. Returns at once when the session does not list
/// this process (it can never read the names then) or has ended. The wait happens before any lock is taken, so the
/// monitor's own lock is never held while waiting. Returns whether the names are readable.
ClassMethod AwaitNamesReadable(pSeconds As %Integer = 15) As %Boolean
{
    For tI = 1:1:(pSeconds * 5) {
        If '..ListsProcess($Job) Quit
        If ..NamesReadable() Quit
        Hang 0.2
    }
    Quit ..NamesReadable()
}

/// Why the active Line-by-Line session is not scoped to the run whose supervisor is <var>pSupervisorPid</var> and whose
/// test process is <var>pRunnerPid</var>, as process <var>pSelfPid</var> (one of the two) can tell; empty when it is.
/// <var>pPids</var> is the session's process list as <method>MonitorActive</method> returns it. The scope holds only when
/// the session is scoped to listed processes, its list names this process, and its list holds only the run's two
/// processes that are still alive (<method>PidsMatch</method>). A session that monitors no routine has nothing else to
/// prove, so this is the whole proof for it (see <method>ProofFailure</method> for a session that monitors routines).
ClassMethod SessionScopeFailure(pPids As %String, pSelfPid As %String, pSupervisorPid As %String, pRunnerPid As %String) As %String
{
    If pPids = "" Quit "The active monitor session is not scoped to listed processes."
    If (pSelfPid = "") || ((" "_pPids_" ") '[ (" "_pSelfPid_" ")) Quit "The active monitor session does not list this process."
    If '..PidsMatch(pPids, pSupervisorPid, pRunnerPid) Quit "The active monitor session lists a process that is neither this run's test process nor its supervisor."
    Quit ""
}

/// Why the active Line-by-Line session is not the session of the run whose supervisor is <var>pSupervisorPid</var>,
/// whose test process is <var>pRunnerPid</var> and whose routines are <var>pRoutineList</var>, as process
/// <var>pSelfPid</var> (one of the two) can tell; empty when it is. <var>pPids</var> is the session's process list as
/// <method>MonitorActive</method> returns it, <var>pActive</var> the routines it reports. A session proves to be the
/// run's only when all of these hold: it is scoped to listed processes; its list names this process; its list holds
/// only the run's two processes that are still alive (<method>PidsMatch</method>), the three checks of
/// <method>SessionScopeFailure</method>; this process can read every routine name; and the names equal the run's
/// routine list.
ClassMethod ProofFailure(pPids As %String, pSelfPid As %String, pSupervisorPid As %String, pRunnerPid As %String, pRoutineList As %List, pActive As %List) As %String
{
    Set tScope = ..SessionScopeFailure(pPids, pSelfPid, pSupervisorPid, pRunnerPid)
    If tScope '= "" Quit tScope
    If '..AllNamed(pActive) Quit "This process could not read the routine names of the active monitor session."
    If '..ListsEqual(pRoutineList, pActive) Quit "The routines the monitor session reports are not this run's routine list."
    Quit ""
}

/// Does the active Line-by-Line session prove to be run <var>pId</var>'s, as seen by the runner (this process)? The
/// runner is in its own session's process list, so it can read the routine names. See <method>ProofFailure</method>.
ClassMethod RunnerOwnsSession(pId As %Integer) As %Boolean
{
    If '..MonitorActive(.tPids) Quit 0
    Quit (..ProofFailure(tPids, $Job, ..RunGet(pId, "pid"), $Job, ..RunGet(pId, "routineList"), ..ActiveRoutines()) = "")
}

/// Does the active session's own process list disprove the session node <var>pSession</var>? Only a session scoped to
/// listed processes has a list of its own (see <method>ScopedPids</method>), so only such a session can be shown not to
/// be the one the node describes: a session of all processes, or a paused one, cannot, and the node is kept.
ClassMethod SessionDisproved(pSession As %List) As %Boolean
{
    If pSession = "" Quit 0
    If '..MonitorActive(.tPids) Quit 0
    Quit ..NodeDisproved(pSession, tPids, ##class(%Monitor.System.LineByLine).GetRoutineCount())
}

/// The decision of <method>SessionDisproved</method> on given state: the process list <var>pPids</var> is a scoped
/// session's own (not empty) and does not match the session node <var>pSession</var> (see <method>NodeMatches</method>).
ClassMethod NodeDisproved(pSession As %List, pPids As %String, pRoutineCount As %Integer) As %Boolean
{
    If (pSession = "") || (pPids = "") Quit 0
    Quit '..NodeMatches(pSession, pPids, pRoutineCount)
}

/// Take the locks under which one releaser at a time proves a session its own and stops it: the run's release lock
/// (<code>("owner",id,"release")</code>), then the monitor's own lock, <code>^%SYS("MON-HOLD")</code>, which
/// <code>%Monitor.System.LineByLine</code> takes in <code>Start</code>, <code>Stop</code>, <code>Pause</code> and
/// <code>Resume</code>, each of which refuses when it cannot take it within 3 seconds. Held from the identity check
/// through <code>Stop</code>, they leave no gap in which the other releaser, or another caller of those four methods,
/// can act. They do not exclude <code>%Monitor.System.LineByLine:Clear</code> or the <code>^PROFILE</code> utility,
/// which take <code>^|"%SYS"|SYS("MON-HOLD")</code> instead, nor <code>AddRoutine</code>, which goes on without the
/// lock after 3 seconds. Each is taken with a timeout. Returns 1 when both are held; otherwise it holds neither, returns 0, and
/// <var>pWhy</var> says which one timed out. The caller releases both with <method>DropReleaseLocks</method>.
ClassMethod TakeReleaseLocks(pId As %Integer, Output pWhy As %String, pReleaseSeconds As %Integer = "", pMonitorSeconds As %Integer = "") As %Boolean
{
    Set pWhy = ""
    If pReleaseSeconds = "" Set pReleaseSeconds = ..#RELEASELOCKSECONDS
    If pMonitorSeconds = "" Set pMonitorSeconds = ..#MONITORLOCKSECONDS
    Lock +^IRIS.TempExecuteMCPv2Coverage("owner", pId, "release"):pReleaseSeconds
    If '$Test {
        Set pWhy = "another releaser of this run held the release lock for "_pReleaseSeconds_" seconds"
        Quit 0
    }
    Lock +^%SYS("MON-HOLD"):pMonitorSeconds
    If '$Test {
        Lock -^IRIS.TempExecuteMCPv2Coverage("owner", pId, "release")
        Set pWhy = "the monitor's own lock was held by another process for "_pMonitorSeconds_" seconds"
        Quit 0
    }
    Quit 1
}

/// Release the locks <method>TakeReleaseLocks</method> took.
ClassMethod DropReleaseLocks(pId As %Integer)
{
    Lock -^%SYS("MON-HOLD")
    Lock -^IRIS.TempExecuteMCPv2Coverage("owner", pId, "release")
}

/// Is the process list <var>pPids</var> that of a coverage session of the runner <var>pRunnerPid</var> and its
/// supervisor <var>pSupervisorPid</var>? The runner starts the session with
/// <code>$ListBuild($JOB, supervisorPid)</code>. IRIS reports the processes of the list that are still alive, space
/// separated and in ascending order of process id (not the order they were given in); a process that has ended
/// leaves the list, and a list with no live process reads <code>0</code> (probe, IRIS 2026.2 build 221U).
/// So the list matches when it has one or two entries, each the runner's PID, the supervisor's PID or
/// <code>0</code>, with no repeated PID. Any other list does not match.
ClassMethod PidsMatch(pPids As %String, pSupervisorPid As %String, pRunnerPid As %String) As %Boolean
{
    If (pSupervisorPid = "") || (pRunnerPid = "") Quit 0
    Set tCount = $Length(pPids, " ")
    If (pPids = "") || (tCount > 2) Quit 0
    For tI = 1:1:tCount {
        Set tPid = $Piece(pPids, " ", tI)
        If tPid = "" Quit
        If (tPid '= 0) && (tPid '= pSupervisorPid) && (tPid '= pRunnerPid) {
            Set tPid = ""
            Quit
        }
        If (tPid '= 0) && $Data(tSeen(tPid)) {
            Set tPid = ""
            Quit
        }
        Set tSeen(tPid) = ""
    }
    Quit (tPid '= "")
}

/// Is the active session the one the session node <var>pSession</var> describes, as a process outside the session
/// can prove it? Such a process cannot read the session's routine names, so the proof is the process list (see
/// <method>PidsMatch</method>) and the number of monitored routines. This is the identity proof for reclaiming a
/// session whose two owner processes have ended; the supervisor, which is in the process list, proves the stronger
/// routine-name equality (see <method>ProveOwnSession</method>).
ClassMethod SessionMatches(pSession As %List) As %Boolean
{
    If pSession = "" Quit 0
    If '..MonitorActive(.tPids) Quit 0
    Quit ..NodeMatches(pSession, tPids, ##class(%Monitor.System.LineByLine).GetRoutineCount())
}

/// The decision of <method>SessionMatches</method> on given state: the process list <var>pPids</var> matches the
/// processes the session node <var>pSession</var> names (see <method>PidsMatch</method>), and the number of monitored
/// routines <var>pRoutineCount</var> equals the node's routine count.
ClassMethod NodeMatches(pSession As %List, pPids As %String, pRoutineCount As %Integer) As %Boolean
{
    If pSession = "" Quit 0
    If '..PidsMatch(pPids, $ListGet(pSession, 2), $ListGet(pSession, 3)) Quit 0
    Quit (pRoutineCount = $ListLength($ListGet(pSession, 5)))
}

/// Do two routine lists name the same routines, whatever their order?
ClassMethod ListsEqual(pA As %List, pB As %List) As %Boolean
{
    If $ListLength(pA) '= $ListLength(pB) Quit 0
    For tI = 1:1:$ListLength(pA) Set tSeen("n"_$List(pA, tI)) = ""
    Set tEqual = 1
    For tI = 1:1:$ListLength(pB) {
        If '$Data(tSeen("n"_$List(pB, tI))) {
            Set tEqual = 0
            Quit
        }
    }
    Quit tEqual
}

/// The busy decision, a pure function of the monitor and record state. Returns one of
/// <code>proceed</code>, <code>reclaim</code>, <code>clear-and-proceed</code>,
/// <code>clear-busy-foreign</code>, <code>busy-suite</code> and <code>busy-foreign</code>.
/// <table>
/// <tr><th>session node</th><th>owners alive</th><th>monitor active</th><th>list matches</th><th>live run</th><th>decision</th></tr>
/// <tr><td>set</td><td>yes</td><td>any</td><td>any</td><td>any</td><td>busy-suite</td></tr>
/// <tr><td>set</td><td>no</td><td>yes</td><td>yes</td><td>any</td><td>reclaim</td></tr>
/// <tr><td>set</td><td>no</td><td>yes</td><td>no</td><td>any</td><td>clear-busy-foreign</td></tr>
/// <tr><td>set</td><td>no</td><td>no</td><td>any</td><td>any</td><td>clear-and-proceed</td></tr>
/// <tr><td>unset</td><td>n/a</td><td>any</td><td>any</td><td>yes</td><td>busy-suite</td></tr>
/// <tr><td>unset</td><td>n/a</td><td>yes</td><td>any</td><td>no</td><td>busy-foreign</td></tr>
/// <tr><td>unset</td><td>n/a</td><td>no</td><td>any</td><td>no</td><td>proceed</td></tr>
/// </table>
ClassMethod BusyDecision(pMonitorActive As %Boolean, pSessionDefined As %Boolean, pOwnersAlive As %Boolean, pListMatches As %Boolean, pLiveRun As %Boolean) As %String
{
    If pSessionDefined {
        If pOwnersAlive Quit "busy-suite"
        If 'pMonitorActive Quit "clear-and-proceed"
        If pListMatches Quit "reclaim"
        Quit "clear-busy-foreign"
    }
    If pLiveRun Quit "busy-suite"
    If pMonitorActive Quit "busy-foreign"
    Quit "proceed"
}

/// Gather the session, monitor and run state, and return the <method>BusyDecision</method>.
/// <var>pSession</var> is the session node (empty when unset); <var>pLiveRunId</var> is the newest live
/// non-terminal run (empty when none).
ClassMethod Evaluate(Output pSession As %List, Output pLiveRunId As %Integer) As %String
{
    Set pSession = $Get(^IRIS.TempExecuteMCPv2Coverage("session"))
    Set tDefined = ($Data(^IRIS.TempExecuteMCPv2Coverage("session")) # 2)
    Set tActive = ..MonitorActive()
    Set tOwners = 0
    Set tMatches = 0
    If tDefined {
        Set tSessionId = $ListGet(pSession, 1)
        Set tOwners = ..OwnerAlive(tSessionId, "supervisor") || ..OwnerAlive(tSessionId, "runner")
        Set tMatches = ..SessionMatches(pSession)
    }
    Set pLiveRunId = ..LiveRunId()
    Quit ..BusyDecision(tActive, tDefined, tOwners, tMatches, (pLiveRunId '= ""))
}

/// Is the process that holds <var>pRole</var>'s owner lock of run <var>pId</var> alive? A lock that can
/// be taken with timeout 0 belongs to a dead process, and is released at once. Never call this for the
/// role of the calling process: a process always takes a lock it already holds.
ClassMethod OwnerAlive(pId As %Integer, pRole As %String) As %Boolean
{
    Lock +^IRIS.TempExecuteMCPv2Coverage("owner", pId, pRole):0
    If $Test {
        Lock -^IRIS.TempExecuteMCPv2Coverage("owner", pId, pRole)
        Quit 0
    }
    Quit 1
}

/// May the suite terminate process <var>pPid</var> as the <var>pRole</var> (<code>supervisor</code> or
/// <code>runner</code>) of run <var>pId</var>? A PID can be reused once its process dies, and this is a
/// shared instance, so this is true only when <var>pPid</var> equals the record's PID for that role and
/// that role's owner lock cannot be taken with timeout 0: the process holding it is still the suite's own.
/// Call it immediately before every <code>Terminate</code>, and terminate only when it is true.
ClassMethod MayTerminate(pId As %Integer, pRole As %String, pPid As %Integer) As %Boolean
{
    If (pRole '= "supervisor") && (pRole '= "runner") Quit 0
    Set tRecordPid = $Get(^IRIS.TempExecuteMCPv2Coverage("run", pId, $Select(pRole = "supervisor": "pid", 1: "runnerPid")))
    If (tRecordPid = "") || (pPid = "") || (pPid '= tRecordPid) Quit 0
    Quit ..OwnerAlive(pId, pRole)
}

/// The newest non-terminal run whose supervisor or runner is alive; empty when there is none.
ClassMethod LiveRunId() As %Integer
{
    Set tId = ""
    For {
        Set tId = $Order(^IRIS.TempExecuteMCPv2Coverage("run", tId), -1)
        If tId = "" Quit
        If ..IsTerminal(..RunGet(tId, "status")) Continue
        If ..OwnerAlive(tId, "supervisor") || ..OwnerAlive(tId, "runner") Quit
    }
    Quit tId
}

/// Is <var>pStatus</var> a terminal run status?
ClassMethod IsTerminal(pStatus As %String) As %Boolean
{
    Quit (pStatus = "completed") || (pStatus = "cancelled") || (pStatus = "failed") || (pStatus = "abandoned")
}

/// One field of a run record.
ClassMethod RunGet(pId As %Integer, pField As %String) As %String
{
    Quit $Get(^IRIS.TempExecuteMCPv2Coverage("run", pId, pField))
}

/// Does run <var>pId</var> exist?
ClassMethod RunExists(pId As %Integer) As %Boolean
{
    Quit ($Data(^IRIS.TempExecuteMCPv2Coverage("run", pId, "status")) # 2)
}

/// The current UTC time as ISO 8601 with a trailing <code>Z</code>.
ClassMethod UtcNow() As %String
{
    Quit $Translate($ZDateTime($ZTimeStamp, 3, 1, 3), " ", "T")_"Z"
}

/// Set a run's status. A terminal status also records <code>finishedAt</code>, and
/// <var>pReason</var> and <var>pError</var> are recorded when given.
ClassMethod SetStatus(pId As %Integer, pStatus As %String, pReason As %String = "", pError As %String = "")
{
    If pReason '= "" Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "reason") = pReason
    If pError '= "" Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "error") = pError
    If ..IsTerminal(pStatus) Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "finishedAt") = ..UtcNow()
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "status") = pStatus
}

/// Write the record of a new run, in status <code>starting</code>. <var>pParams</var> holds the validated
/// request (see <method>ExecuteMCPv2.REST.Coverage:ValidateStart</method>); <var>pRoutines</var> is the
/// measured routines as <method>ResolveRoutines</method> returns them, <var>pUnmeasured</var> the classes
/// that are not measured, <var>pSpec</var> the test spec, and <var>pReclaimed</var> the dead run this run
/// reclaimed (<code>$ListBuild(runId, pid)</code>), or empty.
ClassMethod CreateRun(pId As %Integer, ByRef pParams, pNamespace As %String, pRoutines As %List, pUnmeasured As %List, pSpec As %String, pReclaimed As %List = "")
{
    Kill ^IRIS.TempExecuteMCPv2Coverage("run", pId)
    Set tNames = ""
    For tI = 1:1:$ListLength(pRoutines) Set tNames = tNames_$ListBuild($List($List(pRoutines, tI), 2))
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "namespace") = pNamespace
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "target") = pParams("target")
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "level") = pParams("level")
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "maxSeconds") = pParams("maxSeconds")
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "maxLines") = pParams("maxLines")
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "classes") = pParams("classes")
    If $Get(pParams("minCoverage")) '= "" Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "minCoverage") = pParams("minCoverage")
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "spec") = pSpec
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "routines") = pRoutines
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "routineList") = tNames
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "unmeasured") = pUnmeasured
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "startedAt") = ..UtcNow()
    If pReclaimed '= "" Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "reclaimed") = pReclaimed
    Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "status") = "starting"
}

/// Keep at most <var>pMax</var> (default <parameter>MAXRUNS</parameter>) run records: delete the oldest terminal
/// records, and any non-terminal record whose supervisor is dead. Never delete <var>pKeepId</var>, the run the
/// session node names, or a non-terminal record whose supervisor is alive.
ClassMethod Prune(pKeepId As %Integer, pMax As %Integer = "")
{
    If pMax = "" Set pMax = ..#MAXRUNS
    Set tCount = 0
    Set tId = ""
    For {
        Set tId = $Order(^IRIS.TempExecuteMCPv2Coverage("run", tId))
        If tId = "" Quit
        Set tCount = tCount + 1
    }
    If tCount <= pMax Quit
    Set tSessionId = $ListGet($Get(^IRIS.TempExecuteMCPv2Coverage("session")), 1)
    Set tId = ""
    For {
        Set tId = $Order(^IRIS.TempExecuteMCPv2Coverage("run", tId))
        If (tId = "") || (tCount <= pMax) Quit
        If (tId = pKeepId) || (tId = tSessionId) Continue
        If '..IsTerminal(..RunGet(tId, "status")) && ..OwnerAlive(tId, "supervisor") Continue
        Kill ^IRIS.TempExecuteMCPv2Coverage("run", tId)
        Set tCount = tCount - 1
    }
}

/// Is <var>pName</var> a class name: a name the class dictionary accepts (<class>%Dictionary.Classname</class>, the type
/// of <code>%Dictionary.ClassDefinition.Name</code>)? That is at most 220 characters of dot-separated names, each a valid
/// IRIS name of letters and digits that begins with a letter, where only the first may begin with <code>%</code>. Any
/// letter IRIS accepts in a name counts, a letter without case (a CJK one, for example) included, so every class that can
/// exist is a class name here.
ClassMethod IsClassName(pName As %String) As %Boolean
{
    If (pName = "") || ($Length(pName) > 220) Quit 0
    Quit $$$ISOK(##class(%Dictionary.Classname).IsValid(pName))
}

/// Resolve the routines to measure for <var>pClasses</var> (a <class>%List</class> of class names) in namespace
/// <var>pNamespace</var>. For each class, the routines <code>.1</code> to <code>.N</code> that the compiler
/// generated (the <code>.0</code> method-generator routine is never measured). A class is measured only when
/// it is compiled and every routine that has object code also has kept INT source.
/// <p>Returns a <class>%List</class> of <code>$ListBuild(class, routine, lines)</code>. <var>pUnmeasured</var>
/// is a <class>%List</class> of <code>$ListBuild(class, reason)</code>, where reason is <code>not-compiled</code>,
/// <code>no-routines</code> (no routine of the class has object code) or <code>no-int-source</code>.
/// <var>pTotalLines</var> is the number of INT lines over the measured routines. <var>pError</var> is empty, or
/// IRIS's own text when resolving failed (a namespace or privilege error); nothing is then measured.</p>
ClassMethod ResolveRoutines(pNamespace As %String, pClasses As %List, Output pUnmeasured As %List, Output pTotalLines As %Integer, Output pError As %String) As %List
{
    Set tResult = ""
    Set pUnmeasured = ""
    Set pTotalLines = 0
    Set pError = ""
    Set tOrigNS = $NAMESPACE
    Try {
        If pNamespace '= "" Set $NAMESPACE = pNamespace
        For tI = 1:1:$ListLength(pClasses) {
            Set tClass = $List(pClasses, tI)
            If '$$$comClassDefined(tClass) {
                Set pUnmeasured = pUnmeasured_$ListBuild($ListBuild(tClass, "not-compiled"))
                Continue
            }
            Set tCount = +$$$comClassKeyGet(tClass, $$$cCLASSroutinecount)
            Set tEntries = ""
            Set tLines = 0
            Set tMissingSource = 0
            For tN = 1:1:tCount {
                Set tRoutine = $$$nameClassRoutineNameGet(tClass, tN)
                If '$Data(^rOBJ(tRoutine)) Continue
                If '$Data(^ROUTINE(tRoutine, 0, 0)) {
                    Set tMissingSource = 1
                    Quit
                }
                Set tEntries = tEntries_$ListBuild($ListBuild(tClass, tRoutine, +$Get(^ROUTINE(tRoutine, 0, 0))))
                Set tLines = tLines + $Get(^ROUTINE(tRoutine, 0, 0))
            }
            If tMissingSource {
                Set pUnmeasured = pUnmeasured_$ListBuild($ListBuild(tClass, "no-int-source"))
            } ElseIf tEntries = "" {
                Set pUnmeasured = pUnmeasured_$ListBuild($ListBuild(tClass, "no-routines"))
            } Else {
                Set tResult = tResult_tEntries
                Set pTotalLines = pTotalLines + tLines
            }
        }
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tResult = ""
        Set pUnmeasured = ""
        Set pTotalLines = 0
        Set pError = ..SafeText($System.Status.GetErrorText(ex.AsStatus()))
    }
    Set $NAMESPACE = tOrigNS
    Quit tResult
}

/// The token skeleton of INT routine <var>pRoutine</var> in namespace <var>pNamespace</var>, by line:
/// <code>pSkeleton(line)</code> is the line's labels, commands and braces. A line with no command has no entry.
/// See <method>LineSkeleton</method>.
ClassMethod Skeleton(pNamespace As %String, pRoutine As %String, Output pSkeleton) As %Status
{
    Kill pSkeleton
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        If pNamespace '= "" Set $NAMESPACE = pNamespace
        If '$Data(^ROUTINE(pRoutine, 0, 0)) {
            Set tSC = $$$ERROR($$$GeneralError, "INT routine "_pRoutine_" has no kept source in namespace "_$NAMESPACE)
            Quit
        }
        Set tRoutine = ##class(%Library.Routine).%OpenId(pRoutine_".INT")
        If '$IsObject(tRoutine) {
            Set tSC = $$$ERROR($$$GeneralError, "INT routine "_pRoutine_" could not be opened in namespace "_$NAMESPACE)
            Quit
        }
        Set tStream = ##class(%Stream.TmpCharacter).%New()
        While 'tRoutine.AtEnd {
            Do tStream.WriteLine(tRoutine.ReadLine())
        }
        Set tSC = ##class(%Library.SyntaxColorReader).FromCode(tStream, "INT", "A", .tReader)
        If $$$ISERR(tSC) Quit
        Set tLine = 0
        While tReader.NextLine(.tTokens) {
            Set tLine = tLine + 1
            Set tText = ..LineSkeleton(tTokens)
            If tText '= "" Set pSkeleton(tLine) = tText
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrigNS
    Quit tSC
}

/// The skeleton of one line from its syntax-colour tokens (each <code>$ListBuild(language, attribute, text)</code>):
/// a <code>Label</code> token becomes <code>L</code>, a <code>Command</code> token <code>C:</code> and its text in
/// lower case, and a <code>Brace</code> token its text. Every other token is dropped, and the rest are joined with
/// single spaces. A line with no <code>Command</code> token returns an empty string.
ClassMethod LineSkeleton(pTokens As %List) As %String
{
    Set tText = ""
    Set tHasCommand = 0
    For tI = 1:1:$ListLength(pTokens) {
        Set tToken = $List(pTokens, tI)
        Set tAttribute = $List(tToken, 2)
        If tAttribute = "Label" {
            Set tPart = "L"
        } ElseIf tAttribute = "Command" {
            Set tPart = "C:"_$ZConvert($List(tToken, 3), "L")
            Set tHasCommand = 1
        } ElseIf tAttribute = "Brace" {
            Set tPart = $List(tToken, 3)
        } Else {
            Continue
        }
        Set tText = tText_$Select(tText = "": "", 1: " ")_tPart
    }
    If 'tHasCommand Quit ""
    Quit tText
}

/// The class-source map of class <var>pClass</var> in namespace <var>pNamespace</var>: which INT line each body line of
/// each method that the class itself defines belongs to. It is raw data, the sibling of <method>Skeleton</method>
/// (AD-12): which of those INT lines are executable or covered, and what share of them is, is decided in TypeScript.
/// <p><var>pMap</var> is <code>$ListBuild(class, reason)</code> for a class with <code>reason</code>
/// <code>not-compiled</code> (the class has no compiled definition) or <code>not-up-to-date</code> (its definition
/// changed after it was compiled, <code>$System.OBJ.IsUpToDate</code>, so the compiled code no longer matches the
/// document), and <code>$ListBuild(class, "", lineMap)</code> for a class that is mapped. <code>lineMap</code> is
/// <code>$Data(^rMAP(class))</code> in the target namespace: 10 while the class has the debug line map that its compile
/// wrote, and 0 once a documentation-only save removed it, which is how a stale map shows. Then, for each method that the
/// class source defines, in the order the class document declares them,
/// <code>pMap("m",i)</code> is <code>$ListBuild(name, line, routine, reason, labelLine)</code>:</p>
/// <ul>
/// <li><code>line</code> is the class-document line D that declares the method, or empty when it cannot be found.
/// A class is stored in IRIS's own layout (signature on one line, <code>{</code> on line D+1), so body line k of the
/// method (k = 1 to n) is document line D+1+k, and the closing brace is line D+2+n.</li>
/// <li><code>reason</code> is empty for a method whose body lines map: <code>generator</code> (CodeMode
/// <code>objectgenerator</code> or <code>generator</code>: the body runs at compile time), <code>not-objectscript</code> (any
/// other Language) or <code>layout</code> (the declaration, the <code>{</code> line or the <code>}</code> line is not where
/// the layout says). A method with a reason has no body map.</li>
/// <li><code>pMap("m",i,k)</code> is the INT line of body line k, or 0 when that line has none. It comes from
/// <code>%Studio.Debugger:INTLine</code>, and only return type 0 (mapped) counts: 1 means the line is unmapped and the next
/// mapped line is returned instead, 2 means no mapping at all. A preprocessor line (<method>IsDirective</method>) has
/// none, whatever <code>INTLine</code> says: the compiler maps a leading one onto INT lines near the method's label, which
/// belong to the method before it or to the method's own first statements. An initializing <code>#dim</code> is not a
/// preprocessor line: it compiles to a <code>Set</code> at its own INT line. <code>routine</code> is the INT routine of the
/// first mapped line, and empty when none maps.</li>
/// </ul>
/// <p><code>labelLine</code> (the fifth element) is the INT line of the method's compiled label in <code>routine</code>, and 0
/// when it is not known. A method that compiled to INT code has a label line, which is the first line of its INT block: its
/// body maps to lines after it. The label is the one the compiler recorded for the method (<code>RtnLabel</code>,
/// <code>label^routine</code>), so two methods whose names share their first <code>$$$MAXLABELLENGTH</code> characters have
/// distinct labels. A method that compiled to no INT code (a constant return, a generator, a method not written in
/// ObjectScript) has no <code>label^routine</code> and no label line, and neither has a method whose label is not in the INT
/// text or whose compiled routine is not the one its body maps to. The label lines come from the INT text, which a
/// documentation-only edit saved after the compile leaves in place while it removes the class's line map: a method with a
/// label line in a class with <code>lineMap</code> 0 is how a stale map shows.</p>
/// The namespace is restored on every exit path. A failure to read the class text or the dictionary is returned as the
/// status, and the caller records the class as unavailable.
ClassMethod SourceMap(pNamespace As %String, pClass As %String, Output pMap) As %Status
{
    Kill pMap
    Set pMap = $ListBuild(pClass, "")
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        If pNamespace '= "" Set $NAMESPACE = pNamespace
        If '$$$comClassDefined(pClass) {
            Set pMap = $ListBuild(pClass, "not-compiled")
            Quit
        }
        If '$System.OBJ.IsUpToDate(pClass) {
            Set pMap = $ListBuild(pClass, "not-up-to-date")
            Quit
        }
        Set pMap = $ListBuild(pClass, "", $Data(^rMAP(pClass)))
        Set tSC = ##class(%Atelier.v1.Utils.TextServices).GetTextAsArray(pClass_".cls", 0, .tText)
        If $$$ISERR(tSC) Quit
        Do ..IndexDeclarations(.tText, .tDeclarations)
        Do ..IndexLabels(pClass, .tLabels)
        Set tName = ""
        For {
            Set tName = $$$defMemberNext(pClass, $$$cCLASSmethod, tName)
            If tName = "" Quit
            Set tOrder(+$$$defMemberKeyGet(pClass, $$$cCLASSmethod, tName, $$$cMETHsequencenumber), tName) = ""
        }
        Set tIndex = 0
        Set tSequence = ""
        For {
            Set tSequence = $Order(tOrder(tSequence))
            If tSequence = "" Quit
            Set tName = ""
            For {
                Set tName = $Order(tOrder(tSequence, tName))
                If tName = "" Quit
                Set tIndex = tIndex + 1
                Do ..MapMethod(pClass, tName, .tText, .tDeclarations, .tLabels, tIndex, .pMap)
            }
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrigNS
    Quit tSC
}

/// Index the method declarations of a class document in one pass: <code>pDeclarations(name, line)</code> is set for
/// every line of <var>pText</var> (<code>pText(0)</code> lines, as <code>GetTextAsArray</code> returns them) that begins
/// with <code>Method</code> or <code>ClassMethod</code> and a name.
ClassMethod IndexDeclarations(ByRef pText, Output pDeclarations)
{
    Kill pDeclarations
    For tI = 1:1:+$Get(pText(0)) {
        If '$Locate(pText(tI), "(?i)^(Class)?Method\s+", 1, tEnd) Continue
        Set tRest = $Extract(pText(tI), tEnd, *)
        Set tName = $Translate($Piece($Piece(tRest, "(", 1), " ", 1), """")
        If tName '= "" Set pDeclarations(tName, tI) = ""
    }
}

/// Index the INT labels of the routines that class <var>pClass</var> compiled to, in one pass over each routine's INT text:
/// <code>pLabels(routine, label)</code> is the line of the first line of <code>routine</code> that begins with
/// <var>label</var> (a label starts in column 1 and ends at a space, a tab, a left parenthesis or a semicolon, as
/// <code>%Studio.Debugger:INTLine</code> reads one).
ClassMethod IndexLabels(pClass As %String, Output pLabels)
{
    Kill pLabels
    For tN = 1:1:+$$$comClassKeyGet(pClass, $$$cCLASSroutinecount) {
        Set tRoutine = $$$nameClassRoutineNameGet(pClass, tN)
        For tLine = 1:1:+$Get(^ROUTINE(tRoutine, 0, 0)) {
            Set tLabel = $Piece($Piece($Piece($Piece($Get(^ROUTINE(tRoutine, 0, tLine)), $Char(9)), " "), "("), ";")
            If (tLabel '= "") && '$Data(pLabels(tRoutine, tLabel)) Set pLabels(tRoutine, tLabel) = tLine
        }
    }
}

/// The INT line of the compiled label of method <var>pName</var> of class <var>pClass</var>, from <var>pLabels</var> (see
/// <method>IndexLabels</method>), or 0 when the method has no known label. The label is the compiler's own
/// (<code>RtnLabel</code>, <code>label^routine</code>), so it is exact whatever the method's name. It is 0 when the keyword
/// is not <code>label^routine</code> (a method that compiled to no INT code has none or an inlined constant), when the
/// label is not in that routine's INT text, or when <var>pRoutine</var>, the routine the method's body maps to, is not empty
/// and is another routine.
ClassMethod LabelLine(pClass As %String, pName As %String, pRoutine As %String, ByRef pLabels) As %Integer
{
    Set tRtnLabel = $$$comMemberKeyGet(pClass, $$$cCLASSmethod, pName, $$$cMETHrtnlabel)
    If $Length(tRtnLabel, "^") '= 2 Quit 0
    Set tLabel = $Piece(tRtnLabel, "^", 1)
    Set tRoutine = $Piece(tRtnLabel, "^", 2)
    If (tLabel = "") || (tRoutine = "") Quit 0
    If (pRoutine '= "") && (pRoutine '= tRoutine) Quit 0
    Quit +$Get(pLabels(tRoutine, tLabel))
}

/// The class-document line D that declares method <var>pName</var>, whose body holds <var>pCount</var> lines, from the
/// index <var>pDeclarations</var> (see <method>IndexDeclarations</method>) of the document <var>pText</var>.
/// <var>pLayoutOK</var> is 1 when the layout is where IRIS stores it: line D+1 is <code>{</code> and line D+2+n is
/// <code>}</code>. A name declared on one line is that line (with <var>pLayoutOK</var> telling whether its braces are
/// where they should be). A name declared on several lines is resolved to the one whose braces are where the layout says;
/// when that leaves none or several, or the name is not declared at all, the result is empty and <var>pLayoutOK</var> is 0.
ClassMethod DeclarationLine(ByRef pText, ByRef pDeclarations, pName As %String, pCount As %Integer, Output pLayoutOK As %Boolean) As %Integer
{
    Set tCandidates = 0
    Set tValid = 0
    Set tFirst = ""
    Set tValidLine = ""
    Set tLine = ""
    For {
        Set tLine = $Order(pDeclarations(pName, tLine))
        If tLine = "" Quit
        Set tCandidates = tCandidates + 1
        If tFirst = "" Set tFirst = tLine
        If ($ZStrip($Get(pText(tLine + 1)), "<>W") = "{") && ($ZStrip($Get(pText(tLine + 2 + pCount)), "<>W") = "}") {
            Set tValid = tValid + 1
            Set tValidLine = tLine
        }
    }
    Set pLayoutOK = (tValid = 1)
    Quit $Select(tCandidates = 1: tFirst, tValid = 1: tValidLine, 1: "")
}

/// Is class-document line <var>pLine</var> a preprocessor line: <code>#dim</code>, <code>#define</code>, <code>#sqlcompile</code>,
/// <code>#;</code> and the other directives? It is when, after any leading blanks, it begins with one <code>#</code> followed
/// by a letter or a semicolon. A line that begins with <code>##</code> (<code>##class</code>, <code>##super</code>) is not.
/// <p>A <code>#dim</code> line (in any letter case) that holds an <code>=</code> outside parentheses and string literals
/// initializes its variable, and the compiler turns it into a <code>Set</code> at its own INT line, so it is not a
/// preprocessor line here. Every other directive is one: the compiler maps a leading one onto code that belongs to other
/// methods.</p>
ClassMethod IsDirective(pLine As %String) As %Boolean
{
    Set tText = $ZStrip(pLine, "<W")
    If '(($Extract(tText, 1) = "#") && ($Extract(tText, 2) ? 1(1A,1";"))) Quit 0
    If '$Locate(tText, "(?i)^#dim(\s|$)", 1, tEnd) Quit 1
    Quit '..HasInitializer($Extract(tText, tEnd, *))
}

/// Does <var>pText</var>, the text of a <code>#dim</code> line after the directive name, hold an <code>=</code> outside
/// parentheses and string literals? A string literal opens at a double quote and closes at the next one, so a doubled quote
/// inside it closes and reopens it.
ClassMethod HasInitializer(pText As %String) As %Boolean
{
    Set tDepth = 0
    Set tQuoted = 0
    Set tFound = 0
    For tI = 1:1:$Length(pText) {
        Set tChar = $Extract(pText, tI)
        If tChar = """" {
            Set tQuoted = 'tQuoted
        } ElseIf 'tQuoted {
            If tChar = "(" {
                Set tDepth = tDepth + 1
            } ElseIf (tChar = ")") && (tDepth > 0) {
                Set tDepth = tDepth - 1
            } ElseIf (tChar = "=") && (tDepth = 0) {
                Set tFound = 1
                Quit
            }
        }
    }
    Quit tFound
}

/// Map the body lines of method <var>pName</var> of class <var>pClass</var> into <var>pMap</var> entry <var>pIndex</var>
/// (see <method>SourceMap</method> and <method>DeclarationLine</method>).
ClassMethod MapMethod(pClass As %String, pName As %String, ByRef pText, ByRef pDeclarations, ByRef pLabels, pIndex As %Integer, ByRef pMap) [ Private ]
{
    Set tCount = +$$$defMemberKeyGet(pClass, $$$cCLASSmethod, pName, $$$cMETHimplementation)
    Set tCodeMode = $ZConvert($$$defMemberKeyGet(pClass, $$$cCLASSmethod, pName, $$$cMETHcodemode), "L")
    ; The compiled keyword carries the class's Language default; the definition's keyword is empty for a method with none of its own.
    Set tLanguage = $ZConvert($$$comMemberKeyGet(pClass, $$$cCLASSmethod, pName, $$$cMETHlanguage), "L")
    Set tReason = ""
    If (tCodeMode = "objectgenerator") || (tCodeMode = "generator") {
        Set tReason = "generator"
    } ElseIf (tLanguage '= "") && (tLanguage '= "objectscript") && (tLanguage '= "cache") {
        Set tReason = "not-objectscript"
    }

    Set tDeclaration = ..DeclarationLine(.pText, .pDeclarations, pName, tCount, .tLayoutOK)
    If (tReason = "") && 'tLayoutOK Set tReason = "layout"
    If tReason '= "" {
        Set pMap("m", pIndex) = $ListBuild(pName, tDeclaration, "", tReason)
        Quit
    }

    Set tRoutine = ""
    For tK = 1:1:tCount {
        Set tIntName = ""
        Set tIntLine = -1
        Set tType = 2
        Set tSC = ##class(%Studio.Debugger).INTLine(pClass_".CLS", pName, tK, .tIntName, .tIntLine, .tType)
        If $$$ISOK(tSC) && (tType = 0) && (tIntLine > 0) && '..IsDirective($Get(pText(tDeclaration + 1 + tK))) {
            Set pMap("m", pIndex, tK) = tIntLine
            If tRoutine = "" Set tRoutine = tIntName
        } Else {
            Set pMap("m", pIndex, tK) = 0
        }
    }
    Set pMap("m", pIndex) = $ListBuild(pName, tDeclaration, tRoutine, "", ..LabelLine(pClass, pName, tRoutine, .pLabels))
}

/// The session node <var>pSession</var> with its routine list replaced by <var>pLoaded</var>, the routines the session
/// actually loaded. A releaser and a later start prove a session against the node's list (<method>ProofFailure</method>,
/// <method>NodeMatches</method>), so a session that loaded fewer routines than the run listed can be proven and stopped
/// only once the node and the run record name what it loaded.
ClassMethod WithRoutineList(pSession As %List, pLoaded As %List) As %List
{
    Quit $ListBuild($ListGet(pSession, 1), $ListGet(pSession, 2), $ListGet(pSession, 3), $ListGet(pSession, 4), pLoaded)
}

/// The text naming what is wrong when the Line-by-Line session loaded other routines than the run listed, and empty when
/// both lists name the same routines, whatever their order. <var>pRunList</var> is the run's routine list,
/// <var>pLoaded</var> the routines the session reports (see <method>ActiveRoutines</method>). <code>Start</code> skips a
/// routine that has no object code without an error, so a routine deleted after the run resolved its list is silently
/// missing from the session.
ClassMethod LoadedRoutinesFailure(pRunList As %List, pLoaded As %List) As %String
{
    If ..ListsEqual(pRunList, pLoaded) Quit ""
    For tI = 1:1:$ListLength(pLoaded) Set tLoaded("n"_$List(pLoaded, tI)) = ""
    For tI = 1:1:$ListLength(pRunList) Set tListed("n"_$List(pRunList, tI)) = ""
    Set tMissing = ""
    Set tMissingCount = 0
    For tI = 1:1:$ListLength(pRunList) {
        If '$Data(tLoaded("n"_$List(pRunList, tI))) {
            Set tMissing = tMissing_$Select(tMissing = "": "", 1: ", ")_$List(pRunList, tI)
            Set tMissingCount = tMissingCount + 1
        }
    }
    Set tExtra = ""
    Set tExtraCount = 0
    For tI = 1:1:$ListLength(pLoaded) {
        If '$Data(tListed("n"_$List(pLoaded, tI))) {
            Set tExtra = tExtra_$Select(tExtra = "": "", 1: ", ")_$Select($List(pLoaded, tI) = "": "(a name that could not be read)", 1: $List(pLoaded, tI))
            Set tExtraCount = tExtraCount + 1
        }
    }
    Set tText = ""
    If tMissingCount > 0 {
        Set tText = "The Line-by-Line session did not load "_$Select(tMissingCount = 1: "routine ", 1: "routines ")_tMissing_" of the run's routine list"
    }
    If tExtraCount > 0 {
        Set tText = tText_$Select(tText = "": "The Line-by-Line session loaded ", 1: " and loaded ")_$Select(tExtraCount = 1: "routine ", 1: "routines ")_tExtra_" that the run did not list"
    }
    If tText = "" {
        Set tText = "The Line-by-Line session loaded "_$ListLength(pLoaded)_" routines where the run listed "_$ListLength(pRunList)
    }
    Quit tText_"."
}

/// Strip the sensitive parts of recorded error text for output: caret global references and control
/// characters go through <method>ExecuteMCPv2.Utils:SanitizeError</method>, and the IRIS error code
/// (<code>ERROR #N:</code>) is kept.
ClassMethod SafeText(pText As %String) As %String
{
    Set tPrefix = ""
    If $Extract(pText, 1, 7) = "ERROR #" {
        Set tRest = $Extract(pText, 8, *)
        Set tColon = $Find(tRest, ": ")
        If (tColon > 0) && ($Extract(tRest, 1, tColon - 3) ? 1.N) {
            Set tPrefix = $Extract(pText, 1, 7 + tColon - 1)
            Set pText = $Extract(tRest, tColon, *)
        }
    }
    Set tSafe = $System.Status.GetErrorText(##class(ExecuteMCPv2.Utils).SanitizeError($$$ERROR($$$GeneralError, pText)))
    Set tMarker = "ERROR #5001: "
    If $Extract(tSafe, 1, $Length(tMarker)) = tMarker Set tSafe = $Extract(tSafe, $Length(tMarker) + 1, *)
    Quit tPrefix_tSafe
}

/// The supervisor job entry point for run <var>pId</var> (<code>JOB</code>bed by the Start route).
/// <p>It holds its owner lock for its whole life, JOBs the runner, and sets the status <code>running</code> once the
/// runner reports its session started (or <code>failed</code> with the runner's error). It then checks every 100 ms
/// that the runner is alive, for a cancel and for the time limit; a cancel or the time limit terminates the runner
/// (after <method>MayTerminate</method>). Once the runner has gone it reads the counts and stops the session itself
/// only when the record shows the runner started the session and did not release it, the monitor is active and its
/// routine list is this run's. It then builds the skeleton, writes the terminal status, kills the session node,
/// releases its lock and ends.</p>
ClassMethod Supervise(pId As %Integer)
{
    Set tRunnerPid = ""
    Set tReason = ""
    Set tStartFailed = 0
    Try {
        Lock +^IRIS.TempExecuteMCPv2Coverage("owner", pId, "supervisor"):10
        If '$Test {
            Set tStartFailed = 1
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "error") = "The coverage supervisor could not take its owner lock."
            Quit
        }
        Set tStart = $ZHorolog
        Set tMaxSeconds = +..RunGet(pId, "maxSeconds")
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "pid") = $Job

        Job ##class(ExecuteMCPv2.Coverage.Runner).Run(pId)::10
        If '$Test {
            Set tStartFailed = 1
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "error") = "The test process did not start within 10 seconds."
            Quit
        }
        Set tRunnerPid = $ZChild
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "runnerPid") = tRunnerPid

        ; Phase 1: wait for the runner to report that its session started or failed to start.
        Set tOutcome = ..AwaitStart(pId, tStart)
        If tOutcome = "startfailed" {
            Set tStartFailed = 1
            Quit
        }
        If tOutcome = "timeout" Set tReason = "time-limit"
        If tOutcome = "started" {
            Do ..SetStatus(pId, "running")
            ; Phase 2: watch the runner.
            For {
                If ..RunGet(pId, "testsDone") Quit
                If ..RunGet(pId, "cancel") {
                    Set tReason = "cancel"
                    Quit
                }
                If ($ZHorolog - tStart) > tMaxSeconds {
                    Set tReason = "time-limit"
                    Quit
                }
                If '..OwnerAlive(pId, "runner") Quit
                Hang 0.1
            }
        }
        If (tReason '= "") && ..MayTerminate(pId, "runner", tRunnerPid) {
            Do $System.Process.Terminate(tRunnerPid)
        }
        ; The runner ends by itself once its tests are done; wait for it to be gone.
        For tI = 1:1:600 {
            If '..OwnerAlive(pId, "runner") Quit
            Hang 0.1
        }
    } Catch ex {
        Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "error") = ex.DisplayString()
        Set tStartFailed = 1
    }
    Do ..Finish(pId, tReason, tStartFailed)
    Lock -^IRIS.TempExecuteMCPv2Coverage("owner", pId, "supervisor")
}

/// Wait for the runner of run <var>pId</var> to report its session. Returns <code>started</code>,
/// <code>startfailed</code> (the runner's <code>Start</code> failed), <code>runnerdead</code> (the runner ended
/// before it reported) or <code>timeout</code>.
ClassMethod AwaitStart(pId As %Integer, pStart As %Decimal) As %String
{
    Set tOutcome = "timeout"
    For {
        If ..RunGet(pId, "startError") '= "" {
            Set tOutcome = "startfailed"
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "error") = ..RunGet(pId, "startError")
            Quit
        }
        If ..RunGet(pId, "sessionStarted") {
            Set tOutcome = "started"
            Quit
        }
        If ..RunGet(pId, "runnerUp") && '..OwnerAlive(pId, "runner") {
            Set tOutcome = "runnerdead"
            Quit
        }
        If '..RunGet(pId, "runnerUp") && (($ZHorolog - pStart) > 30) {
            Set tOutcome = "runnerdead"
            Quit
        }
        If ($ZHorolog - pStart) > 120 Quit
        Hang 0.1
    }
    Quit tOutcome
}

/// Prove, from the supervisor, that the active Line-by-Line session is run <var>pId</var>'s: the session node names
/// this run, and the session is scoped to listed processes that are the run's two (the supervisor among them) with the
/// run's routine names (see <method>ProofFailure</method>). The supervisor reads the names only once it is in the
/// session's process list and the monitor has made them readable (see <method>AwaitNamesReadable</method>, which the
/// caller runs before it takes the release locks). The session is stopped, and its counts are read, only after this
/// returns OK.
ClassMethod ProveOwnSession(pId As %Integer) As %Status
{
    If $ListGet($Get(^IRIS.TempExecuteMCPv2Coverage("session")), 1) '= pId {
        Quit $$$ERROR($$$GeneralError, "The session record does not name this run.")
    }
    If '..MonitorActive(.tPids) Quit $$$ERROR($$$GeneralError, "The monitor session ended before it could be verified.")
    Set tWhy = ..ProofFailure(tPids, $Job, ..RunGet(pId, "pid"), ..RunGet(pId, "runnerPid"), ..RunGet(pId, "routineList"), ..ActiveRoutines())
    If tWhy '= "" Quit $$$ERROR($$$GeneralError, tWhy)
    Quit $$$OK
}

/// Release the session, build the skeleton and write the terminal status of run <var>pId</var>, after the
/// runner has gone. <var>pReason</var> is the cancel or time-limit reason that ended the run, if any.
/// <p>When the runner started the session and did not release it, the supervisor takes the release locks
/// (<method>TakeReleaseLocks</method>), re-reads under them whether the runner has released the session or read the
/// counts meanwhile, and reads the counts and stops the session only after <method>ProveOwnSession</method> showed it
/// is this run's; otherwise it stops nothing. A release lock that cannot be taken in time stops nothing and ends the
/// run <code>release-failed</code>.</p>
/// <p>A run whose session had started never ends silently without its counts or its release: when the session could
/// not be stopped or verified the run ends <code>failed</code> with reason <code>release-failed</code>, and when the
/// counts could not be read, <code>failed</code> with reason <code>counts-unreadable</code> (the first of the two
/// wins). The IRIS text is in <code>error</code>, and the counts text in <code>readError</code>.</p>
ClassMethod Finish(pId As %Integer, pReason As %String, pStartFailed As %Boolean)
{
    Set tStatus = "failed"
    Set tError = ""
    Set tUnreleased = ""
    Set tLocked = 0
    Try {
        Set tNamespace = ..RunGet(pId, "namespace")
        Set tSessionStarted = ..RunGet(pId, "sessionStarted")
        Set tReadText = ""
        If tSessionStarted && '..RunGet(pId, "sessionReleased") && ..MonitorActive() {
            Do ..AwaitNamesReadable()
            If '..TakeReleaseLocks(pId, .tLockText) {
                Set tUnreleased = "it could not be stopped ("_tLockText_")"
                Set tReadText = "The monitor session was left as it was, so its counts were not read: "_tLockText
            } Else {
                Set tLocked = 1
                ; Under the locks the other releaser has finished: what it released or read is re-read, not assumed.
                If '..RunGet(pId, "sessionReleased") && ..MonitorActive() {
                    Set tProof = ..ProveOwnSession(pId)
                    If $$$ISERR(tProof) {
                        Set tProofText = ..SafeText($System.Status.GetErrorText(tProof))
                        Set tUnreleased = "it could not be verified as this run's, so it was left running ("_tProofText_")"
                        Set tReadText = "The monitor session could not be verified as this run's, so its counts were not read: "_tProofText
                    } Else {
                        If '..RunGet(pId, "hasCounts") {
                            Set tSC = ##class(ExecuteMCPv2.Coverage.Runner).ReadCounts(pId)
                            If $$$ISERR(tSC) {
                                Set tReadText = $System.Status.GetErrorText(tSC)
                            } Else {
                                Kill ^IRIS.TempExecuteMCPv2Coverage("run", pId, "readError")
                            }
                        }
                        Set tSC = ##class(%Monitor.System.LineByLine).Stop()
                        If $$$ISOK(tSC) {
                            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "sessionReleased") = 1
                            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "releasedBy") = "supervisor"
                        } Else {
                            Set tUnreleased = "it could not be stopped ("_..SafeText($System.Status.GetErrorText(tSC))_")"
                        }
                    }
                }
                Set tLocked = 0
                Do ..DropReleaseLocks(pId)
            }
        }
        If tSessionStarted && '..RunGet(pId, "hasCounts") {
            If tReadText '= "" {
                Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "readError") = tReadText
            } ElseIf ..RunGet(pId, "readError") = "" {
                Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "readError") = "The monitor session ended before its line counts were read."
            }
        }
        If ..RunGet(pId, "hasCounts") {
            Set tRoutines = ..RunGet(pId, "routines")
            For tN = 1:1:$ListLength(tRoutines) {
                Kill tSkeleton
                Set tSC = ..Skeleton(tNamespace, $List($List(tRoutines, tN), 2), .tSkeleton)
                If $$$ISERR(tSC) Continue
                Merge ^IRIS.TempExecuteMCPv2Coverage("run", pId, "skeleton", tN) = tSkeleton
            }
            ; The class-source map, beside the skeleton: one entry per distinct measured class, in routine order.
            Set tClassIndex = 0
            For tN = 1:1:$ListLength(tRoutines) {
                Set tClass = $List($List(tRoutines, tN), 1)
                If $Data(tSeenClass(tClass)) Continue
                Set tSeenClass(tClass) = ""
                Set tClassIndex = tClassIndex + 1
                Kill tMap
                Set tSC = ..SourceMap(tNamespace, tClass, .tMap)
                If $$$ISERR(tSC) {
                    Kill tMap
                    Set tMap = $ListBuild(tClass, "unavailable")
                }
                Merge ^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tClassIndex) = tMap
            }
        }
        If ..RunGet(pId, "testsDone") {
            Set tStatus = "completed"
            If ..RunGet(pId, "runnerError") '= "" {
                Set tStatus = "failed"
                Set tError = ..RunGet(pId, "runnerError")
            }
        } ElseIf pReason '= "" {
            Set tStatus = "cancelled"
        } ElseIf pStartFailed {
            Set tError = $Select(..RunGet(pId, "error") '= "": ..RunGet(pId, "error"), 1: "The test process did not start.")
        } Else {
            Set tError = "The test process ended before the tests finished."
        }
        Set tOutReason = $Select(tStatus = "cancelled": pReason, 1: "")
        If tUnreleased '= "" {
            Set tText = "A suite-owned Line-by-Line session is still active: "_tUnreleased_". The next coverage run reclaims it."
            Set ^IRIS.TempExecuteMCPv2Coverage("run", pId, "releaseError") = tText
            Set tStatus = "failed"
            Set tOutReason = "release-failed"
            Set tError = $Select(tError = "": tText, 1: tError_" "_tText)
        } ElseIf tSessionStarted && '..RunGet(pId, "hasCounts") {
            Set tText = "The line counts of this run could not be read: "_..RunGet(pId, "readError")
            Set tStatus = "failed"
            Set tOutReason = "counts-unreadable"
            Set tError = $Select(tError = "": tText, 1: tError_" "_tText)
        }
        Do ..SetStatus(pId, tStatus, tOutReason, tError)
        ; The session node stays while a session this run started may still be active, so a later run can reclaim it.
        If ($ListGet($Get(^IRIS.TempExecuteMCPv2Coverage("session")), 1) = pId) && (tUnreleased = "") {
            Kill ^IRIS.TempExecuteMCPv2Coverage("session")
        }
    } Catch ex {
        If tLocked Do ..DropReleaseLocks(pId)
        Do ..SetStatus(pId, "failed", "", ex.DisplayString())
    }
}

}
