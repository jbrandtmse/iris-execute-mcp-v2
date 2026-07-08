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

/// Run a runtime database-maintenance operation via <code>SYS.Database</code> class methods.
/// <p>Accepts a JSON body <code>{action, directory, ...params}</code> where
/// <code>action</code> is one of:
/// <ul>
///   <li><code>mount</code> — <code>SYS.Database.MountDatabase(dir, readonly)</code></li>
///   <li><code>dismount</code> — <code>SYS.Database.DismountDatabase(dir)</code> (destructive: takes the DB offline)</li>
///   <li><code>compact</code> — <code>SYS.Database.CompactDatabase(dir, percentFull, .MbProcessed, .MbCompressed)</code></li>
///   <li><code>defragment</code> — <code>SYS.Database.Defragment(dir)</code></li>
///   <li><code>truncate</code> — <code>SYS.Database.ReturnUnusedSpace(dir, targetSize, .ReturnSize)</code> (destructive: shrinks the .DAT, returns trailing free space to the OS)</li>
///   <li><code>expandVolume</code> — <code>SYS.Database.NewVolume(dir, newVolDir, initialSize)</code> (adds a new volume to a multi-volume database)</li>
/// </ul></p>
/// <p>These operations are <b>SYNCHRONOUS</b> — IRIS exposes no native async/queue API
/// for them. <code>compact</code>, <code>defragment</code>, and <code>truncate</code>
/// can run for a while on large databases and the request blocks until they finish.
/// No fabricated started/queued status is returned.</p>
/// <p><b>Guard:</b> <code>directory</code> is required, and the database must exist
/// (checked via <code>SYS.Database.%ExistsId</code>) before any action runs; a missing
/// or unknown directory yields a clean error envelope rather than an opaque
/// <code>&lt;...&gt;</code> crash. Any non-OK <code>%Status</code> from the underlying
/// API (e.g. a DB in use, locked, or unmounted) is propagated through
/// <method>SanitizeError</method>.</p>
/// <p>This tool covers RUNTIME operations only. Database CONFIG (create / modify /
/// delete) lives in the admin <code>iris_database_manage</code> tool (Config.Databases).</p>
ClassMethod DatabaseAction() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read + validate body BEFORE namespace switch (Utils is in HSCUSTOM, not %SYS)
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

        ; action (required)
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate action enum via EXACT membership (NOT a substring test).
        If (tAction'="mount")&&(tAction'="dismount")&&(tAction'="compact")&&(tAction'="defragment")&&(tAction'="truncate")&&(tAction'="expandVolume") {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid action '"_tAction_"'. Supported actions: mount, dismount, compact, defragment, truncate, expandVolume.")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; directory (required for every action — the SYS.Database APIs key on it)
        Set tDirectory = tBody.%Get("directory")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tDirectory, "directory")
        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Read action-specific params (defaults applied; "" coerces via +)
        Set tReadonly = +tBody.%Get("readonly")
        Set tPercentFull = 90
        If tBody.%IsDefined("percentFull") Set tPercentFull = +tBody.%Get("percentFull")
        Set tTargetSize = +tBody.%Get("targetSize")
        Set tNewVolDir = tBody.%Get("newVolDir")
        Set tInitialSize = +tBody.%Get("initialSize")

        Set $NAMESPACE = "%SYS"

        ; ── Guard: confirm the database exists before any operation ──
        ; SYS.Database is keyed on its directory. A missing / unknown directory
        ; produces a clean refusal here rather than an opaque <...> crash inside
        ; the maintenance API (defense in depth; the API %Status is the backstop).
        If '##class(SYS.Database).%ExistsId(tDirectory) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Database directory '"_tDirectory_"' does not exist or is not a configured IRIS database.")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; expandVolume additionally requires newVolDir (validate after NS guard so the
        ; directory-exists check runs first, then restore NS for the error envelope).
        If (tAction = "expandVolume") && (tNewVolDir = "") {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "The 'expandVolume' action requires 'newVolDir' (the directory for the new volume).")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; ── Dispatch to the matching SYS.Database class method ──
        Set tActionSC = $$$OK
        Set tResult = {}
        Do tResult.%Set("action", tAction)
        Do tResult.%Set("directory", tDirectory)

        If tAction = "mount" {
            Set tActionSC = ##class(SYS.Database).MountDatabase(tDirectory, tReadonly)
            Do tResult.%Set("readonly", tReadonly, "boolean")
        }
        ElseIf tAction = "dismount" {
            Set tActionSC = ##class(SYS.Database).DismountDatabase(tDirectory)
        }
        ElseIf tAction = "compact" {
            Set tMbProcessed = 0
            Set tMbCompressed = 0
            Set tActionSC = ##class(SYS.Database).CompactDatabase(tDirectory, tPercentFull, .tMbProcessed, .tMbCompressed)
            Do tResult.%Set("percentFull", +tPercentFull, "number")
            Do tResult.%Set("mbProcessed", +tMbProcessed, "number")
            Do tResult.%Set("mbCompressed", +tMbCompressed, "number")
        }
        ElseIf tAction = "defragment" {
            Set tActionSC = ##class(SYS.Database).Defragment(tDirectory)
        }
        ElseIf tAction = "truncate" {
            Set tReturnSize = 0
            Set tActionSC = ##class(SYS.Database).ReturnUnusedSpace(tDirectory, tTargetSize, .tReturnSize)
            Do tResult.%Set("targetSize", +tTargetSize, "number")
            Do tResult.%Set("returnSize", +tReturnSize, "number")
        }
        ElseIf tAction = "expandVolume" {
            Set tActionSC = ##class(SYS.Database).NewVolume(tDirectory, tNewVolDir, tInitialSize)
            Do tResult.%Set("newVolDir", tNewVolDir)
            Do tResult.%Set("initialSize", +tInitialSize, "number")
        }

        Set $NAMESPACE = tOrigNS

        ; Propagate the underlying API %Status on failure (Rule #9) — gives the
        ; caller the real reason (DB in use, locked, unmounted, insufficient space).
        If $$$ISERR(tActionSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tActionSC))
            Set tSC = $$$OK
            Quit
        }

        Do tResult.%Set("success", 1, "boolean")
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

