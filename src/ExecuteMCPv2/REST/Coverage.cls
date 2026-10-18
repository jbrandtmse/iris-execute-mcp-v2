/// REST handler for line-coverage test runs (Stories 40.1 and 40.2).
/// <p>Backs three routes: <code>POST /api/executemcp/v2/dev/test/coverage</code> (<method>Start</method>, JSON body
/// <code>{target, level, classes, namespace?, maxSeconds, maxLines, minCoverage?}</code>), <code>GET .../dev/test/coverage?id=</code>
/// (<method>Status</method>) and <code>POST .../dev/test/coverage/cancel</code> (<method>Cancel</method>, body
/// <code>{id}</code>). The run itself is two suite jobs owned by <class>ExecuteMCPv2.Coverage.Job</class>
/// (AD-27): this handler validates, decides whether the instance-wide Line-by-Line monitor is free, and
/// launches the supervisor. It returns raw data; TypeScript decides what is executable and computes percentages.</p>
/// <ul>
/// <li><b>Start.</b> The request is validated before any namespace switch. The routines to measure are resolved in
/// the target namespace, and a request that measures no routine, or more than <code>maxLines</code> INT lines, is an
/// error that starts nothing. The busy check and the launch then run under one lock, so two requests cannot both
/// start a session. The result is <code>{outcome, ...}</code>: <code>started</code> (the run record),
/// <code>busy</code> (<code>owner</code> is <code>suite</code> or <code>foreign</code>, and for the suite the running
/// run's <code>coverageRunId</code>, <code>pid</code>, <code>startedAt</code> and <code>namespace</code>) or
/// <code>failed</code> (with <code>error</code>).</li>
/// <li><b>Status.</b> The run record, including <code>readError</code> when the run's line counts could not be read,
/// and <code>minCoverage</code> when the run was started with one. A terminal run with counts also carries
/// <code>routines</code> and <code>sources</code>, the class-source map. It never starts, stops or terminates anything.</li>
/// <li><b>Cancel.</b> Sets the run's cancel flag, then returns the record. A cancel only signals the supervisor job.</li>
/// </ul>
Class ExecuteMCPv2.REST.Coverage Extends ExecuteMCPv2.REST.Base
{

/// HTTP entry point of <code>POST /dev/test/coverage</code>: reads the body, starts the run, renders one envelope.
ClassMethod Start() As %Status
{
    Set tSC = $$$OK
    Set tResult = ""
    Set tErrored = 0
    Try {
        Set tSC1 = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC1) {
            Set tErrored = 1
            Set tCmdStatus = tSC1
            Quit
        }
        Set tSC2 = ..Run(tBody, .tResult)
        If $$$ISERR(tSC2) {
            Set tErrored = 1
            Set tCmdStatus = tSC2
            Quit
        }
        Quit
    } Catch ex {
        Set tErrored = 1
        Set tCmdStatus = ex.AsStatus()
    }

    If tErrored {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus))
    } Else {
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Quit tSC
}

/// HTTP entry point of <code>GET /dev/test/coverage?id=</code>: the run record, with the per-routine counts and
/// skeletons when the run is terminal and has counts.
ClassMethod Status() As %Status
{
    Set tSC = $$$OK
    Set tResult = ""
    Set tErrored = 0
    Try {
        Set tSC1 = ..ReadRun($ZStrip($Get(%request.Data("id", 1)), "<>W"), .tId)
        If $$$ISERR(tSC1) {
            Set tErrored = 1
            Set tCmdStatus = tSC1
            Quit
        }
        Set tResult = ..BuildRun(tId, 1)
        Quit
    } Catch ex {
        Set tErrored = 1
        Set tCmdStatus = ex.AsStatus()
    }

    If tErrored {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus))
    } Else {
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Quit tSC
}

