/// REST handler for ObjectScript command and class method execution.
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
    Set tCmdErrored = 0
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

        ; Set up I/O redirect to capture Write output via a SEPARATE null device.
        ; Binding the mnemonic on $IO (the HTTP response stream) leaves device
        ; parameters altered even after ReDirectIO(0) + bare `Use tInitIO`, which
        ; causes CSP's response-body flush to silently drop the first ~8KB of the
        ; JSON envelope when it exceeds the buffer boundary. By doing the redirect
        ; on a throw-away null device, the HTTP response stream stays pristine.
        Set %ExecuteMCPOutput = ""
        Set %ExecuteMCPTruncated = 0
        Set tInitIO = $IO
        Set tNull = ##class(%Library.Device).GetNullDevice()
        Open tNull:::1
        Use tNull::("^"_$ZNAME)
        Set tRedirected = 1
        Do ##class(%Library.Device).ReDirectIO(1)

        ; Execute the command
        Try {
            XECUTE tCommand
        } Catch exCmd {
            ; Flag the error so the success render below is skipped. The I/O
            ; restore + RenderResponseBody run AFTER the catch so a single
            ; response is emitted and the redirect is guaranteed to be off
            ; before the JSON envelope is written (Bug #1).
            Set tCmdErrored = 1
            Set tCmdStatus = exCmd.AsStatus()
        }

        ; Restore the original I/O state. Disable redirect, switch back to the
        ; original HTTP response stream ($IO), and close the scratch null device.
        ; Since the mnemonic was bound on tNull (not tInitIO), $IO is untouched
        ; and CSP's response buffer flush path is clean.
        Do ##class(%Library.Device).ReDirectIO(0)
        Use tInitIO
        Close tNull
        Set tRedirected = 0

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        If tCmdErrored {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus))
            Kill %ExecuteMCPOutput
            Kill %ExecuteMCPTruncated
        } Else {
            Set tOutput = $Get(%ExecuteMCPOutput, "")
            Set tTruncated = $Get(%ExecuteMCPTruncated, 0)
            Kill %ExecuteMCPOutput
            Kill %ExecuteMCPTruncated
            Set tResult = {}
            Do tResult.%Set("output", tOutput)
            ; Additive (Rule #19): 34-2-R1 fix — a capture-buffer <MAXSTRING> no longer
            ; aborts the command with an opaque error; it now completes with whatever was
            ; captured up to the ceiling, flagged here rather than silently.
            Do tResult.%Set("truncated", tTruncated, "boolean")
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    } Catch ex {
        ; Ensure redirection is restored on unexpected error before rendering.
        ; Switch back to the untouched HTTP response stream; close the null
        ; device if it was opened. Any errors during cleanup are swallowed.
        Try {
            If tRedirected {
                Do ##class(%Library.Device).ReDirectIO(0)
                If $Get(tInitIO) '= "" { Use tInitIO }
                If $Get(tNull) '= "" { Close tNull }
            }
        } Catch {}
        Kill %ExecuteMCPTruncated
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit tSC
}

/// Invoke a class method by name with positional arguments and captured I/O output.
/// <p>Reads a JSON body with <code>className</code>, <code>methodName</code>,
/// optional <code>args</code> (JSON array of up to 20 positional parameters — a plain
/// scalar is passed by value; a <code>{byRef, value?}</code> marker object is passed
/// by reference and its post-call value is returned in the additive
/// <code>byRefValues</code> field, keyed by zero-based index), and optional
/// <code>namespace</code>. Uses <code>$ClassMethod()</code> for dynamic invocation.
/// Argument parsing, marker handling, and the 20-argument dispatch ladder live in
/// <method>InvokeWithArgs</method> on <class>ExecuteMCPv2.Utils</class> — kept out of
/// this routine so the 21-branch ladder cannot push <method>ClassMethod</method> into a
/// separately generated <c>.int</c> from <method>Redirects</method> below (Story 34.1
/// Constraint C-2: <code>$ZNAME</code> binds the currently executing routine, and the
/// mnemonic entry points must live in that same routine).</p>
/// <p>Captures <code>Write</code> output from the target via the same null-device
/// redirect pattern as <method>Execute</method> above (see its comment for why the
/// redirect must bind on a throw-away null device rather than <code>$IO</code>), and
/// returns it in the additive <code>output</code> field. An additive
/// <code>truncated</code> boolean flags the case where the captured output hit the
/// platform's long-string ceiling mid-target-execution (AC 34.2.6/R2) — the response
/// still succeeds, with whatever was captured/mutated before the limit.</p>
ClassMethod ClassMethod() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Set tRedirected = 0
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

        ; Set up I/O redirect to capture Write output via a SEPARATE null device — see
        ; Execute()'s comment above for why this must never bind on $IO. The mnemonic
        ; entry points (Redirects(), below) must stay compiled into this SAME routine
        ; (Story 34.1 Constraint C-2) for "^"_$ZNAME to resolve them; verified after
        ; every compile in this story via iris_doc_list(generated=true).
        Set %ExecuteMCPOutput = ""
        Set tInitIO = $IO
        Set tNull = ##class(%Library.Device).GetNullDevice()
        Open tNull:::1
        Use tNull::("^"_$ZNAME)
        Set tRedirected = 1
        Do ##class(%Library.Device).ReDirectIO(1)

        ; Argument materialization, by-ref marker handling, and the 20-arg dispatch
        ; ladder all live in Utils (keeps this routine small — see method banner).
        Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(tClassName, tMethodName, tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)

        ; Restore the original I/O state — same discipline as Execute() (Rule #7):
        ; disable redirect, switch back to the untouched initial device, close the
        ; scratch null device, unconditionally and before rendering.
        Do ##class(%Library.Device).ReDirectIO(0)
        Use tInitIO
        Close tNull
        Set tRedirected = 0
        Set tOutput = $Get(%ExecuteMCPOutput, "")
        Kill %ExecuteMCPOutput

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
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
        Do tResult.%Set("output", tOutput)
        Do tResult.%Set("byRefValues", tByRefValues)
        Do tResult.%Set("truncated", tTruncated, "boolean")
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        ; Ensure redirection is restored on unexpected error before rendering.
        Try {
            If tRedirected {
                Do ##class(%Library.Device).ReDirectIO(0)
                If $Get(tInitIO) '= "" { Use tInitIO }
                If $Get(tNull) '= "" { Close tNull }
            }
        } Catch {}
        Kill %ExecuteMCPOutput
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
/// <p><b>34-2-R1 fix (Story 34.3):</b> each label's append is wrapped in its own
/// <code>Try/Catch</code> <b>discriminated on <code>&lt;MAXSTRING&gt;</code></b> — any other
/// exception (e.g. <code>&lt;STORE&gt;</code>) is re-thrown unchanged, so a genuine crash is
/// never mis-reported as a benign truncation and the target's/dispatcher's own error
/// handling still sees it (the same discrimination the Story 34.2 review required of
/// <method>ExecuteMCPv2.Utils</method>.<method>InvokeWithArgs</method>, applied here at the
/// point the exception is now absorbed). A capture-buffer <code>&lt;MAXSTRING&gt;</code> (the
/// platform's long-string ceiling, reached when <var>%ExecuteMCPOutput</var> itself grows
/// too large) is absorbed HERE and recorded in the process-private
/// <var>%ExecuteMCPTruncated</var> flag instead of being thrown to the caller of
/// <code>Write</code>. Previously that exception propagated out of <code>Write</code>
/// into whatever code issued it — including a TARGET method's own
/// <code>Try/Catch</code>, which could swallow it before
/// <method>ExecuteMCPv2.Utils</method>.<method>InvokeWithArgs</method>'s dispatch
/// <code>Catch</code> ever saw it, producing a silent partial
/// (<var>truncated</var> staying <code>false</code> even though output was genuinely cut
/// off — ledger item <c>34-2-R1</c>). Now the target's <code>Write</code> call simply
/// returns normally (the target completes instead of aborting) and the flag is the sole,
/// unconditionally reliable signal — read by <method>InvokeWithArgs</method> for the
/// <code>/classmethod</code> endpoint and by <method>Execute</method> above for the
/// <code>/command</code> endpoint's own additive <var>truncated</var> field.</p>
ClassMethod Redirects() [ Internal, Private, ProcedureBlock = 0 ]
{
    Quit
wstr(s) New mcpex Try { Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ s } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
wchr(a) New mcpex Try { Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(a) } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
wnl New mcpex Try { Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(10) } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
wff New mcpex Try { Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(12) } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
wtab(n) New chars,mcpex Try { Set $Piece(chars, " ", n+1) = "" Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ chars } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
rstr(len,time) Quit ""
rchr(time) Quit ""
}

}
