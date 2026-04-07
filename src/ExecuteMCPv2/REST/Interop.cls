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

            Set tSC = ##class(Ens.Config.Production).Create(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

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

            Set tSC = ##class(Ens.Config.Production).Delete(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

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

/// Start, stop, restart, update, or recover a production.
/// <p>Accepts a JSON body with <code>action</code> and optional parameters:
/// <ul>
///   <li><code>name</code> — production class name (required for start/restart)</li>
///   <li><code>timeout</code> — seconds to wait for stop (default 120)</li>
///   <li><code>force</code> — force stop/recover on timeout (default false)</li>
///   <li><code>namespace</code> — target namespace for the production</li>
/// </ul></p>
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

        If (tAction '= "start") && (tAction '= "stop") && (tAction '= "restart") && (tAction '= "update") && (tAction '= "recover") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: start, stop, restart, update, recover")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tNamespace = tBody.%Get("namespace")
        Set tTimeout = +$Get(tBody.%Get("timeout"), 120)
        If tTimeout = 0 Set tTimeout = 120
        Set tForce = +$Get(tBody.%Get("force"), 0)

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
            Set tSC = ##class(Ens.Director).RecoverProduction(tForce)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "recovered"}
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

/// Enable, disable, get, or set settings for an individual production config item.
/// <p>Accepts a JSON body with <code>action</code> ("enable", "disable", "get", "set"),
/// <code>itemName</code> (the config item name), optional <code>settings</code> (for set),
/// and optional <code>namespace</code>.</p>
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

        If (tAction '= "enable") && (tAction '= "disable") && (tAction '= "get") && (tAction '= "set") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: enable, disable, get, set")
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

            ; Apply settings from the JSON object
            Set tUpdated = []
            Set tIter = tSettings.%GetIterator()
            While tIter.%GetNext(.tKey, .tValue) {
                If tKey = "poolSize" { Set tItem.PoolSize = tValue Do tUpdated.%Push(tKey) }
                ElseIf tKey = "enabled" { Set tItem.Enabled = tValue Do tUpdated.%Push(tKey) }
                ElseIf tKey = "comment" { Set tItem.Comment = tValue Do tUpdated.%Push(tKey) }
                ElseIf tKey = "category" { Set tItem.Category = tValue Do tUpdated.%Push(tKey) }
                ElseIf tKey = "className" { Set tItem.ClassName = tValue Do tUpdated.%Push(tKey) }
                ElseIf tKey = "adapterClassName" { Set tItem.AdapterClassName = tValue Do tUpdated.%Push(tKey) }
            }

            Set tSC = tItem.%Save()
            If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; Apply changes to running production
            Set tSC = ##class(Ens.Director).UpdateProduction()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "set", "itemName": (tItemName), "updatedSettings": (tUpdated)}
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
                If $$$ISOK(tSC2) && (tProdName '= "") {
                    Set tStateMap = $ListBuild("Running","Stopped","Suspended","Troubled","NetworkStopped")
                    Set tStateStr = $Select(tState>0&&(tState<6):$ListGet(tStateMap, tState), 1:"Unknown")
                    Set tEntry = {}
                    Do tEntry.%Set("namespace", tNS)
                    Do tEntry.%Set("name", tProdName)
                    Do tEntry.%Set("state", tStateStr)
                    Do tEntry.%Set("stateCode", tState, "number")
                    Do tResult.%Push(tEntry)
                }
            }
            Catch innerEx {
                ; Skip namespaces that don't have Ensemble installed
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

        ; Serialize output to JSON
        Set tOutputJSON = {}
        If $IsObject(tOutput) {
            Do tOutputJSON.%Set("className", $ClassName(tOutput))
            ; Try to serialize properties using JSON export to string
            Try {
                Set tSC2 = tOutput.%JSONExportToString(.tJSONStr)
                If $$$ISOK(tSC2) && (tJSONStr '= "") {
                    Set tParsed = ##class(%DynamicObject).%FromJSON(tJSONStr)
                    Do tOutputJSON.%Set("data", tParsed)
                }
            }
            Catch jsonEx {
                ; Object may not support JSON export, return class name only
                Do tOutputJSON.%Set("data", "Object does not support JSON serialization")
            }
        }
        Else {
            Do tOutputJSON.%Set("data", $Get(tOutput))
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

}