/// HTTP entry point of <code>POST /dev/test/coverage/cancel</code>: sets the cancel flag of a non-terminal run and
/// returns the record. The supervisor job reacts within 100 ms; this method never terminates or stops anything.
ClassMethod Cancel() As %Status
{
    Set tSC = $$$OK
    Set tResult = ""
    Set tErrored = 0
    Try {
        Set tSC1 = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC1) {
            Set tErrored = 1
            Set tCmdStatus = tSC1
            Quit
        }
        Set tIdText = ""
        If $IsObject(tBody) Set tIdText = $ZStrip(tBody.%Get("id"), "<>W")
        Set tSC2 = ..ReadRun(tIdText, .tId)
        If $$$ISERR(tSC2) {
            Set tErrored = 1
            Set tCmdStatus = tSC2
            Quit
        }
        If '##class(ExecuteMCPv2.Coverage.Job).IsTerminal(##class(ExecuteMCPv2.Coverage.Job).RunGet(tId, "status")) {
            Set ^IRIS.TempExecuteMCPv2Coverage("run", tId, "cancel") = 1
        }
        Set tResult = ..BuildRun(tId, 0)
        Quit
    } Catch ex {
        Set tErrored = 1
        Set tCmdStatus = ex.AsStatus()
    }

    If tErrored {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus))
    } Else {
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Quit tSC
}

/// Validate a run id and check that the run exists. <var>pId</var> is the run id on success.
ClassMethod ReadRun(pIdText As %String, Output pId As %Integer) As %Status
{
    Set pId = ""
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(pIdText, "id")
    If $$$ISERR(tSC) Quit tSC
    If pIdText '? 1.N Quit $$$ERROR($$$GeneralError, "Parameter 'id' must be the coverageRunId, all digits")
    Set pId = +pIdText
    If '##class(ExecuteMCPv2.Coverage.Job).RunExists(pId) {
        Quit $$$ERROR($$$GeneralError, "Coverage run "_pId_" was not found. Only the "_##class(ExecuteMCPv2.Coverage.Job).#MAXRUNS_" most recent runs are kept, and runs do not survive an instance restart.")
    }
    Quit $$$OK
}

/// Validate the Start request and return its parameters in <var>pParams</var>: <code>target</code>,
/// <code>level</code>, <code>classes</code> (a <class>%List</class> of 1 to 50 valid class names, de-duplicated, order
/// kept), <code>namespace</code> (empty when not given), <code>maxSeconds</code> (1 to 3600), <code>maxLines</code>
/// (at least 1) and <code>minCoverage</code> (empty when not given, otherwise a number from 0 to 100). Runs before any
/// namespace switch.
ClassMethod ValidateStart(pBody As %DynamicObject, Output pParams) As %Status
{
    Kill pParams
    If '$IsObject(pBody) Quit $$$ERROR($$$GeneralError, "The request body must be a JSON object")

    ; target
    If 'pBody.%IsDefined("target") || (pBody.%GetTypeOf("target") = "null") || (pBody.%Get("target") = "") {
        Quit $$$ERROR($$$GeneralError, "Required parameter 'target' is missing or empty")
    }
    If pBody.%GetTypeOf("target") '= "string" Quit $$$ERROR($$$GeneralError, "Parameter 'target' must be a string")
    Set tTarget = $ZStrip(pBody.%Get("target"), "<>W")
    If (tTarget = "") || (tTarget '? 1.(1AN,1".",1"%",1"_",1":")) {
        Quit $$$ERROR($$$GeneralError, "Parameter 'target' must be a package, a class or class:method name")
    }
    Set pParams("target") = tTarget

    ; level
    If 'pBody.%IsDefined("level") || (pBody.%Get("level") = "") {
        Quit $$$ERROR($$$GeneralError, "Required parameter 'level' is missing or empty")
    }
    Set tLevel = pBody.%Get("level")
    If (pBody.%GetTypeOf("level") '= "string") || ((tLevel '= "package") && (tLevel '= "class") && (tLevel '= "method")) {
        Quit $$$ERROR($$$GeneralError, "Parameter 'level' must be one of: package, class, method")
    }
    Set pParams("level") = tLevel

    ; classes
    If 'pBody.%IsDefined("classes") || (pBody.%GetTypeOf("classes") '= "array") {
        Quit $$$ERROR($$$GeneralError, "Required parameter 'classes' must be an array of 1 to 50 class names")
    }
    Set tClasses = pBody.%Get("classes")
    Set tSize = tClasses.%Size()
    If (tSize < 1) || (tSize > 50) {
        Quit $$$ERROR($$$GeneralError, "Parameter 'classes' must list 1 to 50 class names, got "_tSize)
    }
    Set tList = ""
    Set tInvalid = ""
    For tI = 0:1:tSize - 1 {
        If tClasses.%GetTypeOf(tI) '= "string" {
            Set tInvalid = "an entry that is not a string"
            Quit
        }
        Set tName = tClasses.%Get(tI)
        If '##class(ExecuteMCPv2.Coverage.Job).IsClassName(tName) {
            Set tInvalid = "the invalid class name '"_$Extract(tName, 1, 80)_"'"
            Quit
        }
        If '$Data(tSeen(tName)) {
            Set tSeen(tName) = ""
            Set tList = tList_$ListBuild(tName)
        }
    }
    If tInvalid '= "" Quit $$$ERROR($$$GeneralError, "Parameter 'classes' holds "_tInvalid)
    Set pParams("classes") = tList

    ; namespace (optional)
    Set pParams("namespace") = ""
    If pBody.%IsDefined("namespace") && (pBody.%GetTypeOf("namespace") '= "null") {
        If pBody.%GetTypeOf("namespace") '= "string" Quit $$$ERROR($$$GeneralError, "Parameter 'namespace' must be a string")
        Set pParams("namespace") = $ZStrip(pBody.%Get("namespace"), "<>W")
    }

    ; maxSeconds
    Set tSC = ..ReadInteger(pBody, "maxSeconds", 1, 3600, .tMaxSeconds)
    If $$$ISERR(tSC) Quit tSC
    Set pParams("maxSeconds") = tMaxSeconds

    ; maxLines
    Set tSC = ..ReadInteger(pBody, "maxLines", 1, "", .tMaxLines)
    If $$$ISERR(tSC) Quit tSC
    Set pParams("maxLines") = tMaxLines

    ; minCoverage (optional; JSON null means absent)
    Set pParams("minCoverage") = ""
    If pBody.%IsDefined("minCoverage") && (pBody.%GetTypeOf("minCoverage") '= "null") {
        If pBody.%GetTypeOf("minCoverage") '= "number" {
            Quit $$$ERROR($$$GeneralError, "Parameter 'minCoverage' must be a number from 0 to 100")
        }
        Set tMinCoverage = pBody.%Get("minCoverage")
        If (tMinCoverage < 0) || (tMinCoverage > 100) {
            Quit $$$ERROR($$$GeneralError, "Parameter 'minCoverage' must be a number from 0 to 100")
        }
        Set pParams("minCoverage") = +tMinCoverage
    }
    Quit $$$OK
}

