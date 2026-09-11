/// REST handler for ObjectScript command and class method execution.
/// <p>Provides two endpoints for executing ObjectScript code on IRIS:
/// <ul>
///   <li><b>POST /command</b> — Execute an arbitrary ObjectScript command with I/O capture</li>
///   <li><b>POST /classmethod</b> — Invoke a class method by name with positional arguments</li>
/// </ul>
/// Both methods follow the namespace switch/restore pattern from
/// <class>ExecuteMCPv2.REST.Global</class> and use shared utilities
/// from <class>ExecuteMCPv2.Utils</class>.</p>
/// <p><b>34-3-R1 fix (Story 34.4, AC 34.4.2):</b> <var>truncated</var> is surfaced on
/// the error envelope of every failure path reached AFTER I/O capture has begun (the
/// command/target-execution Catch in <method>Execute</method>, and the
/// <method>ExecuteMCPv2.Utils.InvokeWithArgs</method> error path plus its own Catch in
/// <method>ClassMethod</method>) — previously computed there and then silently
/// discarded. The early validation-error one-liners (missing body/command/className/
/// methodName, bad namespace) render before capture ever starts, so there is no
/// truncated state to report for them; this is documented here explicitly rather than
/// left to be inferred, per the point-of-use clause of AC 34.4.2.</p>
Class ExecuteMCPv2.REST.Command Extends ExecuteMCPv2.REST.Base
{

/// Tear down the output-capture I/O redirect established by <method>Execute</method>/
/// <method>ClassMethod</method> (Story 36.3, ledger <c>34-2-R6</c>/<c>34-4-R7</c>).
/// <p><b>34-2-R6:</b> each teardown step — disabling the redirect, <code>Use</code>-ing
/// back to <var>pInitIO</var>, and <code>Close</code>-ing <var>pNull</var> — is now
/// attempted INDEPENDENTLY (its own <code>Try/Catch</code>). Before this fix the three
/// were one unguarded sequence: a throw from the <code>Use</code> step (the middle one)
/// skipped <code>Close</code> entirely, leaking the scratch null device.</p>
/// <p><b>34-4-R7:</b> the defect was a render landing on the scratch null device (HTTP
/// 200, empty body) after a failed <code>Use</code>. What actually closes it is the
/// INDEPENDENT <code>Close</code> step above: closing the current device reverts
/// <code>$IO</code> to <code>$PRINCIPAL</code>, and in a CSP worker the request's
/// <var>pInitIO</var> IS <code>$PRINCIPAL</code> (live probe, Story 36.3 code review,
/// 2026-09-11: inside a <code>/classmethod</code> request the process held exactly
/// <code>|TCP|1972|&lt;pid&gt;</code> = <code>$PRINCIPAL</code> plus the null device) — so
/// even when the <code>Use</code> step throws, <code>$IO</code> can no longer be left on
/// the capture device. If <code>$IO</code> is still not <var>pInitIO</var> after that (a
/// non-principal <var>pInitIO</var>), one corrective <code>Use</code> retry is made.</p>
/// <p>Returns true when <code>$IO</code> ends up equal to <var>pInitIO</var> (or
/// <var>pInitIO</var> is empty — nothing was ever redirected, so there is nothing to
/// restore); false only when a device fault survives the corrective retry. The result is
/// informational (pinned by <class>ExecuteMCPv2.Tests.ClassMethodEdgeTest</class>): the
/// two handlers do not branch on it, because there is no alternate path to the HTTP
/// response stream — a render goes to whatever <code>$IO</code> is either way.</p>
ClassMethod TeardownRedirect(pInitIO As %String, pNull As %String) As %Boolean
{
    Try { Do ##class(%Library.Device).ReDirectIO(0) } Catch {}
    Try { If pInitIO '= "" { Use pInitIO } } Catch {}
    Try { If pNull '= "" { Close pNull } } Catch {}
    If (pInitIO '= "") && ($IO '= pInitIO) {
        Try { Use pInitIO } Catch {}
    }
    Quit (pInitIO = "") || ($IO = pInitIO)
}

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
        ; 34-2-R5: tRedirected is set the MOMENT Open runs (BEFORE Use, not after), so
        ; a subsequent Use failure still runs this method's own cleanup (both Catch
        ; blocks below only attempt teardown when tRedirected is set).
        ; NO $Test check here, deliberately: "Open tNull:::1" is an UNTIMED open — the
        ; "1" fills the MNEMONIC-SPACE slot, the timeout slot is empty — and an untimed
        ; OPEN never sets $Test (live probe, Story 36.3 code review, 2026-09-11: $Test
        ; passes through unchanged; a timed "Open tNull::1" reports $Test=1 even on an
        ; already-open device). A $Test check here read a STALE value from earlier code,
        ; which is what broke every /command and /classmethod request when one was
        ; tried and reverted on 2026-09-11. An untimed Open that fails THROWS into the
        ; outer Catch before tRedirected is set, having opened nothing — there is no
        ; leak path for a $Test check to guard (Rule #54).
        Open tNull:::1
        Set tRedirected = 1
        Use tNull::("^"_$ZNAME)
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

        ; Restore the original I/O state — see TeardownRedirect's own banner
        ; (34-2-R6/34-4-R7): each step is attempted independently, so the capture
        ; device is always closed and $IO can never be left on it when this method
        ; renders below.
        Do ..TeardownRedirect(tInitIO, tNull)
        Set tRedirected = 0

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        If tCmdErrored {
            ; 34-3-R1 fix (Story 34.4, AC 34.4.2): truncated was computed but
            ; discarded on this path — surface it on the error envelope instead of
            ; silently losing it, the same "computed then discarded" shape 34-2-R3
            ; named for RenderResponseBody's own %Status.
            Set tErrorResult = {}
            Do tErrorResult.%Set("truncated", $Get(%ExecuteMCPTruncated, 0), "boolean")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus), , tErrorResult)
            Kill %ExecuteMCPOutput
            Kill %ExecuteMCPTruncated
        } Else {
            Set tOutput = $Get(%ExecuteMCPOutput, "")
            Set tTruncated = $Get(%ExecuteMCPTruncated, 0)
            Kill %ExecuteMCPOutput
            Kill %ExecuteMCPTruncated
            ; Story 34.6 AC 34.6.1: bound the response PAYLOAD to the documented ceiling —
            ; independent of (and applied AFTER) the capture-buffer <MAXSTRING> truncation
            ; above. ApplyOutputCeiling only ever SETS tTruncated (never clears an
            ; already-true value), so this correctly ORs the two truncation causes into
            ; one flag. See ApplyOutputCeiling's banner for the Rule #38 discipline and
            ; the Rule #36 measurement behind the ceiling value.
            Set tOutput = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tOutput, .tTruncated)
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
        ; Any errors during cleanup are swallowed — see TeardownRedirect's own
        ; banner (34-2-R6/34-4-R7) for why each step is attempted independently.
        Try {
            If tRedirected {
                Do ..TeardownRedirect($Get(tInitIO), $Get(tNull))
            }
        } Catch {}
        ; 34-3-R1 fix: capture whatever truncated state exists before it is
        ; killed, and surface it on the error envelope (AC 34.4.2).
        Set tErrorResult = {}
        Do tErrorResult.%Set("truncated", $Get(%ExecuteMCPTruncated, 0), "boolean")
        ; 34-3-R6/34-4-R5: kill BOTH process-private capture slots here (hygiene — it
        ; releases a capture buffer that can be megabytes at the point of failure).
        ; A leftover slot was never OBSERVABLE by a later request: every reader resets
        ; the slot before capture starts (lines above in this method; ClassMethod()'s
        ; own reset; InvokeWithArgs' entry Kill) — pinned by ClassMethodEdgeTest's
        ; stale-slot test, which seeds the slots WITHOUT a harness pre-scrub.
        Kill %ExecuteMCPTruncated
        Kill %ExecuteMCPOutput
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()), , tErrorResult)
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
/// <p><b>Story 34.6 AC 34.6.1:</b> <code>output</code> is additionally bounded by
/// <method>ExecuteMCPv2.Utils.ApplyOutputCeiling</method>'s documented ceiling (folding
/// further into <code>truncated</code>), and <code>byRefValues</code> gains its own
/// node/byte budget in <method>ExecuteMCPv2.Utils.BuildByRefNode</method>, surfaced here
/// as the additive <code>byRefTruncated</code> boolean — reported separately from
/// <code>truncated</code> since the two describe different response fields.</p>
/// <p><b>Story 34.6 code-review finding CR-5:</b> <code>returnValue</code> — the
/// PRIMARY payload field, and the one AC 34.6.1's ceiling did not originally cover — is
/// now ALSO bounded by the same <method>ExecuteMCPv2.Utils.ApplyOutputCeiling</method>
/// ceiling and marker, surfaced as its own additive <code>returnValueTruncated</code>
/// boolean. Reported separately from <code>truncated</code>/<code>byRefTruncated</code>
/// (each describes a different response field) but present, defaulted false, on both
/// error envelopes too, for the same shape symmetry <code>byRefTruncated</code>
/// already established.</p>
/// <p><b>Story 34.7 AC 34.7.3 (ledger <c>34-6-CR2-6</c>):</b> <code>returnValue</code>,
/// <code>byRefValues</code> and <code>output</code> no longer each get their own
/// independent <parameter>ExecuteMCPv2.Utils.OUTPUTCEILING</parameter> — they now share
/// ONE pool of that size, spent in that field order (a Project Lead decision; see
/// <method>ExecuteMCPv2.Utils.InvokeWithArgs</method>'s banner). All three flags are
/// RETAINED unchanged; only the budget arithmetic changes. <code>returnValue</code> is
/// unaffected in practice (always first, so it always sees the full ceiling); a large
/// <code>output</code> capture now absorbs whatever <code>returnValue</code> and
/// <code>byRefValues</code> did not spend, rather than getting its own separate 32768.</p>
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
            ; 34-2-R7 (CLOSED-BY-DECISION, documented alias, not a bug): %Get collapses
            ; an omitted "args" key, a JSON "args":null, and a JSON "args":"" to the same
            ; "" value here — InvokeWithArgs treats all three identically as a zero-
            ; argument call. Rejecting any of them would break a caller relying on the
            ; alias (Rule #19); no code change intended.
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
        ; 34-2-R5: tRedirected is set the MOMENT Open runs, before Use, so a
        ; subsequent Use failure still runs this method's own cleanup. No $Test
        ; check: this Open is UNTIMED and never sets $Test — see Execute()'s matching
        ; comment above for the live probe.
        Open tNull:::1
        Set tRedirected = 1
        Use tNull::("^"_$ZNAME)
        Do ##class(%Library.Device).ReDirectIO(1)

        ; Argument materialization, by-ref marker handling, and the 20-arg dispatch
        ; ladder all live in Utils (keeps this routine small — see method banner).
        ; Story 34.7 AC 34.7.3: tOutputBudget is the new additive trailing output —
        ; whatever remains of the ONE shared response budget after InvokeWithArgs
        ; accounted for both returnValue and byRefValues (see its banner) — passed below
        ; as the explicit ceiling for `output`, last in the shared-budget priority order.
        Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(tClassName, tMethodName, tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated, .tByRefTruncated, .tOutputBudget)

        ; Restore the original I/O state — same discipline as Execute() (Rule #7), via
        ; TeardownRedirect (34-2-R6/34-4-R7: independent steps, so the capture device
        ; is always closed), unconditionally and before rendering.
        Do ..TeardownRedirect(tInitIO, tNull)
        Set tRedirected = 0
        Set tOutput = $Get(%ExecuteMCPOutput, "")
        Kill %ExecuteMCPOutput

        ; Story 34.6 AC 34.6.1, revised by Story 34.7 AC 34.7.3: bound the output field
        ; to whatever the shared response budget has left (tOutputBudget — the full
        ; OUTPUTCEILING on any early-exit path where InvokeWithArgs never reached its own
        ; shared-budget computation, exactly matching pre-34.7 behavior there). Same
        ; discipline as Execute() above otherwise: ApplyOutputCeiling only ever SETS
        ; tTruncated (never clears an already-true value), so this ORs in with
        ; InvokeWithArgs' own capture-overflow signal.
        Set tOutput = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tOutput, .tTruncated, tOutputBudget)

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        If $$$ISERR(tSC) {
            ; 34-3-R1 fix (Story 34.4, AC 34.4.2): tTruncated is always defined by
            ; InvokeWithArgs (set to 0 at entry) even on its error return — surface
            ; it here instead of discarding it. tByRefTruncated is likewise always
            ; defined (Story 34.6) — a genuine target error skips byRefValues assembly
            ; entirely, so it stays 0, but the field is still rendered for shape
            ; consistency with the success envelope.
            Set tErrorResult = {}
            Do tErrorResult.%Set("truncated", $Get(tTruncated, 0), "boolean")
            Do tErrorResult.%Set("byRefTruncated", $Get(tByRefTruncated, 0), "boolean")
            Do tErrorResult.%Set("returnValueTruncated", $Get(tReturnValueTruncated, 0), "boolean")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC), , tErrorResult)
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
        ; Story 34.6 code-review finding CR-5: returnValue is the PRIMARY payload field,
        ; and was the one field AC 34.6.1's ceiling did not cover — a target returning a
        ; large string (a file read, a serialized report, ...) shipped fully unbounded.
        ; Apply the SAME documented ceiling and marker, with its own additive
        ; returnValueTruncated flag (symmetric with truncated/byRefTruncated — the
        ; story's own established one-flag-per-response-field pattern) rather than
        ; folding it into the unrelated truncated flag, which describes only output.
        Set tReturnValueTruncated = 0
        Set tReturnStr = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tReturnStr, .tReturnValueTruncated)
        Set tResult = {}
        Do tResult.%Set("returnValue", tReturnStr)
        Do tResult.%Set("argCount", tArgCount, "number")
        Do tResult.%Set("output", tOutput)
        Do tResult.%Set("byRefValues", tByRefValues)
        Do tResult.%Set("truncated", tTruncated, "boolean")
        Do tResult.%Set("byRefTruncated", tByRefTruncated, "boolean")
        Do tResult.%Set("returnValueTruncated", tReturnValueTruncated, "boolean")
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        ; Ensure redirection is restored on unexpected error before rendering — see
        ; TeardownRedirect's own banner (34-2-R6/34-4-R7).
        Try {
            If tRedirected {
                Do ..TeardownRedirect($Get(tInitIO), $Get(tNull))
            }
        } Catch {}
        Kill %ExecuteMCPOutput
        ; 34-3-R6/34-4-R5: kill %ExecuteMCPTruncated here too (hygiene, symmetric with
        ; Execute()'s Catch). A leftover flag was never observable by a later request:
        ; InvokeWithArgs Kills it at entry before any capture can set it — pinned by
        ; ClassMethodEdgeTest's stale-slot test.
        Kill %ExecuteMCPTruncated
        Set $NAMESPACE = tOrigNS
        ; 34-3-R1 fix: tTruncated may be undefined here (an exception before
        ; InvokeWithArgs returned), so default it rather than assume it exists. Same for
        ; tByRefTruncated (Story 34.6) and tReturnValueTruncated (code review CR-5) —
        ; an exception this early means returnValue was never computed either.
        Set tErrorResult = {}
        Do tErrorResult.%Set("truncated", $Get(tTruncated, 0), "boolean")
        Do tErrorResult.%Set("byRefTruncated", $Get(tByRefTruncated, 0), "boolean")
        Do tErrorResult.%Set("returnValueTruncated", $Get(tReturnValueTruncated, 0), "boolean")
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()), , tErrorResult)
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
