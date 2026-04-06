/// Shared utility methods for the ExecuteMCPv2 REST service layer.
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

}
