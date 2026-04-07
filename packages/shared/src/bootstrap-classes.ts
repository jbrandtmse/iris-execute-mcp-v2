/**
 * Embedded ObjectScript class content for the ExecuteMCPv2 REST service.
 *
 * Contains all 9 production classes as string literals, keyed by their
 * document name (e.g. "ExecuteMCPv2.Utils.cls"). These are deployed to
 * IRIS via the Atelier PUT /doc endpoint during bootstrap.
 *
 * This file is auto-generated from the src/ExecuteMCPv2/ directory.
 * Do not edit the class content manually.
 */

export interface BootstrapClass {
  name: string;
  content: string;
}

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
        ; In %CSP.REST context, the POST body is available via %request.Content
        ; which is a MultiDimensional property in %CSP.Request.
        ; Use GetMimeData to safely access the body stream.
        Set tStream = %request.GetMimeData("BODY")
        If '$IsObject(tStream) {
            ; Fallback: try reading Content directly using $Get with subscript
            ; to avoid MultiDimensional property access error
            Try {
                Set tStream = %request.Content
            } Catch {
                Set tStream = ""
            }
        }
        If '$IsObject($Get(tStream)) Quit
        Do tStream.Rewind()
        If 'tStream.Size Quit
        Set pBody = ##class(%DynamicObject).%FromJSON(tStream)
    } Catch ex {
        Set tSC = $$$ERROR($$$GeneralError, "Invalid JSON in request body: "_ex.DisplayString())
    }
    Quit tSC
}

}`,
  ],
  [
    "ExecuteMCPv2.Setup.cls",
    `/// Setup and configuration class for the ExecuteMCPv2 REST service.
/// <p>Provides methods to register and unregister the <code>/api/executemcp/v2</code>
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

/// Register the <code>/api/executemcp/v2</code> web application.
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

/// Remove the <code>/api/executemcp/v2</code> web application.
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

/// Map the <code>ExecuteMCPv2</code> package to the <code>%All</code> namespace.
/// <p>This makes ExecuteMCPv2 classes (including compiled routines used for
/// I/O redirect mnemonic labels) available in every namespace. Without this
/// mapping, cross-namespace <code>iris.execute.command</code> fails with
/// <code>&lt;NOROUTINE&gt;</code> because the mnemonic labels are resolved in
/// the current namespace at call time.</p>
/// <p>The mapping points to the database where ExecuteMCPv2 classes are
/// compiled (determined by the routines database of <code>pNamespace</code>).</p>
/// @param pNamespace The namespace where ExecuteMCPv2 is installed (e.g., HSCUSTOM).
ClassMethod ConfigureMapping(pNamespace As %String = "") As %Status [ SqlProc ]
{
    Set tSC = $$$OK
    Try {
        If pNamespace = "" Set pNamespace = $NAMESPACE

        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        ; Get the routines database for the source namespace
        Set tSC = ##class(Config.Namespaces).Get(pNamespace, .tNSProps)
        If $$$ISERR(tSC) Quit
        Set tDatabase = tNSProps("Routines")

        ; Check if mapping already exists
        If ##class(Config.MapPackages).Exists("%ALL", "ExecuteMCPv2") {
            Quit  ; Already mapped
        }

        ; %ALL is a virtual namespace that must exist before creating mappings.
        ; Create it if it doesn't exist yet (uses same databases as %SYS).
        If '##class(Config.Namespaces).Exists("%ALL") {
            Kill tALLProps
            Set tALLProps("Globals") = "%DEFAULTDB"
            Set tALLProps("Routines") = "%DEFAULTDB"
            Set tALLProps("Library") = "IRISLIB"
            Set tALLProps("TempGlobals") = "IRISTEMP"
            Set tSC = ##class(Config.Namespaces).Create("%ALL", .tALLProps)
            If $$$ISERR(tSC) Quit
        }

        ; Now create the package mapping: ExecuteMCPv2 -> source database in %ALL
        Kill tMapProps
        Set tMapProps("Database") = tDatabase
        Set tSC = ##class(Config.MapPackages).Create("%ALL", "ExecuteMCPv2", .tMapProps)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Check whether the <code>/api/executemcp/v2</code> web application exists.
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
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read query parameters
        Set tGlobal = $Get(%request.Data("global", 1))
        Set tSubscripts = $Get(%request.Data("subscripts", 1))
        Set tNamespace = $Get(%request.Data("namespace", 1))

        ; Validate required inputs
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tGlobal, "global")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate global name format (alphanumeric, may start with %)
        Set tSC = ..ValidateGlobalName(tGlobal)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Build global reference and get value
        Set tRef = ..BuildGlobalRef(tGlobal, tSubscripts)
        Set tValue = $Get(@tRef)
        Set tDefined = $Data(@tRef)

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        ; Return result
        Set tResult = {}
        Do tResult.%Set("value", tValue)
        Do tResult.%Set("defined", (tDefined > 0), "boolean")
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit tSC
}

/// Set the value of a global node.
/// <p>Reads a JSON body with <code>global</code>, <code>subscripts</code>,
/// <code>value</code>, and <code>namespace</code> fields. After setting the value,
/// verifies the write with <code>$Get</code> and returns the verified value.</p>
ClassMethod SetGlobal() As %Status
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

        Set tGlobal = tBody.%Get("global")
        Set tSubscripts = tBody.%Get("subscripts")
        Set tValue = tBody.%Get("value")
        Set tNamespace = tBody.%Get("namespace")

        ; Validate required inputs
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tGlobal, "global")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate global name format
        Set tSC = ..ValidateGlobalName(tGlobal)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Build global reference and set value
        Set tRef = ..BuildGlobalRef(tGlobal, tSubscripts)
        Set @tRef = tValue

        ; Verify the write
        Set tVerified = $Get(@tRef)

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        ; Return result with verification
        Set tResult = {}
        Do tResult.%Set("value", tVerified)
        Do tResult.%Set("verified", (tVerified = tValue), "boolean")
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit tSC
}

