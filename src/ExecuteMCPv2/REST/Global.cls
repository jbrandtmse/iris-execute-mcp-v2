/// REST handler for global operations (get, set, kill, list).
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

        ; Return result
        Set tResult = {}
        Do tResult.%Set("value", tValue)
        Do tResult.%Set("defined", (tDefined > 0), "boolean")
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
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

        ; Return result with verification
        Set tResult = {}
        Do tResult.%Set("value", tVerified)
        Do tResult.%Set("verified", (tVerified = tValue), "boolean")
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
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

        ; Return confirmation
        Set tResult = {}
        Do tResult.%Set("deleted", 1, "boolean")
        Do tResult.%Set("global", tGlobal)
        If tSubscripts '= "" Do tResult.%Set("subscripts", tSubscripts)
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
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

        ; Return result
        Set tResult = {}
        Do tResult.%Set("globals", tList)
        Do tResult.%Set("count", tList.%Size(), "number")
        If tFilter '= "" Do tResult.%Set("filter", tFilter)
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
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

}
