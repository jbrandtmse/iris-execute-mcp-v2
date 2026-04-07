/// REST handler for namespace and database configuration operations.
/// <p>Provides CRUD operations for IRIS namespaces and databases via the
/// custom REST endpoint <code>/api/executemcp/v2/config</code>. All operations
/// execute in the <code>%SYS</code> namespace since <class>Config.Namespaces</class>
/// and <class>Config.Databases</class> require it.</p>
/// <p>Follows the handler pattern established by <class>ExecuteMCPv2.REST.Global</class>:
/// try/catch, input validation, error sanitization, and RenderResponseBody envelope.</p>
/// <p><b>CRITICAL</b>: Namespace switching via <code>New $NAMESPACE</code> must be
/// scoped so that error paths can still access <class>ExecuteMCPv2.Utils</class>
/// (which only exists in HSCUSTOM, not %SYS). The pattern is to save/restore
/// <code>$NAMESPACE</code> manually in catch blocks.</p>
Class ExecuteMCPv2.REST.Config Extends %Atelier.REST
{

/// List all namespaces with their code and data database associations.
ClassMethod NamespaceList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        ; List all namespaces using class query
        Set tRS = ##class(%ResultSet).%New("Config.Namespaces:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tResult = []
        While tRS.Next() {
            Kill tProps
            Set tName = tRS.Get("Namespace")
            Set tSC2 = ##class(Config.Namespaces).Get(tName, .tProps)
            Set tEntry = {}
            Do tEntry.%Set("name", tName)
            If $$$ISOK(tSC2) {
                Do tEntry.%Set("globals", $Get(tProps("Globals")))
                Do tEntry.%Set("routines", $Get(tProps("Routines")))
                Do tEntry.%Set("library", $Get(tProps("Library")))
                Do tEntry.%Set("tempGlobals", $Get(tProps("TempGlobals")))
            }
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a namespace.
ClassMethod NamespaceManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate parameters (before namespace switch)
        Set tAction = tBody.%Get("action")
        Set tName = tBody.%Get("name")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        If tName '? 1A.AN && (tName '? 1"%"1A.AN) && (tName '? 1A.E) {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid namespace name: '"_tName_"'")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Config operations
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            Set tCodeDB = tBody.%Get("codeDatabase")
            Set tDataDB = tBody.%Get("dataDatabase")

            If tCodeDB = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'codeDatabase' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            If tDataDB = "" {
                Set $NAMESPACE = tOrigNS
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
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            Set tCodeDB = tBody.%Get("codeDatabase")
            Set tDataDB = tBody.%Get("dataDatabase")

            If tCodeDB '= "" Set tProps("Routines") = tCodeDB
            If tDataDB '= "" Set tProps("Globals") = tDataDB
            If tBody.%Get("library") '= "" Set tProps("Library") = tBody.%Get("library")
            If tBody.%Get("tempGlobals") '= "" Set tProps("TempGlobals") = tBody.%Get("tempGlobals")

            Set tSC = ##class(Config.Namespaces).Modify(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Config.Namespaces).Delete(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all databases with size, free space, and mount status.
ClassMethod DatabaseList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        ; List all databases using class query
        Set tRS = ##class(%ResultSet).%New("Config.Databases:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tResult = []
        While tRS.Next() {
            Kill tProps
            Set tName = tRS.Get("Name")
            Set tSC2 = ##class(Config.Databases).Get(tName, .tProps)
            Set tEntry = {}
            Do tEntry.%Set("name", tName)
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
        Do tRS.Close()

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Build the tProps array for database create/modify from a JSON body.
/// <p>Reads standard database properties from the JSON body and
/// populates the <var>pProps</var> array suitable for passing to
/// <method>Config.Databases.Create</method> or
/// <method>Config.Databases.Modify</method>.</p>
ClassMethod BuildDatabaseProps(pBody As %DynamicObject, Output pProps) [ Private ]
{
    If pBody.%Get("directory") '= "" Set pProps("Directory") = pBody.%Get("directory")
    If pBody.%Get("size") '= "" Set pProps("Size") = +pBody.%Get("size")
    If pBody.%Get("maxSize") '= "" Set pProps("MaxSize") = +pBody.%Get("maxSize")
    If pBody.%Get("expansionSize") '= "" Set pProps("ExpansionSize") = +pBody.%Get("expansionSize")
    If pBody.%Get("globalJournalState") '= "" Set pProps("GlobalJournalState") = +pBody.%Get("globalJournalState")
    If pBody.%Get("mountRequired") '= "" Set pProps("MountRequired") = +pBody.%Get("mountRequired")
    If pBody.%Get("mountAtStartup") '= "" Set pProps("MountAtStartup") = +pBody.%Get("mountAtStartup")
    If pBody.%Get("readOnly") '= "" Set pProps("ReadOnly") = +pBody.%Get("readOnly")
    If pBody.%Get("resource") '= "" Set pProps("Resource") = pBody.%Get("resource")
}

/// Create, modify, or delete a database.
ClassMethod DatabaseManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read and validate before namespace switch
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tAction = tBody.%Get("action")
        Set tName = tBody.%Get("name")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        If tName '? 1A.AN && (tName '? 1"%"1A.AN) && (tName '? 1A.E) {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid database name: '"_tName_"'")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Config operations
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            Set tDir = tBody.%Get("directory")
            If tDir = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'directory' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tProps("Directory") = tDir
            Do ..BuildDatabaseProps(tBody, .tProps)

            Set tSC = ##class(Config.Databases).Create(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            Do ..BuildDatabaseProps(tBody, .tProps)

            Set tSC = ##class(Config.Databases).Modify(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Config.Databases).Delete(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all global, routine, or package mappings for a namespace.
ClassMethod MappingList(pType As %String) As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Validate type parameter (before namespace switch)
        If (pType '= "global") && (pType '= "routine") && (pType '= "package") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'type' must be one of: global, routine, package")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tNamespace = $Get(%request.Data("namespace",1))
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tNamespace, "namespace")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to %SYS
        Set $NAMESPACE = "%SYS"

        If pType = "global" { Set tClassName = "Config.MapGlobals" }
        ElseIf pType = "routine" { Set tClassName = "Config.MapRoutines" }
        ElseIf pType = "package" { Set tClassName = "Config.MapPackages" }

        ; List mappings using class query
        Set tRS = ##class(%ResultSet).%New(tClassName_":List")
        Set tSC = tRS.Execute(tNamespace)
        If $$$ISERR(tSC) { Set $NAMESPACE = tOrigNS Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tResult = []
        While tRS.Next() {
            Kill tProps
            Set tName = tRS.Get("Name")
            Set tSC2 = $ClassMethod(tClassName, "Get", tNamespace, tName, .tProps)
            Set tEntry = {}
            Do tEntry.%Set("name", tName)
            Do tEntry.%Set("type", pType)
            Do tEntry.%Set("namespace", tNamespace)
            If $$$ISOK(tSC2) {
                Do tEntry.%Set("database", $Get(tProps("Database")))
                If pType = "global" {
                    If $Get(tProps("Collation")) '= "" Do tEntry.%Set("collation", tProps("Collation"))
                    If $Get(tProps("LockDatabase")) '= "" Do tEntry.%Set("lockDatabase", tProps("LockDatabase"))
                    If $Get(tProps("Subscript")) '= "" Do tEntry.%Set("subscript", tProps("Subscript"))
                }
            }
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create or delete a global, routine, or package mapping.
ClassMethod MappingManage(pType As %String) As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        If (pType '= "global") && (pType '= "routine") && (pType '= "package") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'type' must be one of: global, routine, package")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Read and validate before namespace switch
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tAction = tBody.%Get("action")
        Set tNamespace = tBody.%Get("namespace")
        Set tName = tBody.%Get("name")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tNamespace, "namespace")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "create") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        If pType = "global" { Set tClassName = "Config.MapGlobals" }
        ElseIf pType = "routine" { Set tClassName = "Config.MapRoutines" }
        ElseIf pType = "package" { Set tClassName = "Config.MapPackages" }

        ; Switch to %SYS for Config operations
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            Set tDatabase = tBody.%Get("database")
            If tDatabase = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'database' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tProps("Database") = tDatabase
            If pType = "global" {
                If tBody.%Get("collation") '= "" Set tProps("Collation") = tBody.%Get("collation")
                If tBody.%Get("lockDatabase") '= "" Set tProps("LockDatabase") = tBody.%Get("lockDatabase")
                If tBody.%Get("subscript") '= "" Set tProps("Subscript") = tBody.%Get("subscript")
            }

            Set tSC = $ClassMethod(tClassName, "Create", tNamespace, tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "type": (pType), "namespace": (tNamespace), "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = $ClassMethod(tClassName, "Delete", tNamespace, tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "type": (pType), "namespace": (tNamespace), "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}
