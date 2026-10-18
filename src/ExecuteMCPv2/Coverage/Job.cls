/// Line-coverage job mechanics for <class>ExecuteMCPv2.REST.Coverage</class> (Story 40.1).
/// <p>This library owns the run record, the busy decision, routine resolution, the token skeleton
/// and the supervisor job. It returns raw data only: which INT lines are executable, and every
/// percentage, is decided in TypeScript (AD-12).</p>
/// <p><b>Two suite jobs per run (AD-27).</b> The runner (<class>ExecuteMCPv2.Coverage.Runner</class>)
/// starts a Line-by-Line session scoped to itself and to the supervisor, runs the tests and stops its own
/// session. The supervisor (<method>Supervise</method>) turns a cancel or the time limit into terminating the
/// runner, and releases a session that a dead runner left behind. A session counts only the process that
/// called <code>Start</code>, and <code>$SYSTEM.Process.Terminate</code> cannot be trapped, so the process
/// that runs the tests cannot be the only one that releases the monitor. Only a process in the session's
/// process list can read its routine names and line counts, which is why the supervisor is in that list.</p>
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
/// <li><code>("start")</code> is the lock that makes the busy check and the launch atomic.</li>
/// </ul>
Class ExecuteMCPv2.Coverage.Job Extends %RegisteredObject
{

/// The number of run records kept.
Parameter MAXRUNS As %Integer = 20;

/// Is a Line-by-Line or PERFMON session active on this instance? This is the only place the suite calls
/// <code>$ZUtil(84,...)</code>; <code>$ZUtil(84,8)</code> is the same test <code>%Monitor.System.LineByLine:Start</code>
/// makes. <var>pPids</var> receives the process ids the session is scoped to (space-delimited, empty when the
/// session is not scoped to processes or cannot say).
/// <p>Any process can read the process list, but only a process that is itself in that list can read the session's
/// routine names and line counts (probe, IRIS 2026.2 build 221U: a process outside the list reads them as
/// unavailable, and a process in the list can read them after a short delay). That is why the session identity
/// check below compares process lists, and why the supervisor is in the session's process list.</p>
ClassMethod MonitorActive(Output pPids As %String) As %Boolean
{
    Set pPids = ""
    If $ZUtil(84, 8) '= 1 Quit 0
    Try {
        Set pPids = $ZUtil(84, 10, 2)
    } Catch {
        Set pPids = ""
    }
    Quit 1
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
    Set tList = ..ActiveRoutines()
    If $ListLength(tList) = 0 Quit 0
    Set tReadable = 1
    For tI = 1:1:$ListLength(tList) {
        If $List(tList, tI) = "" {
            Set tReadable = 0
            Quit
        }
    }
    Quit tReadable
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
    If '..PidsMatch(tPids, $ListGet(pSession, 2), $ListGet(pSession, 3)) Quit 0
    Quit (##class(%Monitor.System.LineByLine).GetRoutineCount() = $ListLength($ListGet(pSession, 5)))
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

/// Is <var>pName</var> a class name: an optional <code>%</code>, then dot-separated names of letters and digits
/// that each begin with a letter?
ClassMethod IsClassName(pName As %String) As %Boolean
{
    If (pName = "") || ($Length(pName) > 220) Quit 0
    Set tValid = 1
    For tI = 1:1:$Length(pName, ".") {
        Set tSegment = $Piece(pName, ".", tI)
        If (tI = 1) && ($Extract(tSegment) = "%") Set tSegment = $Extract(tSegment, 2, *)
        If tSegment '? 1A.AN {
            Set tValid = 0
            Quit
        }
    }
    Quit tValid
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
/// this run and the routine names the monitor reports equal the run's routine list. The supervisor is in the
/// session's process list, so it can read the names after a short delay; this waits up to 15 seconds for that. The
/// session is stopped, and its counts are read, only after this returns OK.
ClassMethod ProveOwnSession(pId As %Integer) As %Status
{
    If $ListGet($Get(^IRIS.TempExecuteMCPv2Coverage("session")), 1) '= pId {
        Quit $$$ERROR($$$GeneralError, "The session record does not name this run.")
    }
    Set tReadable = 0
    For tI = 1:1:75 {
        If '..MonitorActive() Quit
        If ..NamesReadable() {
            Set tReadable = 1
            Quit
        }
        Hang 0.2
    }
    If 'tReadable {
        If '..MonitorActive() Quit $$$ERROR($$$GeneralError, "The monitor session ended before it could be verified.")
        Quit $$$ERROR($$$GeneralError, "The supervisor could not read the routine names of the monitor session within 15 seconds.")
    }
    If '..ListsEqual(..RunGet(pId, "routineList"), ..ActiveRoutines()) {
        Quit $$$ERROR($$$GeneralError, "The routines the monitor session reports are not this run's routine list.")
    }
    Quit $$$OK
}

/// Release the session, build the skeleton and write the terminal status of run <var>pId</var>, after the
/// runner has gone. <var>pReason</var> is the cancel or time-limit reason that ended the run, if any.
/// <p>When the runner started the session and did not release it, the supervisor reads the counts and stops the
/// session only after <method>ProveOwnSession</method> showed it is this run's; otherwise it stops nothing.</p>
/// <p>A run whose session had started never ends silently without its counts or its release: when the session could
/// not be stopped or verified the run ends <code>failed</code> with reason <code>release-failed</code>, and when the
/// counts could not be read, <code>failed</code> with reason <code>counts-unreadable</code> (the first of the two
/// wins). The IRIS text is in <code>error</code>, and the counts text in <code>readError</code>.</p>
ClassMethod Finish(pId As %Integer, pReason As %String, pStartFailed As %Boolean)
{
    Set tStatus = "failed"
    Set tError = ""
    Set tUnreleased = ""
    Try {
        Set tNamespace = ..RunGet(pId, "namespace")
        Set tSessionStarted = ..RunGet(pId, "sessionStarted")
        Set tReadText = ""
        If tSessionStarted && '..RunGet(pId, "sessionReleased") && ..MonitorActive() {
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
        Do ..SetStatus(pId, "failed", "", ex.DisplayString())
    }
}

}
