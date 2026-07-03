/// REST handler for Interoperability production lifecycle operations.
/// <p>Provides create, delete, start, stop, restart, update, recover, and
/// status operations for IRIS Interoperability productions via the custom REST
/// endpoint <code>/api/executemcp/v2/interop/production</code>.</p>
/// <p>Unlike Config/Security handlers, Ens.* classes operate in the
/// <b>target namespace</b> (the production's namespace), NOT %SYS.
/// The web application runs in HSCUSTOM, so namespace switching via
/// <method>ExecuteMCPv2.Utils:SwitchNamespace</method> is required for
/// all Ens.Director and Ens.Config.Production calls.</p>
Class ExecuteMCPv2.REST.Interop Extends %Atelier.REST
{

/// Create or delete an Interoperability production.
/// <p>Accepts a JSON body with <code>action</code> ("create" or "delete"),
/// <code>name</code> (production class name), and optional <code>namespace</code>.
/// Productions must be stopped before deletion.</p>
ClassMethod ProductionManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters
        Set tAction = tBody.%Get("action")
        Set tName = tBody.%Get("name")
        Set tNamespace = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "create") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        If tAction = "create" {
            ; Check if production already exists
            If ##class(%Dictionary.ClassDefinition).%ExistsId(tName) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Production '"_tName_"' already exists")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; Create production class via %Dictionary.ClassDefinition + XData + compile
            ; (same approach as EnsPortal.Dialog.ProductionWizard lines 181-189)
            Set tCreateSC = $$$OK
            Try {
                Set tClsDef = ##class(%Dictionary.ClassDefinition).%New()
                Set tClsDef.Name = tName
                Set tClsDef.Super = "Ens.Production"
                Set tClsDef.ClassVersion = 25

                Set tXData = ##class(%Dictionary.XDataDefinition).%New()
                Set tXData.Name = "ProductionDefinition"
                Do tXData.Data.WriteLine("<Production Name="""_tName_"""/>")
                Do tClsDef.XDatas.Insert(tXData)

                Set tCreateSC = tClsDef.%Save()
                If $$$ISOK(tCreateSC) {
                    Set tCreateSC = $System.OBJ.Compile(tName, "k-d")
                }
            }
            Catch exCreate {
                Set tCreateSC = exCreate.AsStatus()
            }
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tCreateSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCreateSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            ; Check if production exists
            If '##class(%Dictionary.ClassDefinition).%ExistsId(tName) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Production '"_tName_"' does not exist")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; Check if production is running — must be stopped first
            Set tSC2 = ##class(Ens.Director).GetProductionStatus(.tProdName, .tState)
            If $$$ISOK(tSC2) && (tProdName = tName) && (tState = 1) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Production '"_tName_"' is running; stop it before deleting")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; Delete the class definition first — Ens.Projection.Production.RemoveProjection()
            ; fires automatically and handles the Ens.Config.Production record cleanup.
            ; Deleting in the reverse order (config first, then class) is fragile: if the
            ; Ens.Config.Production record is absent (orphaned class, external creation), the
            ; first %DeleteId fails and the class definition is never removed.
            Set tDeleteSC = ##class(%Dictionary.ClassDefinition).%DeleteId(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tDeleteSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tDeleteSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Start, stop, restart, update, recover, or clean a production.
/// <p>Accepts a JSON body with <code>action</code> and optional parameters:
/// <ul>
///   <li><code>name</code> — production class name (required for start/restart)</li>
///   <li><code>timeout</code> — seconds to wait for stop (default 120)</li>
///   <li><code>force</code> — force stop on timeout (default false)</li>
///   <li><code>killAppData</code> — (clean action only) when true, also wipe the
///       persistent <code>^Ens.AppData</code> business state (HL7 sequence numbers,
///       file/FTP done-file tables, batch/control state). Requires <code>confirm</code>.</li>
///   <li><code>confirm</code> — (clean action only) must be true to permit a
///       <code>killAppData</code> persistent wipe; the wipe is refused otherwise.</li>
///   <li><code>namespace</code> — target namespace for the production</li>
/// </ul></p>
/// <p><b>recover</b> is the preferred first response to a troubled production;
/// <b>clean</b> is a last resort for when recover does not resolve the problem.</p>
ClassMethod ProductionControl() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "start") && (tAction '= "stop") && (tAction '= "restart") && (tAction '= "update") && (tAction '= "recover") && (tAction '= "clean") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: start, stop, restart, update, recover, clean")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tNamespace = tBody.%Get("namespace")
        ; Use direct %Get() with conditional default — $Get() cannot wrap a method call
        ; (triggers multidim access on %DynamicObject, raising <INVALID CLASS>). BUG-3.
        Set tTimeout = +tBody.%Get("timeout")
        If tTimeout = 0 Set tTimeout = 120
        Set tForce = +tBody.%Get("force")

        ; Switch to target namespace for Ens.Director operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        If tAction = "start" {
            Set tName = tBody.%Get("name")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
            If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tSC = ##class(Ens.Director).StartProduction(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "started", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "stop" {
            Set tSC = ##class(Ens.Director).StopProduction(tTimeout, tForce)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "stopped"}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "restart" {
            ; Validate name BEFORE stopping — avoid leaving production stopped on validation failure
            Set tName = tBody.%Get("name")
            If tName = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'name' is required for restart action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; Stop then start
            Set tSC = ##class(Ens.Director).StopProduction(tTimeout, tForce)
            If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tSC = ##class(Ens.Director).StartProduction(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "restarted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "update" {
            Set tSC = ##class(Ens.Director).UpdateProduction()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "updated"}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "recover" {
            ; RecoverProduction() takes NO arguments — it acts only on a Troubled
            ; production and suspends the runtime. The prior call passed tForce,
            ; which raised <PARAMETER> at runtime (Story 20.0 AC 20.0.6 latent-bug fix).
            Set tSC = ##class(Ens.Director).RecoverProduction()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "recovered"}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "clean" {
            ; Last resort for a wedged production (recover is the preferred first
            ; response). Depends on ##class(Ens.Director).CleanProduction — an
            ; [ Internal ] method (Rule #4): re-verify its signature/running-guard +
            ; ^Ens.AppData semantics on IRIS upgrade. See the Epic 20 change proposal.
            ; killAppData=1 additionally wipes the PERSISTENT ^Ens.AppData (HL7
            ; sequence numbers, file/FTP done-file tables, batch/control state) →
            ; duplicate re-ingestion of already-processed data. That destructive
            ; wipe is double-gated behind confirm=true (Rule #26).
            Set tKillAppData = +tBody.%Get("killAppData")
            If tKillAppData && ('+tBody.%Get("confirm")) {
                Set $NAMESPACE = tOrigNS
                ; NOTE: do not embed a bare caret-global (Ens.AppData) in this text —
                ; SanitizeError strips caret-global references, silently blanking it.
                ; Name the consequence descriptively instead (AC 20.0.3).
                Set tSC = $$$ERROR($$$GeneralError, "killAppData wipes the persistent Ens.AppData business state (HL7 sequence numbers, file/FTP done-file tables, batch/control-number state) and can cause duplicate re-ingestion of already-processed data; it requires confirm:true. No changes were made.")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; CleanProduction refuses while the production is running (surfaced via
            ; SanitizeError); takes neither timeout nor force.
            Set tSC = ##class(Ens.Director).CleanProduction(tKillAppData)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "cleaned", "killAppData": (tKillAppData)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return the current production status in this namespace.
/// <p>Returns production name, state (Running/Stopped/Suspended/Troubled/NetworkStopped),
/// and start time. When <code>detail=true</code> query parameter is provided,
/// includes item-level status information (name, class, enabled, adapter).</p>
ClassMethod ProductionStatus() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tDetail = +$Get(%request.Data("detail",1), 0)
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Switch to target namespace for Ens.Director operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Get production status — operates in current namespace
        Set tSC = ##class(Ens.Director).GetProductionStatus(.tProdName, .tState)
        If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Map state number to string
        Set tStateMap = $ListBuild("Running","Stopped","Suspended","Troubled","NetworkStopped")
        Set tStateStr = $Select(tState>0&&(tState<6):$ListGet(tStateMap, tState), 1:"Unknown")

        Set tResult = {}
        Do tResult.%Set("name", tProdName)
        Do tResult.%Set("state", tStateStr)
        Do tResult.%Set("stateCode", tState, "number")

        ; Include start time if production is running/suspended/troubled
        If (tState = 1) || (tState = 3) || (tState = 4) {
            Set tStartTime = $Get(^Ens.Runtime("StartTime"))
            If tStartTime '= "" {
                Do tResult.%Set("startTime", tStartTime)
            }
        }

        ; Include item-level detail if requested (for running, suspended, or troubled)
        If tDetail && (tProdName '= "") && ((tState = 1) || (tState = 3) || (tState = 4)) {
            Set tItems = []
            ; Query Ens.Config.Item for item details
            Set tSQL = "SELECT Name, ClassName, Enabled, Category, PoolSize FROM Ens_Config.Item WHERE Production = ?"
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, tProdName)
            If $IsObject(tRS) {
                While tRS.%Next() {
                    Set tItem = {}
                    Do tItem.%Set("name", tRS.Name)
                    Do tItem.%Set("className", tRS.ClassName)
                    Do tItem.%Set("enabled", tRS.Enabled, "boolean")
                    Do tItem.%Set("poolSize", +tRS.PoolSize, "number")
                    If tRS.Category '= "" {
                        Do tItem.%Set("category", tRS.Category)
                    }
                    Do tItems.%Push(tItem)
                }
            }
            Do tResult.%Set("items", tItems)
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

/// Add, remove, enable, disable, get, or set settings for an individual production config item.
/// <p>Accepts a JSON body with <code>action</code> ("add", "remove", "enable", "disable", "get", "set"),
/// <code>itemName</code> (the config item name), optional <code>className</code> (Required for add),
/// optional <code>production</code> (target production for add/remove; defaults to the active production),
/// optional <code>settings</code> (for add/set), and optional <code>namespace</code>.</p>
/// <p>For <code>set</code>/<code>add</code>, the property keys poolSize/enabled/comment/category/className map
/// to <class>Ens.Config.Item</class> properties; any other key is routed to an <class>Ens.Config.Setting</class>
/// on the item (Target Adapter by default; a key may carry a <code>@Host</code>/<code>@Adapter</code> suffix to
/// force the target).</p>
ClassMethod ItemManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters
        Set tAction = tBody.%Get("action")
        Set tItemName = tBody.%Get("itemName")
        Set tNamespace = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tItemName, "itemName")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "enable") && (tAction '= "disable") && (tAction '= "get") && (tAction '= "set") && (tAction '= "add") && (tAction '= "remove") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: enable, disable, get, set, add, remove")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        If tAction = "enable" {
            Set tSC = ##class(Ens.Director).EnableConfigItem(tItemName, 1, 1)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "enabled", "itemName": (tItemName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "disable" {
            Set tSC = ##class(Ens.Director).EnableConfigItem(tItemName, 0, 1)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "disabled", "itemName": (tItemName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "get" {
            ; Query config item details via SQL
            Set tSQL = "SELECT Name, ClassName, Enabled, PoolSize, Comment, Category FROM Ens_Config.Item WHERE Name = ?"
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, tItemName)
            If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
                Set $NAMESPACE = tOrigNS
                Set tMsg = $Select('$IsObject(tRS): "SQL execution failed", 1: "SQL error: "_tRS.%Message)
                Set tSC = $$$ERROR($$$GeneralError, tMsg)
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            If 'tRS.%Next() {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Config item '"_tItemName_"' not found")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tResult = {}
            Do tResult.%Set("action", "get")
            Do tResult.%Set("itemName", tRS.Name)
            Do tResult.%Set("className", tRS.ClassName)
            Do tResult.%Set("enabled", tRS.Enabled, "boolean")
            Do tResult.%Set("poolSize", +tRS.PoolSize, "number")
            If tRS.Comment '= "" {
                Do tResult.%Set("comment", tRS.Comment)
            }
            If tRS.Category '= "" {
                Do tResult.%Set("category", tRS.Category)
            }

            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "set" {
            Set tSettings = tBody.%Get("settings")
            If '$IsObject(tSettings) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'settings' object is required for set action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; Find the config item ID
            If '##class(Ens.Config.Item).NameExists(tItemName, .tID) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Config item '"_tItemName_"' not found")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tItem = ##class(Ens.Config.Item).%OpenId(tID)
            If '$IsObject(tItem) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Failed to open config item '"_tItemName_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; Apply settings from the JSON object.
            ; The 5 working property keys map to Ens.Config.Item properties EXACTLY
            ; as before (back-compat gate). Any OTHER key (incl. adapterClassName,
            ; which is NOT a settable property) routes to an Ens.Config.Setting on
            ; the item's Settings list (additive: error -> success per 17-0 framing B).
            Set tUpdated = []
            Set tIter = tSettings.%GetIterator()
            While tIter.%GetNext(.tKey, .tValue) {
                If tKey = "poolSize" { Set tItem.PoolSize = tValue Do tUpdated.%Push(tKey) }
                ElseIf tKey = "enabled" { Set tItem.Enabled = tValue Do tUpdated.%Push(tKey) }
                ElseIf tKey = "comment" { Set tItem.Comment = tValue Do tUpdated.%Push(tKey) }
                ElseIf tKey = "category" { Set tItem.Category = tValue Do tUpdated.%Push(tKey) }
                ElseIf tKey = "className" { Set tItem.ClassName = tValue Do tUpdated.%Push(tKey) }
                ; CR 17.2-1: propagate the helper's %Status — a failed setting
                ; application must surface as an error, not be reported as updated.
                Else { Set tApplySC = ..ApplyArbitrarySetting(tItem, tKey, tValue) If $$$ISERR(tApplySC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tApplySC)) Set tSC = $$$OK Quit } Do tUpdated.%Push(tKey) }
            }
            ; Stop after a setting-application failure inside the iterator.
            If $$$ISERR($Get(tApplySC, $$$OK)) Quit

            Set tSC = tItem.%Save()
            If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; Apply changes to running production
            Set tSC = ##class(Ens.Director).UpdateProduction()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "set", "itemName": (tItemName), "updatedSettings": (tUpdated)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "add" {
            ; Resolve target production: explicit 'production' or the active one.
            Set tProdName = tBody.%Get("production")
            If tProdName = "" { Set tProdName = ##class(Ens.Director).GetActiveProductionName() }
            If tProdName = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "No active production; 'production' is required for add")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tClassName = tBody.%Get("className")
            ; CR 18.0-1 (whitespace half): strip surrounding whitespace so a stray
            ; leading/trailing space in the className does not produce a confusing
            ; "does not exist or is not compiled" rejection, and so the stored item
            ; ClassName is clean. An all-whitespace value collapses to "" and is then
            ; caught by ValidateRequired below.
            Set tClassName = $ZStrip(tClassName, "<>W")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tClassName, "className")
            If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; CR 17.2-3: reject a host className that does not exist / is not compiled.
            ; SaveToClass would otherwise swallow an OnConfigChange <METHOD DOES NOT
            ; EXIST> and persist a broken item. %Dictionary.CompiledClass.%ExistsId
            ; is true only for a successfully-compiled class (stricter than ClassDefinition).
            If '##class(%Dictionary.CompiledClass).%ExistsId(tClassName) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Host class '"_tClassName_"' does not exist or is not compiled")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            If '##class(%Dictionary.ClassDefinition).%ExistsId(tProdName) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Production '"_tProdName_"' not found")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            ; Sync the config-object extent from the production class XData (source of
            ; truth) before opening — SaveToClass writes the class, not the extent, so
            ; an unsynced %OpenId would see a stale item list (live-verified Story 17.2).
            ; CR 17.2-5: check the LoadFromClass %Status — a silent failure here would
            ; leave a stale/half-loaded extent for the subsequent %OpenId / dup check.
            Set tLoadSC = ##class(Ens.Config.Production).LoadFromClass(tProdName)
            If $$$ISERR(tLoadSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tLoadSC))
                Set tSC = $$$OK
                Quit
            }
            Set tProd = ##class(Ens.Config.Production).%OpenId(tProdName)
            If '$IsObject(tProd) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Failed to open production '"_tProdName_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; CR 17.2-3: reject a duplicate item Name in the production — the
            ; (Production,Name) index is not unique, so add is otherwise non-idempotent.
            Set tDup = tProd.FindItemByConfigName(tItemName)
            If $IsObject(tDup) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Config item '"_tItemName_"' already exists in production '"_tProdName_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tItem = ##class(Ens.Config.Item).%New()
            Set tItem.Name = tItemName
            Set tItem.ClassName = tClassName

            ; Optional settings on the new item (same routing as 'set').
            Set tUpdated = []
            Set tAddApplySC = $$$OK
            Set tSettings = tBody.%Get("settings")
            If $IsObject(tSettings) {
                Set tIter = tSettings.%GetIterator()
                While tIter.%GetNext(.tKey, .tValue) {
                    If tKey = "poolSize" { Set tItem.PoolSize = tValue Do tUpdated.%Push(tKey) }
                    ElseIf tKey = "enabled" { Set tItem.Enabled = tValue Do tUpdated.%Push(tKey) }
                    ElseIf tKey = "comment" { Set tItem.Comment = tValue Do tUpdated.%Push(tKey) }
                    ElseIf tKey = "category" { Set tItem.Category = tValue Do tUpdated.%Push(tKey) }
                    ElseIf tKey = "className" { Set tItem.ClassName = tValue Do tUpdated.%Push(tKey) }
                    ; CR 17.2-1: propagate the helper's %Status instead of swallowing it.
                    Else { Set tAddApplySC = ..ApplyArbitrarySetting(tItem, tKey, tValue) If $$$ISERR(tAddApplySC) Quit  Do tUpdated.%Push(tKey) }
                }
            }
            ; Surface a setting-application failure before persisting the new item.
            If $$$ISERR(tAddApplySC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tAddApplySC))
                Set tSC = $$$OK
                Quit
            }

            Do tProd.Items.Insert(tItem)
            Set tSC = tProd.SaveToClass(tItem)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "added", "itemName": (tItemName), "production": (tProdName), "className": (tClassName), "updatedSettings": (tUpdated)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "remove" {
            ; Resolve target production: explicit 'production' or the active one.
            Set tProdName = tBody.%Get("production")
            If tProdName = "" { Set tProdName = ##class(Ens.Director).GetActiveProductionName() }
            If tProdName = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "No active production; 'production' is required for remove")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            If '##class(%Dictionary.ClassDefinition).%ExistsId(tProdName) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Production '"_tProdName_"' not found")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            ; Sync the config-object extent from the production class XData before
            ; opening (see add branch) so FindItemByConfigName sees the current items.
            ; CR 17.2-5: check the LoadFromClass %Status — a silent failure would
            ; leave a stale/half-loaded extent for the FindItemByConfigName lookup.
            Set tLoadSC = ##class(Ens.Config.Production).LoadFromClass(tProdName)
            If $$$ISERR(tLoadSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tLoadSC))
                Set tSC = $$$OK
                Quit
            }
            Set tProd = ##class(Ens.Config.Production).%OpenId(tProdName)
            If '$IsObject(tProd) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Failed to open production '"_tProdName_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tItem = tProd.FindItemByConfigName(tItemName, .tFindStatus)
            If '$IsObject(tItem) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Config item '"_tItemName_"' not found in production '"_tProdName_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Do tProd.RemoveItem(tItem)
            Set tSC = tProd.SaveToClass()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "removed", "itemName": (tItemName), "production": (tProdName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Apply an arbitrary host/adapter setting to a config item via Ens.Config.Setting.
/// <p>Used by ItemManage add/set for any key that is not one of the 5 recognized
/// Ens.Config.Item property keys. The setting Target defaults to "Adapter"; a key may
/// carry a trailing <code>@Host</code> or <code>@Adapter</code> suffix to force the target.
/// The item is NOT saved here — the caller saves and refreshes the production.</p>
ClassMethod ApplyArbitrarySetting(pItem As Ens.Config.Item, pKey As %String, pValue As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        Set tTarget = "Adapter"
        Set tName = pKey
        ; CR 17.2-2: scan the LAST '@' (not $Find's first '@'), so a setting whose
        ; own name embeds '@' parses correctly. A trailing '@<suffix>' segment
        ; forces the setting Target, but ONLY for the validated Host/Adapter targets.
        Set tAt = 0
        For tI = 1:1:$Length(pKey) {
            If $Extract(pKey, tI) = "@" Set tAt = tI
        }
        If tAt > 0 {
            Set tSuffix = $Extract(pKey, tAt + 1, *)
            Set tBase = $Extract(pKey, 1, tAt - 1)
            ; Reject an unknown suffix instead of silently folding it into the name
            ; with the default Adapter target — a typo'd/unknown suffix would
            ; otherwise be reported as a successful update against the wrong key.
            If (tSuffix '= "Host") && (tSuffix '= "Adapter") {
                Set tSC = $$$ERROR($$$GeneralError, "Setting key '"_pKey_"' has an unknown '@' target suffix '"_tSuffix_"'; expected '@Host' or '@Adapter'")
                Quit
            }
            ; Reject a leading '@' (empty setting Name before the suffix).
            If tBase = "" {
                Set tSC = $$$ERROR($$$GeneralError, "Setting key '"_pKey_"' has an empty name before the '@"_tSuffix_"' target suffix")
                Quit
            }
            Set tTarget = tSuffix
            Set tName = tBase
        }
        Set tSetting = pItem.FindSettingByName(tName, tTarget)
        If '$IsObject(tSetting) {
            Set tSetting = ##class(Ens.Config.Setting).%New()
            Set tSetting.Target = tTarget
            Set tSetting.Name = tName
            Do pItem.Settings.Insert(tSetting)
        }
        Set tSetting.Value = pValue
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Get or set the auto-start production configuration.
/// <p>Accepts a JSON body with <code>action</code> ("get" or "set"),
/// optional <code>productionName</code> (for set), and optional <code>namespace</code>.</p>
ClassMethod AutoStart() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters
        Set tAction = tBody.%Get("action")
        Set tNamespace = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "get") && (tAction '= "set") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: get, set")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to target namespace for Ens.Director operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        If tAction = "get" {
            Set tAutoStart = $Get(^Ens.AutoStart)
            Set $NAMESPACE = tOrigNS

            Set tResult = {}
            Do tResult.%Set("action", "get")
            Do tResult.%Set("autoStart", tAutoStart)
            Do tResult.%Set("enabled", (tAutoStart '= ""), "boolean")
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "set" {
            Set tProductionName = tBody.%Get("productionName")
            ; When productionName is absent from JSON, %Get returns "" which disables auto-start

            Set tSC = ##class(Ens.Director).SetAutoStart(tProductionName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "set")
            Do tResult.%Set("autoStart", tProductionName)
            Do tResult.%Set("enabled", (tProductionName '= ""), "boolean")
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Query event log entries filtered by type, item name, and count.
/// <p>Returns entries from <code>Ens_Util.Log</code> with timestamp, type,
/// item name, and message text. Supports filtering by log type
/// (Info/Warning/Error/Trace/Assert/Alert), config item name, and row count.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>type</code> — Log type filter: Info, Warning, Error, Trace, Assert, Alert</li>
///   <li><code>itemName</code> — Config item name filter (exact match on ConfigName)</li>
///   <li><code>count</code> — Maximum number of rows to return (default 100)</li>
///   <li><code>namespace</code> — Target namespace for Ens.* operations</li>
/// </ul></p>
ClassMethod EventLog() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tType = $Get(%request.Data("type",1))
        Set tItemName = $Get(%request.Data("itemName",1))
        Set tCount = +$Get(%request.Data("count",1), 100)
        If tCount < 1 Set tCount = 100
        If tCount > 10000 Set tCount = 10000
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Build SQL query with filters
        Set tSQL = "SELECT TOP "_tCount_" ID, TimeLogged, Type, ConfigName, Text, SourceClass, SourceMethod, SessionId FROM Ens_Util.Log"
        Set tWhere = ""
        Set tParamCount = 0

        If tType '= "" {
            Set tWhere = tWhere_$Select(tWhere="":"", 1:" AND")_" Type = ?"
            Set tParamCount = tParamCount + 1
            Set tParams(tParamCount) = tType
        }
        If tItemName '= "" {
            Set tWhere = tWhere_$Select(tWhere="":"", 1:" AND")_" ConfigName = ?"
            Set tParamCount = tParamCount + 1
            Set tParams(tParamCount) = tItemName
        }
        If tWhere '= "" {
            Set tSQL = tSQL_" WHERE"_tWhere
        }
        Set tSQL = tSQL_" ORDER BY ID DESC"

        ; Execute SQL based on parameter count
        If tParamCount = 0 {
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL)
        }
        ElseIf tParamCount = 1 {
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, tParams(1))
        }
        Else {
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, tParams(1), tParams(2))
        }

        If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
            Set $NAMESPACE = tOrigNS
            Set tMsg = $Select('$IsObject(tRS): "SQL execution failed", 1: "SQL error: "_tRS.%Message)
            Set tSC = $$$ERROR($$$GeneralError, tMsg)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tEntries = []
        While tRS.%Next() {
            Set tEntry = {}
            Do tEntry.%Set("id", tRS.ID, "number")
            Do tEntry.%Set("timestamp", tRS.TimeLogged)
            Do tEntry.%Set("type", tRS.Type)
            Do tEntry.%Set("itemName", tRS.ConfigName)
            Do tEntry.%Set("text", tRS.Text)
            If tRS.SourceClass '= "" {
                Do tEntry.%Set("sourceClass", tRS.SourceClass)
            }
            If tRS.SourceMethod '= "" {
                Do tEntry.%Set("sourceMethod", tRS.SourceMethod)
            }
            If tRS.SessionId '= "" {
                Do tEntry.%Set("sessionId", tRS.SessionId, "number")
            }
            Do tEntries.%Push(tEntry)
        }

        Set tResult = {}
        Do tResult.%Set("entries", tEntries)
        Do tResult.%Set("count", tEntries.%Size(), "number")

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

/// Return queue status for all production items including queue count.
/// <p>Queries <code>Ens.Queue</code> to return the current count of messages
/// queued for each production config item.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>namespace</code> — Target namespace for Ens.* operations</li>
/// </ul></p>
ClassMethod QueueStatus() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Use Ens.Queue:Enumerate named query (Ens.Queue is not a SQL table)
        Set tRS = ##class(%ResultSet).%New("Ens.Queue:Enumerate")
        Set tSC = tRS.Execute()
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tQueues = []
        While tRS.Next() {
            Set tQueue = {}
            Do tQueue.%Set("name", tRS.Get("Name"))
            Do tQueue.%Set("count", +tRS.Get("Count"), "number")
            Do tQueues.%Push(tQueue)
        }

        Set tResult = {}
        Do tResult.%Set("queues", tQueues)
        Do tResult.%Set("count", tQueues.%Size(), "number")

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

/// Trace message flow by session ID or header ID.
/// <p>Queries <code>Ens.MessageHeader</code> to trace the flow of messages
/// through the production. Each step includes source item, target item,
/// message class, timestamp, and status.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>sessionId</code> — Session ID to trace (returns all messages in session)</li>
///   <li><code>headerId</code> — Specific message header ID to look up</li>
///   <li><code>count</code> — Maximum number of rows (default 100)</li>
///   <li><code>namespace</code> — Target namespace for Ens.* operations</li>
/// </ul></p>
ClassMethod MessageTrace() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tSessionId = $Get(%request.Data("sessionId",1))
        Set tHeaderId = $Get(%request.Data("headerId",1))
        Set tCount = +$Get(%request.Data("count",1), 100)
        If tCount < 1 Set tCount = 100
        If tCount > 10000 Set tCount = 10000
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Validate at least one filter
        If (tSessionId = "") && (tHeaderId = "") {
            Set tSC = $$$ERROR($$$GeneralError, "Either 'sessionId' or 'headerId' parameter is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Build SQL query
        Set tSQL = "SELECT TOP "_tCount_" ID, MessageBodyClassName, MessageBodyId, SourceConfigName, TargetConfigName, TimeCreated, TimeProcessed, Status, SessionId, CorrespondingMessageId FROM Ens.MessageHeader"
        If tHeaderId '= "" {
            Set tSQL = tSQL_" WHERE ID = ?"
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, +tHeaderId)
        }
        Else {
            Set tSQL = tSQL_" WHERE SessionId = ? ORDER BY TimeCreated"
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, +tSessionId)
        }

        If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
            Set $NAMESPACE = tOrigNS
            Set tMsg = $Select('$IsObject(tRS): "SQL execution failed", 1: "SQL error: "_tRS.%Message)
            Set tSC = $$$ERROR($$$GeneralError, tMsg)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tMessages = []
        While tRS.%Next() {
            Set tMsg = {}
            Do tMsg.%Set("id", tRS.ID, "number")
            Do tMsg.%Set("sourceItem", tRS.SourceConfigName)
            Do tMsg.%Set("targetItem", tRS.TargetConfigName)
            Do tMsg.%Set("messageClass", tRS.MessageBodyClassName)
            Do tMsg.%Set("timeCreated", tRS.TimeCreated)
            If tRS.TimeProcessed '= "" {
                Do tMsg.%Set("timeProcessed", tRS.TimeProcessed)
            }
            Do tMsg.%Set("status", tRS.Status)
            Do tMsg.%Set("sessionId", tRS.SessionId, "number")
            If tRS.MessageBodyId '= "" {
                Do tMsg.%Set("messageBodyId", tRS.MessageBodyId, "number")
            }
            If tRS.CorrespondingMessageId '= "" {
                Do tMsg.%Set("correspondingMessageId", tRS.CorrespondingMessageId, "number")
            }
            Do tMessages.%Push(tMsg)
        }

        Set tResult = {}
        Do tResult.%Set("messages", tMessages)
        Do tResult.%Set("count", tMessages.%Size(), "number")

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

/// Generate Mermaid sequence diagrams from message-trace sessions (Epic 21, Story 21.0).
/// <p>Thin handler: validates the request, delegates to the
/// <class>ExecuteMCPv2.Diagram.Generate</class> facade, and renders
/// <code>{ diagrams: [{ sessionId, mermaid, messageCount, warnings, truncated }], count }</code>.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>sessionIds</code> — comma-separated list of 1-20 positive integer session IDs (required)</li>
///   <li><code>labelMode</code> — "full" (default) or "short" (last dotted segment of the body class)</li>
///   <li><code>maxRows</code> — per-session row cap (default 2000, max 10000)</li>
///   <li><code>namespace</code> — target namespace for Ens.* operations</li>
/// </ul></p>
ClassMethod MessageDiagram() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tSessionIdsCsv = $Get(%request.Data("sessionIds",1))
        Set tLabelMode = $Get(%request.Data("labelMode",1))
        If tLabelMode = "" Set tLabelMode = "full"
        Set tMaxRows = +$Get(%request.Data("maxRows",1), 2000) \ 1
        If tMaxRows < 1 Set tMaxRows = 2000
        If tMaxRows > 10000 Set tMaxRows = 10000
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Validate labelMode
        If (tLabelMode '= "full") && (tLabelMode '= "short") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'labelMode' must be 'full' or 'short'")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate sessionIds: CSV of 1-20 positive canonical integers
        If tSessionIdsCsv = "" {
            Set tSC = $$$ERROR($$$GeneralError, "Required parameter 'sessionIds' is missing or empty")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tIdCount = $Length(tSessionIdsCsv, ",")
        If tIdCount > 20 {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'sessionIds' must contain between 1 and 20 session IDs")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tSessionIds = ##class(%Library.ListOfDataTypes).%New()
        Set tValid = 1
        For tI = 1:1:tIdCount {
            Set tPiece = $ZStrip($Piece(tSessionIdsCsv, ",", tI), "<>W")
            If (tPiece = "") || (tPiece '= +tPiece) || (+tPiece '= (+tPiece \ 1)) || (+tPiece <= 0) {
                Set tValid = 0
                Quit
            }
            Do tSessionIds.Insert(+tPiece)
        }
        If 'tValid {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'sessionIds' must be a comma-separated list of positive integers")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Delegate to the diagram library facade
        Set tOptions = {}
        Do tOptions.%Set("labelMode", tLabelMode)
        Do tOptions.%Set("maxRows", tMaxRows, "number")
        Set tResult = ""
        Set tSC = ##class(ExecuteMCPv2.Diagram.Generate).Run(tSessionIds, tOptions, .tResult)
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
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

/// List available adapter types grouped by category.
/// <p>Queries <code>%Dictionary.ClassDefinition</code> to find adapter classes
/// that extend <code>Ens.InboundAdapter</code> or <code>Ens.OutboundAdapter</code>.
/// Results are grouped by category (Inbound/Outbound).</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>category</code> — Filter by category: inbound, outbound (optional)</li>
///   <li><code>namespace</code> — Target namespace for class queries</li>
/// </ul></p>
ClassMethod AdapterList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tCategory = $Get(%request.Data("category",1))
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Switch to target namespace
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        Set tInbound = []
        Set tOutbound = []

        ; Query inbound adapters
        If (tCategory = "") || ($ZConvert(tCategory, "L") = "inbound") {
            Set tSQL = "SELECT Name FROM %Dictionary.ClassDefinition WHERE super [ 'Ens.InboundAdapter' AND Abstract = 0"
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL)
            If $IsObject(tRS) && (tRS.%SQLCODE '< 0) {
                While tRS.%Next() {
                    Set tAdapter = {}
                    Do tAdapter.%Set("name", tRS.Name)
                    Do tInbound.%Push(tAdapter)
                }
            }
        }

        ; Query outbound adapters
        If (tCategory = "") || ($ZConvert(tCategory, "L") = "outbound") {
            Set tSQL = "SELECT Name FROM %Dictionary.ClassDefinition WHERE super [ 'Ens.OutboundAdapter' AND Abstract = 0"
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL)
            If $IsObject(tRS) && (tRS.%SQLCODE '< 0) {
                While tRS.%Next() {
                    Set tAdapter = {}
                    Do tAdapter.%Set("name", tRS.Name)
                    Do tOutbound.%Push(tAdapter)
                }
            }
        }

        Set tResult = {}
        If (tCategory = "") || ($ZConvert(tCategory, "L") = "inbound") {
            Do tResult.%Set("inbound", tInbound)
        }
        If (tCategory = "") || ($ZConvert(tCategory, "L") = "outbound") {
            Do tResult.%Set("outbound", tOutbound)
        }
        Set tTotal = 0
        If $IsObject(tResult.%Get("inbound")) Set tTotal = tTotal + tInbound.%Size()
        If $IsObject(tResult.%Get("outbound")) Set tTotal = tTotal + tOutbound.%Size()
        Do tResult.%Set("totalCount", tTotal, "number")

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

/// Return production status across all namespaces.
/// <p>Iterates all IRIS namespaces, switches to each, and calls
/// <method>Ens.Director:GetProductionStatus</method> to collect
/// a cross-namespace summary. Uses namespace save/restore pattern
/// for safe iteration.</p>
ClassMethod ProductionSummary() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Get list of namespaces — requires %SYS
        Set $NAMESPACE = "%SYS"
        Set tRS = ##class(%ResultSet).%New("Config.Namespaces:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Collect namespace names first
        Set tNSCount = 0
        While tRS.Next() {
            Set tNSCount = tNSCount + 1
            Set tNSList(tNSCount) = tRS.Get("Namespace")
        }
        Do tRS.Close()

        Set tResult = []

        ; Iterate each namespace and check for productions
        For tIdx = 1:1:tNSCount {
            Set tNS = tNSList(tIdx)
            Try {
                Set $NAMESPACE = tNS
                Set tSC2 = ##class(Ens.Director).GetProductionStatus(.tProdName, .tState)
                Set tStateMap = $ListBuild("Running","Stopped","Suspended","Troubled","NetworkStopped")
                If $$$ISOK(tSC2) && (tProdName '= "") {
                    Set tStateStr = $Select(tState>0&&(tState<6):$ListGet(tStateMap, tState), 1:"Unknown")
                    Set tEntry = {}
                    Do tEntry.%Set("namespace", tNS)
                    Do tEntry.%Set("name", tProdName)
                    Do tEntry.%Set("state", tStateStr)
                    Do tEntry.%Set("stateCode", tState, "number")
                    Do tResult.%Push(tEntry)
                } ElseIf $$$ISOK(tSC2) && (tProdName = "") {
                    ; No active/recent production — fall back to Ens.Config.ProductionD
                    ; to include registered-but-never-started productions
                    Set tRegKey = ""
                    For {
                        Set tRegKey = $Order(^Ens.Config.ProductionD(tRegKey))
                        Quit:tRegKey=""
                        Set tEntry = {}
                        Do tEntry.%Set("namespace", tNS)
                        Do tEntry.%Set("name", tRegKey)
                        Do tEntry.%Set("state", "Stopped")
                        Do tEntry.%Set("stateCode", 2, "number")
                        Do tResult.%Push(tEntry)
                    }
                }
            }
            Catch innerEx {
                ; Log skipped namespace with reason (e.g. no Ensemble installed, security violation)
                Do ##class(%SYS.System).WriteToConsoleLog("ProductionSummary: skipped namespace '"_tNS_"': "_innerEx.DisplayString(), 1, 1)
            }
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

/// Create, update, or delete an Ensemble credential.
/// <p>Accepts a JSON body with <code>action</code> ("create", "update", or "delete"),
/// <code>id</code> (credential system name), optional <code>username</code>,
/// optional <code>password</code>, and optional <code>namespace</code>.</p>
/// <p><b>CRITICAL</b>: Passwords are write-only; they never appear in responses.</p>
ClassMethod CredentialManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters BEFORE switching namespace
        Set tAction = tBody.%Get("action")
        Set tID = tBody.%Get("id")
        Set tNamespace = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tID, "id")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "create") && (tAction '= "update") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, update, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        If tAction = "create" {
            ; Check if credential already exists
            If ##class(Ens.Config.Credentials).%ExistsId(tID) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Credential '"_tID_"' already exists")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tCred = ##class(Ens.Config.Credentials).%New()
            Set tCred.SystemName = tID
            Set tUsername = tBody.%Get("username")
            If tUsername '= "" Set tCred.Username = tUsername
            Set tPassword = tBody.%Get("password")
            If tPassword '= "" Set tCred.Password = tPassword

            Set tSC = tCred.%Save()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "id": (tID)}
            If tUsername '= "" Do tResult.%Set("username", tUsername)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "update" {
            ; Check if credential exists
            If '##class(Ens.Config.Credentials).%ExistsId(tID) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Credential '"_tID_"' does not exist")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tCred = ##class(Ens.Config.Credentials).%OpenId(tID)
            If '$IsObject(tCred) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Failed to open credential '"_tID_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tUsername = tBody.%Get("username")
            If tUsername '= "" Set tCred.Username = tUsername
            Set tPassword = tBody.%Get("password")
            If tPassword '= "" Set tCred.Password = tPassword

            Set tSC = tCred.%Save()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "updated", "id": (tID)}
            If tUsername '= "" Do tResult.%Set("username", tUsername)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            ; Check if credential exists
            If '##class(Ens.Config.Credentials).%ExistsId(tID) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Credential '"_tID_"' does not exist")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tSC = ##class(Ens.Config.Credentials).%DeleteId(tID)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "id": (tID)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List stored Ensemble credentials without passwords.
/// <p>Returns credential IDs and usernames. <b>Never</b> includes passwords (NFR6).</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>namespace</code> — Target namespace for Ens.* operations</li>
/// </ul></p>
ClassMethod CredentialList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; CRITICAL: Never include Password column (NFR6)
        Set tSQL = "SELECT SystemName, Username FROM Ens_Config.Credentials ORDER BY SystemName"
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL)

        If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
            Set $NAMESPACE = tOrigNS
            Set tMsg = $Select('$IsObject(tRS): "SQL execution failed", 1: "SQL error: "_tRS.%Message)
            Set tSC = $$$ERROR($$$GeneralError, tMsg)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tCredentials = []
        While tRS.%Next() {
            Set tCred = {}
            Do tCred.%Set("id", tRS.SystemName)
            Do tCred.%Set("username", tRS.Username)
            Do tCredentials.%Push(tCred)
        }

        Set tResult = {}
        Do tResult.%Set("credentials", tCredentials)
        Do tResult.%Set("count", tCredentials.%Size(), "number")

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

/// Get, set, or delete a lookup table entry.
/// <p>Accepts a JSON body with <code>action</code> ("get", "set", or "delete"),
/// <code>tableName</code>, <code>key</code>, optional <code>value</code> (for set),
/// and optional <code>namespace</code>.</p>
ClassMethod LookupManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters BEFORE switching namespace
        Set tAction = tBody.%Get("action")
        Set tTableName = tBody.%Get("tableName")
        Set tKey = tBody.%Get("key")
        Set tNamespace = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTableName, "tableName")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "get") && (tAction '= "set") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: get, set, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Key is required for all actions
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tKey, "key")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        If tAction = "get" {
            Set tValue = $Get(^Ens.LookupTable(tTableName, tKey))
            Set tExists = $Data(^Ens.LookupTable(tTableName, tKey))

            Set $NAMESPACE = tOrigNS
            Set tResult = {}
            Do tResult.%Set("action", "get")
            Do tResult.%Set("tableName", tTableName)
            Do tResult.%Set("key", tKey)
            Do tResult.%Set("value", tValue)
            Do tResult.%Set("exists", (tExists > 0), "boolean")
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "set" {
            ; Use %IsDefined to check presence — ValidateRequired rejects empty strings
            ; which are valid lookup table values
            If 'tBody.%IsDefined("value") {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'value' is required")
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tValue = tBody.%Get("value")

            Set ^Ens.LookupTable(tTableName, tKey) = tValue

            Set $NAMESPACE = tOrigNS
            Set tResult = {}
            Do tResult.%Set("action", "set")
            Do tResult.%Set("tableName", tTableName)
            Do tResult.%Set("key", tKey)
            Do tResult.%Set("value", tValue)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tExists = $Data(^Ens.LookupTable(tTableName, tKey))
            If 'tExists {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Lookup table entry '"_tTableName_"/"_tKey_"' does not exist")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Kill ^Ens.LookupTable(tTableName, tKey)

            Set $NAMESPACE = tOrigNS
            Set tResult = {}
            Do tResult.%Set("action", "deleted")
            Do tResult.%Set("tableName", tTableName)
            Do tResult.%Set("key", tKey)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all business rule classes in the namespace.
/// <p>Queries <code>%Dictionary.ClassDefinition</code> to find non-abstract classes
/// that extend <code>Ens.Rule.Definition</code>.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>namespace</code> — Target namespace for class queries</li>
/// </ul></p>
ClassMethod RuleList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Switch to target namespace
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        Set tSQL = "SELECT Name FROM %Dictionary.ClassDefinition WHERE super [ 'Ens.Rule.Definition' AND Abstract = 0 ORDER BY Name"
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL)

        If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
            Set $NAMESPACE = tOrigNS
            Set tMsg = $Select('$IsObject(tRS): "SQL execution failed", 1: "SQL error: "_tRS.%Message)
            Set tSC = $$$ERROR($$$GeneralError, tMsg)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tRules = []
        While tRS.%Next() {
            Set tRule = {}
            Do tRule.%Set("name", tRS.Name)
            Do tRules.%Push(tRule)
        }

        Set tResult = {}
        Do tResult.%Set("rules", tRules)
        Do tResult.%Set("count", tRules.%Size(), "number")

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

/// Return the rule definition including conditions, actions, and routing logic.
/// <p>Exports the rule class as UDL text via <code>%Compiler.UDL.TextServices</code>.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>name</code> — Fully-qualified rule class name</li>
///   <li><code>namespace</code> — Target namespace for class queries</li>
/// </ul></p>
ClassMethod RuleGet() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tName = $Get(%request.Data("name",1))
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Validate required parameters
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to target namespace
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Verify class exists
        If '##class(%Dictionary.ClassDefinition).%ExistsId(tName) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Rule class '"_tName_"' does not exist")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Export class definition as UDL text
        Set tSC = ##class(%Compiler.UDL.TextServices).GetTextAsString(, tName, .tText)
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tResult = {}
        Do tResult.%Set("name", tName)
        Do tResult.%Set("definition", tText)

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

/// List all data transformation (DTL) classes in the namespace.
/// <p>Queries <code>%Dictionary.ClassDefinition</code> to find non-abstract classes
/// that extend <code>Ens.DataTransformDTL</code> or <code>Ens.DataTransform</code>.</p>
/// <p>Query parameters:
/// <ul>
///   <li><code>namespace</code> — Target namespace for class queries</li>
/// </ul></p>
ClassMethod TransformList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Switch to target namespace
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        Set tSQL = "SELECT Name FROM %Dictionary.ClassDefinition WHERE (super [ 'Ens.DataTransformDTL' OR super [ 'Ens.DataTransform') AND Abstract = 0 ORDER BY Name"
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL)

        If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
            Set $NAMESPACE = tOrigNS
            Set tMsg = $Select('$IsObject(tRS): "SQL execution failed", 1: "SQL error: "_tRS.%Message)
            Set tSC = $$$ERROR($$$GeneralError, tMsg)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tTransforms = []
        While tRS.%Next() {
            Set tTransform = {}
            Do tTransform.%Set("name", tRS.Name)
            Do tTransforms.%Push(tTransform)
        }

        Set tResult = {}
        Do tResult.%Set("transforms", tTransforms)
        Do tResult.%Set("count", tTransforms.%Size(), "number")

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

/// Execute a data transformation against sample input and return the output.
/// <p>Accepts a JSON body with <code>className</code> (transform class name),
/// <code>sourceClass</code> (source message class name),
/// <code>sourceData</code> (JSON object with property values for the source message),
/// and optional <code>namespace</code>.</p>
ClassMethod TransformTest() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters BEFORE switching namespace
        Set tClassName = tBody.%Get("className")
        Set tSourceClass = tBody.%Get("sourceClass")
        Set tSourceData = tBody.%Get("sourceData")
        Set tNamespace = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tClassName, "className")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tSourceClass, "sourceClass")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Verify transform class exists
        If '##class(%Dictionary.ClassDefinition).%ExistsId(tClassName) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Transform class '"_tClassName_"' does not exist")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Verify source class exists
        If '##class(%Dictionary.ClassDefinition).%ExistsId(tSourceClass) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Source class '"_tSourceClass_"' does not exist")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Instantiate the source message object
        Set tSource = $ClassMethod(tSourceClass, "%New")
        If '$IsObject(tSource) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Failed to instantiate source class '"_tSourceClass_"'")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Populate source object properties from sourceData JSON
        If $IsObject(tSourceData) {
            Set tIter = tSourceData.%GetIterator()
            While tIter.%GetNext(.tProp, .tVal) {
                Try {
                    Set $Property(tSource, tProp) = tVal
                }
                Catch setEx {
                    ; Skip properties that don't exist on the class
                }
            }
        }

        ; Execute the transformation
        Set tSC = $ClassMethod(tClassName, "Transform", tSource, .tOutput)
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Serialize output to JSON.
        ; First try native %JSON.Adaptor export (works for Ens.Request/Ens.Response
        ; subclasses that opt in); if that fails, fall back to reflecting public
        ; properties via %Dictionary.CompiledProperty so the caller sees real
        ; values instead of a sentinel error string.
        Set tOutputJSON = {}
        If $IsObject(tOutput) {
            Set tOutputClass = $ClassName(tOutput)
            Do tOutputJSON.%Set("className", tOutputClass)
            Set tSerialized = 0

            Try {
                Set tSC2 = tOutput.%JSONExportToString(.tJSONStr)
                If $$$ISOK(tSC2) && ($Get(tJSONStr) '= "") {
                    Do tOutputJSON.%Set("data", ##class(%DynamicObject).%FromJSON(tJSONStr))
                    Do tOutputJSON.%Set("serialization", "json-adaptor")
                    Set tSerialized = 1
                }
            } Catch jsonEx {
                ; Object does not extend %JSON.Adaptor — fall through to fallback
            }

            If 'tSerialized {
                Set tData = {}
                Set tPropCount = 0
                Try {
                    Set tPropRS = ##class(%SQL.Statement).%ExecDirect(,
                        "SELECT Name FROM %Dictionary.CompiledProperty WHERE parent = ? AND Private = 0 AND Calculated = 0 AND Relationship = 0",
                        tOutputClass)
                    If $IsObject($Get(tPropRS)) && (tPropRS.%SQLCODE = 0) {
                        While tPropRS.%Next() {
                            Set tPropName = tPropRS.%Get("Name")
                            If tPropName = "" Continue
                            If $Extract(tPropName) = "%" Continue
                            Try {
                                Set tPropVal = $Property(tOutput, tPropName)
                                If $IsObject(tPropVal) {
                                    Do tData.%Set(tPropName, "[object "_$ClassName(tPropVal)_"]")
                                } Else {
                                    Do tData.%Set(tPropName, tPropVal)
                                }
                                Set tPropCount = tPropCount + 1
                            } Catch {
                                ; Skip unreadable properties
                            }
                        }
                    }
                } Catch reflEx {
                    ; If reflection itself errors, we still return className only
                }
                Do tOutputJSON.%Set("data", tData)
                Do tOutputJSON.%Set("propertyCount", tPropCount, "number")
                Do tOutputJSON.%Set("serialization", "property-reflection")
                Do tOutputJSON.%Set("note", "Target class does not extend %JSON.Adaptor; values shown are a best-effort property dump (objects and streams are represented as placeholders).")
            }
        }
        Else {
            Do tOutputJSON.%Set("data", $Get(tOutput))
            Do tOutputJSON.%Set("serialization", "scalar")
        }

        Set tResult = {}
        Do tResult.%Set("className", tClassName)
        Do tResult.%Set("sourceClass", tSourceClass)
        Do tResult.%Set("output", tOutputJSON)

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

/// Create, delete, or get a REST application.
/// <p>Accepts a JSON body with <code>action</code> ("create", "delete", or "get"),
/// <code>name</code> (REST application name),
/// optional <code>spec</code> (OpenAPI JSON for create),
/// and optional <code>namespace</code>.</p>
ClassMethod RestManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters BEFORE switching namespace
        Set tAction = tBody.%Get("action")
        Set tName = tBody.%Get("name")
        Set tNamespace = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "create") && (tAction '= "delete") && (tAction '= "get") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, delete, get")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to target namespace
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        If tAction = "create" {
            Set tSpec = tBody.%Get("spec")
            If '$IsObject(tSpec) && (tSpec = "") {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'spec' (OpenAPI JSON) is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; If spec is a string, parse it to %DynamicObject
            If '$IsObject(tSpec) {
                Try {
                    Set tSpec = {}.%FromJSON(tSpec)
                }
                Catch parseEx {
                    Set $NAMESPACE = tOrigNS
                    Set tSC = $$$ERROR($$$GeneralError, "Invalid JSON in 'spec' parameter: "_parseEx.DisplayString())
                    Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                    Set tSC = $$$OK
                    Quit
                }
            }

            Set tSC = ##class(%REST.API).CreateApplication(tName, tSpec)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(%REST.API).DeleteApplication(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "get" {
            Set tSC = ##class(%REST.API).GetApplication(tName, .tSpec)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "get")
            Do tResult.%Set("name", tName)
            Do tResult.%Set("spec", tSpec)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Export or import a lookup table in XML format.
/// <p>Accepts a JSON body with <code>action</code> ("export" or "import"),
/// <code>tableName</code>, optional <code>xml</code> (for import),
/// and optional <code>namespace</code>.</p>
/// <p>Export reads entries from the <code>^Ens.LookupTable</code> global
/// and builds XML output. Import parses XML and sets entries in the global.</p>
ClassMethod LookupTransfer() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters BEFORE switching namespace
        Set tAction = tBody.%Get("action")
        Set tTableName = tBody.%Get("tableName")
        Set tNamespace = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTableName, "tableName")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "export") && (tAction '= "import") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: export, import")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        If tAction = "export" {
            ; Build XML from global data
            Set tXML = "<lookupTable name="""_$ZConvert(tTableName,"O","XML")_""">"_$Char(10)
            Set tKey = ""
            Set tEntryCount = 0
            For {
                Set tKey = $Order(^Ens.LookupTable(tTableName, tKey))
                If tKey = "" Quit
                Set tValue = $Get(^Ens.LookupTable(tTableName, tKey))
                Set tXML = tXML_"  <entry key="""_$ZConvert(tKey,"O","XML")_""" value="""_$ZConvert(tValue,"O","XML")_""" />"_$Char(10)
                Set tEntryCount = tEntryCount + 1
            }
            Set tXML = tXML_"</lookupTable>"

            Set $NAMESPACE = tOrigNS
            Set tResult = {}
            Do tResult.%Set("action", "exported")
            Do tResult.%Set("tableName", tTableName)
            Do tResult.%Set("entryCount", tEntryCount, "number")
            Do tResult.%Set("xml", tXML)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "import" {
            Set tXML = tBody.%Get("xml")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tXML, "xml")
            If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; Parse XML and set entries in global using string extraction
            Set tEntryCount = 0
            Set tPos = 1
            For {
                Set tIdx = $Find(tXML, "<entry ", tPos)
                If tIdx = 0 Quit
                Set tPos = tIdx

                ; Find the end of this entry element to scope attribute search
                Set tEntryEnd = $Find(tXML, "/>", tPos)
                If tEntryEnd = 0 Set tEntryEnd = $Find(tXML, ">", tPos)
                If tEntryEnd = 0 Continue
                Set tEntryFragment = $Extract(tXML, tPos, tEntryEnd - 1)

                ; Extract key attribute (search within this entry element only)
                Set tKeyStart = $Find(tEntryFragment, "key=""", 1)
                If tKeyStart = 0 Continue
                Set tKeyEnd = $Find(tEntryFragment, """", tKeyStart)
                If tKeyEnd = 0 Continue
                Set tEntryKey = $ZConvert($Extract(tEntryFragment, tKeyStart, tKeyEnd - 2), "I", "XML")

                ; Extract value attribute (search within this entry element only)
                Set tValStart = $Find(tEntryFragment, "value=""", 1)
                If tValStart = 0 Continue
                Set tValEnd = $Find(tEntryFragment, """", tValStart)
                If tValEnd = 0 Continue
                Set tEntryValue = $ZConvert($Extract(tEntryFragment, tValStart, tValEnd - 2), "I", "XML")

                Set ^Ens.LookupTable(tTableName, tEntryKey) = tEntryValue
                Set tEntryCount = tEntryCount + 1
            }

            Set $NAMESPACE = tOrigNS
            Set tResult = {}
            Do tResult.%Set("action", "imported")
            Do tResult.%Set("tableName", tTableName)
            Do tResult.%Set("entryCount", tEntryCount, "number")
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List Interoperability System Default Settings (<class>Ens.Config.DefaultSettings</class>).
/// <p>Returns all default-setting rows, optionally filtered by any of the four key
/// dimensions (<code>production</code>, <code>item</code>, <code>hostClass</code>,
/// <code>setting</code>) supplied as query parameters. Each row is the
/// production/item/host-class/setting tuple plus its value, description, and
/// deployable flag.</p>
/// <p>Query parameters: <code>production</code>, <code>item</code>, <code>hostClass</code>,
/// <code>setting</code> (filters), <code>namespace</code> (target namespace).</p>
ClassMethod DefaultSettingsList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tProduction = $Get(%request.Data("production",1))
        Set tItem = $Get(%request.Data("item",1))
        Set tHostClass = $Get(%request.Data("hostClass",1))
        Set tSetting = $Get(%request.Data("setting",1))
        Set tNamespace = $Get(%request.Data("namespace",1))

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Build parameterized SQL with optional key-dimension filters.
        ; Description is named explicitly (not part of EnumerateSettings ROWSPEC).
        Set tSQL = "SELECT ID, ProductionName, ItemName, HostClassName, SettingName, SettingValue, Description, Deployable FROM Ens_Config.DefaultSettings"
        Set tWhere = ""
        Set tParamCount = 0
        If tProduction '= "" {
            Set tWhere = tWhere_$Select(tWhere="":"", 1:" AND")_" ProductionName = ?"
            Set tParamCount = tParamCount + 1, tParams(tParamCount) = tProduction
        }
        If tItem '= "" {
            Set tWhere = tWhere_$Select(tWhere="":"", 1:" AND")_" ItemName = ?"
            Set tParamCount = tParamCount + 1, tParams(tParamCount) = tItem
        }
        If tHostClass '= "" {
            Set tWhere = tWhere_$Select(tWhere="":"", 1:" AND")_" HostClassName = ?"
            Set tParamCount = tParamCount + 1, tParams(tParamCount) = tHostClass
        }
        If tSetting '= "" {
            Set tWhere = tWhere_$Select(tWhere="":"", 1:" AND")_" SettingName = ?"
            Set tParamCount = tParamCount + 1, tParams(tParamCount) = tSetting
        }
        If tWhere '= "" { Set tSQL = tSQL_" WHERE"_tWhere }
        Set tSQL = tSQL_" ORDER BY ProductionName, ItemName, HostClassName, SettingName"

        ; Execute SQL based on parameter count
        If tParamCount = 0 {
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL)
        }
        ElseIf tParamCount = 1 {
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, tParams(1))
        }
        ElseIf tParamCount = 2 {
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, tParams(1), tParams(2))
        }
        ElseIf tParamCount = 3 {
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, tParams(1), tParams(2), tParams(3))
        }
        Else {
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, tParams(1), tParams(2), tParams(3), tParams(4))
        }

        If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
            Set $NAMESPACE = tOrigNS
            Set tMsg = $Select('$IsObject(tRS): "SQL execution failed", 1: "SQL error: "_tRS.%Message)
            Set tSC = $$$ERROR($$$GeneralError, tMsg)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tSettings = []
        While tRS.%Next() {
            Set tRow = {}
            Do tRow.%Set("id", tRS.ID, "number")
            Do tRow.%Set("production", tRS.ProductionName)
            Do tRow.%Set("item", tRS.ItemName)
            Do tRow.%Set("hostClass", tRS.HostClassName)
            Do tRow.%Set("setting", tRS.SettingName)
            Do tRow.%Set("value", tRS.SettingValue)
            If tRS.Description '= "" {
                Do tRow.%Set("description", tRS.Description)
            }
            Do tRow.%Set("deployable", tRS.Deployable, "boolean")
            Do tSettings.%Push(tRow)
        }

        Set tResult = {}
        Do tResult.%Set("settings", tSettings)
        Do tResult.%Set("count", tSettings.%Size(), "number")

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

/// Get, set, or delete a single Interoperability System Default Setting
/// (<class>Ens.Config.DefaultSettings</class>).
/// <p>Accepts a JSON body with <code>action</code> ("get", "set", "delete"),
/// the key tuple <code>production</code>/<code>item</code>/<code>hostClass</code>/<code>setting</code>
/// (each defaulting to <code>"*"</code> when omitted, matching the class
/// <code>InitialExpression</code>), <code>value</code> (for set), optional
/// <code>description</code> and <code>deployable</code> (for set), and optional
/// <code>namespace</code>.</p>
/// <p>The IdKey is the 4-tuple joined with <code>||</code>. <method>%Save()</method>
/// and <method>%DeleteId()</method> auto-update the production mod flags via the
/// class's <code>%OnAfterSave</code>/<code>%OnAfterDelete</code> hooks — no manual
/// production recompile is required.</p>
ClassMethod DefaultSettingsManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required parameters
        Set tAction = tBody.%Get("action")
        Set tNamespace = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "get") && (tAction '= "set") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: get, set, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Resolve the 4-tuple key; each slot defaults to "*" (the InitialExpression).
        Set tProduction = tBody.%Get("production")
        Set:tProduction="" tProduction = "*"
        Set tItem = tBody.%Get("item")
        Set:tItem="" tItem = "*"
        Set tHostClass = tBody.%Get("hostClass")
        Set:tHostClass="" tHostClass = "*"
        Set tSetting = tBody.%Get("setting")
        Set:tSetting="" tSetting = "*"

        ; Reject any key slot containing the "||" IdKey delimiter. The IdKey is the
        ; 4-tuple joined with "||", so an embedded "||" would split tId into the wrong
        ; subscripts and resolve/modify a DIFFERENT row than the caller named (silent
        ; wrong-row get/set/delete). Guard before assembling tId.
        If (tProduction["||") || (tItem["||") || (tHostClass["||") || (tSetting["||") {
            Set tSC = $$$ERROR($$$GeneralError, "Key slot values may not contain the '||' delimiter")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tId = tProduction_"||"_tItem_"||"_tHostClass_"||"_tSetting

        ; Switch to target namespace for Ens.* operations
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        If tAction = "get" {
            If '##class(Ens.Config.DefaultSettings).%ExistsId(tId) {
                Set $NAMESPACE = tOrigNS
                Set tResult = {}
                Do tResult.%Set("action", "get")
                Do tResult.%Set("found", 0, "boolean")
                Do tResult.%Set("production", tProduction)
                Do tResult.%Set("item", tItem)
                Do tResult.%Set("hostClass", tHostClass)
                Do tResult.%Set("setting", tSetting)
                Do ..RenderResponseBody($$$OK, , tResult)
                Quit
            }
            Set tObj = ##class(Ens.Config.DefaultSettings).%OpenId(tId)
            If '$IsObject(tObj) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Failed to open default setting '"_tId_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set $NAMESPACE = tOrigNS
            Set tResult = {}
            Do tResult.%Set("action", "get")
            Do tResult.%Set("found", 1, "boolean")
            Do tResult.%Set("production", tObj.ProductionName)
            Do tResult.%Set("item", tObj.ItemName)
            Do tResult.%Set("hostClass", tObj.HostClassName)
            Do tResult.%Set("setting", tObj.SettingName)
            Do tResult.%Set("value", tObj.SettingValue)
            If tObj.Description '= "" {
                Do tResult.%Set("description", tObj.Description)
            }
            Do tResult.%Set("deployable", tObj.Deployable, "boolean")
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "set" {
            ; value is required for set
            If 'tBody.%IsDefined("value") {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'value' is required for set action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tValue = tBody.%Get("value")

            If ##class(Ens.Config.DefaultSettings).%ExistsId(tId) {
                Set tObj = ##class(Ens.Config.DefaultSettings).%OpenId(tId)
            } Else {
                Set tObj = ##class(Ens.Config.DefaultSettings).%New()
                Set tObj.ProductionName = tProduction, tObj.ItemName = tItem
                Set tObj.HostClassName = tHostClass, tObj.SettingName = tSetting
            }
            If '$IsObject(tObj) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Failed to open or create default setting '"_tId_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tObj.SettingValue = tValue
            If tBody.%IsDefined("description") { Set tObj.Description = tBody.%Get("description") }
            If tBody.%IsDefined("deployable") { Set tObj.Deployable = +tBody.%Get("deployable") }

            ; %OnAfterSave auto-updates production mod flags — NO manual recompile.
            Set tSC = tObj.%Save()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "set")
            Do tResult.%Set("production", tProduction)
            Do tResult.%Set("item", tItem)
            Do tResult.%Set("hostClass", tHostClass)
            Do tResult.%Set("setting", tSetting)
            Do tResult.%Set("value", tValue)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            If '##class(Ens.Config.DefaultSettings).%ExistsId(tId) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Default setting '"_tId_"' not found")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; %OnAfterDelete auto-updates production mod flags.
            Set tSC = ##class(Ens.Config.DefaultSettings).%DeleteId(tId)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "deleted")
            Do tResult.%Set("production", tProduction)
            Do tResult.%Set("item", tItem)
            Do tResult.%Set("hostClass", tHostClass)
            Do tResult.%Set("setting", tSetting)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}
