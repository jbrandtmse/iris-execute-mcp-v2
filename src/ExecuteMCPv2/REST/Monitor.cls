/// REST handler for system monitoring and metrics.
/// <p>Provides system metrics, alert information, and interoperability
/// performance data via the custom REST endpoint
/// <code>/api/executemcp/v2/monitor</code>.</p>
/// <p>System-level metrics and alerts are collected from <b>%SYS</b> namespace
/// using <code>$ZU()</code> functions (always available), SQL queries on
/// <code>SYS.Database</code>, and <code>$SYSTEM.Monitor</code> class methods.
/// Interoperability metrics require namespace switching to the target namespace
/// for <code>Ens.*</code> queries.</p>
Class ExecuteMCPv2.REST.Monitor Extends %Atelier.REST
{

/// Return system metrics in JSON format.
/// <p>Collects key IRIS system metrics including process count, global references,
/// routine commands, database sizes, and uptime. Uses direct <code>$ZU()</code>
/// calls for buffer metrics (always available) and SQL queries for database and
/// process information.</p>
ClassMethod SystemMetrics() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tResult = {}
        Set tMetrics = []

        ; Switch to %SYS for system-level queries
        Set $NAMESPACE = "%SYS"

        ; -- Process count via SQL --
        Set tProcessCount = 0
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT COUNT(*) AS cnt FROM %SYS.ProcessQuery")
        If $IsObject(tRS) && tRS.%Next() {
            Set tProcessCount = +tRS.cnt
        }
        Set tMetric = {}
        Do tMetric.%Set("name", "iris_process_count")
        Do tMetric.%Set("help", "Current number of IRIS processes")
        Do tMetric.%Set("type", "gauge")
        Do tMetric.%Set("value", tProcessCount, "number")
        Do tMetrics.%Push(tMetric)

        ; -- Global references via SYS.Stats.Global.Sample() (instance-wide) --
        ; $ZU(190,0) and $ZU(190,1) return PER-PROCESS counters — the REST
        ; handler's own. SYS.Stats.Global.Sample() / SYS.Stats.Routine.Sample()
        ; expose instance-wide counters driven by the same underlying metrics
        ; that power the Management Portal System Dashboard.
        Set tGlobalRefs = 0
        Try {
            Set tGRef = ##class(SYS.Stats.Global).Sample()
            If $IsObject(tGRef) {
                ; Total global references = local + private + remote
                Set tGlobalRefs = (+tGRef.RefLocal) + (+tGRef.RefPrivate) + (+tGRef.RefRemote)
            }
        }
        Catch { }
        Set tMetric = {}
        Do tMetric.%Set("name", "iris_global_references_total")
        Do tMetric.%Set("help", "Total global references since startup (instance-wide, from SYS.Stats.Global)")
        Do tMetric.%Set("type", "counter")
        Do tMetric.%Set("value", +tGlobalRefs, "number")
        Do tMetrics.%Push(tMetric)

        ; -- Routine commands via SYS.Stats.Routine.Sample() (instance-wide) --
        Set tRoutineCmds = 0
        Try {
            Set tRRef = ##class(SYS.Stats.Routine).Sample()
            If $IsObject(tRRef) {
                Set tRoutineCmds = +tRRef.RtnCommands
            }
        }
        Catch { }
        Set tMetric = {}
        Do tMetric.%Set("name", "iris_routine_commands_total")
        Do tMetric.%Set("help", "Total routine commands since startup (instance-wide, from SYS.Stats.Routine)")
        Do tMetric.%Set("type", "counter")
        Do tMetric.%Set("value", +tRoutineCmds, "number")
        Do tMetrics.%Push(tMetric)

        ; -- Uptime via $ZH (seconds since instance start) --
        Set tUptime = +$ZH
        Set tMetric = {}
        Do tMetric.%Set("name", "iris_uptime_seconds")
        Do tMetric.%Set("help", "IRIS instance uptime in seconds")
        Do tMetric.%Set("type", "gauge")
        Do tMetric.%Set("value", tUptime, "number")
        Do tMetrics.%Push(tMetric)

        ; -- Database info via Config.Databases:List + SYS.Database --
        Set tDatabases = []
        Set tDBRS = ##class(%ResultSet).%New("Config.Databases:List")
        If $IsObject(tDBRS) {
            Set tSC2 = tDBRS.Execute("*")
            If $$$ISOK(tSC2) {
                While tDBRS.Next() {
                    Set tDB = {}
                    Set tDBName = tDBRS.Get("Name")
                    Set tDBDir = tDBRS.Get("Directory")
                    Do tDB.%Set("name", tDBName)
                    Do tDB.%Set("directory", tDBDir)
                    ; Open SYS.Database to get size info
                    Try {
                        Set tDBObj = ##class(SYS.Database).%OpenId(tDBDir)
                        If $IsObject(tDBObj) {
                            Do tDB.%Set("sizeMB", +tDBObj.Size, "number")
                            Do tDB.%Set("maxSizeMB", +tDBObj.MaxSize, "number")
                        }
                    }
                    Catch { }
                    Do tDatabases.%Push(tDB)
                }
            }
        }

        Do tResult.%Set("metrics", tMetrics)
        Do tResult.%Set("databases", tDatabases)

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return active system alerts in JSON format.
/// <p>Queries <code>$SYSTEM.Monitor</code> for the current system state and
/// alert information. Returns the state code, state text, alert count, and
/// alert messages array.</p>
ClassMethod SystemAlerts() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tResult = {}

        ; Switch to %SYS for system monitor queries
        Set $NAMESPACE = "%SYS"

        ; -- System state from $SYSTEM.Monitor.State() --
        ; Returns: -1=Hung, 0=OK, 1=Warning, 2=Alert
        Set tState = $SYSTEM.Monitor.State()
        Set tStateText = $Case(tState, -1:"Hung", 0:"OK", 1:"Warning", 2:"Alert", :"Unknown")
        Do tResult.%Set("state", +tState, "number")
        Do tResult.%Set("stateText", tStateText)

        ; -- Alert count from $SYSTEM.Monitor.Alerts() --
        Set tAlertCount = $SYSTEM.Monitor.Alerts()
        Do tResult.%Set("alertCount", +tAlertCount, "number")

        ; -- Get alert details via $SYSTEM.Monitor.GetAlerts() --
        Set tAlerts = []
        Set tAlertData = ""
        Set tMessages = ""
        Set tLastAlert = ""
        Set tSC2 = $SYSTEM.Monitor.GetAlerts(.tAlertData, .tMessages, .tLastAlert)
        If $$$ISOK(tSC2) {
            ; tMessages is a subscripted array — iterate if available
            Set tKey = ""
            For {
                Set tKey = $Order(tMessages(tKey))
                Quit:tKey=""
                Set tAlert = {}
                Do tAlert.%Set("index", +tKey, "number")
                Do tAlert.%Set("message", $Get(tMessages(tKey)))
                Do tAlert.%Set("severity", tStateText)
                Do tAlert.%Set("category", "system")
                Do tAlerts.%Push(tAlert)
            }
        }
        Do tResult.%Set("alerts", tAlerts)
        Do tResult.%Set("lastAlert", tLastAlert)

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return interoperability metrics in JSON format.
/// <p>Collects message throughput, queue depths, and error counts from
/// Ensemble/Interoperability tables. Iterates namespaces to provide a
/// cross-namespace summary similar to ProductionSummary.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>namespace</code> — Target namespace (optional; if omitted, summarizes all namespaces)</li>
/// </ul></p>
ClassMethod InteropMetrics() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tNamespace = $Get(%request.Data("namespace",1))
        Set tResult = {}
        Set tNamespaces = []

        If tNamespace '= "" {
            ; Single namespace mode
            Set tSC2 = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }
            Set tNSMetrics = ..CollectInteropMetrics(tNamespace)
            Do tNamespaces.%Push(tNSMetrics)
            Set $NAMESPACE = tOrigNS
        }
        Else {
            ; Cross-namespace summary — collect namespace names first, then iterate
            ; (matches ProductionSummary pattern: avoids namespace switch during ResultSet iteration)
            Set $NAMESPACE = "%SYS"
            Set tNSRS = ##class(%ResultSet).%New("Config.Namespaces:List")
            Set tNSCount = 0
            If $IsObject(tNSRS) {
                Set tSC2 = tNSRS.Execute()
                If $$$ISOK(tSC2) {
                    While tNSRS.Next() {
                        Set tNSCount = tNSCount + 1
                        Set tNSList(tNSCount) = tNSRS.Get("Namespace")
                    }
                }
                Do tNSRS.Close()
            }
            ; Now iterate collected namespaces
            For tIdx = 1:1:tNSCount {
                Set tNS = tNSList(tIdx)
                Try {
                    Set $NAMESPACE = tNS
                    Set tNSMetrics = ..CollectInteropMetrics(tNS)
                    Do tNamespaces.%Push(tNSMetrics)
                }
                Catch innerEx {
                    ; Skip namespaces we cannot access
                }
            }
            Set $NAMESPACE = tOrigNS
        }

        Do tResult.%Set("namespaces", tNamespaces)
        Do tResult.%Set("count", tNamespaces.%Size(), "number")

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return running IRIS jobs/processes in JSON format.
/// <p>Queries <code>%SYS.ProcessQuery</code> in the <b>%SYS</b> namespace
/// to list all active IRIS processes with their process ID, namespace,
/// routine, state, username, and resource usage.</p>
ClassMethod JobsList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tResult = {}
        Set tJobs = []

        Set tRS = ##class(%SQL.Statement).%ExecDirect(,
            "SELECT Pid, NameSpace, Routine, State, UserName, ClientIPAddress, "_
            "JobType, CommandsExecuted, GlobalReferences, InTransaction, CPUTime "_
            "FROM %SYS.ProcessQuery ORDER BY Pid")
        If $IsObject(tRS) {
            While tRS.%Next() {
                Set tJob = {}
                Do tJob.%Set("pid", +tRS.Pid, "number")
                Do tJob.%Set("namespace", tRS.NameSpace)
                Do tJob.%Set("routine", tRS.Routine)
                Do tJob.%Set("state", tRS.State)
                Do tJob.%Set("userName", tRS.UserName)
                Do tJob.%Set("clientIPAddress", tRS.ClientIPAddress)
                Do tJob.%Set("jobType", +tRS.JobType, "number")
                Do tJob.%Set("commandsExecuted", +tRS.CommandsExecuted, "number")
                Do tJob.%Set("globalReferences", +tRS.GlobalReferences, "number")
                Do tJob.%Set("inTransaction", +tRS.InTransaction, "number")
                Do tJob.%Set("cpuTime", +tRS.CPUTime, "number")
                Do tJobs.%Push(tJob)
            }
        }

        Do tResult.%Set("jobs", tJobs)
        Do tResult.%Set("count", tJobs.%Size(), "number")

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return current system locks in JSON format.
/// <p>Uses the <code>%SYS.LockQuery:List</code> named query in the
/// <b>%SYS</b> namespace to enumerate all active locks. Parses the
/// pipe-delimited <code>Owner</code> field to extract the owning
/// process ID.</p>
ClassMethod LocksList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tResult = {}
        Set tLocks = []

        Set tRS = ##class(%ResultSet).%New("%SYS.LockQuery:List")
        If $IsObject(tRS) {
            Set tSC2 = tRS.Execute()
            If $$$ISOK(tSC2) {
                While tRS.Next() {
                    Set tLock = {}
                    Set tOwner = tRS.Get("Owner")
                    ; Owner may be pipe-delimited (|<pid>|<info>||<count>) or plain PID
                    ; Handle both formats gracefully
                    If $Find(tOwner, "|") {
                        Set tOwnerPid = +$Piece(tOwner, "|", 2)
                    }
                    Else {
                        Set tOwnerPid = +tOwner
                    }
                    Do tLock.%Set("lockName", tRS.Get("FullReference"))
                    Do tLock.%Set("ownerPid", tOwnerPid, "number")
                    Do tLock.%Set("owner", tOwner)
                    Do tLock.%Set("mode", tRS.Get("Mode"))
                    Do tLock.%Set("flags", tRS.Get("Flags"))
                    Do tLock.%Set("counts", tRS.Get("Counts"))
                    Do tLocks.%Push(tLock)
                }
            }
            Do tRS.Close()
        }

        Do tResult.%Set("locks", tLocks)
        Do tResult.%Set("count", tLocks.%Size(), "number")

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return journal file information in JSON format.
/// <p>Queries <code>%SYS.Journal.System</code> class methods in the <b>%SYS</b>
/// namespace for current journal file, directories, file count, offset,
/// free space, and state.</p>
ClassMethod JournalInfo() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tResult = {}

        ; -- Current journal file info --
        Set tCurrentFile = ##class(%SYS.Journal.System).GetCurrentFileName()
        Do tResult.%Set("currentFile", tCurrentFile)

        ; -- Directories --
        Set tPrimaryDir = ##class(%SYS.Journal.System).GetPrimaryDirectory()
        Set tAlternateDir = ##class(%SYS.Journal.System).GetAlternateDirectory()
        Do tResult.%Set("primaryDirectory", tPrimaryDir)
        Do tResult.%Set("alternateDirectory", tAlternateDir)

        ; -- File count and offset --
        Set tFileCount = ##class(%SYS.Journal.System).GetCurrentFileCount()
        Set tFileOffset = ##class(%SYS.Journal.System).GetCurrentFileOffset()
        Do tResult.%Set("fileCount", +tFileCount, "number")
        Do tResult.%Set("currentOffset", +tFileOffset, "number")

        ; -- Free space and state --
        Set tFreeSpace = ##class(%SYS.Journal.System).GetFreeSpace()
        Set tState = ##class(%SYS.Journal.System).GetStateString()
        Do tResult.%Set("freeSpaceBytes", +tFreeSpace, "number")
        Do tResult.%Set("state", tState)

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return mirror configuration and membership status in JSON format.
/// <p>Queries <code>$SYSTEM.Mirror</code> class methods for mirror membership,
/// name, member type, and role status. Gracefully returns "not configured"
/// when the instance is not a mirror member.</p>
ClassMethod MirrorStatus() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tResult = {}

        ; -- Mirror membership --
        Set tIsMember = +$SYSTEM.Mirror.IsMember()
        Do tResult.%Set("isMember", tIsMember, "boolean")

        If tIsMember {
            ; -- Mirror details (only when member) --
            Set tMirrorName = $SYSTEM.Mirror.MirrorName()
            Set tMemberType = $SYSTEM.Mirror.GetMemberType()
            Set tIsPrimary = +$SYSTEM.Mirror.IsPrimary()
            Set tIsBackup = +$SYSTEM.Mirror.IsBackup()
            Set tIsAsync = +$SYSTEM.Mirror.IsAsyncMember()

            Do tResult.%Set("mirrorName", tMirrorName)
            Do tResult.%Set("memberType", tMemberType)
            Do tResult.%Set("isPrimary", tIsPrimary, "boolean")
            Do tResult.%Set("isBackup", tIsBackup, "boolean")
            Do tResult.%Set("isAsyncMember", tIsAsync, "boolean")

            ; -- Mirror status --
            Set tStatus = $SYSTEM.Mirror.GetStatus(tMirrorName)
            Do tResult.%Set("status", tStatus)
        }
        Else {
            Do tResult.%Set("mirrorName", "")
            Do tResult.%Set("memberType", "Not Member")
            Do tResult.%Set("isPrimary", 0, "boolean")
            Do tResult.%Set("isBackup", 0, "boolean")
            Do tResult.%Set("isAsyncMember", 0, "boolean")
            Do tResult.%Set("status", "Mirror not configured")
        }

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return audit log events in JSON format.
/// <p>Queries the <code>%SYS.Audit:List</code> named query in <b>%SYS</b>
/// namespace with optional filters for time range, username, and event type.
/// Results are limited by the <code>maxRows</code> parameter (default 100,
/// maximum 1000) to prevent oversized responses.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>beginDate</code> — Start date/time filter (YYYY-MM-DD HH:MM:SS)</li>
///   <li><code>endDate</code> — End date/time filter (YYYY-MM-DD HH:MM:SS)</li>
///   <li><code>username</code> — Username filter (default: * = all)</li>
///   <li><code>eventType</code> — Event type filter (default: * = all)</li>
///   <li><code>maxRows</code> — Maximum rows to return (default: 100, max: 1000)</li>
/// </ul></p>
ClassMethod AuditEvents() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read query parameters before switching namespace
        Set tBeginDate = $Get(%request.Data("beginDate",1))
        Set tEndDate = $Get(%request.Data("endDate",1))
        Set tUsername = $Get(%request.Data("username",1), "*")
        Set tEventType = $Get(%request.Data("eventType",1), "*")
        Set tMaxRows = +$Get(%request.Data("maxRows",1), 100)
        If tMaxRows < 1 Set tMaxRows = 100
        If tMaxRows > 1000 Set tMaxRows = 1000

        Set $NAMESPACE = "%SYS"
        Set tResult = {}
        Set tEvents = []

        Set tRS = ##class(%ResultSet).%New("%SYS.Audit:List")
        If $IsObject(tRS) {
            ; Execute params: BeginDateTime, EndDateTime, EventSources, EventTypes, Events, Usernames
            Set tSC2 = tRS.Execute(tBeginDate, tEndDate, "*", tEventType, "*", tUsername)
            If $$$ISOK(tSC2) {
                Set tRowCount = 0
                While tRS.Next() && (tRowCount < tMaxRows) {
                    Set tEvent = {}
                    Do tEvent.%Set("timestamp", tRS.Get("TimeStamp"))
                    Do tEvent.%Set("username", tRS.Get("Username"))
                    Do tEvent.%Set("eventSource", tRS.Get("EventSource"))
                    Do tEvent.%Set("eventType", tRS.Get("EventType"))
                    Do tEvent.%Set("event", tRS.Get("Event"))
                    Do tEvent.%Set("description", tRS.Get("Description"))
                    Do tEvent.%Set("clientIPAddress", tRS.Get("ClientIPAddress"))
                    Do tEvent.%Set("namespace", tRS.Get("Namespace"))
                    Do tEvents.%Push(tEvent)
                    Set tRowCount = tRowCount + 1
                }
            }
            Do tRS.Close()
        }

        Do tResult.%Set("events", tEvents)
        Do tResult.%Set("count", tEvents.%Size(), "number")
        Do tResult.%Set("maxRows", tMaxRows, "number")

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Collect interoperability metrics for the current namespace.
/// <p>Returns a <class>%DynamicObject</class> with queue depth, error count,
/// and production status for the current namespace context.</p>
ClassMethod CollectInteropMetrics(pNamespace As %String) As %DynamicObject
{
    Set tMetrics = {}
    Do tMetrics.%Set("namespace", pNamespace)

    ; -- Production status --
    Set tProdName = ""
    Set tProdState = ""
    Try {
        Set tSC2 = ##class(Ens.Director).GetProductionStatus(.tProdName, .tStateCode)
        If $$$ISOK(tSC2) {
            Do tMetrics.%Set("productionName", tProdName)
            Do tMetrics.%Set("productionState", $Case(+tStateCode, 1:"Running", 2:"Stopped", 3:"Suspended", 4:"Troubled", :"Unknown"))
            Do tMetrics.%Set("productionStateCode", +tStateCode, "number")
        }
        Else {
            Do tMetrics.%Set("productionName", "")
            Do tMetrics.%Set("productionState", "None")
            Do tMetrics.%Set("productionStateCode", 0, "number")
        }
    }
    Catch {
        Do tMetrics.%Set("productionName", "")
        Do tMetrics.%Set("productionState", "None")
        Do tMetrics.%Set("productionStateCode", 0, "number")
    }

    ; -- Queue depth: pending/active messages in Ens.MessageHeader --
    Set tQueueDepth = 0
    Try {
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT COUNT(*) AS cnt FROM Ens.MessageHeader WHERE Status IN (1,2,3,4,5,6)")
        If $IsObject(tRS) && tRS.%Next() {
            Set tQueueDepth = +tRS.cnt
        }
    }
    Catch {
        ; Ens.MessageHeader may not exist in this namespace
    }
    Do tMetrics.%Set("queueDepth", tQueueDepth, "number")

    ; -- Error count in last 24 hours from Ens_Util.Log --
    Set tErrorCount = 0
    Try {
        Set tCutoff = $ZDateTime($Horolog - 1, 3)
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT COUNT(*) AS cnt FROM Ens_Util.Log WHERE Type = 3 AND TimeLogged > ?", tCutoff)
        If $IsObject(tRS) && tRS.%Next() {
            Set tErrorCount = +tRS.cnt
        }
    }
    Catch {
        ; Ens_Util.Log may not exist in this namespace
    }
    Do tMetrics.%Set("errorCount24h", tErrorCount, "number")

    ; -- Total messages in last 24 hours --
    Set tMessageCount = 0
    Try {
        Set tCutoff = $ZDateTime($Horolog - 1, 3)
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT COUNT(*) AS cnt FROM Ens.MessageHeader WHERE TimeCreated > ?", tCutoff)
        If $IsObject(tRS) && tRS.%Next() {
            Set tMessageCount = +tRS.cnt
        }
    }
    Catch {
        ; Ens.MessageHeader may not exist in this namespace
    }
    Do tMetrics.%Set("messageCount24h", tMessageCount, "number")

    Quit tMetrics
}

