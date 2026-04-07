/// REST handler for IRIS System Configuration operations.
/// <p>Provides an endpoint for viewing and modifying IRIS system configuration
/// parameters via the custom REST endpoint
/// <code>/api/executemcp/v2/system/config</code>.</p>
/// <p>Supports three actions:</p>
/// <ul>
///   <li><b>get</b> — Retrieve configuration for a specified section
///       (config, startup, locale)</li>
///   <li><b>set</b> — Modify configuration parameters (config section only)</li>
///   <li><b>export</b> — Return combined system info and configuration data</li>
/// </ul>
/// <p>All operations requiring system classes execute in <b>%SYS</b> namespace
/// using the safe save/restore pattern for namespace switching.</p>
Class ExecuteMCPv2.REST.SystemConfig Extends %Atelier.REST
{

/// Handle system configuration get/set/export operations.
/// <p>Reads a JSON request body with:</p>
/// <ul>
///   <li><code>action</code> — Required: "get", "set", or "export"</li>
///   <li><code>section</code> — Section name for get/set: "config", "startup",
///       or "locale" (defaults to "config")</li>
///   <li><code>properties</code> — JSON object of property name/value pairs
///       (required for set action)</li>
/// </ul>
ClassMethod ConfigManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read and validate request body before namespace switch
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate action
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "get") && (tAction '= "set") && (tAction '= "export") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: get, set, export")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Default section to "config"
        Set tSection = tBody.%Get("section")
        If tSection = "" Set tSection = "config"

        If (tSection '= "config") && (tSection '= "startup") && (tSection '= "locale") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'section' must be one of: config, startup, locale")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate set action constraints
        If tAction = "set" {
            If tSection '= "config" {
                Set tSC = $$$ERROR($$$GeneralError, "Only 'config' section supports modification via set action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tProps = tBody.%Get("properties")
            If '$IsObject(tProps) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'properties' is required for set action and must be a JSON object")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
        }

        ; Dispatch to action handler
        If tAction = "get" {
            Set tResult = ..GetConfig(tSection, .tSC2)
            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "set" {
            Set tResult = ..SetConfig(tBody.%Get("properties"), .tSC2)
            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "export" {
            Set tResult = ..ExportConfig(.tSC2)
            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }
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

/// Retrieve configuration for the specified section.
/// <p>Switches to %SYS namespace to access Config classes, then restores
/// the original namespace before returning.</p>
ClassMethod GetConfig(pSection As %String, Output pSC As %Status) As %DynamicObject [ Private ]
{
    Set pSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Set tResult = {}
    Do tResult.%Set("section", pSection)
    Try {
        Set $NAMESPACE = "%SYS"

        If pSection = "config" {
            ; Config.config.Open returns the object; second arg is CPF file path (not %Status)
            Set tObj = ##class(Config.config).Open()
            If '$IsObject(tObj) {
                Set $NAMESPACE = tOrigNS
                Set pSC = $$$ERROR($$$GeneralError, "Failed to open Config.config")
                Quit
            }
            Set tConfig = {}
            ; Read key properties from the Config.config object
            Do tConfig.%Set("Maxprocesses", tObj.Maxprocesses, "number")
            Do tConfig.%Set("globals", tObj.globals, "number")
            Do tConfig.%Set("routines", tObj.routines, "number")
            Do tConfig.%Set("gmheap", tObj.gmheap, "number")
            Do tConfig.%Set("locksiz", tObj.locksiz, "number")
            Do tConfig.%Set("jrnbufs", tObj.jrnbufs, "number")
            Do tConfig.%Set("console", tObj.console)
            Do tConfig.%Set("errlog", tObj.errlog, "number")
            Do tConfig.%Set("wdparm", tObj.wdparm, "number")
            Do tConfig.%Set("ijcnum", tObj.ijcnum, "number")
            Do tConfig.%Set("ijcbuff", tObj.ijcbuff, "number")
            Do tResult.%Set("properties", tConfig)
        }
        ElseIf pSection = "startup" {
            ; Config.Startup does not have Open/Get — use %Dictionary to read property names
            ; and then read from the CPF file via Config.Startup.Get
            Set tStartup = {}
            ; Use Config.Startup.Get to retrieve startup properties
            Set tSC2 = ##class(Config.Startup).Get(.tProps)
            If $$$ISERR(tSC2) {
                Set $NAMESPACE = tOrigNS
                Set pSC = tSC2
                Quit
            }
            ; tProps is a subscripted array — iterate it
            Set tKey = ""
            For {
                Set tKey = $Order(tProps(tKey))
                Quit:tKey=""
                Do tStartup.%Set(tKey, $Get(tProps(tKey)))
            }
            Do tResult.%Set("properties", tStartup)
        }
        ElseIf pSection = "locale" {
            Set tLocale = {}
            ; List available locales via Config.NLS.Locales:List
            Set tLocales = []
            Set tRS = ##class(%ResultSet).%New("Config.NLS.Locales:List")
            If $IsObject(tRS) {
                Set tSC2 = tRS.Execute()
                If $$$ISOK(tSC2) {
                    While tRS.Next() {
                        Do tLocales.%Push(tRS.Get("Name"))
                    }
                }
                Do tRS.Close()
            }
            Do tLocale.%Set("availableLocales", tLocales)
            Do tLocale.%Set("localeCount", tLocales.%Size(), "number")
            Do tResult.%Set("properties", tLocale)
        }

        Set $NAMESPACE = tOrigNS
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set pSC = ex.AsStatus()
    }
    Quit tResult
}

/// Modify configuration parameters in the config section.
/// <p>Builds a Properties subscripted array from the JSON properties object
/// and calls <code>Config.config.Modify()</code> in %SYS namespace.</p>
ClassMethod SetConfig(pProperties As %DynamicObject, Output pSC As %Status) As %DynamicObject [ Private ]
{
    Set pSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Set tResult = {}
    Try {
        ; Build subscripted array from JSON properties
        Set tIter = pProperties.%GetIterator()
        Set tCount = 0
        While tIter.%GetNext(.tKey, .tValue) {
            Set tProps(tKey) = tValue
            Set tCount = tCount + 1
        }

        If tCount = 0 {
            Set pSC = $$$ERROR($$$GeneralError, "No properties provided for modification")
            Quit
        }

        Set $NAMESPACE = "%SYS"
        Set tSC2 = ##class(Config.config).Modify(.tProps)
        Set $NAMESPACE = tOrigNS

        If $$$ISERR(tSC2) {
            Set pSC = tSC2
            Quit
        }

        Do tResult.%Set("action", "modified")
        Do tResult.%Set("count", tCount, "number")
        Do tResult.%Set("message", "Configuration updated successfully. Some changes may require a restart to take effect.")
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set pSC = ex.AsStatus()
    }
    Quit tResult
}

/// Export complete system configuration including system info and config sections.
/// <p>Returns system version information, install directory, and key
/// configuration section properties.</p>
ClassMethod ExportConfig(Output pSC As %Status) As %DynamicObject [ Private ]
{
    Set pSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Set tResult = {}
    Try {
        ; System info — available from any namespace
        Set tSystem = {}
        Do tSystem.%Set("installDirectory", $SYSTEM.Util.InstallDirectory())
        Do tSystem.%Set("product", $SYSTEM.Version.GetProduct())
        Do tSystem.%Set("version", $SYSTEM.Version.GetNumber())
        Do tSystem.%Set("os", $SYSTEM.Version.GetOS())
        Do tResult.%Set("system", tSystem)

        ; Get config section
        Set tConfig = ..GetConfig("config", .tSC2)
        If $$$ISERR(tSC2) {
            Set pSC = tSC2
            Quit
        }
        Do tResult.%Set("config", tConfig.%Get("properties"))
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set pSC = ex.AsStatus()
    }
    Quit tResult
}

}
