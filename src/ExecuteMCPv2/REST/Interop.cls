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
            Set tSQL = "SELECT Name, ClassName, Enabled, BusinessType, AdapterClassName FROM Ens_Config.Item WHERE Production = ?"
            Set tRS = ##class(%SQL.Statement).%ExecDirect(, tSQL, tProdName)
            If $IsObject(tRS) {
                While tRS.%Next() {
                    Set tItem = {}
                    Do tItem.%Set("name", tRS.Name)
                    Do tItem.%Set("className", tRS.ClassName)
                    Do tItem.%Set("enabled", tRS.Enabled, "boolean")
                    Do tItem.%Set("businessType", tRS.BusinessType, "number")
                    If tRS.AdapterClassName '= "" {
                        Do tItem.%Set("adapter", tRS.AdapterClassName)
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

}