/// Return database status information in JSON format.
/// <p>Queries <code>Config.Databases:List</code> in <b>%SYS</b> for database names
/// and directories, then opens each via <code>SYS.Database.%OpenId</code> to collect
/// mounted status, encryption, journal state, and size information.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>name</code> — Optional database name filter (returns single database)</li>
/// </ul></p>
ClassMethod DatabaseCheck() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tName = $Get(%request.Data("name",1))
        Set $NAMESPACE = "%SYS"

        Set tResult = {}
        Set tDatabases = []

        ; Collect database names/directories into array first, then close ResultSet
        ; (same pattern as SystemMetrics — avoids namespace issues during iteration)
        Set tDBRS = ##class(%ResultSet).%New("Config.Databases:List")
        Set tDBCount = 0
        If $IsObject(tDBRS) {
            Set tSC2 = tDBRS.Execute("*")
            If $$$ISOK(tSC2) {
                While tDBRS.Next() {
                    Set tDBName = tDBRS.Get("Name")
                    ; If name filter specified, skip non-matching databases
                    If (tName '= "") && ($ZConvert(tDBName, "U") '= $ZConvert(tName, "U")) Continue
                    Set tDBCount = tDBCount + 1
                    Set tDBList(tDBCount, "name") = tDBName
                    Set tDBList(tDBCount, "dir") = tDBRS.Get("Directory")
                }
            }
            Do tDBRS.Close()
        }

        ; Now iterate collected databases and open each for details
        For tIdx = 1:1:tDBCount {
            Set tDB = {}
            Set tDBName = tDBList(tIdx, "name")
            Set tDBDir = tDBList(tIdx, "dir")
            Do tDB.%Set("name", tDBName)
            Do tDB.%Set("directory", tDBDir)
            Try {
                Set tDBObj = ##class(SYS.Database).%OpenId(tDBDir)
                If $IsObject(tDBObj) {
                    Do tDB.%Set("mounted", +tDBObj.Mounted, "boolean")
                    Do tDB.%Set("readOnly", +tDBObj.ReadOnly, "boolean")
                    Do tDB.%Set("encrypted", +tDBObj.EncryptedDB, "boolean")
                    Do tDB.%Set("journalState", +tDBObj.GlobalJournalState, "number")
                    Do tDB.%Set("sizeMB", +tDBObj.Size, "number")
                    Do tDB.%Set("maxSizeMB", +tDBObj.MaxSize, "number")
                }
            }
            Catch {
                Do tDB.%Set("mounted", 0, "boolean")
                Do tDB.%Set("error", "Unable to open database")
            }
            Do tDatabases.%Push(tDB)
        }

        Do tResult.%Set("databases", tDatabases)
        Do tResult.%Set("count", tDatabases.%Size(), "number")

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return license information in JSON format.
/// <p>Queries <code>$SYSTEM.License</code> class methods for license type,
/// capacity, current usage, and expiration. Converts <code>$Horolog</code>
/// expiration date to <code>YYYY-MM-DD</code> format using <code>$ZDate</code>.</p>
ClassMethod LicenseInfo() As %Status
{
    Set tSC = $$$OK
    Try {
        Set tResult = {}

        ; -- License identification --
        Set tResult."customerName" = $SYSTEM.License.KeyCustomerName()
        Set tResult."licenseCapacity" = $SYSTEM.License.KeyLicenseCapacity()

        ; -- Expiration (convert $Horolog date to YYYY-MM-DD) --
        Set tExpDate = $SYSTEM.License.KeyExpirationDate()
        If +tExpDate > 0 {
            Set tResult."expirationDate" = $ZDate(tExpDate, 3)
        }
        Else {
            Set tResult."expirationDate" = "N/A"
        }

        ; -- Capacity limits --
        Do tResult.%Set("connectionLimit", +$SYSTEM.License.GetConnectionLimit(), "number")
        Do tResult.%Set("userLimit", +$SYSTEM.License.GetUserLimit(), "number")
        Do tResult.%Set("coresLicensed", +$SYSTEM.License.KeyCoresLicensed(), "number")
        Do tResult.%Set("cpusLicensed", +$SYSTEM.License.KeyCPUsLicensed(), "number")

        ; -- Current usage --
        Do tResult.%Set("currentCSPUsers", +$SYSTEM.License.CSPUsers(), "number")

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Reset the system alert counter and state via <code>$SYSTEM.Monitor.Clear()</code>.
/// <p>Accepts a JSON body with a single field: <code>action</code> (must be "reset").</p>
/// <p>The "reset" action calls <code>$SYSTEM.Monitor.Clear()</code> in the <b>%SYS</b>
/// namespace, which clears the in-memory alert counter and resets the system monitor
/// state. The <code>alerts.log</code> file is <b>NOT</b> truncated — historical entries
/// remain on disk for audit. <code>iris_metrics_alerts</code> will re-populate active
/// alerts on the next poll if conditions persist.</p>
/// <p>Note: Per-alert <code>clear</code> by index and <code>acknowledge</code> are not
/// supported — IRIS exposes no native API for either. Deferred to Epic 13 if needed.</p>
ClassMethod AlertsManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body BEFORE namespace switch (Utils is in HSCUSTOM, not %SYS)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate 'action' field before namespace switch
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Only "reset" is supported
        If tAction '= "reset" {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid action '"_tAction_"'. Supported actions: reset. Note: 'clear' (per-alert by index) and 'acknowledge' are not available — IRIS has no native API for either.")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for $SYSTEM.Monitor.Clear()
        Set $NAMESPACE = "%SYS"

        ; Clear the alert counter and system monitor state
        Do $SYSTEM.Monitor.Clear()

        ; Restore namespace before building response
        Set $NAMESPACE = tOrigNS

        ; Build response with ISO 8601 timestamp: replace space separator with "T"
        ; $ZDateTime($Horolog, 3, 1) => "YYYY-MM-DD HH:MM:SS"; $Translate adds "T"
        Set tTimestamp = $Translate($ZDateTime($Horolog, 3, 1), " ", "T")_"Z"
        Set tResult = {}
        Do tResult.%Set("action", "reset")
        Do tResult.%Set("clearedAt", tTimestamp)

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return ECP (Enterprise Cache Protocol) connection status in JSON format.
/// <p>Checks whether ECP is configured on this instance. Returns connection
/// health when configured, or a graceful "not configured" status when ECP
/// is not in use.</p>
ClassMethod ECPStatus() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tResult = {}

        ; Check ECP configuration by probing $SYSTEM.ECP.GetClientIndex
        ; Returns -1 if ECP is not configured
        Set tClientIdx = $SYSTEM.ECP.GetClientIndex("test")
        Set tConfigured = (tClientIdx '= -1)

        Do tResult.%Set("configured", tConfigured, "boolean")

        If tConfigured {
            Do tResult.%Set("status", "ECP is configured")
            Do tResult.%Set("clientIndex", +tClientIdx, "number")
        }
        Else {
            Do tResult.%Set("status", "ECP not configured")
        }

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}