/// Read the required integer <var>pName</var> of <var>pBody</var>, between <var>pMin</var> and <var>pMax</var>
/// (an empty <var>pMax</var> means no maximum).
ClassMethod ReadInteger(pBody As %DynamicObject, pName As %String, pMin As %Integer, pMax As %Integer, Output pValue As %Integer) As %Status [ Private ]
{
    Set pValue = ""
    Set tRange = $Select(pMax = "": "an integer of at least "_pMin, 1: "an integer from "_pMin_" to "_pMax)
    If 'pBody.%IsDefined(pName) || (pBody.%GetTypeOf(pName) '= "number") {
        Quit $$$ERROR($$$GeneralError, "Required parameter '"_pName_"' must be "_tRange)
    }
    Set tValue = pBody.%Get(pName)
    If (tValue '= (tValue \ 1)) || (tValue < pMin) || ((pMax '= "") && (tValue > pMax)) {
        Quit $$$ERROR($$$GeneralError, "Parameter '"_pName_"' must be "_tRange)
    }
    Set pValue = tValue
    Quit $$$OK
}

/// The request-independent core of <method>Start</method>: validate, resolve and check in the target namespace,
/// then launch from the home namespace. The namespace is restored on every exit path.
ClassMethod Run(pBody As %DynamicObject, Output pResult As %DynamicObject) As %Status
{
    Set pResult = ""
    Set tSC = ..ValidateStart(pBody, .tParams)
    If $$$ISERR(tSC) Quit tSC

    Set tOrigNS = $NAMESPACE
    Set tNamespace = ""
    Set tRoutines = ""
    Set tUnmeasured = ""
    Set tSpec = ""
    Try {
        If tParams("namespace") '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tParams("namespace"), .tOrigNS)
            If $$$ISERR(tSC) {
                Set tSC = $$$ERROR($$$GeneralError, "Namespace '"_tParams("namespace")_"' does not exist or cannot be used. Check the namespace name. Nothing was started.")
                Quit
            }
        }
        Set tNamespace = $NAMESPACE
        Set tRoutines = ##class(ExecuteMCPv2.Coverage.Job).ResolveRoutines(tNamespace, tParams("classes"), .tUnmeasured, .tTotalLines, .tResolveError)
        If tResolveError '= "" {
            Set tSC = $$$ERROR($$$GeneralError, "The routines of the listed classes could not be resolved in namespace "_tNamespace_": "_tResolveError_". Nothing was started.")
            Quit
        }
        If tRoutines = "" {
            Set tSC = $$$ERROR($$$GeneralError, "None of the listed classes has a measurable routine in namespace "_tNamespace_" ("_..UnmeasuredText(tUnmeasured)_"). Compile the classes in that namespace, or pass the namespace they are compiled in. Nothing was started.")
            Quit
        }
        If tTotalLines > tParams("maxLines") {
            Set tSC = $$$ERROR($$$GeneralError, "Coverage of "_tTotalLines_" INT lines exceeds the limit of "_tParams("maxLines")_". List fewer classes, or classes with less code. Nothing was started.")
            Quit
        }
        Do ##class(ExecuteMCPv2.Setup).EnsureUnitTestRoot()
        Set tSpec = ..TestSpec(tParams("target"), tParams("level"))
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrigNS
    If $$$ISERR(tSC) Quit tSC

    Quit ..Launch(.tParams, tNamespace, tRoutines, tUnmeasured, tSpec, .pResult)
}

