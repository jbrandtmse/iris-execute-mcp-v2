/// REST handler for namespace and database configuration operations.
/// <p>Provides CRUD operations for IRIS namespaces and databases via the
/// custom REST endpoint <code>/api/executemcp/v2/config</code>. All operations
/// execute in the <code>%SYS</code> namespace since <class>Config.Namespaces</class>
/// and <class>Config.Databases</class> require it.</p>
/// <p>Follows the handler pattern established by <class>ExecuteMCPv2.REST.Global</class>:
/// namespace switch/restore, try/catch, input validation, error sanitization,
/// and RenderResponseBody envelope.</p>
Class ExecuteMCPv2.REST.Config Extends %Atelier.REST
{

/// List all namespaces with their code and data database associations.
/// <p>Switches to <code>%SYS</code> and calls <class>Config.Namespaces</class>
/// to enumerate all namespaces. Returns a JSON array of namespace objects
/// with <code>name</code>, <code>globals</code>, <code>routines</code>,
/// <code>library</code>, and <code>tempGlobals</code> properties.</p>
ClassMethod NamespaceList() As %Status
{
    Set tSC = $$$OK
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        ; List all namespaces
        Do ##class(Config.Namespaces).NamespaceList(.tList)

        Set tResult = []
        Set tKey = ""
        For {
            Set tKey = $Order(tList(tKey))
            Quit:tKey=""

            ; Get detailed properties for each namespace
            Set tSC2 = ##class(Config.Namespaces).Get(tKey, .tProps)
            Set tEntry = {}
            Do tEntry.%Set("name", tKey)
            If $$$ISOK(tSC2) {
                Do tEntry.%Set("globals", $Get(tProps("Globals")))
                Do tEntry.%Set("routines", $Get(tProps("Routines")))
                Do tEntry.%Set("library", $Get(tProps("Library")))
                Do tEntry.%Set("tempGlobals", $Get(tProps("TempGlobals")))
            }
            Do tResult.%Push(tEntry)
        }

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a namespace.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code>, and optional properties (<code>codeDatabase</code>,
/// <code>dataDatabase</code>, <code>library</code>, <code>tempGlobals</code>).
/// Dispatches to <class>Config.Namespaces</class> in <code>%SYS</code>.</p>
ClassMethod NamespaceManage() As %Status
{
    Set tSC = $$$OK
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

        ; Extract and validate parameters
        Set tAction = tBody.%Get("action")
        Set tName = tBody.%Get("name")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate namespace name format (alphanumeric, hyphens, underscores)
        If tName '? 1A.AN && (tName '? 1"%"1A.AN) && (tName '? 1A.E) {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid namespace name: '"_tName_"'")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Config operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            ; Build properties array
            Set tCodeDB = tBody.%Get("codeDatabase")
            Set tDataDB = tBody.%Get("dataDatabase")

            ; Code and data databases required for create
            If tCodeDB = "" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'codeDatabase' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            If tDataDB = "" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'dataDatabase' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tProps("Routines") = tCodeDB
            Set tProps("Globals") = tDataDB
            If tBody.%Get("library") '= "" Set tProps("Library") = tBody.%Get("library")
            If tBody.%Get("tempGlobals") '= "" Set tProps("TempGlobals") = tBody.%Get("tempGlobals")

            Set tSC = ##class(Config.Namespaces).Create(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            ; Build properties array from provided fields
            Set tCodeDB = tBody.%Get("codeDatabase")
            Set tDataDB = tBody.%Get("dataDatabase")

            If tCodeDB '= "" Set tProps("Routines") = tCodeDB
            If tDataDB '= "" Set tProps("Globals") = tDataDB
            If tBody.%Get("library") '= "" Set tProps("Library") = tBody.%Get("library")
            If tBody.%Get("tempGlobals") '= "" Set tProps("TempGlobals") = tBody.%Get("tempGlobals")

            Set tSC = ##class(Config.Namespaces).Modify(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Config.Namespaces).Delete(tName)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all databases with size, free space, and mount status.
/// <p>Switches to <code>%SYS</code> and calls <class>Config.Databases</class>
/// to enumerate all databases. Returns a JSON array of database objects.</p>
ClassMethod DatabaseList() As %Status
{
    Set tSC = $$$OK
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        ; List all databases
        Do ##class(Config.Databases).DatabaseList(.tList)

        Set tResult = []
        Set tKey = ""
        For {
            Set tKey = $Order(tList(tKey))
            Quit:tKey=""

            ; Get detailed properties for each database
            Set tSC2 = ##class(Config.Databases).Get(tKey, .tProps)
            Set tEntry = {}
            Do tEntry.%Set("name", tKey)
            If $$$ISOK(tSC2) {
                Do tEntry.%Set("directory", $Get(tProps("Directory")))
                Do tEntry.%Set("size", $Get(tProps("Size")), "number")
                Do tEntry.%Set("maxSize", $Get(tProps("MaxSize")), "number")
                Do tEntry.%Set("expansionSize", $Get(tProps("ExpansionSize")), "number")
                Do tEntry.%Set("globalJournalState", $Get(tProps("GlobalJournalState")), "number")
                Do tEntry.%Set("mountRequired", $Get(tProps("MountRequired")), "boolean")
                Do tEntry.%Set("mountAtStartup", $Get(tProps("MountAtStartup")), "boolean")
                Do tEntry.%Set("readOnly", $Get(tProps("ReadOnly")), "boolean")
                Do tEntry.%Set("resource", $Get(tProps("Resource")))
            }
            Do tResult.%Push(tEntry)
        }

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a database.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code>, and optional configuration properties.
/// Dispatches to <class>Config.Databases</class> in <code>%SYS</code>.</p>
ClassMethod DatabaseManage() As %Status
{
    Set tSC = $$$OK
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

        ; Extract and validate parameters
        Set tAction = tBody.%Get("action")
        Set tName = tBody.%Get("name")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate database name format (alphanumeric, may start with %)
        If tName '? 1A.AN && (tName '? 1"%"1A.AN) && (tName '? 1A.E) {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid database name: '"_tName_"'")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Config operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            Set tDir = tBody.%Get("directory")
            If tDir = "" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'directory' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tProps("Directory") = tDir
            If tBody.%Get("size") '= "" Set tProps("Size") = +tBody.%Get("size")
            If tBody.%Get("maxSize") '= "" Set tProps("MaxSize") = +tBody.%Get("maxSize")
            If tBody.%Get("expansionSize") '= "" Set tProps("ExpansionSize") = +tBody.%Get("expansionSize")
            If tBody.%Get("globalJournalState") '= "" Set tProps("GlobalJournalState") = +tBody.%Get("globalJournalState")
            If tBody.%Get("mountRequired") '= "" Set tProps("MountRequired") = +tBody.%Get("mountRequired")
            If tBody.%Get("mountAtStartup") '= "" Set tProps("MountAtStartup") = +tBody.%Get("mountAtStartup")
            If tBody.%Get("readOnly") '= "" Set tProps("ReadOnly") = +tBody.%Get("readOnly")
            If tBody.%Get("resource") '= "" Set tProps("Resource") = tBody.%Get("resource")

            Set tSC = ##class(Config.Databases).Create(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%Get("directory") '= "" Set tProps("Directory") = tBody.%Get("directory")
            If tBody.%Get("size") '= "" Set tProps("Size") = +tBody.%Get("size")
            If tBody.%Get("maxSize") '= "" Set tProps("MaxSize") = +tBody.%Get("maxSize")
            If tBody.%Get("expansionSize") '= "" Set tProps("ExpansionSize") = +tBody.%Get("expansionSize")
            If tBody.%Get("globalJournalState") '= "" Set tProps("GlobalJournalState") = +tBody.%Get("globalJournalState")
            If tBody.%Get("mountRequired") '= "" Set tProps("MountRequired") = +tBody.%Get("mountRequired")
            If tBody.%Get("mountAtStartup") '= "" Set tProps("MountAtStartup") = +tBody.%Get("mountAtStartup")
            If tBody.%Get("readOnly") '= "" Set tProps("ReadOnly") = +tBody.%Get("readOnly")
            If tBody.%Get("resource") '= "" Set tProps("Resource") = tBody.%Get("resource")

            Set tSC = ##class(Config.Databases).Modify(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Config.Databases).Delete(tName)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}
