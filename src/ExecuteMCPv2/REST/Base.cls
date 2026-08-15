/// Common base class for <class>ExecuteMCPv2.REST.*</class> handlers.
/// <p>Every handler in this package previously extended <class>%Atelier.REST</class>
/// directly and called its inherited <method>RenderResponseBody</method> via the
/// <code>Do ..RenderResponseBody(...)</code> form, which discards the method's
/// returned <c>%Status</c> at all 738 call sites across 15 handlers (count derived
/// mechanically from <code>..RenderResponseBody(</code> occurrences, Rule #51 — the
/// "745" carried by the story spec was a hand-authored figure). This class
/// intercepts that single inherited entry point so every one of those call sites is
/// covered without a single call-site edit (Story 34.4, AC 34.4.1).</p>
/// <p><b>What the override does.</b> <class>%Atelier.REST</class>'s own
/// <method>RenderResponseBody</method> interleaves <code>Write</code> calls with
/// <code>%ToJSON()</code> calls directly against the response device: it writes the
/// opening brace and the <code>"status"</code> key, then <code>%ToJSON()</code>s the
/// status part, writes <code>"console"</code>, <code>%ToJSON()</code>s the message
/// part, writes <code>"result"</code>, <code>%ToJSON()</code>s the result part, then
/// writes the closing brace. If serialization of the message or result part fails
/// partway through, everything written so far has already reached the client as an
/// HTTP 200 with a truncated, invalid JSON body and no error signal — the exact
/// failure class Epic 34 exists to remove, just triggered from the response-render
/// path instead of the capture path (deferred-work ledger item <c>34-2-R3</c>).</p>
/// <p>This override serializes the message and result parts into a throw-away
/// <class>%Stream.TmpCharacter</class> FIRST, before anything is written to the real
/// response. If that pre-flight succeeds, nothing has been written yet, so delegating
/// to <code>##super()</code> reproduces the parent's output byte-for-byte (AC 34.4.4
/// back-compat). Note the delegation passes the LOCALLY DEFAULTED copies
/// (<var>tMsgPart</var>/<var>tResPart</var>), never the raw formals — see the
/// <method>RenderResponseBody</method> comment for why re-referencing an omitted
/// formal at that call site is a live outage, and why the defaulted copies are
/// nonetheless byte-equivalent to the parent's own defaulting. If the pre-flight fails,
/// nothing has been written yet either, so a minimal, guaranteed-serializable error
/// envelope — built from empty console/result parts and the real pre-flight failure
/// text (via <method>ExecuteMCPv2.Utils.SanitizeError</method>, Rule #9) — is
/// substituted instead of a truncated one.</p>
/// <p><b>Scope limits — what this pre-flight does NOT cover.</b> Stated explicitly so
/// the guard is not read as broader than it is:</p>
/// <ul>
/// <li><b>The status part is not pre-flighted.</b> The parent serializes
/// <var>pStatus</var> (via <method>StatusToJSON</method>) FIRST, before the console and
/// result parts. A failure there still yields an empty or <c>{"status":</c>-truncated
/// body. It is deliberately not guarded: the substitution envelope must itself render a
/// status through that same path, so pre-flighting it is circular. In practice
/// <method>StatusToJSON</method> builds a well-formed object from any <c>%Status</c>.</li>
/// <li><b>Only serializability is proven, not the device write.</b> The pre-flight
/// serializes into a character stream; the parent writes through the CSP response device
/// (charset translation, Web-Gateway buffering). A payload that serializes cleanly can
/// still fail on the device — e.g. a client disconnecting mid-write — and that
/// <c>%Status</c> is still discarded by the <c>Do</c> call form. This class narrows the
/// failure class; it does not eliminate it.</li>
/// </ul>
/// <p><b>Severity note:</b> <c>34-2-R3</c> has <b>no reachable trigger today</b>. Its
/// known cause — a value whose JSON serialization outright fails reaching a dynamic
/// entity — was fixed at the root during the Story 34.2 review. This class is
/// defense-in-depth: the failure pattern lives in <method>RenderResponseBody</method>
/// itself, which is shared by every <c>ExecuteMCPv2.REST.*</c> handler, on the payload
/// surface Epic 34 enlarged the most.</p>
Class ExecuteMCPv2.REST.Base Extends %Atelier.REST
{

/// Pre-flight JSON serialization of <var>pMsgPart</var>/<var>pResPart</var> before
/// delegating to the inherited implementation. See the class banner for the full
/// rationale.
/// <p>Signature pinned live from <class>%Atelier.REST</class> (IRIS 2026.1 Build
/// 235U) via <c>iris_doc_get</c> before writing this override — parameter names,
/// types, and return type match exactly. Do not change this signature; a mismatch
/// either fails to compile or silently fails to override the inherited method.</p>
ClassMethod RenderResponseBody(pStatus As %Status, pMsgPart As %DynamicArray, pResPart As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Try {
        ; Mirror %Atelier.REST.RenderResponseBody's own default-application so the
        ; pre-flight walks exactly what the parent implementation would walk.
        ; pMsgPart/pResPart are frequently UNDEFINED here — every "Do
        ; ..RenderResponseBody(status, , result)" call site (the overwhelming
        ; majority) omits pMsgPart positionally, and error paths often omit both —
        ; so $Get() (never a bare Set) is required to read them without an
        ; <UNDEFINED> that this method's own Try/Catch would swallow silently,
        ; leaving nothing written to the response (Rule #15 exempts this: pMsgPart
        ; is a local variable/parameter reference, not a method call).
        Set tMsgPart = $Get(pMsgPart)
        Set tResPart = $Get(pResPart)
        If '$IsObject(tMsgPart) Set tMsgPart = []
        If '$IsObject(tResPart) Set tResPart = {}

        Set tPreflightOK = 1
        Set tPreflightStatus = $$$OK
        Try {
            ; Parity with the parent's own %IsA branch (%Atelier.REST.RenderResponseBody):
            ; a %Atelier.v1.Utils.DocumentStreamAdapter is NOT a dynamic entity — its
            ; %ToJSON(pLevel, pFormat) WRITES TO THE CURRENT DEVICE, so handing it the
            ; scratch stream would bind it to pLevel and emit the document body to the
            ; real response during "pre-flight", then again from ##super(). No handler in
            ; this package passes that shape today (nothing calls the inherited
            ; ServeDoc/ServeXml), so this is parity with the method being overridden
            ; rather than speculative generality: an override must not silently diverge
            ; from its parent's contract for a shape the parent explicitly supports.
            If tResPart.%IsA("%Atelier.v1.Utils.DocumentStreamAdapter") {
                ; Nothing to pre-flight — defer entirely to the parent's own branch.
            } Else {
                Set tScratch = ##class(%Stream.TmpCharacter).%New()
                Do tMsgPart.%ToJSON(tScratch)
                Set tScratch = ##class(%Stream.TmpCharacter).%New()
                Do tResPart.%ToJSON(tScratch)
            }
        } Catch exPreflight {
            ; DISCRIMINATED, in the fail-safe direction (Rule #44; same discipline the
            ; Story 34.3 review imposed on Redirects()'s undiscriminated Catch, and that
            ; Utils.InvokeWithArgs applies to <MAXSTRING>). The pre-flight materializes
            ; the whole payload into IRISTEMP, which the parent's device-targeted
            ; %ToJSON() never does — so it can fail for reasons that have NOTHING to do
            ; with serializability (temp-DB pressure on a large but perfectly valid
            ; response). Substituting an error envelope for those would DESTROY a good
            ; payload: a brand-new regression on the hot path of all 738 renders.
            ; Mis-substituting is strictly worse than mis-passing: falling through to
            ; ##super() is exactly the pre-Story-34.4 behavior, never a new failure.
            ; So only a genuine serialization failure substitutes; resource/environment
            ; errors fall through and let the parent render as it always did.
            If $ListFind($ListBuild("<STORE>", "<FILEFULL>", "<NOTOPEN>", "<DIRECTORY>", "<PROTECT>", "<DISCONNECT>", "<INTERRUPT>"), exPreflight.Name) > 0 {
                Set tPreflightOK = 1
            } Else {
                Set tPreflightOK = 0
                Set tPreflightStatus = exPreflight.AsStatus()
            }
        }

        If tPreflightOK {
            ; Success path. Pass the already-defaulted tMsgPart/tResPart, NOT the
            ; raw pMsgPart/pResPart formals: those are frequently undefined (see
            ; above), and re-referencing an undefined by-value argument AT THIS
            ; CALL SITE evaluates it immediately and throws <UNDEFINED> before
            ; control ever reaches ##super() — this was caught live (Story 34.4
            ; dev) as a real empty-response regression, not a hypothetical one.
            ; tMsgPart/tResPart are exactly what the parent's own default-
            ; application would have produced from pMsgPart/pResPart, so this is
            ; still byte-identical to the inherited implementation (AC 34.4.4).
            Set tSC = ##super(pStatus, tMsgPart, tResPart)
        } Else {
            ; Nothing has reached the client yet, so this is one clean envelope,
            ; never a truncated one. Empty console/result parts are guaranteed
            ; serializable; the real failure text is preserved via SanitizeError
            ; (Rule #9) rather than masked with generic text.
            ; The CALLER's own pStatus is folded in rather than replaced: the majority
            ; of substitutable sites are error renders (e.g. Command.cls passes
            ; SanitizeError(tCmdStatus)), and dropping pStatus would tell the client
            ; only "%ToJSON failed" while silently discarding the application error
            ; that caused the response in the first place. $$$ADDSC of an OK pStatus
            ; yields just the pre-flight status, so the success-render case is
            ; unchanged.
            Set tSubStatus = ##class(ExecuteMCPv2.Utils).SanitizeError(tPreflightStatus)
            If $$$ISERR(pStatus) Set tSubStatus = $$$ADDSC(pStatus, tSubStatus)
            Set tSC = ##super(tSubStatus, [], {})
        }
    } Catch ex {
        ; REACHABILITY (Rule #54 — this branch is deliberate, not dead code).
        ; It is NOT reachable via ##super(): %Atelier.REST.RenderResponseBody wraps
        ; its whole body in its own Try/Catch and always returns a %Status rather
        ; than throwing. It IS reachable via the two calls in this method that sit
        ; OUTSIDE the inner pre-flight Try — ##class(ExecuteMCPv2.Utils).SanitizeError()
        ; (which has no internal error trapping of its own) and exPreflight.AsStatus()
        ; in the pre-flight Catch. Both are only reached once the pre-flight has
        ; already failed, so this is a second-order guard.
        ; CONSEQUENCE, stated plainly: nothing has been written to the device at this
        ; point, and every one of the 738 call sites uses the "Do" form that discards
        ; the status returned here — so this path yields an empty HTTP 200. That is
        ; accepted deliberately rather than papered over with a last-resort render:
        ; a render here would itself be a doubly-unreachable, untestable branch
        ; (Rule #54 cuts against adding it). Revisit if the pre-flight ever gains a
        ; reachable trigger.
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

}