/// The test spec for <method>%UnitTest.Manager:RunTest</method>: <method>ExecuteMCPv2.REST.UnitTest:BuildTestSpec</method>
/// for the target and level. RunTest reads one spec as <code>suite:class[:method];class[:method];...</code>: the classes
/// of one suite follow the first colon and are separated by a semicolon alone. At the package level that method joins
/// the classes as <code>:A;:B</code>, which RunTest reads as class A and a method named B (and so runs no test), so the
/// colon after each semicolon is dropped: <code>:A;B</code>.
ClassMethod TestSpec(pTarget As %String, pLevel As %String) As %String
{
    Set tSpec = ##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec(pTarget, pLevel)
    If pLevel = "package" Set tSpec = $Replace(tSpec, ";:", ";")
    Quit tSpec
}

/// The unmeasured classes as text: <code>Class: reason, Class: reason</code>.
ClassMethod UnmeasuredText(pUnmeasured As %List) As %String
{
    Set tText = ""
    For tI = 1:1:$ListLength(pUnmeasured) {
        Set tItem = $List(pUnmeasured, tI)
        Set tText = tText_$Select(tText = "": "", 1: ", ")_$List(tItem, 1)_": "_$List(tItem, 2)
    }
    Quit tText
}

/// Decide whether the monitor is free and, if so, create the run and launch its supervisor; both under one lock.
/// <var>pResult</var> is <code>{outcome:"started", ...run}</code>, <code>{outcome:"busy", owner, ...}</code> or
/// <code>{outcome:"failed", error, ...}</code>. Only a decision that proceeds allocates a run id.
ClassMethod Launch(ByRef pParams, pNamespace As %String, pRoutines As %List, pUnmeasured As %List, pSpec As %String, Output pResult As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pResult = ""
    Set tLocked = 0
    Set tId = ""
    Try {
        Lock +^IRIS.TempExecuteMCPv2Coverage("start"):15
        If '$Test {
            Set pResult = ..BusyResult("suite", "")
            Quit
        }
        Set tLocked = 1
        Set tDecision = ##class(ExecuteMCPv2.Coverage.Job).Evaluate(.tSession, .tLiveRunId)
        Set tSessionId = $ListGet(tSession, 1)
        Set tReclaimed = ""
        If tDecision = "busy-suite" {
            Set pResult = ..BusyResult("suite", $Select(tSessionId '= "": tSessionId, 1: tLiveRunId))
            Quit
        }
        If tDecision = "busy-foreign" {
            Set pResult = ..BusyResult("foreign", "")
            Quit
        }
        If tDecision = "clear-busy-foreign" {
            ; The ownership record is cleared only when the active session's own process list disproves it. A session of
            ; all processes or a paused one has no list of its own, so the record is kept: a suite session paused by
            ; someone else is refused as foreign while it is paused and is reclaimable once it is resumed, and
            ; clear-and-proceed removes the record once the monitor is idle.
            If ##class(ExecuteMCPv2.Coverage.Job).SessionDisproved(tSession) Kill ^IRIS.TempExecuteMCPv2Coverage("session")
            Set pResult = ..BusyResult("foreign", "")
            Quit
        }
        If tDecision = "reclaim" {
            Set tStopSC = ##class(%Monitor.System.LineByLine).Stop()
            If $$$ISERR(tStopSC) {
                Set pResult = ..FailedResult("", "The monitor session of dead coverage run "_tSessionId_" could not be released: "_##class(ExecuteMCPv2.Coverage.Job).SafeText($System.Status.GetErrorText(tStopSC))_". Nothing was started.")
                Quit
            }
            Set tReclaimed = $ListBuild(tSessionId, ##class(ExecuteMCPv2.Coverage.Job).RunGet(tSessionId, "pid"))
            Kill ^IRIS.TempExecuteMCPv2Coverage("session")
            If '##class(ExecuteMCPv2.Coverage.Job).IsTerminal(##class(ExecuteMCPv2.Coverage.Job).RunGet(tSessionId, "status")) {
                Do ##class(ExecuteMCPv2.Coverage.Job).SetStatus(tSessionId, "abandoned")
            }
        } ElseIf tDecision = "clear-and-proceed" {
            Kill ^IRIS.TempExecuteMCPv2Coverage("session")
            If '##class(ExecuteMCPv2.Coverage.Job).IsTerminal(##class(ExecuteMCPv2.Coverage.Job).RunGet(tSessionId, "status")) {
                Do ##class(ExecuteMCPv2.Coverage.Job).SetStatus(tSessionId, "abandoned")
            }
        }

        Set tId = $Increment(^IRIS.TempExecuteMCPv2Coverage("seq"))
        Do ##class(ExecuteMCPv2.Coverage.Job).CreateRun(tId, .pParams, pNamespace, pRoutines, pUnmeasured, pSpec, tReclaimed)
        Do ##class(ExecuteMCPv2.Coverage.Job).Prune(tId)

        Job ##class(ExecuteMCPv2.Coverage.Job).Supervise(tId)::10
        If '$Test {
            Do ##class(ExecuteMCPv2.Coverage.Job).SetStatus(tId, "failed", "", "The coverage supervisor did not start within 10 seconds.")
            Quit
        }
        For tWait = 1:1:100 {
            If ##class(ExecuteMCPv2.Coverage.Job).RunGet(tId, "pid") '= "" Quit
            Hang 0.1
        }
        If ##class(ExecuteMCPv2.Coverage.Job).RunGet(tId, "pid") = "" {
            Do ##class(ExecuteMCPv2.Coverage.Job).SetStatus(tId, "failed", "", "The coverage supervisor did not report in within 10 seconds.")
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    If tLocked Lock -^IRIS.TempExecuteMCPv2Coverage("start")
    If $$$ISERR(tSC) Quit tSC
    If (pResult '= "") || (tId = "") Quit tSC

    ; The run is launched: wait for it to leave "starting", then return it.
    For tWait = 1:1:150 {
        If ##class(ExecuteMCPv2.Coverage.Job).RunGet(tId, "status") '= "starting" Quit
        Hang 0.1
    }
    Set pResult = ..BuildRun(tId, 0)
    If pResult.status = "failed" {
        Do pResult.%Set("outcome", "failed")
    } Else {
        Do pResult.%Set("outcome", "started")
    }
    Quit tSC
}

/// A <code>busy</code> outcome. <var>pOwner</var> is <code>suite</code> or <code>foreign</code>; for the suite, the
/// running run's id, supervisor pid, start time and namespace are added when <var>pRunId</var> is given.
ClassMethod BusyResult(pOwner As %String, pRunId As %Integer) As %DynamicObject
{
    Set tResult = {}
    Do tResult.%Set("outcome", "busy")
    Do tResult.%Set("owner", pOwner)
    If (pOwner = "suite") && (pRunId '= "") {
        Do tResult.%Set("coverageRunId", +pRunId, "number")
        Do tResult.%Set("pid", +##class(ExecuteMCPv2.Coverage.Job).RunGet(pRunId, "pid"), "number")
        Do tResult.%Set("startedAt", ##class(ExecuteMCPv2.Coverage.Job).RunGet(pRunId, "startedAt"))
        Do tResult.%Set("namespace", ##class(ExecuteMCPv2.Coverage.Job).RunGet(pRunId, "namespace"))
    }
    Quit tResult
}

/// A <code>failed</code> outcome that has no run record.
ClassMethod FailedResult(pRunId As %Integer, pError As %String) As %DynamicObject
{
    Set tResult = {}
    Do tResult.%Set("outcome", "failed")
    If pRunId '= "" Do tResult.%Set("coverageRunId", +pRunId, "number")
    Do tResult.%Set("error", pError)
    Quit tResult
}

/// Set <var>pKey</var> to the number <var>pValue</var>, or to JSON null when it is empty.
ClassMethod SetNumber(pObject As %DynamicObject, pKey As %String, pValue As %String) [ Private ]
{
    If pValue = "" {
        Do pObject.%Set(pKey, "", "null")
    } Else {
        Do pObject.%Set(pKey, +pValue, "number")
    }
}

/// The run record as a JSON object. <var>pWithRoutines</var> adds <code>routines</code>, the per-routine counts and
/// skeletons, when the run is terminal and has counts. A non-terminal record whose supervisor and runner are both
/// dead is reported with status <code>abandoned</code>; the record itself is not changed.
ClassMethod BuildRun(pId As %Integer, pWithRoutines As %Boolean = 0) As %DynamicObject
{
    Set tSupervisorAlive = ##class(ExecuteMCPv2.Coverage.Job).OwnerAlive(pId, "supervisor")
    Set tRunnerAlive = ##class(ExecuteMCPv2.Coverage.Job).OwnerAlive(pId, "runner")
    ; The status is read after the two probes: a supervisor that finished in between has written its terminal status.
    Set tRecorded = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "status")
    Set tTerminal = ##class(ExecuteMCPv2.Coverage.Job).IsTerminal(tRecorded)
    Set tStatus = tRecorded
    If 'tTerminal && 'tSupervisorAlive && 'tRunnerAlive Set tStatus = "abandoned"

    Set tRun = {}
    Do tRun.%Set("coverageRunId", +pId, "number")
    Do tRun.%Set("status", tStatus)
    Do tRun.%Set("namespace", ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "namespace"))
    Do tRun.%Set("target", ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "target"))
    Do tRun.%Set("level", ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "level"))
    Do ..SetNumber(tRun, "pid", ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "pid"))
    Do ..SetNumber(tRun, "runnerPid", ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "runnerPid"))
    Do tRun.%Set("startedAt", ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "startedAt"))
    Set tFinishedAt = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "finishedAt")
    If tFinishedAt = "" {
        Do tRun.%Set("finishedAt", "", "null")
    } Else {
        Do tRun.%Set("finishedAt", tFinishedAt)
    }
    Do ..SetNumber(tRun, "runIndex", ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "runIndex"))
    Set tReason = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "reason")
    If tReason '= "" Do tRun.%Set("reason", tReason)
    Set tError = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "error")
    If tError '= "" Do tRun.%Set("error", ##class(ExecuteMCPv2.Coverage.Job).SafeText(tError))
    Set tReadError = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "readError")
    If tReadError '= "" Do tRun.%Set("readError", ##class(ExecuteMCPv2.Coverage.Job).SafeText(tReadError))
    Set tReleasedBy = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "releasedBy")
    If tReleasedBy '= "" Do tRun.%Set("releasedBy", tReleasedBy)
    Do tRun.%Set("cancelRequested", +##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "cancel"), "boolean")
    Do tRun.%Set("supervisorAlive", +tSupervisorAlive, "boolean")
    Do tRun.%Set("runnerAlive", +tRunnerAlive, "boolean")

    Set tUnmeasured = []
    Set tList = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "unmeasured")
    For tI = 1:1:$ListLength(tList) {
        Set tItem = $List(tList, tI)
        Set tEntry = {}
        Do tEntry.%Set("class", $List(tItem, 1))
        Do tEntry.%Set("reason", $List(tItem, 2))
        Do tUnmeasured.%Push(tEntry)
    }
    Do tRun.%Set("unmeasured", tUnmeasured)

    Set tReclaimed = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "reclaimed")
    If tReclaimed '= "" {
        Set tReclaimedObject = {}
        Do tReclaimedObject.%Set("coverageRunId", +$List(tReclaimed, 1), "number")
        Do ..SetNumber(tReclaimedObject, "pid", $List(tReclaimed, 2))
        Do tRun.%Set("reclaimed", tReclaimedObject)
    }

    Set tMinCoverage = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "minCoverage")
    If tMinCoverage '= "" Do tRun.%Set("minCoverage", +tMinCoverage, "number")

    If pWithRoutines && tTerminal && ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "hasCounts") {
        Do tRun.%Set("routines", ..BuildRoutines(pId))
        Do tRun.%Set("sources", ..BuildSources(pId))
    }
    Quit tRun
}

