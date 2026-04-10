/// Setup and configuration class for the ExecuteMCPv2 REST service.
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
/// mapping, cross-namespace <code>iris_execute_command</code> fails with
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

}
