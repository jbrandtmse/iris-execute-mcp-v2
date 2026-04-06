/**
 * Embedded ObjectScript class content for the ExecuteMCPv2 REST service.
 *
 * Contains all 6 production classes as string literals, keyed by their
 * document name (e.g. "ExecuteMCPv2.Utils.cls"). These are deployed to
 * IRIS via the Atelier PUT /doc endpoint during bootstrap.
 *
 * This file is auto-generated from the src/ExecuteMCPv2/ directory.
 * Do not edit the class content manually.
 */

export const BOOTSTRAP_CLASSES: Map<string, string> = new Map([
  [
    "ExecuteMCPv2.Utils.cls",
    `/// Shared utility methods for the ExecuteMCPv2 REST service layer.
/// <p>Provides namespace switching, input validation, error sanitization,
/// and request body parsing helpers used by all REST handler classes.</p>
Class ExecuteMCPv2.Utils Extends %RegisteredObject
{

/// Save the current namespace and switch to <var>pNamespace</var>.
/// <p>The original namespace is returned via the <var>pOriginal</var> output parameter
/// so callers can restore it later with <method>RestoreNamespace</method>.</p>
ClassMethod SwitchNamespace(pNamespace As %String, Output pOriginal As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        Set pOriginal = $NAMESPACE
        Set $NAMESPACE = pNamespace
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Restore <code>$NAMESPACE</code> to the previously saved value.
/// <p>Called in both normal and error paths to guarantee namespace cleanup.</p>
ClassMethod RestoreNamespace(pOriginal As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        Set $NAMESPACE = pOriginal
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Validate that <var>pValue</var> is not empty.
/// <p>Returns an error <class>%Status</class> identifying <var>pName</var> as the missing field.</p>
ClassMethod ValidateRequired(pValue As %String, pName As %String) As %Status
{
    If pValue = "" {
        Quit $$$ERROR($$$GeneralError, "Required parameter '"_pName_"' is missing or empty")
    }
    Quit $$$OK
}

/// Validate a string parameter.
/// <p>Checks that the value is not empty and does not exceed <var>pMaxLen</var> characters.
/// If <var>pMaxLen</var> is 0 or not supplied, no length check is performed.</p>
ClassMethod ValidateString(pValue As %String, pName As %String, pMaxLen As %Integer = 0) As %Status
{
    If pValue = "" {
        Quit $$$ERROR($$$GeneralError, "Parameter '"_pName_"' must be a non-empty string")
    }
    If (pMaxLen > 0) && ($Length(pValue) > pMaxLen) {
        Quit $$$ERROR($$$GeneralError, "Parameter '"_pName_"' exceeds maximum length of "_pMaxLen)
    }
    Quit $$$OK
}

/// Validate that <var>pValue</var> is a valid integer.
ClassMethod ValidateInteger(pValue As %String, pName As %String) As %Status
{
    If pValue = "" {
        Quit $$$ERROR($$$GeneralError, "Parameter '"_pName_"' must be a valid integer")
    }
    If pValue '? 1.N && (pValue '? 1"-"1.N) {
        Quit $$$ERROR($$$GeneralError, "Parameter '"_pName_"' must be a valid integer")
    }
    Quit $$$OK
}

/// Validate that <var>pValue</var> is a valid boolean (0, 1, true, false).
ClassMethod ValidateBoolean(pValue As %String, pName As %String) As %Status
{
    Set tLower = $ZConvert(pValue, "L")
    If (tLower '= "0") && (tLower '= "1") && (tLower '= "true") && (tLower '= "false") {
        Quit $$$ERROR($$$GeneralError, "Parameter '"_pName_"' must be a boolean (0, 1, true, false)")
    }
    Quit $$$OK
}

/// Strip internal IRIS details from an error status.
/// <p>Removes <code>$ZERROR</code> content, stack traces, and global references
/// from the error text, returning a safe status suitable for external callers (NFR11).</p>
ClassMethod SanitizeError(pStatus As %Status) As %Status
{
    If $$$ISOK(pStatus) Quit pStatus
    ; Get the error text
    Set tText = $System.Status.GetErrorText(pStatus)
    ; Strip stack trace references like +5^RoutineName
    Set tSafe = $ZStrip(tText, "*C")
    ; Remove references to routines: +N^Name patterns
    Set tSafe = $Replace(tSafe, $Char(13), "")
    Set tSafe = $Replace(tSafe, $Char(10), " ")
    ; Strip ^GlobalName("key") and +N^RoutineName references
    Set tOffset = 1
    For {
        Set tPos = $Find(tSafe, "^", tOffset)
        If tPos = 0 Quit
        ; Check if this looks like a global or routine reference
        Set tBefore = $Extract(tSafe, 1, tPos - 2)
        Set tAfter = $Extract(tSafe, tPos)
        If (tAfter ? 1A.AN) || (tAfter ? 1"%".AN) {
            ; This is likely a global/routine reference — strip it
            ; Also strip +N prefix before the caret if present
            Set tStart = tPos - 1
            While (tStart > 1) && ($Extract(tSafe, tStart - 1) ? 1AN) {
                Set tStart = tStart - 1
            }
            If (tStart > 1) && ($Extract(tSafe, tStart - 1) = "+") {
                Set tStart = tStart - 1
            }
            ; Find the end of the reference
            Set tEnd = tPos
            Set tLen = $Length(tSafe)
            While (tEnd <= tLen) && (($Extract(tSafe, tEnd) ? 1AN) || ($Extract(tSafe, tEnd) = ".") || ($Extract(tSafe, tEnd) = "%")) {
                Set tEnd = tEnd + 1
            }
            ; Also strip parenthesized subscripts if present
            If (tEnd <= tLen) && ($Extract(tSafe, tEnd) = "(") {
                Set tDepth = 1
                Set tEnd = tEnd + 1
                While (tEnd <= tLen) && (tDepth > 0) {
                    If $Extract(tSafe, tEnd) = "(" Set tDepth = tDepth + 1
                    If $Extract(tSafe, tEnd) = ")" Set tDepth = tDepth - 1
                    Set tEnd = tEnd + 1
                }
            }
            Set tSafe = $Extract(tSafe, 1, tStart - 1) _ $Extract(tSafe, tEnd, *)
            Set tOffset = tStart
        } Else {
            ; Not a reference — advance past this caret to avoid infinite loop
            Set tOffset = tPos
        }
    }
    ; If we stripped everything meaningful, use a generic message
    If $ZStrip(tSafe, "<>W") = "" {
        Set tSafe = "An internal error occurred"
    }
    Quit $$$ERROR($$$GeneralError, tSafe)
}

/// Read the HTTP request body and parse it as JSON.
/// <p>Returns a <class>%DynamicObject</class> via the <var>pBody</var> output parameter.</p>
ClassMethod ReadRequestBody(Output pBody As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pBody = ""
    Try {
        ; Guard against undefined or non-object %request.Content
        If '$IsObject($Get(%request.Content)) {
            Quit
        }
        If '%request.Content.Size {
            Quit
        }
        Set tContent = %request.Content.Read()
        If tContent = "" {
            Quit
        }
        Set pBody = {}.%FromJSON(tContent)
    } Catch ex {
        Set tSC = $$$ERROR($$$GeneralError, "Invalid JSON in request body")
    }
    Quit tSC
}

}`,
  ],
  [
    "ExecuteMCPv2.Setup.cls",
    `/// Setup and configuration class for the ExecuteMCPv2 REST service.
/// <p>Provides methods to register and unregister the <code>/api/executemcp</code>
/// web application on IRIS. This class is called by the auto-bootstrap flow
/// (Story 3.6) and can also be invoked manually from the Terminal:</p>
/// <example>
/// Do ##class(ExecuteMCPv2.Setup).Configure()
/// </example>
/// <p>The Configure method must be run by a user with <code>%Admin_Manage</code>
/// privileges, as it creates/modifies web applications in the <code>%SYS</code> namespace.</p>
Class ExecuteMCPv2.Setup Extends %RegisteredObject
{

/// Default web application name for the ExecuteMCPv2 REST service.
Parameter WEBAPP = "/api/executemcp/v2";

/// Register the <code>/api/executemcp</code> web application.
/// <p>Creates or updates the web application to route requests to
/// <class>ExecuteMCPv2.REST.Dispatch</class>. The operation is idempotent —
/// calling Configure() multiple times has no side effects.</p>
/// <p>Must be called from, or will switch to, the <code>%SYS</code> namespace
/// since <class>Security.Applications</class> requires it.</p>
/// @param pNamespace The namespace where ExecuteMCPv2 classes are installed.
///        Defaults to the current namespace before switching to %SYS.
ClassMethod Configure(pNamespace As %String = "") As %Status [ SqlProc ]
{
    Set tSC = $$$OK
    Try {
        ; Capture the target namespace before switching to %SYS
        If pNamespace = "" Set pNamespace = $NAMESPACE

        ; Switch to %SYS to manage web applications
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        Set tAppName = ..#WEBAPP

        ; Check if the web application already exists
        Set tExists = ##class(Security.Applications).Exists(tAppName)

        If tExists {
            ; Update existing web application
            Set tSC = ##class(Security.Applications).Get(tAppName, .tProps)
            If $$$ISERR(tSC) Quit

            Set tProps("NameSpace") = pNamespace
            Set tProps("DispatchClass") = "ExecuteMCPv2.REST.Dispatch"
            Set tProps("Enabled") = 1
            Set tProps("AutheEnabled") = 32
            Set tProps("Type") = 2
            Set tProps("CSPZENEnabled") = 1
            Set tProps("InbndWebServicesEnabled") = 0
            Set tProps("CookiePath") = "/api/executemcp/v2/"
            Set tProps("Resource") = "%Development"

            Set tSC = ##class(Security.Applications).Modify(tAppName, .tProps)
            If $$$ISERR(tSC) Quit
        } Else {
            ; Create new web application
            Kill tProps
            Set tProps("NameSpace") = pNamespace
            Set tProps("DispatchClass") = "ExecuteMCPv2.REST.Dispatch"
            Set tProps("Description") = "ExecuteMCPv2 REST Service for MCP Tool Execution"
            Set tProps("Enabled") = 1
            Set tProps("AutheEnabled") = 32
            Set tProps("Type") = 2
            Set tProps("CSPZENEnabled") = 1
            Set tProps("InbndWebServicesEnabled") = 0
            Set tProps("CookiePath") = "/api/executemcp/v2/"
            Set tProps("Resource") = "%Development"

            Set tSC = ##class(Security.Applications).Create(tAppName, .tProps)
            If $$$ISERR(tSC) Quit
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Remove the <code>/api/executemcp</code> web application.
/// <p>Deletes the web application registration. Does nothing if the
/// web application does not exist (idempotent).</p>
ClassMethod Uninstall() As %Status
{
    Set tSC = $$$OK
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        Set tAppName = ..#WEBAPP

        If ##class(Security.Applications).Exists(tAppName) {
            Set tSC = ##class(Security.Applications).Delete(tAppName)
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Check whether the <code>/api/executemcp</code> web application exists.
/// <p>Returns 1 if registered, 0 if not.</p>
ClassMethod IsConfigured() As %Boolean [ SqlProc ]
{
    Set tResult = 0
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Set tResult = ##class(Security.Applications).Exists(..#WEBAPP)
    } Catch ex {
        Set tResult = 0
    }
    Quit tResult
}

}`,
  ],
  [
    "ExecuteMCPv2.REST.Config.cls",
    `/// REST handler for namespace and database configuration operations.
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

/// List all global, routine, or package mappings for a namespace.
/// <p>The <var>pType</var> URL parameter selects the mapping class:
/// <code>global</code> -> <class>Config.MapGlobals</class>,
/// <code>routine</code> -> <class>Config.MapRoutines</class>,
/// <code>package</code> -> <class>Config.MapPackages</class>.
/// Returns a JSON array of mapping objects for the requested namespace.</p>
ClassMethod MappingList(pType As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        ; Validate type parameter
        If (pType '= "global") && (pType '= "routine") && (pType '= "package") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'type' must be one of: global, routine, package")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Get namespace from query parameter
        Set tNamespace = $Get(%request.Data("namespace",1))
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tNamespace, "namespace")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        ; Determine mapping class based on type
        If pType = "global" {
            Set tClassName = "Config.MapGlobals"
        }
        ElseIf pType = "routine" {
            Set tClassName = "Config.MapRoutines"
        }
        ElseIf pType = "package" {
            Set tClassName = "Config.MapPackages"
        }

        ; List mappings for the namespace
        Do $ClassMethod(tClassName, "List", tNamespace, .tList)

        Set tResult = []
        Set tKey = ""
        For {
            Set tKey = $Order(tList(tKey))
            Quit:tKey=""

            ; Get detailed properties for each mapping
            Set tSC2 = $ClassMethod(tClassName, "Get", tNamespace, tKey, .tProps)
            Set tEntry = {}
            Do tEntry.%Set("name", tKey)
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

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create or delete a global, routine, or package mapping.
/// <p>The <var>pType</var> URL parameter selects the mapping class.
/// Reads a JSON body with <code>action</code> (create|delete),
/// <code>namespace</code>, <code>name</code>, and <code>database</code>
/// (required for create). Additional type-specific properties are supported
/// for global mappings: <code>collation</code>, <code>lockDatabase</code>,
/// <code>subscript</code>.</p>
ClassMethod MappingManage(pType As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        ; Validate type parameter
        If (pType '= "global") && (pType '= "routine") && (pType '= "package") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'type' must be one of: global, routine, package")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

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
        Set tNamespace = tBody.%Get("namespace")
        Set tName = tBody.%Get("name")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tNamespace, "namespace")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value (only create and delete for mappings)
        If (tAction '= "create") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Determine mapping class based on type
        If pType = "global" {
            Set tClassName = "Config.MapGlobals"
        }
        ElseIf pType = "routine" {
            Set tClassName = "Config.MapRoutines"
        }
        ElseIf pType = "package" {
            Set tClassName = "Config.MapPackages"
        }

        ; Switch to %SYS for Config operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            Set tDatabase = tBody.%Get("database")
            If tDatabase = "" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'database' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tProps("Database") = tDatabase

            ; Global-specific optional properties
            If pType = "global" {
                If tBody.%Get("collation") '= "" Set tProps("Collation") = tBody.%Get("collation")
                If tBody.%Get("lockDatabase") '= "" Set tProps("LockDatabase") = tBody.%Get("lockDatabase")
                If tBody.%Get("subscript") '= "" Set tProps("Subscript") = tBody.%Get("subscript")
            }

            Set tSC = $ClassMethod(tClassName, "Create", tNamespace, tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "type": (pType), "namespace": (tNamespace), "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = $ClassMethod(tClassName, "Delete", tNamespace, tName)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "type": (pType), "namespace": (tNamespace), "name": (tName)}
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

}`,
  ],
  [
    "ExecuteMCPv2.REST.Security.cls",
    `/// REST handler for security management operations.
/// <p>Provides user account CRUD, role assignment, password
/// management, role management, resource management, and permission
/// checking via the custom REST endpoint
/// <code>/api/executemcp/v2/security/</code>. All operations
/// execute in the <code>%SYS</code> namespace since <class>Security.Users</class>,
/// <class>Security.Roles</class>, and <class>Security.Resources</class>
/// require it.</p>
/// <p>Follows the handler pattern established by <class>ExecuteMCPv2.REST.Config</class>:
/// namespace switch/restore, try/catch, input validation, error sanitization,
/// and RenderResponseBody envelope.</p>
/// <p><b>CRITICAL</b>: Password values are NEVER included in response bodies
/// or error messages (NFR6).</p>
Class ExecuteMCPv2.REST.Security Extends %Atelier.REST
{

/// List all user accounts with their properties (excluding passwords).
/// <p>Switches to <code>%SYS</code> and iterates over users via SQL
/// against <class>Security.Users</class>. Returns a JSON array of user
/// objects with <code>Name</code>, <code>FullName</code>, <code>Roles</code>,
/// <code>Enabled</code>, <code>Namespace</code>, and <code>Comment</code>.</p>
ClassMethod UserList() As %Status
{
    Set tSC = $$$OK
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all users
        Set tRS = ##class(%ResultSet).%New("Security.Users:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        While tRS.Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("fullName", tRS.Get("FullName"))
            Do tEntry.%Set("enabled", tRS.Get("Enabled"), "boolean")
            Do tEntry.%Set("namespace", tRS.Get("NameSpace"))
            Do tEntry.%Set("roles", tRS.Get("Roles"))
            Do tEntry.%Set("comment", tRS.Get("Comment"))
            Do tEntry.%Set("expirationDate", tRS.Get("ExpirationDate"))
            Do tEntry.%Set("changePasswordOnNextLogin", tRS.Get("ChangePassword"), "boolean")
            ; CRITICAL: Never include password values
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Get a single user account by name (excluding password).
/// <p>Switches to <code>%SYS</code> and calls <method>Security.Users.Get</method>
/// to retrieve user properties. Returns a JSON object with user details.</p>
ClassMethod UserGet(pName As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        ; Validate name parameter
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(pName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        Set tSC = ##class(Security.Users).Get(pName, .tProps)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tEntry = {}
        Do tEntry.%Set("name", $Get(tProps("Name")))
        Do tEntry.%Set("fullName", $Get(tProps("FullName")))
        Do tEntry.%Set("enabled", +$Get(tProps("Enabled")), "boolean")
        Do tEntry.%Set("namespace", $Get(tProps("Namespace")))
        Do tEntry.%Set("routine", $Get(tProps("Routine")))
        Do tEntry.%Set("roles", $Get(tProps("Roles")))
        Do tEntry.%Set("comment", $Get(tProps("Comment")))
        Do tEntry.%Set("expirationDate", $Get(tProps("ExpirationDate")))
        Do tEntry.%Set("changePasswordOnNextLogin", +$Get(tProps("ChangePassword")), "boolean")
        ; CRITICAL: Never include password values

        Do ..RenderResponseBody($$$OK, , tEntry)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a user account.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code>, and optional properties. Dispatches to
/// <class>Security.Users</class> in <code>%SYS</code>.</p>
/// <p><b>CRITICAL</b>: Password values are accepted in the request body
/// but NEVER echoed in responses or error messages.</p>
ClassMethod UserManage() As %Status
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

        ; Switch to %SYS for Security operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            ; Password is required for create
            Set tPassword = tBody.%Get("password")
            If tPassword = "" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'password' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tProps("Password") = tPassword
            If tBody.%Get("fullName") '= "" Set tProps("FullName") = tBody.%Get("fullName")
            If tBody.%Get("roles") '= "" Set tProps("Roles") = tBody.%Get("roles")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")
            If tBody.%Get("namespace") '= "" Set tProps("Namespace") = tBody.%Get("namespace")
            If tBody.%Get("routine") '= "" Set tProps("Routine") = tBody.%Get("routine")
            If tBody.%Get("comment") '= "" Set tProps("Comment") = tBody.%Get("comment")
            If tBody.%Get("expirationDate") '= "" Set tProps("ExpirationDate") = tBody.%Get("expirationDate")
            If tBody.%IsDefined("changePasswordOnNextLogin") Set tProps("ChangePassword") = +tBody.%Get("changePasswordOnNextLogin")

            Set tSC = ##class(Security.Users).Create(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; CRITICAL: Never include password in response
            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            ; Build properties array from provided fields
            If tBody.%Get("fullName") '= "" Set tProps("FullName") = tBody.%Get("fullName")
            If tBody.%Get("roles") '= "" Set tProps("Roles") = tBody.%Get("roles")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")
            If tBody.%Get("namespace") '= "" Set tProps("Namespace") = tBody.%Get("namespace")
            If tBody.%Get("routine") '= "" Set tProps("Routine") = tBody.%Get("routine")
            If tBody.%Get("comment") '= "" Set tProps("Comment") = tBody.%Get("comment")
            If tBody.%Get("expirationDate") '= "" Set tProps("ExpirationDate") = tBody.%Get("expirationDate")
            If tBody.%IsDefined("changePasswordOnNextLogin") Set tProps("ChangePassword") = +tBody.%Get("changePasswordOnNextLogin")

            Set tSC = ##class(Security.Users).Modify(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; CRITICAL: Never include password in response
            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Users).Delete(tName)
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

/// Add or remove roles from a user account.
/// <p>Reads a JSON body with <code>action</code> (add|remove),
/// <code>username</code>, and <code>role</code>. For add, appends the
/// role to the user's existing roles. For remove, strips it from the
/// comma-separated role list.</p>
ClassMethod UserRoles() As %Status
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
        Set tUsername = tBody.%Get("username")
        Set tRole = tBody.%Get("role")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tUsername, "username")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tRole, "role")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "add") && (tAction '= "remove") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: add, remove")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        ; Get current user properties
        Set tSC = ##class(Security.Users).Get(tUsername, .tProps)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tRoles = $Get(tProps("Roles"))

        If tAction = "add" {
            ; Append role if not already present
            If tRoles = "" {
                Set tNewRoles = tRole
            }
            Else {
                ; Check if role already exists in the list
                Set tFound = 0
                For tI = 1:1:$Length(tRoles, ",") {
                    If $Piece(tRoles, ",", tI) = tRole Set tFound = 1 Quit
                }
                If tFound {
                    ; Role already assigned - return success without modification
                    Set tResult = {"action": "add", "username": (tUsername), "role": (tRole), "message": "Role already assigned"}
                    Do ..RenderResponseBody($$$OK, , tResult)
                    Quit
                }
                Set tNewRoles = tRoles _ "," _ tRole
            }
        }
        ElseIf tAction = "remove" {
            ; Remove role from comma-separated list
            Set tNewRoles = ""
            Set tRemoved = 0
            For tI = 1:1:$Length(tRoles, ",") {
                Set tCurrent = $Piece(tRoles, ",", tI)
                If tCurrent = tRole {
                    Set tRemoved = 1
                }
                Else {
                    If tNewRoles '= "" Set tNewRoles = tNewRoles _ ","
                    Set tNewRoles = tNewRoles _ tCurrent
                }
            }
            If 'tRemoved {
                ; Role was not assigned - return success without modification
                Set tResult = {"action": "remove", "username": (tUsername), "role": (tRole), "message": "Role was not assigned"}
                Do ..RenderResponseBody($$$OK, , tResult)
                Quit
            }
        }

        ; Update user with new role list
        Kill tProps
        Set tProps("Roles") = tNewRoles
        Set tSC = ##class(Security.Users).Modify(tUsername, .tProps)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tResult = {}
        Do tResult.%Set("action", tAction)
        Do tResult.%Set("username", tUsername)
        Do tResult.%Set("role", tRole)
        Do tResult.%Set("roles", tNewRoles)
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Change a user's password or validate a candidate password.
/// <p>Reads a JSON body with <code>action</code> (change|validate),
/// <code>username</code> (required for change), and <code>password</code>.
/// For change, uses <method>Security.Users.Modify</method> with the
/// <code>ChangePassword</code> property. For validate, calls
/// <code>$SYSTEM.Security.ValidatePassword()</code>.</p>
/// <p><b>CRITICAL</b>: Password values are NEVER echoed in responses
/// or error messages. Only success/failure status is returned.</p>
ClassMethod UserPassword() As %Status
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
        Set tPassword = tBody.%Get("password")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tPassword, "password")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "change") && (tAction '= "validate") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: change, validate")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        If tAction = "change" {
            Set tUsername = tBody.%Get("username")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tUsername, "username")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; Use ChangePassword property to change password
            Set tProps("ChangePassword") = tPassword
            Set tSC = ##class(Security.Users).Modify(tUsername, .tProps)
            If $$$ISERR(tSC) {
                ; CRITICAL: Sanitize error - do NOT include password in error message
                Set tSC = $$$ERROR($$$GeneralError, "Failed to change password for user '"_tUsername_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; CRITICAL: Never include password in response
            Set tResult = {"action": "changed", "username": (tUsername), "success": true}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "validate" {
            ; Validate password against system password rules
            Set tSC = $SYSTEM.Security.ValidatePassword(tPassword)
            If $$$ISOK(tSC) {
                Set tResult = {"action": "validate", "valid": true}
            }
            Else {
                ; Extract validation message but NEVER include the password itself
                Set tMsg = $System.Status.GetErrorText(tSC)
                ; Remove any potential password values from the message
                Set tMsg = $Replace(tMsg, tPassword, "***")
                Set tResult = {"action": "validate", "valid": false, "message": (tMsg)}
                Set tSC = $$$OK
            }
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

/// List all security roles.
ClassMethod RoleList() As %Status
{
    Set tSC = $$$OK
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Set tResult = []
        Set tRS = ##class(%ResultSet).%New("Security.Roles:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        While tRS.Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("description", tRS.Get("Description"))
            Do tEntry.%Set("resources", tRS.Get("Resources"))
            Do tEntry.%Set("grantedRoles", tRS.Get("GrantedRoles"))
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a security role.
ClassMethod RoleManage() As %Status
{
    Set tSC = $$$OK
    Try {
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '\$IsObject(tBody) {
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
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        If tAction = "create" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("resources") Set tProps("Resources") = tBody.%Get("resources")
            If tBody.%IsDefined("grantedRoles") Set tProps("GrantedRoles") = tBody.%Get("grantedRoles")
            Set tSC = ##class(Security.Roles).Create(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("resources") Set tProps("Resources") = tBody.%Get("resources")
            If tBody.%IsDefined("grantedRoles") Set tProps("GrantedRoles") = tBody.%Get("grantedRoles")
            Set tSC = ##class(Security.Roles).Modify(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Roles).Delete(tName)
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

/// List all security resources.
ClassMethod ResourceList() As %Status
{
    Set tSC = $$$OK
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Set tResult = []
        Set tRS = ##class(%ResultSet).%New("Security.Resources:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        While tRS.Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("description", tRS.Get("Description"))
            Do tEntry.%Set("publicPermission", tRS.Get("PublicPermission"))
            Do tEntry.%Set("type", tRS.Get("Type"))
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a security resource.
ClassMethod ResourceManage() As %Status
{
    Set tSC = $$$OK
    Try {
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '\$IsObject(tBody) {
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
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        If tAction = "create" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("publicPermission") Set tProps("PublicPermission") = tBody.%Get("publicPermission")
            Set tSC = ##class(Security.Resources).Create(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("publicPermission") Set tProps("PublicPermission") = tBody.%Get("publicPermission")
            Set tSC = ##class(Security.Resources).Modify(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Resources).Delete(tName)
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

/// Check whether a user or role has a specific permission on a resource.
ClassMethod PermissionCheck() As %Status
{
    Set tSC = $$$OK
    Try {
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '\$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tTarget = tBody.%Get("target")
        Set tResource = tBody.%Get("resource")
        Set tPermission = tBody.%Get("permission")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTarget, "target")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tResource, "resource")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tPermission, "permission")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Set tIsUser = ##class(Security.Users).Exists(tTarget)
        Set tIsRole = ##class(Security.Roles).Exists(tTarget)
        If 'tIsUser && 'tIsRole {
            Set tSC = $$$ERROR($$$GeneralError, "Target '"_tTarget_"' is not a known user or role")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tGrantedResources = ""
        Set tTargetType = ""
        If tIsUser {
            Set tTargetType = "user"
            Set tSC = ##class(Security.Users).Get(tTarget, .tUserProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tUserRoles = \$Get(tUserProps("Roles"))
            For tI = 1:1:\$Length(tUserRoles, ",") {
                Set tRoleName = \$Piece(tUserRoles, ",", tI)
                If tRoleName = "" Continue
                Set tRoleSC = ##class(Security.Roles).Get(tRoleName, .tRoleProps)
                If $$$ISOK(tRoleSC) {
                    Set tRoleRes = \$Get(tRoleProps("Resources"))
                    If tRoleRes '= "" {
                        If tGrantedResources '= "" Set tGrantedResources = tGrantedResources _ ","
                        Set tGrantedResources = tGrantedResources _ tRoleRes
                    }
                }
            }
        }
        Else {
            Set tTargetType = "role"
            Set tSC = ##class(Security.Roles).Get(tTarget, .tRoleProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tGrantedResources = \$Get(tRoleProps("Resources"))
        }
        Set tHasPermission = 0
        Set tFoundResource = 0
        Set tGrantedPermission = ""
        For tI = 1:1:\$Length(tGrantedResources, ",") {
            Set tPair = \$Piece(tGrantedResources, ",", tI)
            Set tResName = \$Piece(tPair, ":", 1)
            Set tResPerm = \$Piece(tPair, ":", 2)
            If tResName = tResource {
                Set tFoundResource = 1
                Set tGrantedPermission = tResPerm
                Set tHasPermission = 1
                For tJ = 1:1:\$Length(tPermission) {
                    Set tChar = \$Extract(tPermission, tJ)
                    If tResPerm '[ tChar {
                        Set tHasPermission = 0
                        Quit
                    }
                }
                Quit
            }
        }
        Set tResult = {}
        Do tResult.%Set("target", tTarget)
        Do tResult.%Set("targetType", tTargetType)
        Do tResult.%Set("resource", tResource)
        Do tResult.%Set("permission", tPermission)
        Do tResult.%Set("granted", tHasPermission, "boolean")
        If tFoundResource Do tResult.%Set("grantedPermission", tGrantedPermission)
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all web applications, optionally filtered by namespace.
/// <p>Switches to <code>%SYS</code> and queries <class>Security.Applications</class>
/// via SQL. If a <code>namespace</code> query parameter is provided, only web
/// applications targeting that namespace are returned. Returns a JSON array
/// of web application objects.</p>
ClassMethod WebAppList() As %Status
{
    Set tSC = $$$OK
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        ; Check for optional namespace filter from query parameter
        Set tNamespaceFilter = $Get(%request.Data("namespace", 1))

        Set tResult = []

        ; Use SQL to enumerate web applications
        If tNamespaceFilter '= "" {
            Set tStatement = ##class(%SQL.Statement).%New()
            Set tSC = tStatement.%Prepare("SELECT Name, NameSpace, DispatchClass, Description, Enabled, AutheEnabled, IsNameSpaceDefault, CSPZENEnabled, Recurse, MatchRoles, Resource_, CookiePath FROM Security.Applications WHERE NameSpace = ?")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tRS = tStatement.%Execute(tNamespaceFilter)
        }
        Else {
            Set tStatement = ##class(%SQL.Statement).%New()
            Set tSC = tStatement.%Prepare("SELECT Name, NameSpace, DispatchClass, Description, Enabled, AutheEnabled, IsNameSpaceDefault, CSPZENEnabled, Recurse, MatchRoles, Resource_, CookiePath FROM Security.Applications")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tRS = tStatement.%Execute()
        }

        If tRS.%SQLCODE < 0 {
            Set tSC = $$$ERROR($$$GeneralError, "SQL error listing web applications: " _ tRS.%Message)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.%Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.%Get("Name"))
            Do tEntry.%Set("namespace", tRS.%Get("NameSpace"))
            Do tEntry.%Set("dispatchClass", tRS.%Get("DispatchClass"))
            Do tEntry.%Set("description", tRS.%Get("Description"))
            Do tEntry.%Set("enabled", +tRS.%Get("Enabled"), "boolean")
            Do tEntry.%Set("authEnabled", +tRS.%Get("AutheEnabled"), "number")
            Do tEntry.%Set("isNameSpaceDefault", +tRS.%Get("IsNameSpaceDefault"), "boolean")
            Do tEntry.%Set("cspZenEnabled", +tRS.%Get("CSPZENEnabled"), "boolean")
            Do tEntry.%Set("recurse", +tRS.%Get("Recurse"), "boolean")
            Do tEntry.%Set("matchRoles", tRS.%Get("MatchRoles"))
            Do tEntry.%Set("resource", tRS.%Get("Resource_"))
            Do tEntry.%Set("cookiePath", tRS.%Get("CookiePath"))
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

/// Get a single web application by name.
/// <p>Switches to <code>%SYS</code> and calls <method>Security.Applications.Get</method>
/// to retrieve web application properties. The <var>pName</var> parameter should
/// be URL-decoded by the dispatch framework (web app names start with <code>/</code>).</p>
ClassMethod WebAppGet(pName As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        ; Validate name parameter
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(pName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; URL-decode the name (webapp names contain '/')
        Set pName = $ZCONVERT(pName, "I", "URL")

        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        Set tSC = ##class(Security.Applications).Get(pName, .tProps)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tEntry = {}
        Do tEntry.%Set("name", $Get(tProps("Name")))
        Do tEntry.%Set("namespace", $Get(tProps("NameSpace")))
        Do tEntry.%Set("dispatchClass", $Get(tProps("DispatchClass")))
        Do tEntry.%Set("description", $Get(tProps("Description")))
        Do tEntry.%Set("enabled", +$Get(tProps("Enabled")), "boolean")
        Do tEntry.%Set("authEnabled", +$Get(tProps("AutheEnabled")), "number")
        Do tEntry.%Set("isNameSpaceDefault", +$Get(tProps("IsNameSpaceDefault")), "boolean")
        Do tEntry.%Set("cspZenEnabled", +$Get(tProps("CSPZENEnabled")), "boolean")
        Do tEntry.%Set("recurse", +$Get(tProps("Recurse")), "boolean")
        Do tEntry.%Set("matchRoles", $Get(tProps("MatchRoles")))
        Do tEntry.%Set("resource", $Get(tProps("Resource")))
        Do tEntry.%Set("cookiePath", $Get(tProps("CookiePath")))

        Do ..RenderResponseBody($$$OK, , tEntry)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a web application.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code> (web app path, e.g. "/api/myapp"), and optional properties.
/// Dispatches to <class>Security.Applications</class> in <code>%SYS</code>.</p>
/// <p><b>NOTE</b>: <method>Security.Applications.Create</method> does NOT notify
/// the CSP gateway. Newly created web apps require either saving through the
/// Management Portal or restarting the CSP gateway to become active.</p>
ClassMethod WebAppManage() As %Status
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

        ; Switch to %SYS for Security operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            If tBody.%IsDefined("namespace") Set tProps("NameSpace") = tBody.%Get("namespace")
            If tBody.%IsDefined("dispatchClass") Set tProps("DispatchClass") = tBody.%Get("dispatchClass")
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")
            If tBody.%IsDefined("authEnabled") Set tProps("AutheEnabled") = +tBody.%Get("authEnabled")
            If tBody.%IsDefined("isNameSpaceDefault") Set tProps("IsNameSpaceDefault") = +tBody.%Get("isNameSpaceDefault")
            If tBody.%IsDefined("cspZenEnabled") Set tProps("CSPZENEnabled") = +tBody.%Get("cspZenEnabled")
            If tBody.%IsDefined("recurse") Set tProps("Recurse") = +tBody.%Get("recurse")
            If tBody.%IsDefined("matchRoles") Set tProps("MatchRoles") = tBody.%Get("matchRoles")
            If tBody.%IsDefined("resource") Set tProps("Resource") = tBody.%Get("resource")
            If tBody.%IsDefined("cookiePath") Set tProps("CookiePath") = tBody.%Get("cookiePath")

            Set tSC = ##class(Security.Applications).Create(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "created")
            Do tResult.%Set("name", tName)
            Do tResult.%Set("caveat", "CSP gateway was NOT notified. Save through the Management Portal or restart the CSP gateway to activate this web application.")
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%IsDefined("namespace") Set tProps("NameSpace") = tBody.%Get("namespace")
            If tBody.%IsDefined("dispatchClass") Set tProps("DispatchClass") = tBody.%Get("dispatchClass")
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")
            If tBody.%IsDefined("authEnabled") Set tProps("AutheEnabled") = +tBody.%Get("authEnabled")
            If tBody.%IsDefined("isNameSpaceDefault") Set tProps("IsNameSpaceDefault") = +tBody.%Get("isNameSpaceDefault")
            If tBody.%IsDefined("cspZenEnabled") Set tProps("CSPZENEnabled") = +tBody.%Get("cspZenEnabled")
            If tBody.%IsDefined("recurse") Set tProps("Recurse") = +tBody.%Get("recurse")
            If tBody.%IsDefined("matchRoles") Set tProps("MatchRoles") = tBody.%Get("matchRoles")
            If tBody.%IsDefined("resource") Set tProps("Resource") = tBody.%Get("resource")
            If tBody.%IsDefined("cookiePath") Set tProps("CookiePath") = tBody.%Get("cookiePath")

            Set tSC = ##class(Security.Applications).Modify(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Applications).Delete(tName)
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

/// List all SSL/TLS configurations.
/// <p>Switches to <code>%SYS</code> and queries <class>Security.SSLConfigs</class>
/// via SQL. Returns a JSON array of SSL configuration objects with
/// <code>name</code>, <code>description</code>, <code>type</code>,
/// <code>enabled</code>, <code>certFile</code>, <code>keyFile</code>,
/// <code>caFile</code>, <code>protocols</code>, <code>verifyPeer</code>,
/// and other TLS settings.</p>
ClassMethod SSLList() As %Status
{
    Set tSC = $$$OK
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all SSL/TLS configurations
        Set tStatement = ##class(%SQL.Statement).%New()
        Set tSC = tStatement.%Prepare("SELECT Name, Description, CertificateFile, PrivateKeyFile, CAFile, CAPath, CipherList, Protocols, VerifyPeer, VerifyDepth, Type, Enabled FROM Security.SSLConfigs")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        Set tRS = tStatement.%Execute()

        If tRS.%SQLCODE < 0 {
            Set tSC = $$$ERROR($$$GeneralError, "SQL error listing SSL/TLS configurations: " _ tRS.%Message)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.%Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.%Get("Name"))
            Do tEntry.%Set("description", tRS.%Get("Description"))
            Do tEntry.%Set("certFile", tRS.%Get("CertificateFile"))
            Do tEntry.%Set("keyFile", tRS.%Get("PrivateKeyFile"))
            Do tEntry.%Set("caFile", tRS.%Get("CAFile"))
            Do tEntry.%Set("caPath", tRS.%Get("CAPath"))
            Do tEntry.%Set("cipherList", tRS.%Get("CipherList"))
            Do tEntry.%Set("protocols", +tRS.%Get("Protocols"), "number")
            Do tEntry.%Set("verifyPeer", +tRS.%Get("VerifyPeer"), "number")
            Do tEntry.%Set("verifyDepth", +tRS.%Get("VerifyDepth"), "number")
            Do tEntry.%Set("type", +tRS.%Get("Type"), "number")
            Do tEntry.%Set("enabled", +tRS.%Get("Enabled"), "boolean")
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

/// Create, modify, or delete an SSL/TLS configuration.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code> (configuration name), and optional properties such as
/// <code>certFile</code>, <code>keyFile</code>, <code>caFile</code>,
/// <code>protocols</code>, <code>verifyPeer</code>, etc.
/// Dispatches to <class>Security.SSLConfigs</class> in <code>%SYS</code>.</p>
ClassMethod SSLManage() As %Status
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

        ; Switch to %SYS for Security operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("certFile") Set tProps("CertificateFile") = tBody.%Get("certFile")
            If tBody.%IsDefined("keyFile") Set tProps("PrivateKeyFile") = tBody.%Get("keyFile")
            If tBody.%IsDefined("caFile") Set tProps("CAFile") = tBody.%Get("caFile")
            If tBody.%IsDefined("caPath") Set tProps("CAPath") = tBody.%Get("caPath")
            If tBody.%IsDefined("cipherList") Set tProps("CipherList") = tBody.%Get("cipherList")
            If tBody.%IsDefined("protocols") Set tProps("Protocols") = +tBody.%Get("protocols")
            If tBody.%IsDefined("verifyPeer") Set tProps("VerifyPeer") = +tBody.%Get("verifyPeer")
            If tBody.%IsDefined("verifyDepth") Set tProps("VerifyDepth") = +tBody.%Get("verifyDepth")
            If tBody.%IsDefined("type") Set tProps("Type") = +tBody.%Get("type")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")

            Set tSC = ##class(Security.SSLConfigs).Create(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "created")
            Do tResult.%Set("name", tName)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("certFile") Set tProps("CertificateFile") = tBody.%Get("certFile")
            If tBody.%IsDefined("keyFile") Set tProps("PrivateKeyFile") = tBody.%Get("keyFile")
            If tBody.%IsDefined("caFile") Set tProps("CAFile") = tBody.%Get("caFile")
            If tBody.%IsDefined("caPath") Set tProps("CAPath") = tBody.%Get("caPath")
            If tBody.%IsDefined("cipherList") Set tProps("CipherList") = tBody.%Get("cipherList")
            If tBody.%IsDefined("protocols") Set tProps("Protocols") = +tBody.%Get("protocols")
            If tBody.%IsDefined("verifyPeer") Set tProps("VerifyPeer") = +tBody.%Get("verifyPeer")
            If tBody.%IsDefined("verifyDepth") Set tProps("VerifyDepth") = +tBody.%Get("verifyDepth")
            If tBody.%IsDefined("type") Set tProps("Type") = +tBody.%Get("type")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")

            Set tSC = ##class(Security.SSLConfigs).Modify(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.SSLConfigs).Delete(tName)
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

}`,
  ],
  [
    "ExecuteMCPv2.REST.Dispatch.cls",
    `/// Main REST dispatch class for the ExecuteMCPv2 custom REST service.
/// <p>Extends <class>%Atelier.REST</class> to inherit the three-part response envelope
/// (<code>{status, console, result}</code>), <method>StatusToJSON</method> error formatting,
/// and ETag/caching support.</p>
/// <p>The URL prefix for this application is <code>/api/executemcp/v2/</code>.
/// Routes are defined in the <xdata>UrlMap</xdata> XData block below.</p>
Class ExecuteMCPv2.REST.Dispatch Extends %Atelier.REST
{

/// URL routing map for ExecuteMCPv2 REST endpoints.
/// <p>
/// <b>Epic 3 routes</b> (command execution, unit tests, globals):
/// </p>
/// <p>
/// Future epics will add routes here:
/// <ul>
///   <li>Epic 4: <code>/config/:entity</code> - Configuration handler</li>
///   <li>Epic 5: <code>/production/:action</code> - Interoperability handler</li>
///   <li>Epic 6: <code>/system/:metric</code> - Ops handler</li>
///   <li>Epic 7: <code>/data/:action</code> - Data and analytics handler</li>
/// </ul>
/// </p>
XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes>
  <!-- Epic 3: Command Execution -->
  <Route Url="/command" Method="POST" Call="ExecuteMCPv2.REST.Command:Execute" />
  <Route Url="/classmethod" Method="POST" Call="ExecuteMCPv2.REST.Command:ClassMethod" />

  <!-- Epic 3: Unit Test Execution -->
  <Route Url="/tests" Method="POST" Call="ExecuteMCPv2.REST.UnitTest:RunTests" />

  <!-- Epic 3: Global Operations -->
  <Route Url="/global" Method="GET" Call="ExecuteMCPv2.REST.Global:GetGlobal" />
  <Route Url="/global" Method="PUT" Call="ExecuteMCPv2.REST.Global:SetGlobal" />
  <Route Url="/global" Method="DELETE" Call="ExecuteMCPv2.REST.Global:KillGlobal" />
  <Route Url="/global/list" Method="GET" Call="ExecuteMCPv2.REST.Global:ListGlobals" />

  <!-- Epic 4: Configuration Management -->
  <Route Url="/config/namespace" Method="GET" Call="ExecuteMCPv2.REST.Config:NamespaceList" />
  <Route Url="/config/namespace" Method="POST" Call="ExecuteMCPv2.REST.Config:NamespaceManage" />
  <Route Url="/config/database" Method="GET" Call="ExecuteMCPv2.REST.Config:DatabaseList" />
  <Route Url="/config/database" Method="POST" Call="ExecuteMCPv2.REST.Config:DatabaseManage" />
  <Route Url="/config/mapping/:type" Method="GET" Call="ExecuteMCPv2.REST.Config:MappingList" />
  <Route Url="/config/mapping/:type" Method="POST" Call="ExecuteMCPv2.REST.Config:MappingManage" />

  <!-- Epic 4: Security / User Management -->
  <Route Url="/security/user" Method="GET" Call="ExecuteMCPv2.REST.Security:UserList" />
  <Route Url="/security/user" Method="POST" Call="ExecuteMCPv2.REST.Security:UserManage" />
  <Route Url="/security/user/:name" Method="GET" Call="ExecuteMCPv2.REST.Security:UserGet" />
  <Route Url="/security/user/roles" Method="POST" Call="ExecuteMCPv2.REST.Security:UserRoles" />
  <Route Url="/security/user/password" Method="POST" Call="ExecuteMCPv2.REST.Security:UserPassword" />

  <!-- Epic 4: Security / Role Management -->
  <Route Url="/security/role" Method="GET" Call="ExecuteMCPv2.REST.Security:RoleList" />
  <Route Url="/security/role" Method="POST" Call="ExecuteMCPv2.REST.Security:RoleManage" />

  <!-- Epic 4: Security / Resource Management -->
  <Route Url="/security/resource" Method="GET" Call="ExecuteMCPv2.REST.Security:ResourceList" />
  <Route Url="/security/resource" Method="POST" Call="ExecuteMCPv2.REST.Security:ResourceManage" />

  <!-- Epic 4: Security / Permission Check -->
  <Route Url="/security/permission" Method="POST" Call="ExecuteMCPv2.REST.Security:PermissionCheck" />

  <!-- Epic 4: Security / Web Application Management -->
  <Route Url="/security/webapp" Method="GET" Call="ExecuteMCPv2.REST.Security:WebAppList" />
  <Route Url="/security/webapp" Method="POST" Call="ExecuteMCPv2.REST.Security:WebAppManage" />
  <Route Url="/security/webapp/:name" Method="GET" Call="ExecuteMCPv2.REST.Security:WebAppGet" />

  <!-- Epic 4: Security / SSL/TLS Configuration Management -->
  <Route Url="/security/ssl" Method="GET" Call="ExecuteMCPv2.REST.Security:SSLList" />
  <Route Url="/security/ssl" Method="POST" Call="ExecuteMCPv2.REST.Security:SSLManage" />

  <!-- Future Epic 5: Interoperability Management -->
  <!-- <Route Url="/production/:action" Method="POST" Call="ExecuteMCPv2.REST.Production:Execute" /> -->

  <!-- Future Epic 6: Operations and Monitoring -->
  <!-- <Route Url="/system/:metric" Method="GET" Call="ExecuteMCPv2.REST.Ops:GetMetric" /> -->

  <!-- Future Epic 7: Data and Analytics -->
  <!-- <Route Url="/data/:action" Method="POST" Call="ExecuteMCPv2.REST.Data:Execute" /> -->
</Routes>
}

}`,
  ],
  [
    "ExecuteMCPv2.REST.Command.cls",
    `/// REST handler for ObjectScript command and class method execution.
/// <p>Provides two endpoints for executing ObjectScript code on IRIS:
/// <ul>
///   <li><b>POST /command</b> — Execute an arbitrary ObjectScript command with I/O capture</li>
///   <li><b>POST /classmethod</b> — Invoke a class method by name with positional arguments</li>
/// </ul>
/// Both methods follow the namespace switch/restore pattern from
/// <class>ExecuteMCPv2.REST.Global</class> and use shared utilities
/// from <class>ExecuteMCPv2.Utils</class>.</p>
Class ExecuteMCPv2.REST.Command Extends %Atelier.REST
{

/// Execute an ObjectScript command with captured I/O output.
/// <p>Reads a JSON body with <code>command</code> and optional <code>namespace</code>.
/// Uses <code>##class(%Device).ReDirectIO(1)</code> with label-based tag methods
/// to capture all Write output from the executed command. The captured output
/// is returned in the response body.</p>
ClassMethod Execute() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Set tRedirected = 0
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Extract parameters
        Set tCommand = ""
        Set tNamespace = ""
        If $IsObject(tBody) {
            Set tCommand = tBody.%Get("command")
            Set tNamespace = tBody.%Get("namespace")
        }

        ; Validate required command
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tCommand, "command")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }

        ; Set up I/O redirect to capture Write output
        Set %ExecuteMCPOutput = ""
        Set tInitIO = $IO
        Set tWasRedirected = ##class(%Library.Device).ReDirectIO()
        Set tOldMnemonic = ##class(%Library.Device).GetMnemonicRoutine()
        Use tInitIO::("^"_$ZNAME)
        Set tRedirected = 1
        Do ##class(%Library.Device).ReDirectIO(1)

        ; Execute the command
        Try {
            XECUTE tCommand
        } Catch exCmd {
            ; Restore I/O before handling error
            Use tInitIO::($Select(tOldMnemonic=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
            If tWasRedirected '= tRedirected Do ##class(%Library.Device).ReDirectIO(tWasRedirected)
            Set tRedirected = 0

            Set tSC = exCmd.AsStatus()
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Quit
        }

        ; Restore I/O
        Use tInitIO::($Select(tOldMnemonic=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
        If tWasRedirected '= tRedirected Do ##class(%Library.Device).ReDirectIO(tWasRedirected)
        Set tRedirected = 0

        ; Build result
        Set tOutput = $Get(%ExecuteMCPOutput, "")
        Kill %ExecuteMCPOutput
        Set tResult = {}
        Do tResult.%Set("output", tOutput)
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        ; Ensure redirection is restored on unexpected error
        Try {
            If tRedirected {
                If $Get(tInitIO) '= "" {
                    Use tInitIO::($Select($Get(tOldMnemonic)=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
                }
                Do ##class(%Library.Device).ReDirectIO(0)
            }
        } Catch {}
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    ; Always restore namespace
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}

/// Execute a class method by name with positional arguments.
/// <p>Reads a JSON body with <code>className</code>, <code>methodName</code>,
/// optional <code>args</code> (JSON array of positional parameters), and
/// optional <code>namespace</code>. Uses <code>$ClassMethod()</code> for
/// dynamic invocation, supporting up to 10 arguments.</p>
ClassMethod ClassMethod() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Extract parameters
        Set tClassName = ""
        Set tMethodName = ""
        Set tNamespace = ""
        Set tArgs = ""
        If $IsObject(tBody) {
            Set tClassName = tBody.%Get("className")
            Set tMethodName = tBody.%Get("methodName")
            Set tNamespace = tBody.%Get("namespace")
            Set tArgs = tBody.%Get("args")
        }

        ; Validate required fields
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tClassName, "className")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tMethodName, "methodName")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }

        ; Determine argument count
        Set tArgCount = 0
        If $IsObject(tArgs) Set tArgCount = tArgs.%Size()

        ; Call $ClassMethod with the appropriate number of arguments (up to 10)
        If tArgCount = 0 {
            Set tReturn = $ClassMethod(tClassName, tMethodName)
        } ElseIf tArgCount = 1 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0))
        } ElseIf tArgCount = 2 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1))
        } ElseIf tArgCount = 3 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1), tArgs.%Get(2))
        } ElseIf tArgCount = 4 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1), tArgs.%Get(2), tArgs.%Get(3))
        } ElseIf tArgCount = 5 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1), tArgs.%Get(2), tArgs.%Get(3), tArgs.%Get(4))
        } ElseIf tArgCount = 6 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1), tArgs.%Get(2), tArgs.%Get(3), tArgs.%Get(4), tArgs.%Get(5))
        } ElseIf tArgCount = 7 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1), tArgs.%Get(2), tArgs.%Get(3), tArgs.%Get(4), tArgs.%Get(5), tArgs.%Get(6))
        } ElseIf tArgCount = 8 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1), tArgs.%Get(2), tArgs.%Get(3), tArgs.%Get(4), tArgs.%Get(5), tArgs.%Get(6), tArgs.%Get(7))
        } ElseIf tArgCount = 9 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1), tArgs.%Get(2), tArgs.%Get(3), tArgs.%Get(4), tArgs.%Get(5), tArgs.%Get(6), tArgs.%Get(7), tArgs.%Get(8))
        } ElseIf tArgCount = 10 {
            Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1), tArgs.%Get(2), tArgs.%Get(3), tArgs.%Get(4), tArgs.%Get(5), tArgs.%Get(6), tArgs.%Get(7), tArgs.%Get(8), tArgs.%Get(9))
        } Else {
            Set tSC = $$$ERROR($$$GeneralError, "Too many arguments: maximum is 10, received " _ tArgCount)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Quit
        }

        ; Build result — convert return value to string for JSON transport
        ; Guard against OREF return values that cannot be serialized to JSON
        If $IsObject(tReturn) {
            Set tReturnStr = "<Object:"_$ClassName(tReturn)_">"
        } Else {
            Set tReturnStr = tReturn
        }
        Set tResult = {}
        Do tResult.%Set("returnValue", tReturnStr)
        Do tResult.%Set("argCount", tArgCount, "number")
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    ; Always restore namespace
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}

/// I/O redirect entry points for output capture.
/// <p>These label-based methods are referenced by the mnemonic routine
/// set via <code>Use tInitIO::("^"_$ZNAME)</code> when I/O redirection is active.
/// All captured output is accumulated in the process-private variable
/// <code>%ExecuteMCPOutput</code>.</p>
ClassMethod Redirects() [ Internal, Private, ProcedureBlock = 0 ]
{
    Quit
wstr(s) Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ s Quit
wchr(a) Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(a) Quit
wnl Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(10) Quit
wff Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(12) Quit
wtab(n) New chars Set $Piece(chars, " ", n+1) = "" Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ chars Quit
rstr(len,time) Quit ""
rchr(time) Quit ""
}

}`,
  ],
  [
    "ExecuteMCPv2.REST.UnitTest.cls",
    `/// REST handler for unit test execution.
/// <p>Provides a single endpoint for running ObjectScript unit tests via
/// <code>POST /api/executemcp/v2/tests</code>. Supports three granularity levels:
/// <ul>
///   <li><b>package</b> — Run all test classes in a package</li>
///   <li><b>class</b> — Run a specific test class</li>
///   <li><b>method</b> — Run a specific test class (method filtering applied to results)</li>
/// </ul>
/// Uses the <code>/noload/nodelete</code> qualifiers since test classes are
/// pre-compiled via MCP tools, not loaded from the filesystem.</p>
Class ExecuteMCPv2.REST.UnitTest Extends %Atelier.REST
{

/// Run unit tests for a given target at the specified level.
/// <p>Reads a JSON body with <code>target</code> (required), <code>level</code>
/// (<code>package|class|method</code>), and optional <code>namespace</code>.
/// Ensures the test environment is configured, executes the tests via
/// <class>%UnitTest.Manager</class>, parses results from SQL tables, and
/// returns structured JSON.</p>
ClassMethod RunTests() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Extract parameters
        Set tTarget = ""
        Set tLevel = "package"
        Set tNamespace = ""
        If $IsObject(tBody) {
            Set tTarget = tBody.%Get("target")
            If tBody.%Get("level") '= "" Set tLevel = tBody.%Get("level")
            Set tNamespace = tBody.%Get("namespace")
        }

        ; Validate required target
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTarget, "target")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Validate level
        If (tLevel '= "package") && (tLevel '= "class") && (tLevel '= "method") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'level' must be one of: package, class, method")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Quit
        }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }

        ; Ensure test environment (^UnitTestRoot guard)
        Set tSC = ..EnsureTestEnvironment()
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Build testspec based on level
        Set tTestSpec = ..BuildTestSpec(tTarget, tLevel)

        ; Determine method filter for "method" level
        Set tMethodFilter = ""
        If tLevel = "method" {
            ; target format: "Package.ClassName:MethodName"
            If tTarget [ ":" {
                Set tMethodFilter = $Piece(tTarget, ":", 2)
            }
        }

        ; Run tests with /noload/nodelete qualifiers
        Set tSC = ##class(%UnitTest.Manager).RunTest(tTestSpec, "/noload/nodelete")

        ; Parse results regardless of RunTest status (tests may have failed but ran)
        Set tResult = ..ParseTestResults(tMethodFilter)

        ; RunTest returns error status when tests fail - but that is not a handler error.
        ; We always return the parsed results. isError is only for handler-level failures.
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    ; Always restore namespace
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}

/// Ensure <code>^UnitTestRoot</code> is set before running tests.
/// <p>If the global is not defined, sets it to empty string to indicate
/// tests are pre-compiled in memory. Preserves existing values.</p>
ClassMethod EnsureTestEnvironment() As %Status
{
    Set tSC = $$$OK
    Try {
        If '$Data(^UnitTestRoot) {
            Set ^UnitTestRoot = ""
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Build the testspec string for <method>%UnitTest.Manager.RunTest</method>.
/// <p>Converts the target and level into the appropriate testspec format
/// for <code>/noload</code> mode.</p>
ClassMethod BuildTestSpec(pTarget As %String, pLevel As %String) As %String
{
    If pLevel = "package" {
        ; For package mode with /noload, use the package name as the testspec
        Quit pTarget
    }
    If pLevel = "class" {
        ; For class mode with /noload, use the class name as testspec
        Quit pTarget
    }
    If pLevel = "method" {
        ; For method mode, extract class name and run the whole class
        ; Method filtering is done on the results
        If pTarget [ ":" {
            Quit $Piece(pTarget, ":", 1)
        }
        Quit pTarget
    }
    Quit pTarget
}

/// Parse test results from the <code>%UnitTest_Result</code> SQL tables.
/// <p>Queries the most recent test instance and builds a structured
/// <class>%DynamicObject</class> with totals and per-method details.</p>
ClassMethod ParseTestResults(pMethodFilter As %String = "") As %DynamicObject
{
    Set tResult = {}
    Set tDetails = []
    Set tTotal = 0
    Set tPassed = 0
    Set tFailed = 0
    Set tSkipped = 0
    Set tDuration = 0

    Try {
        ; Get the most recent test instance ID
        Set tInstanceId = ""
        Set tStmt = ##class(%SQL.Statement).%New()
        Set tSC = tStmt.%Prepare("SELECT TOP 1 ID, Duration FROM %UnitTest_Result.TestInstance ORDER BY ID DESC")
        If $$$ISERR(tSC) {
            Do tResult.%Set("total", 0, "number")
            Do tResult.%Set("passed", 0, "number")
            Do tResult.%Set("failed", 0, "number")
            Do tResult.%Set("skipped", 0, "number")
            Do tResult.%Set("duration", 0, "number")
            Do tResult.%Set("details", tDetails)
            Do tResult.%Set("error", "Failed to prepare SQL query for test results")
            Quit
        }
        Set tRS = tStmt.%Execute()
        If tRS.%Next() {
            Set tInstanceId = tRS.%Get("ID")
            Set tDuration = +tRS.%Get("Duration")
        }

        If tInstanceId = "" {
            Do tResult.%Set("total", 0, "number")
            Do tResult.%Set("passed", 0, "number")
            Do tResult.%Set("failed", 0, "number")
            Do tResult.%Set("skipped", 0, "number")
            Do tResult.%Set("duration", 0, "number")
            Do tResult.%Set("details", tDetails)
            Quit
        }

        ; Query test methods for this instance
        Set tSQL = "SELECT tm.Name AS MethodName, tm.Status AS MethodStatus, tm.Duration AS MethodDuration, "_
                   "tc.Name AS ClassName "_
                   "FROM %UnitTest_Result.TestMethod tm "_
                   "JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID "_
                   "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID "_
                   "WHERE ts.TestInstance = ? "_
                   "ORDER BY tc.Name, tm.Name"
        Set tStmt2 = ##class(%SQL.Statement).%New()
        Set tSC = tStmt2.%Prepare(tSQL)
        If $$$ISERR(tSC) {
            Do tResult.%Set("total", 0, "number")
            Do tResult.%Set("passed", 0, "number")
            Do tResult.%Set("failed", 0, "number")
            Do tResult.%Set("skipped", 0, "number")
            Do tResult.%Set("duration", tDuration, "number")
            Do tResult.%Set("details", tDetails)
            Do tResult.%Set("error", "Failed to prepare SQL query for test methods")
            Quit
        }
        Set tRS2 = tStmt2.%Execute(tInstanceId)

        While tRS2.%Next() {
            Set tMethodName = tRS2.%Get("MethodName")
            Set tClassName = tRS2.%Get("ClassName")
            Set tStatus = tRS2.%Get("MethodStatus")
            Set tMethodDur = +tRS2.%Get("MethodDuration")

            ; Apply method filter if specified
            If (pMethodFilter '= "") && (tMethodName '= pMethodFilter) {
                Continue
            }

            Set tDetail = {}
            Do tDetail.%Set("class", tClassName)
            Do tDetail.%Set("method", tMethodName)
            Do tDetail.%Set("duration", tMethodDur, "number")

            ; Map status: 1 = passed, 0 = failed
            If tStatus = 1 {
                Do tDetail.%Set("status", "passed")
                Do tDetail.%Set("message", "")
                Set tPassed = tPassed + 1
            } Else {
                Do tDetail.%Set("status", "failed")
                ; Get failure message from assertions
                Set tMsg = ..GetFailureMessage(tInstanceId, tClassName, tMethodName)
                Do tDetail.%Set("message", tMsg)
                Set tFailed = tFailed + 1
            }

            Do tDetails.%Push(tDetail)
            Set tTotal = tTotal + 1
        }
    } Catch ex {
        ; On any error, return what we have so far
        Do tResult.%Set("error", "Error parsing test results: " _ ex.DisplayString())
    }

    Do tResult.%Set("total", tTotal, "number")
    Do tResult.%Set("passed", tPassed, "number")
    Do tResult.%Set("failed", tFailed, "number")
    Do tResult.%Set("skipped", tSkipped, "number")
    Do tResult.%Set("duration", tDuration, "number")
    Do tResult.%Set("details", tDetails)
    Quit tResult
}

/// Get failure messages for a specific test method from assertion results.
ClassMethod GetFailureMessage(pInstanceId As %String, pClassName As %String, pMethodName As %String) As %String [ Private ]
{
    Set tMsg = ""
    Try {
        Set tSQL = "SELECT ta.Description, ta.Status "_
                   "FROM %UnitTest_Result.TestAssert ta "_
                   "JOIN %UnitTest_Result.TestMethod tm ON ta.TestMethod = tm.ID "_
                   "JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID "_
                   "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID "_
                   "WHERE ts.TestInstance = ? AND tc.Name = ? AND tm.Name = ? AND ta.Status = 0 "_
                   "ORDER BY ta.ID"
        Set tStmt = ##class(%SQL.Statement).%New()
        Set tSC = tStmt.%Prepare(tSQL)
        If $$$ISOK(tSC) {
            Set tRS = tStmt.%Execute(pInstanceId, pClassName, pMethodName)
            While tRS.%Next() {
                Set tDesc = tRS.%Get("Description")
                If tMsg '= "" Set tMsg = tMsg _ "; "
                Set tMsg = tMsg _ tDesc
            }
        }
    } Catch ex {
        Set tMsg = "Error retrieving failure details"
    }
    Quit tMsg
}

}`,
  ],
  [
    "ExecuteMCPv2.REST.Global.cls",
    `/// REST handler for global operations (get, set, kill, list).
/// <p>Provides CRUD operations on IRIS globals via the custom REST
/// endpoint <code>/api/executemcp/v2/global</code>. Each method follows
/// the namespace switch/restore pattern and uses shared validation
/// utilities from <class>ExecuteMCPv2.Utils</class>.</p>
Class ExecuteMCPv2.REST.Global Extends %Atelier.REST
{

/// Get the value of a global node.
/// <p>Reads query parameters <code>global</code>, <code>subscripts</code>,
/// and <code>namespace</code> from <code>%request</code>.
/// Returns the value at the specified node along with a <code>defined</code>
/// flag indicating whether the node exists.</p>
ClassMethod GetGlobal() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Try {
        ; Read query parameters
        Set tGlobal = $Get(%request.Data("global", 1))
        Set tSubscripts = $Get(%request.Data("subscripts", 1))
        Set tNamespace = $Get(%request.Data("namespace", 1))

        ; Validate required inputs
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tGlobal, "global")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Validate global name format (alphanumeric, may start with %)
        Set tSC = ..ValidateGlobalName(tGlobal)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }

        ; Build global reference and get value
        Set tRef = ..BuildGlobalRef(tGlobal, tSubscripts)
        Set tValue = $Get(@tRef)
        Set tDefined = $Data(@tRef)

        ; Return result
        Set tResult = {}
        Do tResult.%Set("value", tValue)
        Do tResult.%Set("defined", (tDefined > 0), "boolean")
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    ; Always restore namespace
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}

/// Set the value of a global node.
/// <p>Reads a JSON body with <code>global</code>, <code>subscripts</code>,
/// <code>value</code>, and <code>namespace</code> fields. After setting the value,
/// verifies the write with <code>$Get</code> and returns the verified value.</p>
ClassMethod SetGlobal() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Quit
        }

        Set tGlobal = tBody.%Get("global")
        Set tSubscripts = tBody.%Get("subscripts")
        Set tValue = tBody.%Get("value")
        Set tNamespace = tBody.%Get("namespace")

        ; Validate required inputs
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tGlobal, "global")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Validate global name format
        Set tSC = ..ValidateGlobalName(tGlobal)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }

        ; Build global reference and set value
        Set tRef = ..BuildGlobalRef(tGlobal, tSubscripts)
        Set @tRef = tValue

        ; Verify the write
        Set tVerified = $Get(@tRef)

        ; Return result with verification
        Set tResult = {}
        Do tResult.%Set("value", tVerified)
        Do tResult.%Set("verified", (tVerified = tValue), "boolean")
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    ; Always restore namespace
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}

/// Kill (delete) a global node or subtree.
/// <p>Reads query parameters <code>global</code>, <code>subscripts</code>,
/// and <code>namespace</code>. Kills the specified node and returns confirmation.</p>
ClassMethod KillGlobal() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Try {
        ; Read query parameters
        Set tGlobal = $Get(%request.Data("global", 1))
        Set tSubscripts = $Get(%request.Data("subscripts", 1))
        Set tNamespace = $Get(%request.Data("namespace", 1))

        ; Validate required inputs
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tGlobal, "global")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Validate global name format
        Set tSC = ..ValidateGlobalName(tGlobal)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }

        ; Build global reference and kill
        Set tRef = ..BuildGlobalRef(tGlobal, tSubscripts)
        Kill @tRef

        ; Return confirmation
        Set tResult = {}
        Do tResult.%Set("deleted", 1, "boolean")
        Do tResult.%Set("global", tGlobal)
        If tSubscripts '= "" Do tResult.%Set("subscripts", tSubscripts)
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    ; Always restore namespace
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}

/// List globals matching an optional filter pattern.
/// <p>Iterates over <code>^$GLOBAL</code> in the target namespace
/// and returns an array of global names. If <code>filter</code> is specified,
/// only globals containing the filter substring are included.</p>
ClassMethod ListGlobals() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Try {
        ; Read query parameters
        Set tNamespace = $Get(%request.Data("namespace", 1))
        Set tFilter = $Get(%request.Data("filter", 1))

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }

        ; Iterate through globals
        Set tList = []
        Set tGlobal = ""
        For {
            Set tGlobal = $Order(^$GLOBAL(tGlobal))
            Quit:tGlobal=""
            ; Apply filter if specified
            If (tFilter '= "") && (tGlobal '[ tFilter) Continue
            Do tList.%Push(tGlobal)
        }

        ; Return result
        Set tResult = {}
        Do tResult.%Set("globals", tList)
        Do tResult.%Set("count", tList.%Size(), "number")
        If tFilter '= "" Do tResult.%Set("filter", tFilter)
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    ; Always restore namespace
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}

/// Build a global reference string from a name and comma-separated subscripts.
/// <p>Returns a string suitable for use with the <code>@</code> indirection operator.
/// Subscripts are parsed from a comma-separated string. Numeric subscripts are
/// left unquoted; string subscripts are quoted.</p>
ClassMethod BuildGlobalRef(pGlobal As %String, pSubscripts As %String = "") As %String [ Private ]
{
    ; Start with the caret-prefixed global name
    Set tRef = "^" _ pGlobal

    ; If no subscripts, return the bare global reference
    If pSubscripts = "" Quit tRef

    ; Parse comma-separated subscripts
    Set tSubList = ""
    Set tLen = $Length(pSubscripts, ",")
    For i = 1:1:tLen {
        Set tSub = $ZStrip($Piece(pSubscripts, ",", i), "<>W")
        If tSub = "" Continue
        ; Check if subscript is numeric (integer or decimal, optionally negative)
        If (tSub = (+tSub)) {
            ; Numeric subscript — use as-is
            Set $Piece(tSubList, ",", i) = tSub
        } Else {
            ; Strip surrounding quotes if present
            If ($Extract(tSub, 1) = """") && ($Extract(tSub, *) = """") {
                Set tSub = $Extract(tSub, 2, *-1)
            }
            ; String subscript — quote it
            Set $Piece(tSubList, ",", i) = """"_tSub_""""
        }
    }

    Set tRef = tRef _ "(" _ tSubList _ ")"
    Quit tRef
}

/// Public wrapper for <method>BuildGlobalRef</method> to support unit testing.
/// <p>Not intended for external use — only exposes the private method for
/// <class>ExecuteMCPv2.Tests.GlobalTest</class>.</p>
ClassMethod BuildGlobalRefPublic(pGlobal As %String, pSubscripts As %String = "") As %String
{
    Quit ..BuildGlobalRef(pGlobal, pSubscripts)
}

/// Public wrapper for <method>ValidateGlobalName</method> to support unit testing.
ClassMethod ValidateGlobalNamePublic(pGlobal As %String) As %Status
{
    Quit ..ValidateGlobalName(pGlobal)
}

/// Validate that a global name follows a safe pattern.
/// <p>Ensures the name is alphanumeric (with optional leading <code>%</code>)
/// and does not contain injection patterns.</p>
ClassMethod ValidateGlobalName(pGlobal As %String) As %Status [ Private ]
{
    ; Allow optional leading %, then one alpha followed by alphanumeric chars
    If pGlobal '? .1"%"1A.AN {
        Quit $$$ERROR($$$GeneralError, "Invalid global name '"_pGlobal_"': must be alphanumeric (optional leading %)")
    }
    Quit $$$OK
}

}`,
  ],
]);
