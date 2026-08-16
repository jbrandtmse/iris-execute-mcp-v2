/// Target methods used by <class>ExecuteMCPv2.Tests.ClassMethodArgsTest</class> to
/// exercise <method>ExecuteMCPv2.Utils.InvokeWithArgs</method>'s argument ladder,
/// by-ref marker handling, and dispatch through <code>$ClassMethod</code>.
/// <p>Not part of the bootstrap manifest (Rule #39 — test fixtures stay out).</p>
Class ExecuteMCPv2.Tests.ClassMethodArgsFixture Extends %RegisteredObject
{

/// Zero-argument target.
ClassMethod Target0() As %String
{
    Quit "zero-ok"
}

/// Plain value-only formal — target never assigns it, so a dot-passed local should be
/// left exactly as-passed (no mutation).
ClassMethod TargetPlainReadOnly(pVal As %String) As %String
{
    Quit "seen:"_pVal
}

/// Output formal (undefined-in expected when the caller wants Output-style semantics).
ClassMethod TargetOutput(Output pOut As %String) As %String
{
    Set tWasUndef = '$Data(pOut)
    Set pOut = "output-set-wasUndef"_tWasUndef
    Quit "ok"
}

/// Output formal that the target deliberately never assigns — for the
/// "undefined out-value" residual-risk case (34.1 Residual Risk).
ClassMethod TargetOutputNeverAssigned(Output pOut As %String) As %String
{
    Quit "ok-untouched"
}

/// ByRef formal (defined-in expected).
ClassMethod TargetByRef(ByRef pVal As %String) As %String
{
    Set pVal = pVal_"-mutated"
    Quit "ok"
}

/// Output formal that receives a subscripted-array shape — the idiomatic IRIS
/// Output pattern (AC 34.2.6/R1's motivating case).
ClassMethod TargetSubscriptOutput(Output pOut) As %String
{
    Set pOut = "topvalue"
    Set pOut("k1") = "v1"
    Set pOut("k2", "nested") = "v2"
    Quit "ok"
}

/// Output formal that receives ONLY subscripts, no top-level value ($Data=10 case).
ClassMethod TargetSubscriptOnlyOutput(Output pOut) As %String
{
    Set pOut("a") = "alpha"
    Set pOut("b") = "beta"
    Quit "ok"
}

/// ByRef formal that the target mutates to hold an OBJECT REFERENCE rather than a
/// scalar or subscript tree — for the OREF-out-value guard regression test.
ClassMethod TargetByRefOref(ByRef pVal) As %String
{
    Set pVal = ##class(%Library.DynamicObject).%New()
    Quit "ok"
}

/// ByRef formal mutated to hold an OREF that ALSO has subscripts ($Data=11) — the shape
/// that bypassed the original guard (which lived inside BuildByRefNode's $Data=1 arm).
/// Code review reproduced live that an unguarded OREF here reaches %ToJSON inside
/// RenderResponseBody and TRUNCATES the response body into unparseable JSON with
/// HTTP 200 — the original non-JSON-response bug returning by another door.
/// Deliberately a NON-dynamic OREF: %Library.DynamicObject would nest silently as {},
/// which hides the defect; a plain %RegisteredObject cannot be serialized at all.
ClassMethod TargetByRefOrefWithSubscripts(ByRef pVal) As %String
{
    Set pVal = ##class(ExecuteMCPv2.Tests.ClassMethodArgsFixture).%New()
    Set pVal("meta") = "has-subscript"
    Quit "ok"
}

/// Output formal whose CHILD node holds an OREF and has its own subscripts — proves the
/// guard applies at every recursion depth, not just the top-level node.
ClassMethod TargetNestedOrefOutput(Output pOut) As %String
{
    Set pOut("child") = ##class(ExecuteMCPv2.Tests.ClassMethodArgsFixture).%New()
    Set pOut("child", "leaf") = "x"
    Quit "ok"
}

/// Target that throws an ordinary runtime error — pins AC 34.2.1's "behavior on target
/// runtime error unchanged" clause, which previously had no fixture at all.
ClassMethod TargetThrows() As %String
{
    Set tZero = 0
    Quit 1 / tZero
}

/// Target whose OWN concatenation overflows the platform long-string ceiling, writing
/// NOTHING — a genuine target failure that merely happens to be a <MAXSTRING>. It must
/// surface as a real error, never as success+truncated:true (AC 34.2.6/R2 "never a
/// silent partial"). Code review reproduced the pre-fix false positive live.
ClassMethod TargetThrowsOwnMaxString() As %String
{
    Set tX = "A"
    For i=1:1:30 {
        Set tX = tX_tX
    }
    Quit "never-reached"
}

/// Target throwing an ordinary error whose MESSAGE TEXT merely CONTAINS the literal
/// token <MAXSTRING> — the substring-match false positive found at code review.
ClassMethod TargetThrowsTextMentioningMaxString() As %String
{
    Throw ##class(%Exception.General).%New("MyError", 5001, , "target failed while parsing <MAXSTRING> sentinel token")
}

/// Ten-argument target, all ByRef, each mutated — AC 34.2.3 requires rung 10 to be
/// covered, and rung 10 is the boundary between the OLD 10-arg ceiling and the new 20.
/// Code review found no test dispatched it (the test named "TenArgs" passes ONE arg).
ClassMethod Target10(ByRef p0, ByRef p1, ByRef p2, ByRef p3, ByRef p4, ByRef p5, ByRef p6, ByRef p7, ByRef p8, ByRef p9) As %String
{
    Set p0=p0_"-m", p1=p1_"-m", p2=p2_"-m", p3=p3_"-m", p4=p4_"-m"
    Set p5=p5_"-m", p6=p6_"-m", p7=p7_"-m", p8=p8_"-m", p9=p9_"-m"
    Quit "10-ok"
}

/// Two-argument target: one plain value, one ByRef — mixed signature.
ClassMethod TargetMixed(pScalar As %String, ByRef pByRef As %String) As %String
{
    Set pByRef = pByRef_"-mixedmutated"
    Quit "scalar-seen:"_pScalar
}

/// 20-argument target, all ByRef, each mutated with a position-specific suffix —
/// for AC 34.2.3's arity-20 coverage.
ClassMethod Target20(ByRef p0, ByRef p1, ByRef p2, ByRef p3, ByRef p4, ByRef p5, ByRef p6, ByRef p7, ByRef p8, ByRef p9, ByRef p10, ByRef p11, ByRef p12, ByRef p13, ByRef p14, ByRef p15, ByRef p16, ByRef p17, ByRef p18, ByRef p19) As %String
{
    ; Guarded with $Data so this also works when fewer than 20 actual args were
    ; supplied by the caller — unsupplied trailing formals are truly unbound, not
    ; merely undefined, and referencing them directly raises <UNDEFINED>.
    If $Data(p0) Set p0=p0_"-m"
    If $Data(p1) Set p1=p1_"-m"
    If $Data(p2) Set p2=p2_"-m"
    If $Data(p3) Set p3=p3_"-m"
    If $Data(p4) Set p4=p4_"-m"
    If $Data(p5) Set p5=p5_"-m"
    If $Data(p6) Set p6=p6_"-m"
    If $Data(p7) Set p7=p7_"-m"
    If $Data(p8) Set p8=p8_"-m"
    If $Data(p9) Set p9=p9_"-m"
    If $Data(p10) Set p10=p10_"-m"
    If $Data(p11) Set p11=p11_"-m"
    If $Data(p12) Set p12=p12_"-m"
    If $Data(p13) Set p13=p13_"-m"
    If $Data(p14) Set p14=p14_"-m"
    If $Data(p15) Set p15=p15_"-m"
    If $Data(p16) Set p16=p16_"-m"
    If $Data(p17) Set p17=p17_"-m"
    If $Data(p18) Set p18=p18_"-m"
    If $Data(p19) Set p19=p19_"-m"
    Quit "20-ok"
}

/// Writes two short lines — for capture-through-dispatch verification.
ClassMethod TargetWriteTwoLines() As %String
{
    Write "line1"
    Write $Char(10)
    Write "line2"
    Quit "wrote"
}

/// Writes a very large amount of output via repeated FIXED-size Write calls, past the
/// platform's long-string ceiling — for AC 34.2.6/R2's <MAXSTRING> boundary test. Writes
/// the SAME fixed-size chunk repeatedly (never doubles a local) so only the capture
/// buffer (<code>%ExecuteMCPOutput</code>) can overflow. A doubling local, by contrast,
/// risks tripping its OWN independent <MAXSTRING> around iteration ~21-22 — after the
/// Story 34.3 <method>ExecuteMCPv2.REST.Command</method>.<method>Redirects</method> fix
/// (ledger item 34-2-R1), a capture overflow no longer aborts the target at all, so the
/// old doubling design would instead run to completion and then hit the LOCAL's own
/// <MAXSTRING> — a genuine target error, not the capture-overflow path this fixture
/// exists to exercise (Story 34.3 rework).
ClassMethod TargetWriteHuge() As %String
{
    Set tChunk = $Translate($Justify("", 5000), " ", "X")
    For i=1:1:1000 {
        Write tChunk
    }
    Quit "wrote-huge"
}

/// Same capture-overflow shape as <method>TargetWriteHuge</method>, but wraps each
/// <code>Write</code> in the TARGET's OWN <code>Try/Catch</code> that swallows any
/// exception — the exact shape ledger item 34-2-R1 reported: before the Story 34.3
/// <method>Redirects</method> fix, a capture <MAXSTRING> propagated THROUGH
/// <code>Write</code> and could be absorbed by a target's own exception handling before
/// <method>ExecuteMCPv2.Utils</method>.<method>InvokeWithArgs</method>'s dispatch
/// <code>Catch</code> ever saw it, producing a silent partial (<var>truncated</var>
/// staying <code>false</code>) even though output was genuinely cut off. After the fix,
/// the capture buffer's own <MAXSTRING> never reaches <code>Write</code>'s caller at all
/// (<method>Redirects</method> absorbs it at the label and records
/// <var>%ExecuteMCPTruncated</var>), so it is unconditionally observable regardless of
/// what the target does with an exception that never arrives.
ClassMethod TargetWriteHugeSwallowsOwnErrors() As %String
{
    Set tChunk = $Translate($Justify("", 5000), " ", "X")
    For i=1:1:1000 {
        Try {
            Write tChunk
        } Catch {
            ; Deliberately swallowed — models the reported shape.
        }
    }
    Quit "wrote-huge-swallowed"
}

/// Writes before/after a nested <code>%SYS.Capture</code> window — for AC 34.2.6/R3's
/// documented-limitation test (the endpoint's own capture must not corrupt around it).
ClassMethod TargetNestedCapture() As %String
{
    Write "outer-before"
    Set tCookie = ""
    Set tBeginSC = $$BeginCapture^%SYS.Capture(.tCookie)
    Write "inner-captured-line"
    Set tEndRet = $$EndCapture^%SYS.Capture(tCookie, .tInner)
    Write "outer-after"
    Quit "beginSC="_tBeginSC_"|endRet="_tEndRet
}

/// Writes before/during/after turning the endpoint's own redirect off and back on —
/// for AC 34.2.6/R3's documented-limitation test.
ClassMethod TargetSelfRedirectOff() As %String
{
    Write "before-off"
    Do ##class(%Library.Device).ReDirectIO(0)
    Write "during-off"
    Do ##class(%Library.Device).ReDirectIO(1)
    Write "after-on-again"
    Quit "ok"
}

/// Narrates via <code>Write</code>, switches namespace (<code>ZN</code>) mid-execution
/// (bug report repro 3's shape), AND mutates a <code>ByRef</code> argument — all in the
/// same call. Story 34.1's Residual Risk section flagged "a target that ZNs mid-execution
/// and mutates a ByRef arg" as the most likely real-world combination never exercised
/// together, and 34.1's probes never ran a target through the extra
/// <class>ExecuteMCPv2.Utils</class>.<method>InvokeWithArgs</method> routine-frame hop
/// that Story 34.2 introduced between the mnemonic-binding driver and the target's
/// <code>Write</code> calls. Used by QA to close that specific gap live (34.2 review).
ClassMethod TargetZNWriteByRef(ByRef pVal As %String) As %String
{
    Write "before-zn:"_$NAMESPACE
    ZN "USER"
    Write $Char(10)_"after-zn:"_$NAMESPACE
    Set pVal = pVal_"-zn-mutated"
    Quit "zn-ok"
}

/// Writes output containing JSON metacharacters (double quote, backslash, brace),
/// a literal newline AND a CRLF pair, a tab, a control character, and non-ASCII/UTF-8
/// text — Rule #58 fixture-diversity coverage for the <var>output</var> capture path,
/// which must survive a JSON round-trip without corrupting the response envelope.
ClassMethod TargetWriteMetachars() As %String
{
    Write "quote"""_"backslash\"_"brace{}"
    Write $Char(10)
    Write $Char(13,10)
    Write $Char(9)_"tab-after"
    Write $Char(7)
    Write "unicode-héllo-世界-😀"
    Quit "wrote-metachars"
}

/// ByRef target whose mutated value contains the same JSON-metacharacter/control-char/
/// non-ASCII mix as <method>TargetWriteMetachars</method> — Rule #58 coverage for the
/// <var>byRefValues</var> encoding path.
ClassMethod TargetByRefMetacharsValue(ByRef pVal As %String) As %String
{
    Set pVal = "quote"""_"backslash\"_"newline"_$Char(10)_"crlf"_$Char(13,10)_"tab"_$Char(9)_"unicode-héllo-世界-😀"
    Quit "ok"
}

/// Writes a moderate amount of narration (~20KB) — comfortably past the ~8KB CSP
/// response-buffer boundary <method>ExecuteMCPv2.REST.Command</method>'s null-device
/// redirect exists to avoid, but far below the &lt;MAXSTRING&gt; ceiling — for a
/// real-HTTP proof that the fixed envelope isn't silently truncated at that boundary.
ClassMethod TargetWriteModerate() As %String
{
    Set tLine = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"_$Char(10)
    For i=1:1:300 { Write tLine }
    Quit "wrote-moderate"
}

/// Writes 50,000 characters — comfortably past the Story 34.6 AC 34.6.1
/// <parameter>ExecuteMCPv2.Utils.OUTPUTCEILING</parameter> (32768 chars) but nowhere near
/// the &lt;MAXSTRING&gt; ceiling (~2-4M chars) — isolates the NEW response-payload
/// ceiling from the pre-existing capture-buffer-overflow truncation path.
ClassMethod TargetWriteOverCeiling() As %String
{
    Write $TR($J("", 50000), " ", "Y")
    Quit "wrote-over-ceiling"
}

/// ByRef formal mutated to a single value LONGER than the AC 34.6.1 byte budget
/// (40000 chars, vs. the 32768-char ceiling) — exercises
/// <method>ExecuteMCPv2.Utils.BuildByRefNode</method>'s per-leaf byte-budget truncation
/// in isolation from the structural node budget.
ClassMethod TargetByRefHugeValue(ByRef pVal) As %String
{
    Set pVal = $TR($J("", 40000), " ", "Z")
    Quit "ok"
}

/// Output formal receiving 1500 subscript entries (each a tiny value) — exceeds the
/// AC 34.6.1 <parameter>ExecuteMCPv2.Utils.BYREFNODECEILING</parameter> (1000 nodes) while
/// every individual value stays trivially small, isolating the STRUCTURAL node budget
/// from the byte budget.
ClassMethod TargetByRefManySubscripts(Output pOut) As %String
{
    For i=1:1:1500 { Set pOut(i) = "v" }
    Quit "ok"
}

/// Returns 50,000 characters directly as the RETURN value (not via Write) —
/// comfortably past the Story 34.6 <parameter>ExecuteMCPv2.Utils.OUTPUTCEILING</parameter>
/// (32768 chars). Code-review finding CR-5: <code>returnValue</code>, the PRIMARY
/// payload field, is now ALSO bounded by the same ceiling <code>output</code>/
/// <code>byRefValues</code> already use — this isolates that new ceiling from the
/// pre-existing output-capture one <method>TargetWriteOverCeiling</method> exercises.
ClassMethod TargetReturnOverCeiling() As %String
{
    Quit $TR($J("", 50000), " ", "R")
}

/// Returns the CURRENT namespace — Story 34.6 AC 34.6.2 (ledger `34-4-R1`): the epic
/// gate's leg (d) and its <c>custom-rest.integration.test.ts</c> original previously
/// asserted only that <code>%SYSTEM.Version.GetVersion()</code> returned SOME
/// version-looking string, which is IDENTICAL in every namespace — a regression that
/// dropped the <code>namespace</code> parameter entirely would still pass. This target
/// makes the namespace-sensitive area genuinely differ (Rules #34/#40): a caller passing
/// <code>namespace: "USER"</code> must see <code>"USER"</code> back, not the configured
/// default namespace.
ClassMethod TargetReturnNamespace() As %String
{
    Quit $NAMESPACE
}

}