/// Kill (delete) a global node or subtree.
/// <p>Reads query parameters <code>global</code>, <code>subscripts</code>,
/// and <code>namespace</code>. Kills the specified node and returns confirmation.</p>
ClassMethod KillGlobal() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read query parameters
        Set tGlobal = $Get(%request.Data("global", 1))
        Set tSubscripts = $Get(%request.Data("subscripts", 1))
        Set tNamespace = $Get(%request.Data("namespace", 1))

        ; Validate required inputs
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tGlobal, "global")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate global name format
        Set tSC = ..ValidateGlobalName(tGlobal)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Build global reference and kill
        Set tRef = ..BuildGlobalRef(tGlobal, tSubscripts)
        Kill @tRef

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        ; Return confirmation
        Set tResult = {}
        Do tResult.%Set("deleted", 1, "boolean")
        Do tResult.%Set("global", tGlobal)
        If tSubscripts '= "" Do tResult.%Set("subscripts", tSubscripts)
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit tSC
}

/// List globals matching an optional filter pattern.
/// <p>Iterates over <code>^$GLOBAL</code> in the target namespace
/// and returns an array of global names. If <code>filter</code> is specified,
/// only globals containing the filter substring are included.</p>
ClassMethod ListGlobals() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read query parameters
        Set tNamespace = $Get(%request.Data("namespace", 1))
        Set tFilter = $Get(%request.Data("filter", 1))

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
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

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        ; Return result
        Set tResult = {}
        Do tResult.%Set("globals", tList)
        Do tResult.%Set("count", tList.%Size(), "number")
        If tFilter '= "" Do tResult.%Set("filter", tFilter)
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
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
/// <p>Ensures the name starts with an optional <code>%</code>, then an alpha
/// character, followed by alphanumeric characters and dots (e.g., <code>Ens.AutoStart</code>).
/// Does not allow injection patterns.</p>
ClassMethod ValidateGlobalName(pGlobal As %String) As %Status [ Private ]
{
    ; Allow optional leading %, then one alpha followed by alphanumeric chars and dots
    ; IRIS global names can contain dots (e.g., Ens.AutoStart, Ens.Config.ItemD)
    If pGlobal '? .1"%"1A.AN.(1"."1A.AN) {
        Quit $$$ERROR($$$GeneralError, "Invalid global name '"_pGlobal_"': must be alphanumeric with optional dots (optional leading %)")
    }
    Quit $$$OK
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
    Set tOrigNS = $NAMESPACE
    Set tRedirected = 0
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Extract parameters
        Set tCommand = ""
        Set tNamespace = ""
        If $IsObject(tBody) {
            Set tCommand = tBody.%Get("command")
            Set tNamespace = tBody.%Get("namespace")
        }

        ; Validate required command
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tCommand, "command")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch namespace if specified
        ; The ExecuteMCPv2 package is mapped to %All namespace at bootstrap time,
        ; so the compiled routine (with I/O redirect mnemonic labels) is available
        ; in every namespace, enabling cross-namespace command execution.
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
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

            Set $NAMESPACE = tOrigNS
            Set tSC = exCmd.AsStatus()
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Restore I/O
        Use tInitIO::($Select(tOldMnemonic=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
        If tWasRedirected '= tRedirected Do ##class(%Library.Device).ReDirectIO(tWasRedirected)
        Set tRedirected = 0

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        Set tOutput = $Get(%ExecuteMCPOutput, "")
        Kill %ExecuteMCPOutput
        Set tResult = {}
        Do tResult.%Set("output", tOutput)
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        ; Ensure redirection is restored on unexpected error
        Try {
            If tRedirected {
                If $Get(tInitIO) '= "" {
                    Use tInitIO::($Select($Get(tOldMnemonic)=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
                }
                Do ##class(%Library.Device).ReDirectIO(0)
            }
        } Catch {}
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
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
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

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
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tMethodName, "methodName")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
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
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Too many arguments: maximum is 10, received " _ tArgCount)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

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
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
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
/// <p>I/O from <code>%UnitTest.Manager.RunTest()</code> is redirected to prevent
/// its progress output from corrupting the HTTP response body.</p>
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
    Set tOrigNS = $NAMESPACE
    Set tRedirected = 0
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

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
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate level
        If (tLevel '= "package") && (tLevel '= "class") && (tLevel '= "method") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'level' must be one of: package, class, method")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Ensure test environment (^UnitTestRoot guard)
        Set tSC = ..EnsureTestEnvironment()
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Build testspec based on level
        Set tTestSpec = ..BuildTestSpec(tTarget, tLevel)

        ; Determine method filter for "method" level
        Set tMethodFilter = ""
        If tLevel = "method" {
            If tTarget [ ":" {
                Set tMethodFilter = $Piece(tTarget, ":", 2)
            }
        }

        ; Redirect I/O to suppress RunTest console output
        ; %UnitTest.Manager.RunTest writes progress/results directly to the
        ; current device, which corrupts the HTTP response. We capture and
        ; discard it using the same redirect pattern from Command.cls.
        Set %ExecuteMCPOutput = ""
        Set tInitIO = $IO
        Set tWasRedirected = ##class(%Library.Device).ReDirectIO()
        Set tOldMnemonic = ##class(%Library.Device).GetMnemonicRoutine()
        Use tInitIO::("^"_$ZNAME)
        Set tRedirected = 1
        Do ##class(%Library.Device).ReDirectIO(1)

        ; Run tests with /noload/nodelete qualifiers
        Try {
            Set tTestSC = ##class(%UnitTest.Manager).RunTest(tTestSpec, "/noload/nodelete/norecursive")
        } Catch exTest {
            Set tTestSC = exTest.AsStatus()
        }

        ; Restore I/O
        Use tInitIO::($Select(tOldMnemonic=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
        If tWasRedirected '= tRedirected Do ##class(%Library.Device).ReDirectIO(tWasRedirected)
        Set tRedirected = 0
        Kill %ExecuteMCPOutput

        ; Parse results regardless of RunTest status (tests may have failed but ran)
        Set tResult = ..ParseTestResults(tMethodFilter)

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        ; Ensure redirection is restored on unexpected error
        Try {
            If $Get(tRedirected) {
                If $Get(tInitIO) '= "" {
                    Use tInitIO::($Select($Get(tOldMnemonic)=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
                }
                Do ##class(%Library.Device).ReDirectIO(0)
            }
        } Catch {}
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit tSC
}

/// I/O redirect entry points for suppressing RunTest output.
/// <p>All output from <code>%UnitTest.Manager.RunTest()</code> is captured
/// and discarded to prevent it from corrupting the REST response.</p>
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

/// Ensure <code>^UnitTestRoot</code> is set before running tests.
ClassMethod EnsureTestEnvironment() As %Status
{
    Set tSC = $$$OK
    Try {
        ; ^UnitTestRoot must point to a valid directory. When empty,
        ; %UnitTest.Manager.Root() falls back to the IRIS source dir.
        ; We create a temp directory so the framework doesn't error on
        ; directory checks even though /noload skips file loading.
        Set tRoot = $Get(^UnitTestRoot)
        If (tRoot = "") || ('##class(%File).DirectoryExists(tRoot)) {
            Set tDir = ##class(%File).NormalizeDirectory($ZU(12)_"unittest_mcp")
            Do ##class(%File).CreateDirectoryChain(tDir)
            Set ^UnitTestRoot = tDir
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Build the testspec string for <method>%UnitTest.Manager.RunTest</method>.
/// Build testspec for <code>%UnitTest.Manager.RunTest</code> in <code>/noload</code> mode.
/// <p>With /noload, testspec MUST use colon format to specify classes directly.
/// The framework cannot discover classes from directories when ^UnitTestRoot="".</p>
ClassMethod BuildTestSpec(pTarget As %String, pLevel As %String) As %String
{
    If pLevel = "class" {
        Quit ":"_pTarget
    }
    If pLevel = "method" {
        If pTarget [ ":" {
            Set tClass = $Piece(pTarget, ":", 1)
            Set tMethod = $Piece(pTarget, ":", 2)
            Quit ":"_tClass_":"_tMethod
        }
        Quit ":"_pTarget
    }
    If pLevel = "package" {
        ; Query class dictionary for all %UnitTest.TestCase subclasses in the package
        Set tSpec = ""
        Set tSQL = "SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ? AND Abstract = 0"
        Set tStmt = ##class(%SQL.Statement).%New()
        Set tSC = tStmt.%Prepare(tSQL)
        If $$$ISOK(tSC) {
            Set tRS = tStmt.%Execute(pTarget_".")
            While tRS.%Next() {
                Set tClassName = tRS.%Get("Name")
                Try {
                    If $ClassMethod(tClassName, "%Extends", "%UnitTest.TestCase") {
                        If tSpec '= "" Set tSpec = tSpec _ ";"
                        Set tSpec = tSpec _ ":" _ tClassName
                    }
                } Catch {}
            }
        }
        If tSpec = "" Quit ":"_pTarget
        Quit tSpec
    }
    Quit ":"_pTarget
}

/// Parse test results from the <code>%UnitTest_Result</code> SQL tables.
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

            If (pMethodFilter '= "") && (tMethodName '= pMethodFilter) {
                Continue
            }

            Set tDetail = {}
            Do tDetail.%Set("class", tClassName)
            Do tDetail.%Set("method", tMethodName)
            Do tDetail.%Set("duration", tMethodDur, "number")

            If tStatus = 1 {
                Do tDetail.%Set("status", "passed")
                Do tDetail.%Set("message", "")
                Set tPassed = tPassed + 1
            } Else {
                Do tDetail.%Set("status", "failed")
                Set tMsg = ..GetFailureMessage(tInstanceId, tClassName, tMethodName)
                Do tDetail.%Set("message", tMsg)
                Set tFailed = tFailed + 1
            }

            Do tDetails.%Push(tDetail)
            Set tTotal = tTotal + 1
        }
    } Catch ex {
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
    "ExecuteMCPv2.REST.Config.cls",
    `/// REST handler for namespace and database configuration operations.
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
/// <p><b>CRITICAL</b>: Namespace switching uses <code>Set tOrigNS = $NAMESPACE</code>
/// and manual restore (never <code>New $NAMESPACE</code>) so that
/// <class>ExecuteMCPv2.Utils</class> remains visible in catch blocks.</p>
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
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all users
        Set tRS = ##class(%ResultSet).%New("Security.Users:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

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

/// Get a single user account by name (excluding password).
/// <p>Switches to <code>%SYS</code> and calls <method>Security.Users.Get</method>
/// to retrieve user properties. Returns a JSON object with user details.</p>
ClassMethod UserGet(pName As %String) As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Validate name parameter (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(pName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        Set tSC = ##class(Security.Users).Get(pName, .tProps)
        Set $NAMESPACE = tOrigNS
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
        Set $NAMESPACE = tOrigNS
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

        ; Validate action value
        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            ; Password is required for create
            Set tPassword = tBody.%Get("password")
            If tPassword = "" {
                Set $NAMESPACE = tOrigNS
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
            Set $NAMESPACE = tOrigNS
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
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; CRITICAL: Never include password in response
            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Users).Delete(tName)
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

/// Add or remove roles from a user account.
/// <p>Reads a JSON body with <code>action</code> (add|remove),
/// <code>username</code>, and <code>role</code>. For add, appends the
/// role to the user's existing roles. For remove, strips it from the
/// comma-separated role list.</p>
ClassMethod UserRoles() As %Status
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
        Set $NAMESPACE = "%SYS"

        ; Get current user properties
        Set tSC = ##class(Security.Users).Get(tUsername, .tProps)
        Set $NAMESPACE = tOrigNS
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
                    ; Role already assigned — return success without modification
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
                ; Role was not assigned — return success without modification
                Set tResult = {"action": "remove", "username": (tUsername), "role": (tRole), "message": "Role was not assigned"}
                Do ..RenderResponseBody($$$OK, , tResult)
                Quit
            }
        }

        ; Update user with new role list
        Kill tProps
        Set tProps("Roles") = tNewRoles

        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Security.Users).Modify(tUsername, .tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tResult = {}
        Do tResult.%Set("action", tAction)
        Do tResult.%Set("username", tUsername)
        Do tResult.%Set("role", tRole)
        Do tResult.%Set("roles", tNewRoles)
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

        If tAction = "change" {
            Set tUsername = tBody.%Get("username")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tUsername, "username")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; Switch to %SYS for Security operations
            Set $NAMESPACE = "%SYS"

            ; Use ChangePassword property to change password
            Set tProps("ChangePassword") = tPassword
            Set tSC = ##class(Security.Users).Modify(tUsername, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) {
                ; CRITICAL: Sanitize error — do NOT include password in error message
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
            Set $NAMESPACE = "%SYS"
            Set tSC = $SYSTEM.Security.ValidatePassword(tPassword)
            Set $NAMESPACE = tOrigNS
            If $$$ISOK(tSC) {
                Set tResult = {"action": "validate", "valid": true}
            }
            Else {
                ; Extract validation message but NEVER include the password itself
                ; Use a generic message to avoid any risk of password leakage
                ; through IRIS-reformatted or truncated error text
                Set tMsg = $System.Status.GetErrorText(tSC)
                ; Strip the password using regex-style replacement that handles
                ; IRIS reformatting (spaces, truncation, case changes)
                ; First do exact match, then strip any remaining fragments >= 3 chars
                Set tMsg = $Replace(tMsg, tPassword, "***")
                If $Length(tPassword) >= 3 {
                    ; Also strip partial matches (IRIS may truncate or reformat)
                    Set tPwdLen = $Length(tPassword)
                    For tK = tPwdLen:-1:3 {
                        Set tFragment = $Extract(tPassword, 1, tK)
                        Set tMsg = $Replace(tMsg, tFragment, "***")
                    }
                }
                Set tResult = {"action": "validate", "valid": false, "message": (tMsg)}
                Set tSC = $$$OK
            }
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

/// List all security roles.
/// <p>Switches to <code>%SYS</code> and iterates over roles via the
/// <class>Security.Roles</class> SQL query. Returns a JSON array of role
/// objects with <code>name</code>, <code>description</code>,
/// <code>resources</code>, and <code>grantedRoles</code>.</p>
ClassMethod RoleList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all roles
        Set tRS = ##class(%ResultSet).%New("Security.Roles:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("description", tRS.Get("Description"))
            Do tEntry.%Set("resources", tRS.Get("Resources"))
            Do tEntry.%Set("grantedRoles", tRS.Get("GrantedRoles"))
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

/// Create, modify, or delete a security role.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code>, and optional properties (<code>description</code>,
/// <code>resources</code>, <code>grantedRoles</code>). Dispatches to
/// <class>Security.Roles</class> in <code>%SYS</code>.</p>
ClassMethod RoleManage() As %Status
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

        ; Validate action value
        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("resources") Set tProps("Resources") = tBody.%Get("resources")
            If tBody.%IsDefined("grantedRoles") Set tProps("GrantedRoles") = tBody.%Get("grantedRoles")

            Set tSC = ##class(Security.Roles).Create(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("resources") Set tProps("Resources") = tBody.%Get("resources")
            If tBody.%IsDefined("grantedRoles") Set tProps("GrantedRoles") = tBody.%Get("grantedRoles")

            Set tSC = ##class(Security.Roles).Modify(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Roles).Delete(tName)
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

/// List all security resources.
/// <p>Switches to <code>%SYS</code> and iterates over resources via the
/// <class>Security.Resources</class> SQL query. Returns a JSON array of
/// resource objects with <code>name</code>, <code>description</code>,
/// <code>publicPermission</code>, and <code>type</code>.</p>
ClassMethod ResourceList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all resources
        Set tRS = ##class(%ResultSet).%New("Security.Resources:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("description", tRS.Get("Description"))
            Do tEntry.%Set("publicPermission", tRS.Get("PublicPermission"))
            Do tEntry.%Set("type", tRS.Get("Type"))
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

/// Create, modify, or delete a security resource.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code>, and optional properties (<code>description</code>,
/// <code>publicPermission</code>). Dispatches to
/// <class>Security.Resources</class> in <code>%SYS</code>.</p>
ClassMethod ResourceManage() As %Status
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

        ; Validate action value
        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("publicPermission") Set tProps("PublicPermission") = tBody.%Get("publicPermission")

            Set tSC = ##class(Security.Resources).Create(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("publicPermission") Set tProps("PublicPermission") = tBody.%Get("publicPermission")

            Set tSC = ##class(Security.Resources).Modify(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Resources).Delete(tName)
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

/// Check whether a user or role has a specific permission on a resource.
/// <p>Reads a JSON body with <code>target</code> (username or role name),
/// <code>resource</code>, and <code>permission</code> (R, W, U, or combination).
/// Looks up the target's assigned resources (via <class>Security.Users</class>
/// or <class>Security.Roles</class>) and checks if the requested permission
/// is granted on the specified resource.</p>
ClassMethod PermissionCheck() As %Status
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
        Set tTarget = tBody.%Get("target")
        Set tResource = tBody.%Get("resource")
        Set tPermission = tBody.%Get("permission")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTarget, "target")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tResource, "resource")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tPermission, "permission")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        ; Determine if target is a user or role by checking existence
        Set tIsUser = ##class(Security.Users).Exists(tTarget)
        Set tIsRole = ##class(Security.Roles).Exists(tTarget)

        If 'tIsUser && 'tIsRole {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Target '"_tTarget_"' is not a known user or role")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Get the resources string for the target
        Set tGrantedResources = ""
        Set tTargetType = ""

        If tIsUser {
            Set tTargetType = "user"
            ; Get user's roles, then collect all resources from those roles
            Set tSC = ##class(Security.Users).Get(tTarget, .tUserProps)
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            ; Check user's directly-assigned resources first
            Set tDirectResources = $Get(tUserProps("Resources"))
            If tDirectResources '= "" {
                Set tGrantedResources = tDirectResources
            }
            Set tUserRoles = $Get(tUserProps("Roles"))
            ; Collect resources from all assigned roles
            For tI = 1:1:$Length(tUserRoles, ",") {
                Set tRoleName = $Piece(tUserRoles, ",", tI)
                If tRoleName = "" Continue
                Set tRoleSC = ##class(Security.Roles).Get(tRoleName, .tRoleProps)
                If $$$ISOK(tRoleSC) {
                    Set tRoleRes = $Get(tRoleProps("Resources"))
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
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tGrantedResources = $Get(tRoleProps("Resources"))
        }

        ; Done with %SYS — restore namespace for response rendering
        Set $NAMESPACE = tOrigNS

        ; Parse the resources string to check if the requested permission is granted
        ; Resources format: "ResName:RWU,ResName2:R"
        Set tHasPermission = 0
        Set tFoundResource = 0
        Set tGrantedPermission = ""
        For tI = 1:1:$Length(tGrantedResources, ",") {
            Set tPair = $Piece(tGrantedResources, ",", tI)
            Set tResName = $Piece(tPair, ":", 1)
            Set tResPerm = $Piece(tPair, ":", 2)
            If tResName = tResource {
                Set tFoundResource = 1
                Set tGrantedPermission = tResPerm
                ; Check each character of requested permission exists in granted
                Set tHasPermission = 1
                For tJ = 1:1:$Length(tPermission) {
                    Set tChar = $Extract(tPermission, tJ)
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
        Set $NAMESPACE = tOrigNS
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
    Set tOrigNS = $NAMESPACE
    Try {

        ; Check for optional namespace filter from query parameter
        Set tNamespaceFilter = $Get(%request.Data("namespace", 1))

        Set tResult = []

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        ; Use SQL to enumerate web applications
        If tNamespaceFilter '= "" {
            Set tStatement = ##class(%SQL.Statement).%New()
            Set tSC = tStatement.%Prepare("SELECT Name, NameSpace, DispatchClass, Description, Enabled, AutheEnabled, IsNameSpaceDefault, CSPZENEnabled, Recurse, MatchRoles, CookiePath FROM Security.Applications WHERE NameSpace = ?")
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tRS = tStatement.%Execute(tNamespaceFilter)
        }
        Else {
            Set tStatement = ##class(%SQL.Statement).%New()
            Set tSC = tStatement.%Prepare("SELECT Name, NameSpace, DispatchClass, Description, Enabled, AutheEnabled, IsNameSpaceDefault, CSPZENEnabled, Recurse, MatchRoles, CookiePath FROM Security.Applications")
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tRS = tStatement.%Execute()
        }

        If tRS.%SQLCODE < 0 {
            Set $NAMESPACE = tOrigNS
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
            ; Resource column omitted — reserved word conflict in SQL projection
            Do tEntry.%Set("cookiePath", tRS.%Get("CookiePath"))
            Do tResult.%Push(tEntry)
        }

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

/// Get a single web application by name.
/// <p>Switches to <code>%SYS</code> and calls <method>Security.Applications.Get</method>
/// to retrieve web application properties. The <var>pName</var> parameter should
/// be URL-decoded by the dispatch framework (web app names start with <code>/</code>).</p>
ClassMethod WebAppGet(pName As %String) As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Validate name parameter (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(pName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; URL-decode the name (webapp names contain '/')
        Set pName = $ZCONVERT(pName, "I", "URL")

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        Set tSC = ##class(Security.Applications).Get(pName, .tProps)
        Set $NAMESPACE = tOrigNS
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
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Build the tProps array for web application create/modify from a JSON body.
/// <p>Reads standard web application properties from the JSON body and
/// populates the <var>pProps</var> array suitable for passing to
/// <method>Security.Applications.Create</method> or
/// <method>Security.Applications.Modify</method>.</p>
ClassMethod BuildWebAppProps(pBody As %DynamicObject, Output pProps) [ Private ]
{
    If pBody.%IsDefined("namespace") Set pProps("NameSpace") = pBody.%Get("namespace")
    If pBody.%IsDefined("dispatchClass") Set pProps("DispatchClass") = pBody.%Get("dispatchClass")
    If pBody.%IsDefined("description") Set pProps("Description") = pBody.%Get("description")
    If pBody.%IsDefined("enabled") Set pProps("Enabled") = +pBody.%Get("enabled")
    If pBody.%IsDefined("authEnabled") Set pProps("AutheEnabled") = +pBody.%Get("authEnabled")
    If pBody.%IsDefined("isNameSpaceDefault") Set pProps("IsNameSpaceDefault") = +pBody.%Get("isNameSpaceDefault")
    If pBody.%IsDefined("cspZenEnabled") Set pProps("CSPZENEnabled") = +pBody.%Get("cspZenEnabled")
    If pBody.%IsDefined("recurse") Set pProps("Recurse") = +pBody.%Get("recurse")
    If pBody.%IsDefined("matchRoles") Set pProps("MatchRoles") = pBody.%Get("matchRoles")
    If pBody.%IsDefined("resource") Set pProps("Resource") = pBody.%Get("resource")
    If pBody.%IsDefined("cookiePath") Set pProps("CookiePath") = pBody.%Get("cookiePath")
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

        ; Validate action value
        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            Do ..BuildWebAppProps(tBody, .tProps)

            Set tSC = ##class(Security.Applications).Create(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "created")
            Do tResult.%Set("name", tName)
            Do tResult.%Set("caveat", "CSP gateway was NOT notified. Save through the Management Portal or restart the CSP gateway to activate this web application.")
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            Do ..BuildWebAppProps(tBody, .tProps)

            Set tSC = ##class(Security.Applications).Modify(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Applications).Delete(tName)
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
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all SSL/TLS configurations
        Set tStatement = ##class(%SQL.Statement).%New()
        Set tSC = tStatement.%Prepare("SELECT Name, Description, CertificateFile, PrivateKeyFile, CAFile, CAPath, CipherList, Protocols, VerifyPeer, VerifyDepth, Type, Enabled FROM Security.SSLConfigs")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tRS = tStatement.%Execute()

        If tRS.%SQLCODE < 0 {
            Set $NAMESPACE = tOrigNS
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

/// Create, modify, or delete an SSL/TLS configuration.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code> (configuration name), and optional properties such as
/// <code>certFile</code>, <code>keyFile</code>, <code>caFile</code>,
/// <code>protocols</code>, <code>verifyPeer</code>, etc.
/// Dispatches to <class>Security.SSLConfigs</class> in <code>%SYS</code>.</p>
ClassMethod SSLManage() As %Status
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

        ; Validate action value
        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
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
            Set $NAMESPACE = tOrigNS
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
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.SSLConfigs).Delete(tName)
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

/// List all OAuth2 server definitions and their registered clients.
/// <p>Switches to <code>%SYS</code> and queries
/// <class>OAuth2.Server.Configuration</class> for server definitions,
/// then <class>OAuth2.Client</class> for registered clients.
/// Returns a JSON object with <code>servers</code> and <code>clients</code>
/// arrays.</p>
/// <p><b>CRITICAL</b>: Client secrets are NEVER included in response bodies
/// (NFR6).</p>
ClassMethod OAuthList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tServers = []
        Set tClients = []

        ; List OAuth2 server definitions via SQL
        Set tStatement = ##class(%SQL.Statement).%New()
        Set tSC = tStatement.%Prepare("SELECT ID, IssuerEndpoint, Description, SupportedScopes, AccessTokenInterval, AuthorizationCodeInterval, RefreshTokenInterval, SigningAlgorithm FROM OAuth2.Server.Configuration")
        If $$$ISERR(tSC) {
            ; Table may not exist - return empty results
            Set $NAMESPACE = tOrigNS
            Set tResult = {}
            Do tResult.%Set("servers", [])
            Do tResult.%Set("clients", [])
            Do tResult.%Set("serverCount", 0, "number")
            Do tResult.%Set("clientCount", 0, "number")
            Do ..RenderResponseBody($$$OK, , tResult)
            Set tSC = $$$OK
            Quit
        }
        Set tRS = tStatement.%Execute()

        If tRS.%SQLCODE '< 0 {
            While tRS.%Next() {
                Set tEntry = {}
                Do tEntry.%Set("id", tRS.%Get("ID"))
                Do tEntry.%Set("issuerEndpoint", tRS.%Get("IssuerEndpoint"))
                Do tEntry.%Set("description", tRS.%Get("Description"))
                Do tEntry.%Set("supportedScopes", tRS.%Get("SupportedScopes"))
                Do tEntry.%Set("accessTokenInterval", +tRS.%Get("AccessTokenInterval"), "number")
                Do tEntry.%Set("authorizationCodeInterval", +tRS.%Get("AuthorizationCodeInterval"), "number")
                Do tEntry.%Set("refreshTokenInterval", +tRS.%Get("RefreshTokenInterval"), "number")
                Do tEntry.%Set("signingAlgorithm", tRS.%Get("SigningAlgorithm"))
                Do tServers.%Push(tEntry)
            }
        }

        ; List OAuth2 client registrations via SQL
        Set tStatement2 = ##class(%SQL.Statement).%New()
        Set tSC2 = tStatement2.%Prepare("SELECT ApplicationName, ServerDefinition, ClientId, ClientType, RedirectURL, Description, Enabled FROM OAuth2.Client")
        If '$$$ISERR(tSC2) {
            Set tRS2 = tStatement2.%Execute()
            If tRS2.%SQLCODE '< 0 {
                While tRS2.%Next() {
                    Set tEntry = {}
                    Do tEntry.%Set("applicationName", tRS2.%Get("ApplicationName"))
                    Do tEntry.%Set("serverDefinition", tRS2.%Get("ServerDefinition"))
                    Do tEntry.%Set("clientId", tRS2.%Get("ClientId"))
                    ; CRITICAL: Never include clientSecret (NFR6)
                    Do tEntry.%Set("clientType", tRS2.%Get("ClientType"))
                    Do tEntry.%Set("redirectURL", tRS2.%Get("RedirectURL"))
                    Do tEntry.%Set("description", tRS2.%Get("Description"))
                    Do tEntry.%Set("enabled", +tRS2.%Get("Enabled"), "boolean")
                    Do tClients.%Push(tEntry)
                }
            }
        }

        Set $NAMESPACE = tOrigNS

        Set tResult = {}
        Do tResult.%Set("servers", tServers)
        Do tResult.%Set("clients", tClients)
        Do tResult.%Set("serverCount", tServers.%Size(), "number")
        Do tResult.%Set("clientCount", tClients.%Size(), "number")
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

/// Create, delete, or discover OAuth2 server definitions and client registrations.
/// <p>Reads a JSON body with <code>action</code> (create|delete|discover),
/// <code>entity</code> (server|client for create/delete), and action-specific
/// parameters. Dispatches to the appropriate OAuth2 classes in <code>%SYS</code>.</p>
/// <p><b>CRITICAL</b>: Client secrets are NEVER included in response bodies
/// or error messages (NFR6).</p>
ClassMethod OAuthManage() As %Status
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

        ; Extract and validate action (before namespace switch)
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "create") && (tAction '= "delete") && (tAction '= "discover") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, delete, discover")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for OAuth2 operations
        Set $NAMESPACE = "%SYS"

        If tAction = "discover" {
            ; OIDC Discovery from issuer URL
            Set tIssuerURL = tBody.%Get("issuerURL")
            If tIssuerURL = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'issuerURL' is required for discover action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tSC = ##class(%SYS.OAuth2.Registration).Discover(tIssuerURL, .tConfig)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "discovered")
            Do tResult.%Set("issuerURL", tIssuerURL)
            ; Return discovered configuration as a nested object
            Set tDiscovered = {}
            If $IsObject(tConfig) {
                If tConfig.%IsA("%DynamicObject") {
                    Set tDiscovered = tConfig
                }
                Else {
                    ; Convert discovered config properties to JSON
                    If $Property(tConfig, "IssuerEndpoint") '= "" Do tDiscovered.%Set("issuerEndpoint", $Property(tConfig, "IssuerEndpoint"))
                    If $Property(tConfig, "AuthorizationEndpoint") '= "" Do tDiscovered.%Set("authorizationEndpoint", $Property(tConfig, "AuthorizationEndpoint"))
                    If $Property(tConfig, "TokenEndpoint") '= "" Do tDiscovered.%Set("tokenEndpoint", $Property(tConfig, "TokenEndpoint"))
                    If $Property(tConfig, "UserinfoEndpoint") '= "" Do tDiscovered.%Set("userinfoEndpoint", $Property(tConfig, "UserinfoEndpoint"))
                    If $Property(tConfig, "RevocationEndpoint") '= "" Do tDiscovered.%Set("revocationEndpoint", $Property(tConfig, "RevocationEndpoint"))
                    If $Property(tConfig, "IntrospectionEndpoint") '= "" Do tDiscovered.%Set("introspectionEndpoint", $Property(tConfig, "IntrospectionEndpoint"))
                    If $Property(tConfig, "JWKSEndpoint") '= "" Do tDiscovered.%Set("jwksEndpoint", $Property(tConfig, "JWKSEndpoint"))
                }
            }
            Do tResult.%Set("configuration", tDiscovered)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "create" || (tAction = "delete") {
            ; Entity type required for create/delete
            Set tEntity = tBody.%Get("entity")
            If (tEntity '= "server") && (tEntity '= "client") {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'entity' must be 'server' or 'client' for " _ tAction _ " action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            If tAction = "create" {
                If tEntity = "server" {
                    ; Create OAuth2 server definition
                    Set tIssuerURL = tBody.%Get("issuerURL")
                    If tIssuerURL = "" {
                        Set $NAMESPACE = tOrigNS
                        Set tSC = $$$ERROR($$$GeneralError, "Parameter 'issuerURL' is required for server creation")
                        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                        Set tSC = $$$OK
                        Quit
                    }

                    Set tConfig = ##class(OAuth2.Server.Configuration).%New()
                    Set tConfig.IssuerEndpoint = tIssuerURL
                    If tBody.%IsDefined("description") Set tConfig.Description = tBody.%Get("description")
                    If tBody.%IsDefined("supportedScopes") Set tConfig.SupportedScopes = tBody.%Get("supportedScopes")
                    If tBody.%IsDefined("accessTokenInterval") Set tConfig.AccessTokenInterval = +tBody.%Get("accessTokenInterval")
                    If tBody.%IsDefined("authorizationCodeInterval") Set tConfig.AuthorizationCodeInterval = +tBody.%Get("authorizationCodeInterval")
                    If tBody.%IsDefined("refreshTokenInterval") Set tConfig.RefreshTokenInterval = +tBody.%Get("refreshTokenInterval")
                    If tBody.%IsDefined("signingAlgorithm") Set tConfig.SigningAlgorithm = tBody.%Get("signingAlgorithm")

                    Set tSC = tConfig.%Save()
                    Set $NAMESPACE = tOrigNS
                    If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

                    Set tResult = {}
                    Do tResult.%Set("action", "created")
                    Do tResult.%Set("entity", "server")
                    Do tResult.%Set("issuerEndpoint", tIssuerURL)
                    Do ..RenderResponseBody($$$OK, , tResult)
                }
                ElseIf tEntity = "client" {
                    ; Register OAuth2 client application
                    Set tServerName = tBody.%Get("serverName")
                    Set tClientName = tBody.%Get("clientName")
                    If tServerName = "" {
                        Set $NAMESPACE = tOrigNS
                        Set tSC = $$$ERROR($$$GeneralError, "Parameter 'serverName' is required for client registration")
                        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                        Set tSC = $$$OK
                        Quit
                    }
                    If tClientName = "" {
                        Set $NAMESPACE = tOrigNS
                        Set tSC = $$$ERROR($$$GeneralError, "Parameter 'clientName' is required for client registration")
                        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                        Set tSC = $$$OK
                        Quit
                    }

                    Set tProps("ApplicationName") = tClientName
                    Set tProps("ServerDefinition") = tServerName
                    If tBody.%IsDefined("redirectURIs") Set tProps("RedirectURL") = tBody.%Get("redirectURIs")
                    If tBody.%IsDefined("grantTypes") Set tProps("GrantTypes") = tBody.%Get("grantTypes")
                    If tBody.%IsDefined("clientType") Set tProps("ClientType") = tBody.%Get("clientType")
                    If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")

                    Set tSC = ##class(%SYS.OAuth2.Registration).RegisterClient(tServerName, .tProps)
                    Set $NAMESPACE = tOrigNS
                    If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

                    ; Return client ID but NEVER the client secret (NFR6)
                    Set tResult = {}
                    Do tResult.%Set("action", "created")
                    Do tResult.%Set("entity", "client")
                    Do tResult.%Set("clientName", tClientName)
                    Do tResult.%Set("serverName", tServerName)
                    If $Data(tProps("ClientId")) Do tResult.%Set("clientId", tProps("ClientId"))
                    ; CRITICAL: Never include clientSecret in response
                    Do ..RenderResponseBody($$$OK, , tResult)
                }
            }
            ElseIf tAction = "delete" {
                Set tName = tBody.%Get("name")
                If tName = "" {
                    Set $NAMESPACE = tOrigNS
                    Set tSC = $$$ERROR($$$GeneralError, "Parameter 'name' is required for " _ tEntity _ " deletion")
                    Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                    Set tSC = $$$OK
                    Quit
                }

                If tEntity = "server" {
                    Set tSC = ##class(OAuth2.Server.Configuration).Delete(tName)
                }
                ElseIf tEntity = "client" {
                    Set tSC = ##class(OAuth2.Client).Delete(tName)
                }
                Set $NAMESPACE = tOrigNS
                If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

                Set tResult = {}
                Do tResult.%Set("action", "deleted")
                Do tResult.%Set("entity", tEntity)
                Do tResult.%Set("name", tName)
                Do ..RenderResponseBody($$$OK, , tResult)
            }
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        ; CRITICAL: Sanitize error to avoid leaking secrets
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}`,
  ],
  [
    "ExecuteMCPv2.REST.Interop.cls",
    `/// REST handler for Interoperability production lifecycle operations.
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

  <!-- Epic 4: Security / OAuth2 Configuration Management -->
  <Route Url="/security/oauth" Method="GET" Call="ExecuteMCPv2.REST.Security:OAuthList" />
  <Route Url="/security/oauth" Method="POST" Call="ExecuteMCPv2.REST.Security:OAuthManage" />

  <!-- Epic 5: Interoperability Management -->
  <Route Url="/interop/production/status" Method="GET" Call="ExecuteMCPv2.REST.Interop:ProductionStatus" />
  <Route Url="/interop/production/summary" Method="GET" Call="ExecuteMCPv2.REST.Interop:ProductionSummary" />
  <Route Url="/interop/production" Method="POST" Call="ExecuteMCPv2.REST.Interop:ProductionManage" />
  <Route Url="/interop/production/control" Method="POST" Call="ExecuteMCPv2.REST.Interop:ProductionControl" />
  <Route Url="/interop/production/item" Method="POST" Call="ExecuteMCPv2.REST.Interop:ItemManage" />
  <Route Url="/interop/production/autostart" Method="POST" Call="ExecuteMCPv2.REST.Interop:AutoStart" />

  <!-- Epic 5: Production Monitoring -->
  <Route Url="/interop/production/logs" Method="GET" Call="ExecuteMCPv2.REST.Interop:EventLog" />
  <Route Url="/interop/production/queues" Method="GET" Call="ExecuteMCPv2.REST.Interop:QueueStatus" />
  <Route Url="/interop/production/messages" Method="GET" Call="ExecuteMCPv2.REST.Interop:MessageTrace" />
  <Route Url="/interop/production/adapters" Method="GET" Call="ExecuteMCPv2.REST.Interop:AdapterList" />

  <!-- Epic 5: Credentials and Lookup Tables -->
  <Route Url="/interop/credential" Method="GET" Call="ExecuteMCPv2.REST.Interop:CredentialList" />
  <Route Url="/interop/credential" Method="POST" Call="ExecuteMCPv2.REST.Interop:CredentialManage" />
  <Route Url="/interop/lookup" Method="POST" Call="ExecuteMCPv2.REST.Interop:LookupManage" />
  <Route Url="/interop/lookup/transfer" Method="POST" Call="ExecuteMCPv2.REST.Interop:LookupTransfer" />

  <!-- Epic 5: Rules, Transforms, and REST API -->
  <Route Url="/interop/rule" Method="GET" Call="ExecuteMCPv2.REST.Interop:RuleList" />
  <Route Url="/interop/rule/get" Method="GET" Call="ExecuteMCPv2.REST.Interop:RuleGet" />
  <Route Url="/interop/transform" Method="GET" Call="ExecuteMCPv2.REST.Interop:TransformList" />
  <Route Url="/interop/transform/test" Method="POST" Call="ExecuteMCPv2.REST.Interop:TransformTest" />
  <Route Url="/interop/rest" Method="POST" Call="ExecuteMCPv2.REST.Interop:RestManage" />

  <!-- Future Epic 6: Operations and Monitoring -->
  <!-- <Route Url="/system/:metric" Method="GET" Call="ExecuteMCPv2.REST.Ops:GetMetric" /> -->

  <!-- Future Epic 7: Data and Analytics -->
  <!-- <Route Url="/data/:action" Method="POST" Call="ExecuteMCPv2.REST.Data:Execute" /> -->
</Routes>
}

}`,
  ]
]);

/**
 * Return all bootstrap classes in compilation order.
 *
 * Utils and Setup are compiled first (no handler dependencies),
 * then the individual REST handler classes, and finally Dispatch
 * which references all handlers in its UrlMap.
 */
export function getBootstrapClasses(): BootstrapClass[] {
  return [...BOOTSTRAP_CLASSES.entries()].map(([name, content]) => ({
    name,
    content,
  }));
}
