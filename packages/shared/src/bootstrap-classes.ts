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
Parameter WEBAPP = "/api/executemcp";

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
            Set tProps("AutheEnabled") = 64
            Set tProps("CSPZENEnabled") = 1

            Set tSC = ##class(Security.Applications).Modify(tAppName, .tProps)
            If $$$ISERR(tSC) Quit
        } Else {
            ; Create new web application
            Kill tProps
            Set tProps("NameSpace") = pNamespace
            Set tProps("DispatchClass") = "ExecuteMCPv2.REST.Dispatch"
            Set tProps("Description") = "ExecuteMCPv2 REST Service for MCP Tool Execution"
            Set tProps("Enabled") = 1
            Set tProps("AutheEnabled") = 64
            Set tProps("CSPZENEnabled") = 1
            Set tProps("Resource") = ""

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

  <!-- Future Epic 4: Configuration Management -->
  <!-- <Route Url="/config/:entity" Method="GET" Call="ExecuteMCPv2.REST.Config:GetConfig" /> -->

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
