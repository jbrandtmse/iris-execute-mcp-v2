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

        ; -- Global references via $ZU(190,0) --
        Set tGlobalRefs = 0
        Try { Set tGlobalRefs = $ZU(190,0) } Catch { }
        Set tMetric = {}
        Do tMetric.%Set("name", "iris_global_references_total")
        Do tMetric.%Set("help", "Total global references since startup")
        Do tMetric.%Set("type", "counter")
        Do tMetric.%Set("value", +tGlobalRefs, "number")
        Do tMetrics.%Push(tMetric)

        ; -- Routine commands via $ZU(190,1) --
        Set tRoutineCmds = 0
        Try { Set tRoutineCmds = $ZU(190,1) } Catch { }
        Set tMetric = {}
        Do tMetric.%Set("name", "iris_routine_commands_total")
        Do tMetric.%Set("help", "Total routine commands since startup")
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

}
