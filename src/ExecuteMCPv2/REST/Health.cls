/// REST handler for the composite instance health check.
/// <p>Backs the custom REST endpoint <code>/api/executemcp/v2/monitor/health</code>
/// (<method>HealthCheck</method>). Split out from <class>ExecuteMCPv2.REST.Monitor</class>
/// (Story 23.1, AC 23.1.1) once the handler + its per-area helpers exceeded the
/// project's ~400-added-line-per-class guideline for that file.</p>
/// <p>Every probe here mirrors the exact system-class call an existing
/// <class>ExecuteMCPv2.REST.Monitor</class> / <class>ExecuteMCPv2.REST.Config</class> /
/// <class>ExecuteMCPv2.REST.Interop</class> handler already makes (Rule #2) — the pinned
/// per-area source list lives in <code>research/feature-specs/01-health-check.md</code> §3
/// (Story 23.0). This class returns <b>raw per-area values only</b>; ALL threshold/verdict
/// logic lives in TypeScript (<code>iris_health_check</code>, Story 23.2), per
/// architecture.md ADR H5 (server-side composition, TS-side interpretation).</p>
Class ExecuteMCPv2.REST.Health Extends %Atelier.REST
{

/// Composite health-check endpoint: gathers all requested health areas in
/// ONE round-trip with per-area fault isolation (Story 23.1 / spec
/// <code>research/feature-specs/01-health-check.md</code>).
/// <p>Returns <b>raw per-area values only</b> — no threshold/verdict logic.
/// Thresholds, findings, and the overall verdict are computed in TypeScript
/// by <code>iris_health_check</code> (Story 23.2), per architecture.md ADR
/// H5 (server-side composition, TS-side interpretation).</p>
/// <p>Query parameters (GET) / JSON body (POST):
/// <ul>
///   <li><code>areas</code> — GET: comma-separated area names in the
///       <code>areas</code> query parameter (e.g. <code>?areas=journal,license</code>);
///       POST: a JSON array of area names in the request body
///       (<code>{"areas": ["journal","license"]}</code>). Optional; when
///       omitted, all 9 areas are checked: <code>system, databases, journal,
///       mirror, locks, license, ecp, alerts, interop</code>.</li>
/// </ul></p>
/// <p>Response shape: <code>{ "areas": { "&lt;area&gt;": {...raw...}, ... },
/// "errors": { "&lt;area&gt;": "&lt;sanitized msg&gt;" } }</code>. Each area
/// probe runs in its own Try/Catch (Rule #7) — a single area's failure lands
/// in <code>errors[area]</code> (sanitized, Rule #33) and leaves every other
/// area intact; the request still returns HTTP 200. Non-configured areas
/// (no mirror membership, no ECP, no Ens classes in this namespace, an
/// unmounted/unlimited-size database) return distinguishable raw markers in
/// <code>areas</code> — e.g. <code>interopEnabled:false</code>,
/// <code>isMember:false</code>, <code>configured:false</code>, or a
/// per-database <code>maxSize:0</code>/<code>mounted:0</code> — never as
/// <code>errors</code> entries.</p>
ClassMethod HealthCheck() As %Status
{
    Set tSC = $$$OK
    Set tResult = ""
    Set tOrigNS = $NAMESPACE
    Set tErrored = 0
    Try {
        ; ---- Parse the requested areas BEFORE any namespace switch ----
        Set tRequestedCSV = ""
        If (%request.Method = "POST") {
            Set tSC1 = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
            If $$$ISERR(tSC1) {
                Set tErrored = 1
                Set tCmdStatus = tSC1
                Quit
            }
            If $IsObject(tBody) {
                Set tAreasArr = tBody.%Get("areas")
                If $IsObject(tAreasArr) {
                    Set tIter = tAreasArr.%GetIterator()
                    While tIter.%GetNext(.tIdx, .tVal) {
                        Set tRequestedCSV = tRequestedCSV _ $Select(tRequestedCSV="":"",1:",") _ tVal
                    }
                }
            }
        }
        Else {
            Set tRequestedCSV = $Get(%request.Data("areas",1))
        }

        Do ..HealthCheckParseAreas(tRequestedCSV, .tWant)

        Set tAreas = {}
        Set tErrors = {}

        ; interop FIRST, in the ORIGINAL (target) namespace: Ens.* classes are
        ; per-namespace and the "no Ens classes" gate must run before the
        ; %SYS switch below (AC 23.1.2 / spec §3 interop row).
        If tWant("interop") Do ..HealthCheckInterop(tAreas, tErrors)

        ; Remaining 8 areas all read %SYS-namespace system classes.
        Set $NAMESPACE = "%SYS"
        If tWant("system")    Do ..HealthCheckSystem(tAreas, tErrors)
        If tWant("databases") Do ..HealthCheckDatabases(tAreas, tErrors)
        If tWant("journal")   Do ..HealthCheckJournal(tAreas, tErrors)
        If tWant("mirror")    Do ..HealthCheckMirror(tAreas, tErrors)
        If tWant("locks")     Do ..HealthCheckLocks(tAreas, tErrors)
        If tWant("license")   Do ..HealthCheckLicense(tAreas, tErrors)
        If tWant("ecp")       Do ..HealthCheckECP(tAreas, tErrors)
        If tWant("alerts")    Do ..HealthCheckAlerts(tAreas, tErrors)
        Set $NAMESPACE = tOrigNS

        Set tResult = {}
        Do tResult.%Set("areas", tAreas)
        Do tResult.%Set("errors", tErrors)
        Quit
    } Catch ex {
        Set $NAMESPACE = tOrigNS
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

/// Resolve the requested-areas membership table from a comma-separated area
/// list into <var>pWant</var> (subscripted <code>pWant(areaName)=1/0</code>).
/// A blank <var>pRequestedCSV</var> means "all 9 areas". Unknown names are
/// silently ignored — the TS-layer zod enum (Story 23.2) is the
/// authoritative validator for a hard rejection; this endpoint stays
/// permissive. Split out from <method>HealthCheck</method> so area
/// filtering (AC 23.1.3c) is unit-testable without a live
/// <var>%request</var> CSP context.
ClassMethod HealthCheckParseAreas(pRequestedCSV As %String, Output pWant) As %Status
{
    Set tSC = $$$OK
    Try {
        Kill pWant
        Set tAllAreasCSV = "system,databases,journal,mirror,locks,license,ecp,alerts,interop"
        Set tWantAll = (pRequestedCSV = "")
        For tI = 1:1:$Length(tAllAreasCSV, ",") {
            Set pWant($Piece(tAllAreasCSV, ",", tI)) = tWantAll
        }
        If 'tWantAll {
            For tI = 1:1:$Length(pRequestedCSV, ",") {
                Set tName = $ZStrip($Piece(pRequestedCSV, ",", tI), "<>W")
                If $Data(pWant(tName)) Set pWant(tName) = 1
            }
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Convert a caught exception's <class>%Status</class> into a single-line,
/// Rule #33-safe display string for the per-area <code>errors</code> map
/// (<method>ExecuteMCPv2.Utils:SanitizeError</method> already strips
/// caret-global/routine references; this also collapses embedded CR/LF/TAB).
ClassMethod AreaErrorText(pStatus As %Status) As %String
{
    Set tText = "An internal error occurred"
    Try {
        Set tSafe = ##class(ExecuteMCPv2.Utils).SanitizeError(pStatus)
        Set tRaw = $System.Status.GetErrorText(tSafe)
        Set tClean = $ZStrip($Translate(tRaw, $Char(13,10,9), "   "), "<>W")
        If tClean '= "" Set tText = tClean
    } Catch {
        Set tText = "An internal error occurred"
    }
    Quit tText
}

/// <code>system</code> area: instance-wide global-reference and
/// routine-command counters, uptime, and process count (mirrors
/// <class>ExecuteMCPv2.REST.Monitor</class> <method>SystemMetrics</method> —
/// Rule #5: instance-wide samplers only, never per-process <code>$ZU</code>).
/// Absorbs the dropped <code>memory</code> area conceptually (Story 23.0
/// finding) — adds NO new fields.
ClassMethod HealthCheckSystem(pAreas As %DynamicObject, pErrors As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tArea = {}

        Set tGlobalRefs = 0
        Set tGRef = ##class(SYS.Stats.Global).Sample()
        If $IsObject(tGRef) {
            Set tGlobalRefs = (+tGRef.RefLocal) + (+tGRef.RefPrivate) + (+tGRef.RefRemote)
        }
        Do tArea.%Set("globalReferences", tGlobalRefs, "number")

        Set tRoutineCmds = 0
        Set tRRef = ##class(SYS.Stats.Routine).Sample()
        If $IsObject(tRRef) {
            Set tRoutineCmds = +tRRef.RtnCommands
        }
        Do tArea.%Set("routineCommands", tRoutineCmds, "number")

        Do tArea.%Set("uptimeSeconds", +$ZH, "number")

        Set tProcessCount = 0
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT COUNT(*) AS cnt FROM %SYS.ProcessQuery")
        If $IsObject(tRS) && tRS.%Next() {
            Set tProcessCount = +tRS.cnt
        }
        Do tArea.%Set("processCount", tProcessCount, "number")

        Do pAreas.%Set("system", tArea)
    } Catch ex {
        Do pErrors.%Set("system", ..AreaErrorText(ex.AsStatus()))
    }
    Quit tSC
}

/// <code>databases</code> area: per-database <code>{size, maxSize, mounted,
/// openFailed}</code> raw values (mirrors <class>ExecuteMCPv2.REST.Config</class>
/// <method>DatabaseList</method> — <code>Config.Databases:List</code> +
/// <code>SYS.Database.%OpenId</code>). <var>openFailed</var> distinguishes a
/// genuine <code>%OpenId</code> failure from a legitimately-unlimited
/// (<code>maxSize=0</code>) or unmounted database (CR 23.0-5) — TS treats
/// <code>maxSize=0</code> or <code>mounted=0</code> as <code>notApplicable</code>
/// and <code>openFailed=1</code> as a real problem.
ClassMethod HealthCheckDatabases(pAreas As %DynamicObject, pErrors As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tList = []
        Set tDBRS = ##class(%ResultSet).%New("Config.Databases:List")
        Set tSC2 = tDBRS.Execute("*")
        If $$$ISOK(tSC2) {
            While tDBRS.Next() {
                Set tDBName = tDBRS.Get("Name")
                Set tDBDir = tDBRS.Get("Directory")
                Set tEntry = {}
                Do tEntry.%Set("name", tDBName)
                Do tEntry.%Set("directory", tDBDir)
                Set tSize = 0, tMaxSize = 0, tMounted = 0, tOpenFailed = 0
                Try {
                    Set tDBObj = ##class(SYS.Database).%OpenId(tDBDir)
                    If $IsObject(tDBObj) {
                        Set tSize = +tDBObj.Size
                        Set tMaxSize = +tDBObj.MaxSize
                        Set tMounted = +tDBObj.Mounted
                    } Else {
                        Set tOpenFailed = 1
                    }
                } Catch {
                    Set tOpenFailed = 1
                }
                Do tEntry.%Set("size", tSize, "number")
                Do tEntry.%Set("maxSize", tMaxSize, "number")
                Do tEntry.%Set("mounted", tMounted, "boolean")
                Do tEntry.%Set("openFailed", tOpenFailed, "boolean")
                Do tList.%Push(tEntry)
            }
            Do tDBRS.Close()
            Do pAreas.%Set("databases", tList)
        } Else {
            Do pErrors.%Set("databases", ..AreaErrorText(tSC2))
        }
    } Catch ex {
        Do pErrors.%Set("databases", ..AreaErrorText(ex.AsStatus()))
    }
    Quit tSC
}

/// <code>journal</code> area: current-journal metadata (mirrors
/// <class>ExecuteMCPv2.REST.Monitor</class> <method>JournalInfo</method>)
/// plus the primary journal directory's volume <code>{free, total}</code>
/// bytes via <code>%Library.File.GetDirectorySpace</code> (new for this
/// story — spec §3 journal row) so TS can compute a full-% independent of
/// journal-file rollover.
ClassMethod HealthCheckJournal(pAreas As %DynamicObject, pErrors As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tArea = {}
        Do tArea.%Set("currentFile", ##class(%SYS.Journal.System).GetCurrentFileName())
        Set tPrimaryDir = ##class(%SYS.Journal.System).GetPrimaryDirectory()
        Do tArea.%Set("primaryDirectory", tPrimaryDir)
        Do tArea.%Set("alternateDirectory", ##class(%SYS.Journal.System).GetAlternateDirectory())
        Do tArea.%Set("fileCount", +##class(%SYS.Journal.System).GetCurrentFileCount(), "number")
        Do tArea.%Set("currentOffset", +##class(%SYS.Journal.System).GetCurrentFileOffset(), "number")
        Do tArea.%Set("freeSpaceBytes", +##class(%SYS.Journal.System).GetFreeSpace(), "number")
        Do tArea.%Set("state", ##class(%SYS.Journal.System).GetStateString())

        Set tVolFree = 0, tVolTotal = 0
        Try {
            Set tDirSC = ##class(%Library.File).GetDirectorySpace(tPrimaryDir, .tVolFree, .tVolTotal, 0)
            If $$$ISERR(tDirSC) { Set tVolFree = 0, tVolTotal = 0 }
        } Catch {
            Set tVolFree = 0, tVolTotal = 0
        }
        Do tArea.%Set("volumeFreeBytes", +tVolFree, "number")
        Do tArea.%Set("volumeTotalBytes", +tVolTotal, "number")

        Do pAreas.%Set("journal", tArea)
    } Catch ex {
        Do pErrors.%Set("journal", ..AreaErrorText(ex.AsStatus()))
    }
    Quit tSC
}

/// <code>mirror</code> area: mirror membership/role status (mirrors
/// <class>ExecuteMCPv2.REST.Monitor</class> <method>MirrorStatus</method>).
/// <code>isMember:false</code> IS the raw <code>notApplicable</code> signal
/// when this instance is not a mirror member — TS interprets it, per ADR H5.
ClassMethod HealthCheckMirror(pAreas As %DynamicObject, pErrors As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tArea = {}
        Set tIsMember = +$SYSTEM.Mirror.IsMember()
        Do tArea.%Set("isMember", tIsMember, "boolean")
        If tIsMember {
            Set tMirrorName = $SYSTEM.Mirror.MirrorName()
            Do tArea.%Set("mirrorName", tMirrorName)
            Do tArea.%Set("memberType", $SYSTEM.Mirror.GetMemberType())
            Do tArea.%Set("isPrimary", +$SYSTEM.Mirror.IsPrimary(), "boolean")
            Do tArea.%Set("isBackup", +$SYSTEM.Mirror.IsBackup(), "boolean")
            Do tArea.%Set("isAsyncMember", +$SYSTEM.Mirror.IsAsyncMember(), "boolean")
            Do tArea.%Set("status", $SYSTEM.Mirror.GetStatus(tMirrorName))
        }
        Do pAreas.%Set("mirror", tArea)
    } Catch ex {
        Do pErrors.%Set("mirror", ..AreaErrorText(ex.AsStatus()))
    }
    Quit tSC
}

/// <code>locks</code> area: lock-table space CSV (PINNED, Story 23.0 —
/// <code>%SYS</code>-only, does NOT exist outside <code>%SYS</code>).
/// Raw <code>{available, usable, used}</code> bytes; TS computes
/// <code>used/(usable+used)*100</code> (the exact formula
/// <class>%Monitor.System.LockTable</class> uses) and guards
/// <code>usable+used=0</code> as <code>notApplicable</code>. Do NOT use
/// <code>GetMaxLockTableSize()</code> — a ~1TB theoretical-ceiling sentinel,
/// not real capacity.
ClassMethod HealthCheckLocks(pAreas As %DynamicObject, pErrors As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tCSV = ##class(SYS.Lock).GetLockSpaceInfo()
        Set tArea = {}
        Do tArea.%Set("available", +$Piece(tCSV, ",", 1), "number")
        Do tArea.%Set("usable", +$Piece(tCSV, ",", 2), "number")
        Do tArea.%Set("used", +$Piece(tCSV, ",", 3), "number")
        Do pAreas.%Set("locks", tArea)
    } Catch ex {
        Do pErrors.%Set("locks", ..AreaErrorText(ex.AsStatus()))
    }
    Quit tSC
}

/// <code>license</code> area: raw CSP-user count + user limit (mirrors
/// <class>ExecuteMCPv2.REST.Monitor</class> <method>LicenseInfo</method> —
/// MUST use <code>GetUserLimit()</code>, NOT <code>GetConnectionLimit()</code>,
/// which is a per-user cap unrelated to overall capacity and reads 0 on this
/// edition) plus IRIS's own authoritative
/// <code>SYS.Stats.Dashboard.LicenseCurrent(Pct)</code> dashboard figures
/// (CR 23.0-2) so 23.2 can prefer whichever numerator proves more accurate
/// under load.
ClassMethod HealthCheckLicense(pAreas As %DynamicObject, pErrors As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tArea = {}
        Do tArea.%Set("currentCSPUsers", +$SYSTEM.License.CSPUsers(), "number")
        Do tArea.%Set("userLimit", +$SYSTEM.License.GetUserLimit(), "number")

        Set tLicCurrent = 0, tLicCurrentPct = 0
        Try {
            Set tDash = ##class(SYS.Stats.Dashboard).Sample()
            If $IsObject(tDash) {
                Set tLicCurrent = +tDash.LicenseCurrent
                Set tLicCurrentPct = +tDash.LicenseCurrentPct
            }
        } Catch {
            Set tLicCurrent = 0, tLicCurrentPct = 0
        }
        Do tArea.%Set("licenseCurrent", tLicCurrent, "number")
        Do tArea.%Set("licenseCurrentPct", tLicCurrentPct, "number")

        Do pAreas.%Set("license", tArea)
    } Catch ex {
        Do pErrors.%Set("license", ..AreaErrorText(ex.AsStatus()))
    }
    Quit tSC
}

/// <code>ecp</code> area: ECP configuration probe (mirrors
/// <class>ExecuteMCPv2.REST.Monitor</class> <method>ECPStatus</method>).
/// <code>configured:false</code> IS the raw <code>notApplicable</code> signal.
ClassMethod HealthCheckECP(pAreas As %DynamicObject, pErrors As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tArea = {}
        Set tClientIdx = $SYSTEM.ECP.GetClientIndex("test")
        Do tArea.%Set("configured", (tClientIdx '= -1), "boolean")
        Do pAreas.%Set("ecp", tArea)
    } Catch ex {
        Do pErrors.%Set("ecp", ..AreaErrorText(ex.AsStatus()))
    }
    Quit tSC
}

/// <code>alerts</code> area: raw numeric <code>$SYSTEM.Monitor.State()</code>
/// (mirrors <class>ExecuteMCPv2.REST.Monitor</class> <method>SystemAlerts</method>
/// — do NOT synthesize a per-alert <code>severity</code>; the existing
/// handler's <code>alerts[].severity</code> is a copy of the overall state
/// text, not real per-alert data, per Story 23.0 finding). TS maps every
/// non-zero <code>state</code> to a level.
ClassMethod HealthCheckAlerts(pAreas As %DynamicObject, pErrors As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tArea = {}
        Do tArea.%Set("state", +$SYSTEM.Monitor.State(), "number")
        Do tArea.%Set("alertCount", +$SYSTEM.Monitor.Alerts(), "number")

        Set tMessages = []
        Set tAlertData = "", tMsgs = "", tLastAlert = ""
        Set tSC2 = $SYSTEM.Monitor.GetAlerts(.tAlertData, .tMsgs, .tLastAlert)
        If $$$ISOK(tSC2) {
            Set tKey = ""
            For {
                Set tKey = $Order(tMsgs(tKey))
                Quit:tKey=""
                Do tMessages.%Push($Get(tMsgs(tKey)))
            }
        }
        Do tArea.%Set("messages", tMessages)
        Do tArea.%Set("lastAlert", tLastAlert)

        Do pAreas.%Set("alerts", tArea)
    } Catch ex {
        Do pErrors.%Set("alerts", ..AreaErrorText(ex.AsStatus()))
    }
    Quit tSC
}

/// <code>interop</code> area: production queue depths (mirrors
/// <class>ExecuteMCPv2.REST.Interop</class> <method>QueueStatus</method>).
/// Gates FIRST via <code>Ens.Director.GetProductionStatus</code> (mirrors
/// sibling <method>Interop.cls:ProductionStatus</method>) — when the gate
/// errors or throws (no Ens classes in this namespace), emits the raw
/// <code>interopEnabled:false</code> <code>notApplicable</code> signal and
/// returns WITHOUT touching <var>pErrors</var> (AC 23.1.2: this case must
/// NOT be treated as a per-area error). A running/stopped production with
/// zero queues is <code>interopEnabled:true, queueCount:0</code> — that IS
/// applicable, not <code>notApplicable</code>.
ClassMethod HealthCheckInterop(pAreas As %DynamicObject, pErrors As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set tGateOK = 0
    Set tProdName = ""
    Set tProdState = 0
    Try {
        Set tGateSC = ##class(Ens.Director).GetProductionStatus(.tProdName, .tProdState)
        Set tGateOK = $$$ISOK(tGateSC)
    } Catch {
        Set tGateOK = 0
    }

    If 'tGateOK {
        Set tArea = {}
        Do tArea.%Set("interopEnabled", 0, "boolean")
        Do pAreas.%Set("interop", tArea)
        Quit tSC
    }

    Try {
        Set tArea = {}
        Do tArea.%Set("interopEnabled", 1, "boolean")
        Do tArea.%Set("productionName", tProdName)
        Do tArea.%Set("productionStateCode", +tProdState, "number")

        Set tQueues = []
        Set tQRS = ##class(%ResultSet).%New("Ens.Queue:Enumerate")
        Set tQSC = tQRS.Execute()
        If $$$ISOK(tQSC) {
            While tQRS.Next() {
                Set tQ = {}
                Do tQ.%Set("name", tQRS.Get("Name"))
                Do tQ.%Set("count", +tQRS.Get("Count"), "number")
                Do tQueues.%Push(tQ)
            }
            Do tArea.%Set("queues", tQueues)
            Do tArea.%Set("queueCount", tQueues.%Size(), "number")
            Do pAreas.%Set("interop", tArea)
        } Else {
            Do pErrors.%Set("interop", ..AreaErrorText(tQSC))
        }
    } Catch ex {
        Do pErrors.%Set("interop", ..AreaErrorText(ex.AsStatus()))
    }
    Quit tSC
}

}