/// The class-source map of a terminal run, one entry per measured class: <code>{class, reason?, methods:[...]}</code>.
/// A method that maps is <code>{name, line, routine, intLines:[...], labelLine}</code> (<code>intLines[k-1]</code> is the
/// INT line of body line k, or 0; <code>labelLine</code> is the INT line of the method's label, or 0 when it is not known),
/// and a method that does not is <code>{name, line, reason}</code>. <code>line</code> is the class-document line that
/// declares the method, or null. See <method>ExecuteMCPv2.Coverage.Job:SourceMap</method>.
ClassMethod BuildSources(pId As %Integer) As %DynamicArray [ Private ]
{
    Set tSources = []
    Set tIndex = ""
    For {
        Set tIndex = $Order(^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tIndex))
        If tIndex = "" Quit
        Set tHead = $Get(^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tIndex))
        Set tClass = {}
        Do tClass.%Set("class", $List(tHead, 1))
        If $List(tHead, 2) '= "" Do tClass.%Set("reason", $List(tHead, 2))
        Set tMethods = []
        Set tM = ""
        For {
            Set tM = $Order(^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tIndex, "m", tM))
            If tM = "" Quit
            Set tNode = ^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tIndex, "m", tM)
            Set tMethod = {}
            Do tMethod.%Set("name", $List(tNode, 1))
            Do ..SetNumber(tMethod, "line", $List(tNode, 2))
            If $List(tNode, 4) '= "" {
                Do tMethod.%Set("reason", $List(tNode, 4))
            } Else {
                Do tMethod.%Set("routine", $List(tNode, 3))
                Set tInts = []
                Set tK = ""
                For {
                    Set tK = $Order(^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tIndex, "m", tM, tK))
                    If tK = "" Quit
                    Do tInts.%Push(+^IRIS.TempExecuteMCPv2Coverage("run", pId, "sources", tIndex, "m", tM, tK), "number")
                }
                Do tMethod.%Set("intLines", tInts)
                Do tMethod.%Set("labelLine", +$ListGet(tNode, 5), "number")
            }
            Do tMethods.%Push(tMethod)
        }
        Do tClass.%Set("methods", tMethods)
        Do tSources.%Push(tClass)
    }
    Quit tSources
}

