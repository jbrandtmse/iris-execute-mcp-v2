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
    ; Strip a single leading "ERROR #N: " or localized equivalent (e.g. Arabic "خطأ #N: ")
    ; so the final $$$ERROR wrap does not produce a doubly-prefixed chain (Bug #11).
    For tPrefix = "ERROR #", "خطأ #" {
        If $Extract(tSafe, 1, $Length(tPrefix)) = tPrefix {
            Set tRest = $Extract(tSafe, $Length(tPrefix) + 1, *)
            Set tColon = $Find(tRest, ": ")
            If tColon > 0 {
                Set tCodeChunk = $Extract(tRest, 1, tColon - 3)
                If tCodeChunk ? 1.N {
                    Set tSafe = $Extract(tRest, tColon, *)
                    Quit
                }
            }
        }
    }
    Quit $$$ERROR($$$GeneralError, tSafe)
}

/// Parse one positional argument entry for the <code>/classmethod</code> endpoint's
/// argument ladder (Story 34.2). Takes the whole <var>pArgs</var> array plus the
/// <var>pPosition</var> index rather than a pre-extracted element, because
/// <method>%Get</method> collapses JSON <code>null</code> and <code>""</code> to the same
/// value — only <method>%GetTypeOf</method> on the array can tell them apart, and
/// AC 34.2.6/R6 requires that distinction (code review 2026-08-14).
/// <p>A plain JSON scalar (string/number/boolean) is a by-value argument:
/// <var>pValue</var> is set to it directly and <var>pIsByRef</var> is 0. A JSON object
/// of shape <code>{byRef, value?}</code> is a by-reference marker: <var>pIsByRef</var>
/// reflects the marker's <code>byRef</code> flag, and <var>pValue</var> is set to the
/// marker's <code>value</code> — or left genuinely UNDEFINED (<code>Kill pValue</code>)
/// when <code>value</code> is omitted, which is the Output-style undefined-in case
/// (AC 34.2.6/R6). A bare JSON <code>null</code> element, a JSON array, an object missing
/// or mistyping <code>byRef</code>, a <code>byRef:false</code> marker with no
/// <code>value</code>, a JSON <code>null</code> <code>value</code>, or a non-scalar
/// <code>value</code> are all rejected with a clear validation error (AC 34.2.6/R7 — the
/// enumeration of recognized/rejected shapes is exhaustive as of 2026-08-15, when code
/// review added the bare-<code>null</code> element that the original list omitted).</p>
ClassMethod ParseArgEntry(pArgs As %DynamicArray, Output pValue, Output pIsByRef As %Boolean, pPosition As %Integer) As %Status
{
    Set tSC = $$$OK
    Set pIsByRef = 0
    Try {
        ; A bare JSON null element is rejected rather than silently aliased to "" —
        ; the same rule the marker path applies to `value: null` (AC 34.2.6/R6). Without
        ; this, `args:[null]` and `args:[""]` were indistinguishable to the target while
        ; `{"byRef":true,"value":null}` was loudly rejected — an inconsistency found at
        ; code review (Rule #56: the shape was missing from the R7 enumeration).
        If pArgs.%GetTypeOf(pPosition) = "null" {
            Set tSC = $$$ERROR($$$GeneralError, "Argument "_pPosition_" cannot be JSON null; use {""byRef"":true} for an undefined argument, or """" for an empty string")
            Quit
        }
        Set pEntry = pArgs.%Get(pPosition)
        If '$IsObject(pEntry) {
            Set pValue = pEntry
            Quit
        }
        If $ClassName(pEntry) = "%Library.DynamicArray" {
            Set tSC = $$$ERROR($$$GeneralError, "Argument "_pPosition_" is a JSON array; expected a scalar or a {byRef, value} marker object")
            Quit
        }
        Set tByRefType = pEntry.%GetTypeOf("byRef")
        If tByRefType = "unassigned" {
            Set tSC = $$$ERROR($$$GeneralError, "Argument "_pPosition_" is an object without a 'byRef' key; expected a scalar or a {byRef, value} marker object")
            Quit
        }
        If tByRefType '= "boolean" {
            Set tSC = $$$ERROR($$$GeneralError, "Argument "_pPosition_": 'byRef' must be a JSON boolean")
            Quit
        }
        Set pIsByRef = pEntry.%Get("byRef")
        Set tValueType = pEntry.%GetTypeOf("value")
        If tValueType = "unassigned" {
            If 'pIsByRef {
                Set tSC = $$$ERROR($$$GeneralError, "Argument "_pPosition_": marker with byRef:false must include a 'value'")
            } Else {
                ; Output-style undefined-in: leave pValue genuinely undefined.
                Kill pValue
            }
            Quit
        }
        If tValueType = "null" {
            Set tSC = $$$ERROR($$$GeneralError, "Argument "_pPosition_": marker 'value' cannot be JSON null; omit 'value' entirely for an undefined argument")
            Quit
        }
        If (tValueType = "object") || (tValueType = "array") {
            Set tSC = $$$ERROR($$$GeneralError, "Argument "_pPosition_": marker 'value' must be a scalar (string, number, or boolean)")
            Quit
        }
        Set pValue = pEntry.%Get("value")
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Recursively serialize a by-ref-bound local's post-call value into the AC 34.2.6/R1
/// encoding used by <var>byRefValues</var>: a leaf with no subscripts returns its raw
/// scalar value; a node with descendants (and optionally its own top-level value)
/// returns a <class>%DynamicObject</class> of shape <code>{value?, subscripts?}</code>,
/// with each subscript key mapped recursively via the same rule. Only call this when
/// <code>$Data(pLocal)</code> is nonzero — a fully undefined local is represented by
/// omitting its key from <var>byRefValues</var> entirely, not by calling this method.
/// <p>Descends via <code>Merge</code> into a fresh local rather than passing a
/// subscripted node by reference (not valid ObjectScript call-argument syntax — verified
/// live during this story) and without name indirection (which cannot see
/// procedure-block-private locals — Story 34.1 Finding 5).</p>
ClassMethod BuildByRefNode(ByRef pLocal)
{
    Set tData = $Data(pLocal)
    ; Guard against an OREF out-value (a target that mutates a by-ref local to hold an
    ; object reference) — mirrors the returnValue $IsObject guard in ClassMethod(), so a
    ; non-JSON-serializable OREF can never reach RenderResponseBody.
    ; The guard is applied to the node's own VALUE at EVERY $Data shape, not just the
    ; leaf case: `Set pOut = obj  Set pOut("k") = 1` is legal ObjectScript ($Data=11), and
    ; code review reproduced live (2026-08-14) that an unguarded OREF there reaches
    ; %ToJSON INSIDE RenderResponseBody — after the response has begun — truncating the
    ; body into an unparseable envelope with HTTP 200. That is the very failure class this
    ; epic exists to fix, so the check must not sit inside the tData=1 arm.
    Set tHasValue = (tData # 10)
    If tHasValue {
        If $IsObject(pLocal) {
            Set tValue = "<Object:"_$ClassName(pLocal)_">"
        } Else {
            Set tValue = pLocal
        }
    }
    If tData = 1 {
        Quit tValue
    }
    Set tResult = {}
    If tHasValue {
        Do tResult.%Set("value", tValue)
    }
    Set tSubs = {}
    Set tKey = ""
    For {
        Set tKey = $Order(pLocal(tKey))
        Quit:tKey=""
        Kill tChild
        Merge tChild = pLocal(tKey)
        Do tSubs.%Set(tKey, ..BuildByRefNode(.tChild))
    }
    Do tResult.%Set("subscripts", tSubs)
    Quit tResult
}

/// Invoke a class method dynamically with up to 20 positional arguments, each either a
/// plain JSON scalar (by-value) or a <code>{byRef, value?}</code> marker object
/// (by-reference — the caller reads post-call mutations back via <var>pByRefValues</var>,
/// AC 34.2.2). Rejects a non-array <var>pArgs</var> (AC 34.2.6/R12) and an argument
/// count above 20 (AC 34.2.3).
/// <p>Every argument position is materialized into its own named local (<var>tA0</var>
/// … <var>tA19</var>) and dot-passed to <code>$ClassMethod</code> UNCONDITIONALLY
/// (Story 34.1 Finding 1 / Finding E) — the caller's marker decides only what is READ
/// BACK, never what is bound. Both materialization and the post-call read-back use
/// direct-by-name access (an explicit ladder per position): string-built indirection
/// cannot see these procedure-block-private locals (Story 34.1 Finding 5) and a generic
/// loop over indirected names would silently return an empty <var>pByRefValues</var>,
/// and a subscripted array node cannot be dot-passed as a call argument at all (verified
/// live during this story) — both are why this method cannot be written as a loop.</p>
/// <p>If the target throws mid-execution — including a &lt;MAXSTRING&gt; raised by the
/// caller's own output-capture concatenation once captured text exceeds the platform's
/// long-string ceiling (verified live at roughly 2–4 million characters during this
/// story) — the throw is caught here. A &lt;MAXSTRING&gt; sets <var>pTruncated</var> and
/// is treated as a partial success (whatever the target wrote up to that point stays in
/// the caller's capture buffer, and whatever by-ref mutations already landed are still
/// read back); any other target throw is returned as a real, sanitizable error
/// (AC 34.2.6/R2 — never a silent partial).</p>
/// <p><b>Known limitation (AC 34.2.6/R3, documented rather than implemented):</b> a
/// target that itself redirects I/O mid-execution — e.g. <code>%SYS.Capture</code> (the
/// bug report's own published workaround) or its own <code>ReDirectIO(0)</code> — steals
/// whatever it writes during that window into its own buffer or the null device. That
/// content is silently absent from <var>pReturn</var>'s caller's captured <c>output</c>,
/// but verified live: the caller's own capture/redirect state is NOT corrupted by this —
/// <code>%SYS.Capture</code> restores the prior mnemonic via its own cookie, and a
/// target's own <code>ReDirectIO(0)</code> just discards writes into the null device —
/// so the response envelope stays intact either way. There is no endpoint-side way to
/// detect or prevent a target's own I/O redirection, so this is a documented gap, not a
/// silent corruption.</p>
ClassMethod InvokeWithArgs(pClassName As %String, pMethodName As %String, pArgs, Output pReturn, Output pByRefValues As %DynamicObject, Output pArgCount As %Integer, Output pTruncated As %Boolean) As %Status
{
    Set tSC = $$$OK
    Set pReturn = ""
    Set pByRefValues = {}
    Set pArgCount = 0
    Set pTruncated = 0
    Try {
        ; Validate args shape (AC 34.2.6/R12) — must be a JSON array, or absent/empty.
        If $IsObject(pArgs) {
            If $ClassName(pArgs) '= "%Library.DynamicArray" {
                Set tSC = $$$ERROR($$$GeneralError, "'args' must be a JSON array")
                Quit
            }
            Set pArgCount = pArgs.%Size()
        } ElseIf (pArgs '= "") {
            Set tSC = $$$ERROR($$$GeneralError, "'args' must be a JSON array")
            Quit
        }

        If pArgCount > 20 {
            Set tSC = $$$ERROR($$$GeneralError, "Too many arguments: maximum is 20, received "_pArgCount)
            Quit
        }

        ; Materialize each supplied position into its own named local (AC 34.2.2,
        ; 34.2.6/R6, 34.2.6/R7) — explicit per-position ladder, see method banner.
        Set tByRef0=0, tByRef1=0, tByRef2=0, tByRef3=0, tByRef4=0
        Set tByRef5=0, tByRef6=0, tByRef7=0, tByRef8=0, tByRef9=0
        Set tByRef10=0, tByRef11=0, tByRef12=0, tByRef13=0, tByRef14=0
        Set tByRef15=0, tByRef16=0, tByRef17=0, tByRef18=0, tByRef19=0
        If pArgCount > 0  { Set tSC = ..ParseArgEntry(pArgs, .tA0, .tByRef0, 0)     If $$$ISERR(tSC) Quit }
        If pArgCount > 1  { Set tSC = ..ParseArgEntry(pArgs, .tA1, .tByRef1, 1)     If $$$ISERR(tSC) Quit }
        If pArgCount > 2  { Set tSC = ..ParseArgEntry(pArgs, .tA2, .tByRef2, 2)     If $$$ISERR(tSC) Quit }
        If pArgCount > 3  { Set tSC = ..ParseArgEntry(pArgs, .tA3, .tByRef3, 3)     If $$$ISERR(tSC) Quit }
        If pArgCount > 4  { Set tSC = ..ParseArgEntry(pArgs, .tA4, .tByRef4, 4)     If $$$ISERR(tSC) Quit }
        If pArgCount > 5  { Set tSC = ..ParseArgEntry(pArgs, .tA5, .tByRef5, 5)     If $$$ISERR(tSC) Quit }
        If pArgCount > 6  { Set tSC = ..ParseArgEntry(pArgs, .tA6, .tByRef6, 6)     If $$$ISERR(tSC) Quit }
        If pArgCount > 7  { Set tSC = ..ParseArgEntry(pArgs, .tA7, .tByRef7, 7)     If $$$ISERR(tSC) Quit }
        If pArgCount > 8  { Set tSC = ..ParseArgEntry(pArgs, .tA8, .tByRef8, 8)     If $$$ISERR(tSC) Quit }
        If pArgCount > 9  { Set tSC = ..ParseArgEntry(pArgs, .tA9, .tByRef9, 9)     If $$$ISERR(tSC) Quit }
        If pArgCount > 10 { Set tSC = ..ParseArgEntry(pArgs, .tA10, .tByRef10, 10) If $$$ISERR(tSC) Quit }
        If pArgCount > 11 { Set tSC = ..ParseArgEntry(pArgs, .tA11, .tByRef11, 11) If $$$ISERR(tSC) Quit }
        If pArgCount > 12 { Set tSC = ..ParseArgEntry(pArgs, .tA12, .tByRef12, 12) If $$$ISERR(tSC) Quit }
        If pArgCount > 13 { Set tSC = ..ParseArgEntry(pArgs, .tA13, .tByRef13, 13) If $$$ISERR(tSC) Quit }
        If pArgCount > 14 { Set tSC = ..ParseArgEntry(pArgs, .tA14, .tByRef14, 14) If $$$ISERR(tSC) Quit }
        If pArgCount > 15 { Set tSC = ..ParseArgEntry(pArgs, .tA15, .tByRef15, 15) If $$$ISERR(tSC) Quit }
        If pArgCount > 16 { Set tSC = ..ParseArgEntry(pArgs, .tA16, .tByRef16, 16) If $$$ISERR(tSC) Quit }
        If pArgCount > 17 { Set tSC = ..ParseArgEntry(pArgs, .tA17, .tByRef17, 17) If $$$ISERR(tSC) Quit }
        If pArgCount > 18 { Set tSC = ..ParseArgEntry(pArgs, .tA18, .tByRef18, 18) If $$$ISERR(tSC) Quit }
        If pArgCount > 19 { Set tSC = ..ParseArgEntry(pArgs, .tA19, .tByRef19, 19) If $$$ISERR(tSC) Quit }
        If $$$ISERR(tSC) Quit

        ; Dispatch — literal arity-specific ladder (0..20); every position dot-passed
        ; so by-ref binding works regardless of the target's own declared signature
        ; (Story 34.1 Finding 1 / Finding E). Wrapped separately so a capture <MAXSTRING>
        ; — a partial success, not a failure — doesn't skip the by-ref read-back below;
        ; any GENUINE target throw still short-circuits it and returns as a real error.
        Try {
            If pArgCount = 0 {
                Set pReturn = $ClassMethod(pClassName, pMethodName)
            } ElseIf pArgCount = 1 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0)
            } ElseIf pArgCount = 2 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1)
            } ElseIf pArgCount = 3 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2)
            } ElseIf pArgCount = 4 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3)
            } ElseIf pArgCount = 5 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4)
            } ElseIf pArgCount = 6 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5)
            } ElseIf pArgCount = 7 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6)
            } ElseIf pArgCount = 8 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7)
            } ElseIf pArgCount = 9 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8)
            } ElseIf pArgCount = 10 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9)
            } ElseIf pArgCount = 11 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10)
            } ElseIf pArgCount = 12 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10, .tA11)
            } ElseIf pArgCount = 13 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10, .tA11, .tA12)
            } ElseIf pArgCount = 14 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10, .tA11, .tA12, .tA13)
            } ElseIf pArgCount = 15 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10, .tA11, .tA12, .tA13, .tA14)
            } ElseIf pArgCount = 16 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10, .tA11, .tA12, .tA13, .tA14, .tA15)
            } ElseIf pArgCount = 17 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10, .tA11, .tA12, .tA13, .tA14, .tA15, .tA16)
            } ElseIf pArgCount = 18 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10, .tA11, .tA12, .tA13, .tA14, .tA15, .tA16, .tA17)
            } ElseIf pArgCount = 19 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10, .tA11, .tA12, .tA13, .tA14, .tA15, .tA16, .tA17, .tA18)
            } ElseIf pArgCount = 20 {
                Set pReturn = $ClassMethod(pClassName, pMethodName, .tA0, .tA1, .tA2, .tA3, .tA4, .tA5, .tA6, .tA7, .tA8, .tA9, .tA10, .tA11, .tA12, .tA13, .tA14, .tA15, .tA16, .tA17, .tA18, .tA19)
            } Else {
                ; Unreachable today (pArgCount comes from %Size() and >20 is rejected
                ; above), but the pre-Story-34.2 ladder carried this defence and losing it
                ; would let a future refactor fall through all 21 branches, never call the
                ; target, and still report success with an empty returnValue.
                Set tSC = $$$ERROR($$$GeneralError, "Internal error: unsupported argument count "_pArgCount)
            }
        } Catch exTarget {
            ; Only a <MAXSTRING> raised INSIDE this request's own capture labels means the
            ; capture buffer overflowed — that is the AC 34.2.6/R2 partial-success case.
            ; A <MAXSTRING> the TARGET itself raised (its own concatenation overflowing),
            ; or any error whose text merely MENTIONS the token, is a genuine failure and
            ; must surface as a real, sanitizable error — never as a success envelope with
            ; truncated:true, which would report a crash as a truncation and mask the real
            ; %Status (Rule #9). Code review reproduced both false positives live.
            ; Discriminator grounded in live-probed reality (2026-08-14, Rule #36): a
            ; capture overflow reports Name="<MAXSTRING>" and Location="wstr^<mnemonic
            ; routine>" — a Redirects() entry point in Command.cls; a target's own
            ; overflow reports its own label (e.g. "ThrowOwnMaxString+3^SomeRoutine").
            Set tTargetStatus = exTarget.AsStatus()
            Set tThrowLabel = $Piece($Piece(exTarget.Location, "^", 1), "+", 1)
            If (exTarget.Name = "<MAXSTRING>") && ($ListFind($ListBuild("wstr", "wchr", "wnl", "wff", "wtab"), tThrowLabel) > 0) {
                Set pTruncated = 1
            } Else {
                Set tSC = tTargetStatus
            }
        }
        ; A genuine target error skips the read-back below and is returned as-is; only the
        ; capture-truncation path (tSC still OK) reaches byRefValues assembly.
        If $$$ISERR(tSC) Quit

        ; Assemble byRefValues for marked positions only (AC 34.2.2, 34.2.6/R1, R6) —
        ; direct-by-name access; omit the key when the local is still genuinely
        ; undefined after the call (Residual Risk: "undefined out-value").
        If tByRef0, $Data(tA0)   Do pByRefValues.%Set(0, ..BuildByRefNode(.tA0))
        If tByRef1, $Data(tA1)   Do pByRefValues.%Set(1, ..BuildByRefNode(.tA1))
        If tByRef2, $Data(tA2)   Do pByRefValues.%Set(2, ..BuildByRefNode(.tA2))
        If tByRef3, $Data(tA3)   Do pByRefValues.%Set(3, ..BuildByRefNode(.tA3))
        If tByRef4, $Data(tA4)   Do pByRefValues.%Set(4, ..BuildByRefNode(.tA4))
        If tByRef5, $Data(tA5)   Do pByRefValues.%Set(5, ..BuildByRefNode(.tA5))
        If tByRef6, $Data(tA6)   Do pByRefValues.%Set(6, ..BuildByRefNode(.tA6))
        If tByRef7, $Data(tA7)   Do pByRefValues.%Set(7, ..BuildByRefNode(.tA7))
        If tByRef8, $Data(tA8)   Do pByRefValues.%Set(8, ..BuildByRefNode(.tA8))
        If tByRef9, $Data(tA9)   Do pByRefValues.%Set(9, ..BuildByRefNode(.tA9))
        If tByRef10, $Data(tA10) Do pByRefValues.%Set(10, ..BuildByRefNode(.tA10))
        If tByRef11, $Data(tA11) Do pByRefValues.%Set(11, ..BuildByRefNode(.tA11))
        If tByRef12, $Data(tA12) Do pByRefValues.%Set(12, ..BuildByRefNode(.tA12))
        If tByRef13, $Data(tA13) Do pByRefValues.%Set(13, ..BuildByRefNode(.tA13))
        If tByRef14, $Data(tA14) Do pByRefValues.%Set(14, ..BuildByRefNode(.tA14))
        If tByRef15, $Data(tA15) Do pByRefValues.%Set(15, ..BuildByRefNode(.tA15))
        If tByRef16, $Data(tA16) Do pByRefValues.%Set(16, ..BuildByRefNode(.tA16))
        If tByRef17, $Data(tA17) Do pByRefValues.%Set(17, ..BuildByRefNode(.tA17))
        If tByRef18, $Data(tA18) Do pByRefValues.%Set(18, ..BuildByRefNode(.tA18))
        If tByRef19, $Data(tA19) Do pByRefValues.%Set(19, ..BuildByRefNode(.tA19))
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
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

}