/// Return detail for a single IRIS process in JSON format.
/// <p>Queries <code>%SYS.ProcessQuery</code> in the <b>%SYS</b> namespace for the
/// process identified by the <code>pid</code> query parameter. Returns process
/// state, routine, namespace, user, resource counters, and the
/// <code>canBeTerminated</code> / <code>canBeSuspended</code> flags that gate the
/// control actions in <method>ProcessManage</method>.</p>
/// <p>Stack/variable inspection is intentionally NOT exposed: <code>%SYS.ProcessQuery</code>
/// only surfaces a process's own stack via mailbox-message methods that require
/// the target to cooperate; the read view here reports the state-level detail that
/// the Management Portal ProcessDetails page shows without that overhead.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>pid</code> — Process ID to inspect (required)</li>
/// </ul></p>
ClassMethod ProcessGet() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read + validate pid BEFORE switching namespace (Utils lives in HSCUSTOM)
        Set tPid = $Get(%request.Data("pid",1))
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tPid, "pid")
        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        ; Coerce pid to its canonical numeric form once so the string-keyed lookups
        ; and the numeric isCurrentProcess check below can never disagree.
        If '$ISVALIDNUM(tPid) || (tPid '= +tPid) || (+tPid <= 0) {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid pid '"_tPid_"'. pid must be a positive integer.")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tPid = +tPid

        Set $NAMESPACE = "%SYS"

        ; Confirm the process exists before reporting detail
        If '##class(%SYS.ProcessQuery).%ExistsId(tPid) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Process "_tPid_" does not exist")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tProc = ##class(%SYS.ProcessQuery).%OpenId(tPid)
        If '$IsObject(tProc) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Unable to open process "_tPid)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tResult = {}
        Do tResult.%Set("pid", +tProc.Pid, "number")
        Do tResult.%Set("namespace", tProc.NameSpace)
        Do tResult.%Set("routine", tProc.Routine)
        Do tResult.%Set("state", tProc.State)
        Do tResult.%Set("userName", tProc.UserName)
        Do tResult.%Set("clientIPAddress", tProc.ClientIPAddress)
        Do tResult.%Set("device", tProc.CurrentDevice)
        Do tResult.%Set("jobType", +tProc.JobType, "number")
        Do tResult.%Set("commandsExecuted", +tProc.CommandsExecuted, "number")
        Do tResult.%Set("globalReferences", +tProc.GlobalReferences, "number")
        Do tResult.%Set("inTransaction", +tProc.InTransaction, "number")
        Do tResult.%Set("cpuTime", +tProc.CPUTime, "number")
        Do tResult.%Set("memoryUsedKB", +tProc.MemoryUsed, "number")
        Do tResult.%Set("priority", +tProc.Priority, "number")
        Do tResult.%Set("roles", tProc.Roles)
        Do tResult.%Set("canBeTerminated", +tProc.CanBeTerminated, "boolean")
        Do tResult.%Set("canBeSuspended", +tProc.CanBeSuspended, "boolean")
        Do tResult.%Set("canBeExamined", +tProc.CanBeExamined, "boolean")
        ; isCurrentProcess: true if this is the calling (REST handler) process
        Do tResult.%Set("isCurrentProcess", (+tProc.Pid = +$Job), "boolean")

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

/// Terminate, suspend, or resume an IRIS process.
/// <p>Accepts a JSON body <code>{action, pid}</code> where <code>action</code> is one
/// of <code>terminate</code>, <code>suspend</code>, or <code>resume</code>. Opens the
/// target via <code>##class(SYS.Process).%OpenId(pid)</code> in the <b>%SYS</b>
/// namespace and calls the corresponding instance method.</p>
/// <p><b>Self / critical-process guard (defense in depth):</b> a control action is
/// REFUSED — changing nothing — when:
/// <ul>
///   <li>The target is the calling process (<code>pid = $JOB</code>), for any action;</li>
///   <li>The action is <code>terminate</code> and <code>%SYS.ProcessQuery.CanBeTerminated</code>
///       is false (a critical system job);</li>
///   <li>The action is <code>suspend</code> and <code>%SYS.ProcessQuery.CanBeSuspended</code>
///       is false.</li>
/// </ul>
/// The guard is enforced here in the handler so it holds even on a direct REST call,
/// independent of any TS-layer pre-check. A refusal returns
/// <code>{action, pid, refused:true, reason}</code> with HTTP 200 (an explanatory
/// result, not a server error).</p>
ClassMethod ProcessManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read + validate body BEFORE namespace switch (Utils is in HSCUSTOM, not %SYS)
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

        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tPid = tBody.%Get("pid")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tPid, "pid")
        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        ; Coerce pid to its canonical numeric form once, then use it everywhere
        ; (existence check, opens, guard, response) so the string-keyed lookups and
        ; the numeric self-guard can never disagree (e.g. " 01234" vs 1234).
        If '$ISVALIDNUM(tPid) || (tPid '= +tPid) || (+tPid <= 0) {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid pid '"_tPid_"'. pid must be a positive integer.")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tPid = +tPid

        ; Validate action enum via EXACT membership (NOT a substring contains test):
        ; a substring test would accept a comma-injected value like "terminate,suspend"
        ; which would then route to Resume() via the Else fall-through below.
        If (tAction '= "terminate") && (tAction '= "suspend") && (tAction '= "resume") {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid action '"_tAction_"'. Supported control actions: terminate, suspend, resume.")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set $NAMESPACE = "%SYS"

        ; Confirm target exists
        If '##class(%SYS.ProcessQuery).%ExistsId(tPid) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Process "_tPid_" does not exist")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; ── Self / critical-process guard (AC 16.1.4) ──
        ; Refuse BEFORE invoking any control method; a refusal changes nothing.
        Set tRefused = 0
        Set tReason = ""
        If (+tPid = +$Job) {
            Set tRefused = 1
            Set tReason = "Refused: cannot "_tAction_" the calling process (PID "_tPid_" = $JOB). This is the process serving the request."
        }
        Else {
            ; Read the can-be-* flags via %SYS.ProcessQuery (no mailbox overhead).
            ; Fail CLOSED: if the query object cannot be opened (e.g. the process
            ; exited between the %ExistsId check above and here), refuse rather than
            ; fall through to the control method with the guard un-applied.
            Set tQ = ##class(%SYS.ProcessQuery).%OpenId(tPid)
            If '$IsObject(tQ) {
                Set tRefused = 1
                Set tReason = "Refused: process "_tPid_" could not be inspected for the "_tAction_" safety check (it may have just exited); no control action was taken."
            }
            ElseIf (tAction = "terminate") && ('+tQ.CanBeTerminated) {
                Set tRefused = 1
                Set tReason = "Refused: process "_tPid_" cannot be terminated (CanBeTerminated=0 - critical/protected system job)."
            }
            ElseIf (tAction = "suspend") && ('+tQ.CanBeSuspended) {
                Set tRefused = 1
                Set tReason = "Refused: process "_tPid_" cannot be suspended (CanBeSuspended=0 - critical/protected system job)."
            }
        }

        If tRefused {
            Set $NAMESPACE = tOrigNS
            Set tResult = {}
            Do tResult.%Set("action", tAction)
            Do tResult.%Set("pid", +tPid, "number")
            Do tResult.%Set("refused", 1, "boolean")
            Do tResult.%Set("reason", tReason)
            Do ..RenderResponseBody($$$OK, , tResult)
            Quit
        }

        ; ── Execute the control action ──
        Set tProc = ##class(SYS.Process).%OpenId(tPid)
        If '$IsObject(tProc) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Unable to open process "_tPid_" for control")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Dispatch by EXACT action match (resume reached only when tAction="resume",
        ; never as a catch-all Else — the enum was already validated above).
        Set tActionSC = $$$OK
        If tAction = "terminate" {
            Set tActionSC = tProc.Terminate()
        }
        ElseIf tAction = "suspend" {
            Set tActionSC = tProc.Suspend()
        }
        ElseIf tAction = "resume" {
            Set tActionSC = tProc.Resume()
        }

        Set $NAMESPACE = tOrigNS

        If $$$ISERR(tActionSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tActionSC))
            Set tSC = $$$OK
            Quit
        }

        Set tResult = {}
        Do tResult.%Set("action", tAction)
        Do tResult.%Set("pid", +tPid, "number")
        Do tResult.%Set("refused", 0, "boolean")
        Do tResult.%Set("success", 1, "boolean")
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Run / freeze / thaw a backup, or list backup history (Story 16.3).
/// <p>Backed by <code>Backup.General</code> in <code>%SYS</code>:
/// <ul>
/// <li><b>run</b> &rarr; <code>StartTask(taskName, jobbackup, quietflag)</code> — runs a
/// USER-DEFINED backup task BY NAME. Live-probe (Rule #16) confirmed there are no
/// predefined/shipped task names; the operator defines the task (name + database
/// list + type) in the Management Portal first, and the backup TYPE is a property of
/// that definition (so <code>backupType</code> here is informational only, not used to
/// pick the task). Requires <code>taskName</code>.</li>
/// <li><b>freeze</b> &rarr; <code>ExternalFreeze(LogFile, Text, ...)</code> — quiesces ALL
/// database writes instance-wide until a thaw. DISRUPTIVE.</li>
/// <li><b>thaw</b> &rarr; <code>ExternalThaw(LogFile, Username, Password)</code> — resumes
/// writes after a freeze.</li>
/// <li><b>listHistory</b> (read) &rarr; walks <code>^SYS("BUHISTORY", hindex, ...)</code>
/// most-recent-first, returning timestamp / type / status / device / log / description.</li>
/// </ul>
/// <b>restore is NOT supported via this tool</b> (Rule #16, AC 16.3.3): IRIS restore is
/// interactive (<code>^DBREST</code> / <code>CLUMENU^JRNRESTO</code>) and not cleanly
/// scriptable through <code>Backup.General</code>. An <code>action="restore"</code> request
/// is rejected here with a clear message rather than crashing — use the IRIS restore
/// utility / Management Portal restore instead.</p>
ClassMethod BackupManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read + validate body BEFORE namespace switch (Utils is in HSCUSTOM, not %SYS)
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

        ; action (required)
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; ── restore guard (AC 16.3.3): defend the server even though restore is
        ; not in the tool's enum — refuse cleanly, never crash. ──
        If tAction = "restore" {
            ; De-caret (Rule #33 / CR 22.1-3): SanitizeError strips ANY token
            ; containing a caret — including CLUMENU^JRNRESTO, whose caret is
            ; not "leading" but still falls inside a contiguous alnum run and
            ; gets removed. Both routine names are written WITHOUT carets here
            ; so they survive SanitizeError; the doc comment above (a
            ; non-sanitized surface) keeps the caret form.
            Set tSC = $$$ERROR($$$GeneralError, "Restore is not supported via this tool. IRIS restore is interactive (DBREST / CLUMENU in JRNRESTO) and not cleanly scriptable via Backup.General; use the IRIS restore utility or the Management Portal restore instead.")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate action enum via EXACT membership (NOT a substring test).
        If (tAction'="run")&&(tAction'="freeze")&&(tAction'="thaw")&&(tAction'="listHistory") {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid action '"_tAction_"'. Supported actions: run, freeze, thaw, listHistory. (restore is not supported — use the IRIS restore utility.)")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Read params (defaults applied; "" coerces via +)
        Set tTaskName = tBody.%Get("taskName")
        Set tBackupType = tBody.%Get("backupType")
        Set tJobBackup = +tBody.%Get("jobbackup")
        Set tDevice = tBody.%Get("device")
        Set tLogFile = tBody.%Get("logFile")
        Set tDescription = tBody.%Get("description")
        Set tUsername = tBody.%Get("username")
        Set tPassword = tBody.%Get("password")

        ; run requires taskName (validate before NS switch — Utils is in HSCUSTOM)
        If tAction = "run" {
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTaskName, "taskName")
            If $$$ISERR(tSC) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
        }

        Set $NAMESPACE = "%SYS"

        Set tActionSC = $$$OK
        Set tResult = {}
        Do tResult.%Set("action", tAction)

        If tAction = "listHistory" {
            ; Walk ^SYS("BUHISTORY", hindex, ...) most-recent-first. The hindex is
            ; date*1000000+time ($HOROLOG parts); the "0" index node is skipped by
            ; reverse $Order from "" (numeric keys are all positive).
            Set tEntries = []
            Set tCount = 0
            Set tMax = 50
            Set tKey = $Order(^SYS("BUHISTORY", ""), -1)
            While (tKey '= "") && (tCount < tMax) {
                ; Only treat canonical positive-integer subscripts as history index
                ; nodes. This skips the "0" metadata node (LOGNOTPURGED, etc.) AND
                ; defends against any non-numeric / non-canonical subscript a corrupt
                ; or foreign-written global might carry (which would otherwise feed
                ; garbage to $ZDateTime below).
                If (tKey = +tKey) && (tKey = (tKey \ 1)) && (+tKey > 0) {
                    Set tEntry = {}
                    ; Decode hindex = days*1000000 + seconds back to a $HOROLOG string.
                    ; Guard the timestamp render: a node whose seconds part is out of
                    ; $HOROLOG range (>=86400) or otherwise illegal must degrade this
                    ; ONE entry's timestamp gracefully, never abort the whole listing.
                    Set tHoro = (tKey \ 1000000) _ "," _ (tKey # 1000000)
                    Set tTimestamp = ""
                    Try {
                        Set tTimestamp = $ZDateTime(tHoro, 3)
                    } Catch tTSErr {
                        Set tTimestamp = ""
                    }
                    Do tEntry.%Set("timestamp", tTimestamp)
                    Do tEntry.%Set("type", $Get(^SYS("BUHISTORY", tKey, "TYPE")))
                    Do tEntry.%Set("status", $Get(^SYS("BUHISTORY", tKey, "STATUS")))
                    Do tEntry.%Set("device", $Get(^SYS("BUHISTORY", tKey, "DEVICE")))
                    Do tEntry.%Set("logFile", $Get(^SYS("BUHISTORY", tKey, "LOG")))
                    Do tEntry.%Set("description", $Get(^SYS("BUHISTORY", tKey, "DESC")))
                    Do tEntry.%Set("list", $Get(^SYS("BUHISTORY", tKey, "LIST")))
                    Do tEntries.%Push(tEntry)
                    Set tCount = tCount + 1
                }
                Set tKey = $Order(^SYS("BUHISTORY", tKey), -1)
            }
            Do tResult.%Set("entries", tEntries)
            Do tResult.%Set("count", tCount, "number")
        }
        ElseIf tAction = "run" {
            ; StartTask(taskname, jobbackup, quietflag) — quietflag=1 keeps output
            ; off the principal device (we have none in a REST context).
            Set tActionSC = ##class(Backup.General).StartTask(tTaskName, tJobBackup, 1)
            Do tResult.%Set("taskName", tTaskName)
            Do tResult.%Set("jobbackup", +tJobBackup, "boolean")
            If tBackupType '= "" Do tResult.%Set("backupType", tBackupType)
        }
        ElseIf tAction = "freeze" {
            ; ExternalFreeze(LogFile, Text, SwitchJournalFile=1, TimeOut=10, ...)
            Set tActionSC = ##class(Backup.General).ExternalFreeze(tLogFile, tDescription)
            If tLogFile '= "" Do tResult.%Set("logFile", tLogFile)
        }
        ElseIf tAction = "thaw" {
            ; ExternalThaw(LogFile, Username, Password)
            Set tActionSC = ##class(Backup.General).ExternalThaw(tLogFile, tUsername, tPassword)
            If tLogFile '= "" Do tResult.%Set("logFile", tLogFile)
        }

        Set $NAMESPACE = tOrigNS

        ; Propagate the underlying API %Status on failure (Rule #9).
        If $$$ISERR(tActionSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tActionSC))
            Set tSC = $$$OK
            Quit
        }

        Do tResult.%Set("success", 1, "boolean")
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
