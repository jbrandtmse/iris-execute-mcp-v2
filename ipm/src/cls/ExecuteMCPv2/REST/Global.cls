/// REST handler for global operations (get, set, kill, list).
/// <p>Provides CRUD operations on IRIS globals via the custom REST
/// endpoint <code>/api/executemcp/v2/global</code>. Each method follows
/// the namespace switch/restore pattern and uses shared validation
/// utilities from <class>ExecuteMCPv2.Utils</class>.</p>
Class ExecuteMCPv2.REST.Global Extends ExecuteMCPv2.REST.Base
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
/// <p><b>Security (Story 36.4 / ledger <code>36-2-CR-1</code>):</b> caller text is
/// NEVER evaluated — every subscript is emitted as a canonical number or as ONE
/// well-formed string literal, never as code. Before the fix, a string piece was
/// wrapped in quotes WITHOUT doubling a quote it contained, so a quote inside the
/// value could close the literal and the rest of the piece ran as ObjectScript
/// through the callers' <code>@tRef</code> indirection. Now every quote in a
/// string VALUE is doubled before the value is wrapped once, so the literal can
/// only end at its own closing quote. Quotes, <code>_</code>, <code>$</code>,
/// <code>@</code>, <code>(</code>, <code>)</code>, <code>^</code>, <code>|</code>
/// and control characters are all stored as literal subscript data (a control
/// character inside a string literal is inert under indirection — verified live
/// at the Story 36.4 code review for <code>$C(0)</code>, <code>$C(9)</code>,
/// <code>$C(10)</code>, <code>$C(13)</code>, <code>$C(127)</code>,
/// <code>$C(133)</code>, <code>$C(150)</code> and <code>$C(8232)</code>).</p>
/// <p>Parsing rules (the tool contract): <code>pSubscripts</code> is split on
/// EVERY comma — a string key containing a comma is not supported. Leading and
/// trailing whitespace around each piece is trimmed (<code>$ZStrip</code> class
/// <code>"W"</code>: space, tab and non-breaking space — unchanged pre-fix
/// behavior). An empty piece is skipped. A canonical number (<code>1</code>,
/// <code>-1.5</code>) is emitted unquoted. Any other piece is a string: if it is
/// wrapped in quotes (the documented <code>"key1","key2"</code> convention) the
/// value is the text between them; otherwise the whole piece is the value. In
/// both cases a doubled quote (<code>""</code>) decodes to one literal quote,
/// ObjectScript's own string-literal convention (<code>"a""b"</code> and
/// <code>a""b</code> both address the subscript <code>a"b</code>). An UNWRAPPED
/// piece that begins or ends with an unmatched quote (an odd-length run of
/// quotes at either edge — what a quoted key containing a comma looks like after
/// the comma split, e.g. <code>"a,b"</code>) is rejected with a clear error
/// rather than silently addressing a different node.</p>
/// <p>Back-compat (Rule #19): every input for which the pre-fix builder produced
/// a valid literal reference yields the byte-identical reference string now —
/// mechanically verified at the Story 36.4 code review (20,000 random hostile
/// inputs, pre-fix vs fixed builder, 0 mismatches). The only inputs whose
/// outcome changed are those that previously evaluated as code or failed to
/// parse. "Escape-in-place" was chosen over a <code>$Name</code>-built reference
/// (probe-first, Rule #16) because <code>$Name</code> canonicalizes a
/// numeric-looking string subscript (<code>^G("1")</code> renders as
/// <code>^G(1)</code> — same node, different reference STRING).</p>
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
            ; Numeric subscript — use as-is. A piece reaches this branch only
            ; when it equals its own canonical number (digits, "-" and "."),
            ; which is inert unquoted.
            Set $Piece(tSubList, ",", i) = tSub
        } Else {
            ; String subscript (Story 36.4). Recover the caller's intended
            ; VALUE, then emit it as ONE escaped string literal.
            If ($Length(tSub) >= 2) && ($Extract(tSub, 1) = """") && ($Extract(tSub, *) = """") {
                ; Wrapped in quotes (the documented convention): the value is
                ; the text between them.
                Set tValue = $Extract(tSub, 2, *-1)
            } Else {
                ; Unwrapped. An odd-length run of quotes at either edge is an
                ; unmatched quote — the shape a quoted key containing a comma
                ; takes after the comma split. Reject it instead of silently
                ; addressing a different node (pre-fix, every such piece was a
                ; <SYNTAX> error, a <SUBSCRIPT> error or evaluated as code).
                Set tLead = $Length(tSub) - $Length($ZStrip(tSub, "<", """"))
                Set tTrail = $Length(tSub) - $Length($ZStrip(tSub, ">", """"))
                If (tLead # 2) || (tTrail # 2) {
                    Throw ##class(%Exception.StatusException).CreateFromStatus($$$ERROR($$$GeneralError, "Invalid subscript: a piece begins or ends with an unmatched quote. Wrap a string key in quotes and double any quote inside it; a comma always separates subscripts, so a string key containing a comma is not supported"))
                }
                Set tValue = tSub
            }
            ; Decode ObjectScript's doubled-quote convention ("" is one quote)
            ; for wrapped and unwrapped pieces alike, so every input that
            ; addressed a literal node before the fix still addresses the
            ; byte-identical reference (Rule #19).
            Set tValue = $Replace(tValue, """""", """")
            ; THE FIX: double EVERY quote in the value, then wrap once. The
            ; literal can now only end at its own closing quote, whatever the
            ; value contains, so no part of it is ever evaluated as code.
            Set $Piece(tSubList, ",", i) = """" _ $Replace(tValue, """", """""") _ """"
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

}