/// The per-routine counts and skeletons of a terminal run: <code>{class, routine, lines, hits:[[line,count]...],
/// skeleton:[[line,text]...]}</code>. <code>hits</code> lists only the lines with a count above 0.
ClassMethod BuildRoutines(pId As %Integer) As %DynamicArray [ Private ]
{
    Set tRoutines = []
    Set tList = ##class(ExecuteMCPv2.Coverage.Job).RunGet(pId, "routines")
    For tN = 1:1:$ListLength(tList) {
        Set tEntry = $List(tList, tN)
        Set tHits = []
        Set tLine = ""
        For {
            Set tLine = $Order(^IRIS.TempExecuteMCPv2Coverage("run", pId, "hits", tN, tLine))
            If tLine = "" Quit
            Set tPair = []
            Do tPair.%Push(+tLine, "number")
            Do tPair.%Push(+^IRIS.TempExecuteMCPv2Coverage("run", pId, "hits", tN, tLine), "number")
            Do tHits.%Push(tPair)
        }
        Set tSkeleton = []
        Set tLine = ""
        For {
            Set tLine = $Order(^IRIS.TempExecuteMCPv2Coverage("run", pId, "skeleton", tN, tLine))
            If tLine = "" Quit
            Set tPair = []
            Do tPair.%Push(+tLine, "number")
            Do tPair.%Push(^IRIS.TempExecuteMCPv2Coverage("run", pId, "skeleton", tN, tLine), "string")
            Do tSkeleton.%Push(tPair)
        }
        Set tRoutine = {}
        Do tRoutine.%Set("class", $List(tEntry, 1))
        Do tRoutine.%Set("routine", $List(tEntry, 2))
        Do tRoutine.%Set("lines", +$List(tEntry, 3), "number")
        Do tRoutine.%Set("hits", tHits)
        Do tRoutine.%Set("skeleton", tSkeleton)
        Do tRoutines.%Push(tRoutine)
    }
    Quit tRoutines
}

}
