/// Shared utility methods for the ExecuteMCPv2 REST service layer.
/// <p>Provides namespace switching, input validation, error sanitization,
/// and request body parsing helpers used by all REST handler classes.</p>
Class ExecuteMCPv2.Utils Extends %RegisteredObject
{

/// Story 34.6 AC 34.6.1, revised by Story 34.7 AC 34.7.3 (ledger <c>34-6-CR2-6</c>) — the
/// ONE documented response-payload ceiling, measured in RAW CHARACTERS via
/// <code>$Length</code> BEFORE JSON escaping — not raw UTF-8 bytes (stated explicitly to
/// avoid overclaiming byte-precision on a Unicode-enabled instance) and not the SERIALIZED
/// size of the JSON response body, which JSON escaping can inflate well past this figure
/// for content heavy in quotes, backslashes, tabs, or control characters (see
/// <method>ApplyOutputCeiling</method>'s banner for a live-measured worst case).
/// <p><b>Story 34.7 — ONE SHARED budget, not three independent ones.</b> On
/// <code>/classmethod</code>, <parameter>OUTPUTCEILING</parameter> characters are shared
/// across <code>returnValue</code>, <code>byRefValues</code>, and <code>output</code>
/// TOGETHER, spent in that field order (a Project Lead decision, not re-litigable — see
/// <method>InvokeWithArgs</method>'s banner) — NOT applied independently to each field
/// (the pre-34.7 shape, which let a fully-flagged response carry roughly three times this
/// figure raw, before escaping). On <code>/command</code>, which has only
/// <code>output</code>, this ceiling is the field's own full budget, unchanged.</p>
/// <p>Also reused as the byRefValues STRUCTURAL byte budget's own starting point inside
/// <method>BuildByRefNode</method> (reduced by whatever <code>returnValue</code> already
/// consumed of the shared pool — see <method>InvokeWithArgs</method>). Chosen from LIVE
/// 2026-08-15 measurement (Rule #36), not by feel — see <method>ApplyOutputCeiling</method>'s
/// banner for the measurement evidence and Rule #38 discipline.</p>
Parameter OUTPUTCEILING As %Integer = 32768;

/// Story 34.6 AC 34.6.1 — the byRefValues STRUCTURAL ceiling: the maximum number of tree
/// nodes (subscript entries) <method>BuildByRefNode</method> will materialize across the
/// WHOLE byRefValues structure (every by-ref-marked position combined), independent of
/// the byte budget in <parameter>OUTPUTCEILING</parameter> — bounds a pathologically
/// wide/deep Output array even where every individual value is tiny.
Parameter BYREFNODECEILING As %Integer = 1000;

/// Story 34.8 AC 34.8.3/34.8.4 — the size (in RAW BYTES) of each chunk
/// <method>DecodeUtf8Stream</method> reads from a request-body stream before decoding it.
/// Chosen well under the platform's practical string ceiling while staying large enough
/// that an ordinary request body decodes in a single chunk. Live-measured during this
/// story (2026-08-16, disposable <c>ExecuteMCPv2.Temp.Utf8Probe</c>): a SINGLE
/// <code>.Read()</code> call requesting a stream's full ~49,000,000-byte
/// <property>Size</property> in one shot silently returned only ~3.6 million characters —
/// with NO exception of any kind — which is exactly the failure this chunk size and the
/// accompanying read-loop in <method>DecodeUtf8Stream</method> exist to avoid.
Parameter UTF8CHUNKSIZE As %Integer = 1000000;

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

/// Story 34.6 AC 34.6.1 — truncate <var>pOutput</var> to the documented
/// <parameter>OUTPUTCEILING</parameter>-character ceiling, appending a structured,
/// machine-detectable elision marker (never a bare "...") in place of the elided tail.
/// Only ever SETS <var>pTruncated</var> to true when truncation happens HERE — an
/// already-true value from an earlier, unrelated truncation cause (e.g. a capture-buffer
/// &lt;MAXSTRING&gt;, Story 34.3) is left untouched, so a caller ORs this in for free
/// simply by passing its existing flag ByRef. The returned string's length never exceeds
/// <parameter>OUTPUTCEILING</parameter> (content is trimmed to make room for the marker
/// itself, not appended on top of a full-length excerpt).
/// <p><b>Rule #38 — what this ceiling is NOT.</b> Live measurement on 2026-08-15 (Story
/// 34.6) found the CSP Gateway/HTTP transport tolerates multi-megabyte
/// <code>/command</code> responses cleanly — no corruption, no timeout, no error — up to
/// 3,000,000 characters (the largest size tested; the underlying platform long-string
/// ceiling sits somewhere past that). So this ceiling is NOT protection against a Web
/// Gateway timeout or against the target's own execution cost: the target has already
/// fully run, and the captured output has already been fully produced, by the time this
/// method trims it. It exists purely to keep the RESPONSE PAYLOAD a bounded, genuinely
/// consumable size for the MCP clients — typically AI agents with a finite context
/// budget — that read tool results. A real, live MCP client (Claude Code CLI, this
/// repository's own dev environment) was observed diverting a rendered tool result away
/// from inline consumption once it reached 50,031 characters; 32768 (see
/// <parameter>OUTPUTCEILING</parameter>) was chosen to stay safely under that measured
/// boundary.</p>
/// <p><b>Story 34.6 code review (cycle 2) / Story 34.7 AC 34.7.3 — the ceiling is ONE
/// SHARED budget across a <code>/classmethod</code> response, not per field.</b>
/// <code>output</code>, <code>returnValue</code> and the <code>byRefValues</code> budget
/// used to each get their own independent <parameter>OUTPUTCEILING</parameter>, so a
/// single fully-compliant, fully-flagged response could carry roughly three times this
/// figure raw before JSON escaping (and more after it) — this is now fixed: see
/// <method>InvokeWithArgs</method>'s banner for the shared-budget/field-order design.
/// This method itself is unchanged by that fix — it still truncates ONE string to
/// WHATEVER <var>pCeiling</var> it is given; the caller now simply passes a smaller,
/// already-reduced <var>pCeiling</var> once an earlier field has spent part of the shared
/// pool.</p>
/// <p><b>Rule #38 / AC 34.7.4 — raw characters, not serialized JSON size.</b>
/// <var>pCeiling</var> bounds <var>pOutput</var>'s own RAW character count, measured
/// BEFORE this value is embedded in a JSON response body. JSON string escaping can
/// inflate the SERIALIZED size well past the ceiling: a quote or backslash becomes a
/// 2-character escape, and a tab/newline/other control character becomes a 2- or
/// 6-character escape. The earlier, now-inapplicable pre-34.7 independent-budget
/// measurement — two 32768-character raw fields built entirely from JSON metacharacters
/// serialized to 131,102 characters combined — described the per-field shape this story
/// replaced (see this parameter's own Story 34.7 banner above).
/// <p><b>Live-measured inflation UNDER THIS STORY'S shared budget</b> (Story 34.7 code
/// review, raw <code>fetch</code> against the deployed <code>/command</code> endpoint;
/// every row is a single field holding exactly 32768 RAW characters, so the RAW ceiling
/// itself is honored identically in all three):
/// <ul>
/// <li>escaping-neutral plain letters &#8594; 32,860-character HTTP body (1.0x)</li>
/// <li>mixed metacharacters (the <c>TargetReturnEscapeHeavyOverCeiling</c> fixture's own
/// profile: quote, backslash, tab, one control character) &#8594; 98,311 (3.0x)</li>
/// <li><b>WORST CASE — all C0 control characters</b> (each costing a 6-character
/// <code>\uXXXX</code> escape) &#8594; <b>196,495</b> (6.0x)</li>
/// </ul>
/// <b>Honest residual-risk statement:</b> the worst case is therefore about <b>6x</b> the
/// raw ceiling — roughly <b>3.9x past</b> the 50,031-character client-divert threshold
/// documented above that was the entire rationale for
/// <parameter>OUTPUTCEILING</parameter>'s value. The shared budget substantially reduces
/// the pre-34.7 worst case (which was this figure again per independent field) but does
/// NOT restore that safety margin for metacharacter-heavy content. The ceiling was never
/// a promise about the HTTP response body's own byte size, only about how much of any one
/// RAW field's content survives; fully bounding the SERIALIZED size would require
/// measuring and truncating against it directly rather than against raw characters, which
/// is a larger design change tracked in <c>deferred-work.md</c> (<c>34-7-QA-1</c>) rather
/// than attempted here.</p>
/// <p><var>pCeiling</var> defaults to <parameter>OUTPUTCEILING</parameter> when omitted
/// (sentinel <code>-1</code> — distinct from an explicit <code>0</code>, which
/// <method>BuildByRefNode</method> legitimately passes once its shared byte budget is
/// fully exhausted).</p>
/// <p><b>Story 34.6 code-review findings CR-6/CR-8/CR-9 fix.</b> The elision marker
/// itself is <code>36 + digits(pCeiling)</code> characters (never smaller than ~37).
/// When <var>pCeiling</var> is smaller than the marker's own length, appending the
/// marker anyway would make the result BOTH longer than the ceiling it is supposed to
/// respect AND longer than the (small) original value it replaces — exactly the defect
/// <method>BuildByRefNode</method>'s shared byte budget hit once nearly exhausted
/// (a 4-character value destroyed and replaced by a ~37-character marker, and the
/// response growing past its own documented budget). In that band this method falls
/// back to a plain hard cut of the first <var>pCeiling</var> characters, with NO marker
/// at all — the marker is only ever emitted whole, exactly matching the documented
/// format, never as a truncated/malformed fragment. Two invariants hold for EVERY
/// <var>pCeiling</var>, including this band: the result never exceeds
/// <var>pCeiling</var> characters, and the result is never LONGER than
/// <var>pOutput</var> itself — a value is never elided into something bigger than it
/// started.</p>
/// <p><b>Story 34.7 AC 34.7.1 fix (ledger <c>34-6-CR-10</c>) — the cut never lands
/// between a high and low surrogate.</b> IRIS represents an astral character (outside
/// the Basic Multilingual Plane, e.g. an emoji) internally as a UTF-16 SURROGATE PAIR —
/// two consecutive code units — and <code>$Extract</code> counts each half as one
/// character. Cutting immediately after the high half (leaving its low-half partner on
/// the elided side) previously emitted that lone high surrogate on the wire as WTF-8
/// (invalid UTF-8): Node's lenient decoder silently substituted it with U+FFFD,
/// inflating the client-visible length PAST the advertised ceiling (32768 became
/// 32770, live-verified), and a strict decoder (<code>TextDecoder({fatal:true})</code>)
/// threw outright. Every retained-length computation below is now passed through
/// <method>SurrogateSafeCutLength</method>, which backs the cut off by one code unit
/// whenever it would otherwise end on an unpaired high surrogate — see that method's
/// own banner for why this can never itself land on ANOTHER split pair. The wire-level
/// proof (decoding the ACTUAL HTTP response bytes with a strict decoder, per AC 34.7.2)
/// lives in the TS default suite, not here — see
/// <c>execute-classmethod-epic-gate.test.ts</c>.</p>
ClassMethod ApplyOutputCeiling(pOutput As %String, ByRef pTruncated As %Boolean, pCeiling As %Integer = -1) As %String
{
    Set tCeiling = pCeiling
    If tCeiling < 0 { Set tCeiling = ..#OUTPUTCEILING }
    Set tLen = $Length(pOutput)
    If tLen <= tCeiling {
        Quit pOutput
    }
    Set pTruncated = 1
    Set tMarker = $Char(10)_"[IRIS-MCP-TRUNCATED ceiling="_tCeiling_"chars]"_$Char(10)
    ; Story 34.6 CR-6/CR-8/CR-9: the marker does not fit within a small remaining
    ; ceiling — appending it anyway would both exceed the ceiling AND replace a SMALLER
    ; original value with something LARGER. Fall back to a marker-less hard cut so the
    ; result is always bounded by tCeiling and never bigger than pOutput itself.
    If $Length(tMarker) > tCeiling {
        Set tKeep = ..SurrogateSafeCutLength(pOutput, tCeiling)
        Quit $Extract(pOutput, 1, tKeep)
    }
    Set tKeep = tCeiling - $Length(tMarker)
    Set tKeep = ..SurrogateSafeCutLength(pOutput, tKeep)
    Quit $Extract(pOutput, 1, tKeep) _ tMarker
}

/// Story 34.7 AC 34.7.1 (ledger <c>34-6-CR-10</c>) — back a truncation cut length off by
/// one UTF-16 code unit when the code unit AT <var>pLen</var> is a high surrogate half
/// (<code>$Ascii</code> range 55296-56319, hex D800-DBFF). See
/// <method>ApplyOutputCeiling</method>'s banner for why cutting immediately after a high
/// surrogate is unsafe: it strands the surrogate's low-half partner on the elided side,
/// which IRIS emits on the wire as invalid UTF-8 (WTF-8) rather than the intended 4-byte
/// astral-character encoding.
/// <p>Backing off by one never lands on ANOTHER split pair: if the PRECEDING code unit
/// (at <var>pLen</var>-1) is itself a low surrogate, positions <var>pLen</var>-2 and
/// <var>pLen</var>-1 already form a COMPLETE pair — in well-formed UTF-16 a low
/// surrogate only ever immediately follows its own matching high surrogate — so the
/// shorter cut is always clean. Never backs off below 0. A no-op (returns
/// <var>pLen</var> unchanged) whenever the code unit at <var>pLen</var> is anything
/// other than a high surrogate, including when <var>pLen</var> is 0. Uses the SAME
/// <code>$Ascii(string, position)</code> two-argument form already proven live by
/// <c>UtilsTest.TestApplyOutputCeilingMidSurrogatePairStaysValidJSON</c> (Story 34.6 QA)
/// to read a UTF-16 code unit's raw numeric value at an arbitrary position.</p>
ClassMethod SurrogateSafeCutLength(pStr As %String, pLen As %Integer) As %Integer
{
    Set tLen = pLen
    If tLen > 0 {
        Set tLastCode = $Ascii(pStr, tLen)
        If (tLastCode >= 55296) && (tLastCode <= 56319) {
            Set tLen = tLen - 1
        }
    }
    Quit tLen
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
/// <p><b>Story 34.6 AC 34.6.1 — node/byte budget.</b> <var>pNodeBudget</var> and
/// <var>pByteBudget</var> are shared counters THREADED across every recursive call AND
/// across every one of the (up to 20) top-level positions <method>InvokeWithArgs</method>
/// calls this method for — the budgets bound the WHOLE <var>byRefValues</var> structure,
/// not any one position. <var>pNodeBudget</var> (initial value
/// <parameter>BYREFNODECEILING</parameter>) is decremented once per call — once it is
/// exhausted, further subscript descent stops (the node already built is kept, marked
/// <code>subscriptsTruncated: true</code>) — bounding a pathologically wide/deep tree even
/// when every value is tiny. <var>pByteBudget</var> — STARTING value
/// <parameter>OUTPUTCEILING</parameter> MINUS whatever <var>returnValue</var> already
/// consumed of the ONE shared response budget (Story 34.7 AC 34.7.3; see
/// <method>InvokeWithArgs</method>'s banner for the field-order design) — is decremented
/// by every piece of CONTENT this method
/// emits: each leaf value's own length (via <method>ApplyOutputCeiling</method>), each
/// <code>&lt;Object:...&gt;</code> OREF placeholder, and each subscript KEY. So one huge
/// value, many medium values, or many long subscript keys are all bounded to the same
/// total. It does NOT charge the per-node JSON scaffolding itself (the
/// <code>{"value":...,"subscripts":{}}</code> wrapper, roughly 25-30 characters per
/// container node); that residue is bounded instead by
/// <parameter>BYREFNODECEILING</parameter>, giving a hard worst case of about
/// <parameter>OUTPUTCEILING</parameter> + (<parameter>BYREFNODECEILING</parameter> x 30)
/// characters for the whole structure. Either budget's exhaustion sets
/// <var>pByRefTruncated</var> — reported separately from the <var>output</var> field's own
/// <var>truncated</var> flag, since they describe different parts of the response.</p>
/// <p><b>Story 34.6 code-review finding CR-6.</b> This method's own child-subscript
/// loop below already refuses to recurse once either budget is exhausted. The 20
/// top-level calls <method>InvokeWithArgs</method> makes had no equivalent guard — see
/// <method>AddByRefPosition</method>, which now wraps every one of those calls with the
/// SAME pre-check, OMITTING a position from <var>pByRefValues</var> entirely once the
/// budget is already gone, rather than materializing it here and relying on
/// <method>ApplyOutputCeiling</method> alone to keep the damage bounded.</p>
/// <p><b>Story 34.6 code review (cycle 2) — the byte budget now charges KEYS and OREF
/// placeholders, not only leaf values.</b> Before this, both were emitted free, so the
/// advertised 32768-character <var>byRefValues</var> budget did not bound
/// <var>byRefValues</var> at all: measured live, 400 positions keyed by 900-character
/// subscripts emitted 363,908 characters with 32,368 of the budget still reported
/// unspent and <var>pByRefTruncated</var> still false, and 1500 OREF leaves emitted
/// ~49,000 characters without touching the budget at all. A long-keyed
/// <code>Output</code> array (file paths, URLs, composite keys) is an entirely idiomatic
/// ObjectScript shape, so this was reachable by ordinary callers, and it was the same
/// unbounded-payload class as code-review finding CR-5 one field over.</p>
ClassMethod BuildByRefNode(ByRef pLocal, ByRef pNodeBudget As %Integer, ByRef pByteBudget As %Integer, ByRef pByRefTruncated As %Boolean)
{
    ; Every call materializes exactly one tree node — charge it against the shared
    ; structural budget regardless of whether it turns out to be a leaf or a container.
    Set pNodeBudget = pNodeBudget - 1
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
            ; Story 34.6 code review (cycle 2): the OREF placeholder is EMITTED CONTENT
            ; and must be charged like any other leaf value. Before this it was the one
            ; value shape that consumed payload without ever decrementing the budget, so
            ; a target returning many OREF out-values shipped tens of KB with the byte
            ; budget still reading its full 32768 and byRefTruncated still false.
            Set pByteBudget = pByteBudget - $Length(tValue)
            If pByteBudget < 0 { Set pByteBudget = 0 }
        } Else {
            ; Charge this leaf's value against the shared byte budget (AC 34.6.1) by
            ; truncating it to WHATEVER REMAINS of that budget right now — reuses
            ; ApplyOutputCeiling (same marker format as the output field) with an
            ; EXPLICIT ceiling instead of the default, so a value that is itself under
            ; OUTPUTCEILING but arrives after other leaves have already spent most of
            ; the shared budget is truncated to the remainder in ONE pass (never
            ; double-truncated: OUTPUTCEILING first, then the remaining budget again).
            Set tValue = ..ApplyOutputCeiling(pLocal, .pByRefTruncated, pByteBudget)
            Set pByteBudget = pByteBudget - $Length(tValue)
            If pByteBudget < 0 { Set pByteBudget = 0 }
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
    Set tCut = 0
    For {
        Set tKey = $Order(pLocal(tKey))
        Quit:tKey=""
        If (pNodeBudget <= 0) || (pByteBudget <= 0) {
            Set tCut = 1
            Quit
        }
        ; Story 34.6 code review (cycle 2): a subscript KEY is emitted content too, and
        ; was previously never charged — so a long-keyed Output array (file paths, URLs,
        ; composite keys: an entirely idiomatic ObjectScript Output shape) shipped a
        ; byRefValues payload arbitrarily larger than the documented budget while
        ; byRefTruncated still read false. Measured live before this fix: 400 positions
        ; keyed by 900-character strings emitted 363,908 characters against a
        ; 32768-character budget, with 32,368 of that budget still reported unspent.
        ; Charge the key BEFORE descending; if the key alone would consume the rest of
        ; the budget, stop here instead of descending with a zero budget (which would
        ; force the child's value to the ambiguous empty string AddByRefPosition's
        ; banner deliberately avoids). This keeps pByteBudget >= 1 at every recursive
        ; entry, so ApplyOutputCeiling is never called with a zero ceiling.
        If $Length(tKey) >= pByteBudget {
            Set pByteBudget = 0
            Set tCut = 1
            Quit
        }
        Set pByteBudget = pByteBudget - $Length(tKey)
        Kill tChild
        Merge tChild = pLocal(tKey)
        Do tSubs.%Set(tKey, ..BuildByRefNode(.tChild, .pNodeBudget, .pByteBudget, .pByRefTruncated))
    }
    If tCut {
        Set pByRefTruncated = 1
        Do tResult.%Set("subscriptsTruncated", 1, "boolean")
    }
    Do tResult.%Set("subscripts", tSubs)
    Quit tResult
}

/// Story 34.6 code-review finding CR-6 — add ONE top-level by-ref position's node to
/// <var>pByRefValues</var> at key <var>pKey</var>, honoring the shared node/byte
/// budgets the SAME way <method>BuildByRefNode</method>'s own child-subscript loop
/// already does. <method>InvokeWithArgs</method>' 20 top-level calls were the one place
/// nothing checked the budget BEFORE materializing a node: once one large value
/// exhausted the shared byte budget, every later position was still handed to
/// <method>BuildByRefNode</method>, which (before the accompanying
/// <method>ApplyOutputCeiling</method> fix) truncated a small real value down to an
/// elision marker LARGER than the value itself.
/// <p>When either budget is already exhausted BEFORE this position is visited, it is
/// OMITTED from <var>pByRefValues</var> entirely — the key never appears — rather than
/// materialized as a misleading placeholder. This mirrors the convention this class
/// already uses for a genuinely-undefined post-call local (see
/// <method>BuildByRefNode</method>'s banner: "a fully undefined local is represented by
/// omitting its key ... entirely") instead of inventing a new, ambiguous empty-string
/// shape that could be confused with a target that genuinely set the value to "".
/// <var>pByRefTruncated</var> is set either way so the caller knows something was cut.</p>
ClassMethod AddByRefPosition(pByRefValues As %DynamicObject, pKey As %Integer, ByRef pLocal, ByRef pNodeBudget As %Integer, ByRef pByteBudget As %Integer, ByRef pByRefTruncated As %Boolean)
{
    If (pNodeBudget <= 0) || (pByteBudget <= 0) {
        Set pByRefTruncated = 1
        Quit
    }
    Do pByRefValues.%Set(pKey, ..BuildByRefNode(.pLocal, .pNodeBudget, .pByteBudget, .pByRefTruncated))
    Quit
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
/// <p><b>34-2-R1 TERMINAL disposition (Story 34.3):</b> a capture-buffer
/// <code>&lt;MAXSTRING&gt;</code> is no longer detected by catching an exception here at
/// all — <class>ExecuteMCPv2.REST.Command</class>'s <method>Redirects</method> labels now
/// absorb it internally (so a target's OWN <code>Try/Catch</code> around its
/// <code>Write</code> calls can never swallow it first, closing the exact silent-partial
/// shape the ledger item reported) and record it in the process-private
/// <var>%ExecuteMCPTruncated</var> flag. This method reads that flag immediately after
/// dispatch and ORs it into <var>pTruncated</var>, so a target with no
/// <code>Try/Catch</code> (still covered by the exTarget discriminator below, kept as
/// defense-in-depth for any <code>&lt;MAXSTRING&gt;</code> that reaches this level by some
/// other path) and a target that swallows its own errors report identically.</p>
/// <p><b>Story 34.6 AC 34.6.1:</b> <var>pByRefTruncated</var> is a new, additive,
/// OPTIONAL trailing output parameter (verified live that omitting a trailing
/// <c>Output</c> argument at a call site is safe ObjectScript — the pre-existing 30+
/// call sites in <class>ExecuteMCPv2.Tests.ClassMethodArgsTest</class> do not pass it and
/// need no change). It reports whether <var>pByRefValues</var>' node/byte budget (see
/// <method>BuildByRefNode</method>) was exhausted — separate from <var>pTruncated</var>,
/// which describes only the <var>output</var> field.</p>
/// <p><b>Story 34.6 code-review finding CR-6:</b> the 20 top-level
/// <method>BuildByRefNode</method> dispatches below are each wrapped by
/// <method>AddByRefPosition</method>, which shares ONE pair of budget counters across
/// every position (not a fresh budget per position) and OMITS a position from
/// <var>pByRefValues</var> once either budget is already exhausted, instead of handing
/// it to <method>BuildByRefNode</method> and risking a small real value being replaced
/// by a larger elision marker.</p>
/// <p><b>Story 34.7 AC 34.7.3 (ledger <c>34-6-CR2-6</c>) — ONE shared response budget,
/// spent <c>returnValue</c> &#8594; <c>byRefValues</c> &#8594; <c>output</c>.</b> This is a
/// recorded Project Lead decision, not re-litigated here: the small, high-value fields
/// are never starved, and narration — usually the field that actually blows the budget —
/// absorbs the truncation. Before this, <c>output</c>, <c>returnValue</c> and
/// <c>byRefValues</c> each got their OWN independent <parameter>OUTPUTCEILING</parameter>,
/// so a fully-flagged response could carry roughly three times the documented figure raw.
/// <var>pOutputBudget</var> is a new, additive, OPTIONAL trailing output parameter
/// (omittable exactly like <var>pByRefTruncated</var> above — every pre-34.7 call site is
/// unaffected) reporting how much of the shared <parameter>OUTPUTCEILING</parameter> pool
/// remains AFTER this call accounted for both <var>returnValue</var> and
/// <var>byRefValues</var>; <class>ExecuteMCPv2.REST.Command</class> passes it as the
/// explicit ceiling for <var>output</var>'s own <method>ApplyOutputCeiling</method> call,
/// so <var>output</var> — last in priority — gets exactly whatever is left.
/// <var>pReturn</var> itself is UNCHANGED by this — still the target's raw, untouched
/// return value (never pre-truncated here); this method only computes, INTERNALLY, how
/// much of the shared budget a STRINGIFIED-and-ceiling-applied copy of it WOULD consume
/// (mirroring <class>ExecuteMCPv2.REST.Command</class>'s own <c>$IsObject</c> OREF-guard +
/// <method>ApplyOutputCeiling</method> sequence on the SAME <var>pReturn</var> value, so
/// the two computations can never diverge), purely to seed <var>tByRefByteBudget</var>'s
/// STARTING point below at whatever remains once <var>returnValue</var>'s share is
/// deducted — <var>returnValue</var>'s OWN truncation, computed independently in
/// <class>ExecuteMCPv2.REST.Command</class>, is therefore unaffected: it is always first
/// in priority, so it always sees the FULL <parameter>OUTPUTCEILING</parameter> as its own
/// ceiling, exactly as before this story.</p>
ClassMethod InvokeWithArgs(pClassName As %String, pMethodName As %String, pArgs, Output pReturn, Output pByRefValues As %DynamicObject, Output pArgCount As %Integer, Output pTruncated As %Boolean, Output pByRefTruncated As %Boolean, Output pOutputBudget As %Integer) As %Status
{
    Set tSC = $$$OK
    Set pReturn = ""
    Set pByRefValues = {}
    Set pArgCount = 0
    Set pTruncated = 0
    Set pByRefTruncated = 0
    ; Story 34.7 AC 34.7.3: default to the FULL shared budget so a caller that never
    ; reaches the shared-budget computation below (an early validation error, or a
    ; genuine target throw — see the $$$ISERR(tSC) Quit right before that computation)
    ; still gets a well-defined value, matching this method's pre-34.7 behavior exactly
    ; (Command.cls's own output ceiling was always the full OUTPUTCEILING on those paths).
    Set pOutputBudget = ..#OUTPUTCEILING
    Kill %ExecuteMCPTruncated
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
        ; 34-2-R1: fold in the label-level capture-overflow flag (see Command.cls's
        ; Redirects() and this method's banner) regardless of which path set tSC — a
        ; target that swallowed a MAXSTRING via its own Try/Catch never throws here at
        ; all, so this is the only place that observes it for such a target.
        Set pTruncated = pTruncated || $Get(%ExecuteMCPTruncated, 0)
        Kill %ExecuteMCPTruncated
        ; A genuine target error skips the read-back below and is returned as-is; only the
        ; capture-truncation path (tSC still OK) reaches byRefValues assembly.
        If $$$ISERR(tSC) Quit

        ; Story 34.7 AC 34.7.3: determine how much of the ONE shared response budget
        ; returnValue's own (independently, identically computed) truncation in
        ; Command.cls WILL consume, so byRefValues — second in priority — starts with
        ; whatever is left rather than always resetting to the full ceiling. See this
        ; method's banner for why pReturn itself is left untouched here.
        Set tRVForBudget = $Select($IsObject(pReturn): "<Object:"_$ClassName(pReturn)_">", 1: pReturn)
        Set tRVTruncatedForBudget = 0
        Set tRVForBudget = ..ApplyOutputCeiling(tRVForBudget, .tRVTruncatedForBudget, ..#OUTPUTCEILING)
        Set pOutputBudget = ..#OUTPUTCEILING - $Length(tRVForBudget)
        If pOutputBudget < 0 { Set pOutputBudget = 0 }

        ; Assemble byRefValues for marked positions only (AC 34.2.2, 34.2.6/R1, R6) —
        ; direct-by-name access; omit the key when the local is still genuinely
        ; undefined after the call (Residual Risk: "undefined out-value").
        ; Story 34.6 AC 34.6.1: tByRefNodeBudget/tByRefByteBudget are initialized ONCE
        ; and threaded (ByRef) through every position below, so the budget spans the
        ; WHOLE byRefValues structure rather than resetting per position.
        ; Story 34.6 code-review finding CR-6: each position is routed through
        ; AddByRefPosition (not BuildByRefNode directly), which OMITS the position once
        ; either budget is already exhausted instead of risking a small value being
        ; replaced by a larger elision marker — see AddByRefPosition's banner.
        ; Story 34.7 AC 34.7.3: the byte budget now STARTS at pOutputBudget (whatever the
        ; shared response budget has left after returnValue's share, computed above)
        ; rather than always resetting to the full ceiling — byRefValues is second in the
        ; shared-budget priority order.
        Set tByRefNodeBudget = ..#BYREFNODECEILING
        Set tByRefByteBudget = pOutputBudget
        If tByRef0, $Data(tA0)   Do ..AddByRefPosition(pByRefValues, 0, .tA0, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef1, $Data(tA1)   Do ..AddByRefPosition(pByRefValues, 1, .tA1, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef2, $Data(tA2)   Do ..AddByRefPosition(pByRefValues, 2, .tA2, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef3, $Data(tA3)   Do ..AddByRefPosition(pByRefValues, 3, .tA3, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef4, $Data(tA4)   Do ..AddByRefPosition(pByRefValues, 4, .tA4, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef5, $Data(tA5)   Do ..AddByRefPosition(pByRefValues, 5, .tA5, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef6, $Data(tA6)   Do ..AddByRefPosition(pByRefValues, 6, .tA6, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef7, $Data(tA7)   Do ..AddByRefPosition(pByRefValues, 7, .tA7, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef8, $Data(tA8)   Do ..AddByRefPosition(pByRefValues, 8, .tA8, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef9, $Data(tA9)   Do ..AddByRefPosition(pByRefValues, 9, .tA9, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef10, $Data(tA10) Do ..AddByRefPosition(pByRefValues, 10, .tA10, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef11, $Data(tA11) Do ..AddByRefPosition(pByRefValues, 11, .tA11, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef12, $Data(tA12) Do ..AddByRefPosition(pByRefValues, 12, .tA12, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef13, $Data(tA13) Do ..AddByRefPosition(pByRefValues, 13, .tA13, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef14, $Data(tA14) Do ..AddByRefPosition(pByRefValues, 14, .tA14, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef15, $Data(tA15) Do ..AddByRefPosition(pByRefValues, 15, .tA15, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef16, $Data(tA16) Do ..AddByRefPosition(pByRefValues, 16, .tA16, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef17, $Data(tA17) Do ..AddByRefPosition(pByRefValues, 17, .tA17, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef18, $Data(tA18) Do ..AddByRefPosition(pByRefValues, 18, .tA18, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)
        If tByRef19, $Data(tA19) Do ..AddByRefPosition(pByRefValues, 19, .tA19, .tByRefNodeBudget, .tByRefByteBudget, .pByRefTruncated)

        ; Story 34.7 AC 34.7.3: whatever remains of the shared budget after both
        ; returnValue and byRefValues have taken their share is what Command.cls may
        ; spend on `output` — third and last in the shared-budget priority order.
        Set pOutputBudget = tByRefByteBudget
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Story 34.8 — decode a raw (untranslated) request-body stream as UTF-8, returning a NEW
/// character stream ready for <method>%DynamicObject</method>.<method>%FromJSON</method>.
/// <p><b>Why this exists (ledger <c>34-6-CR-7</c>).</b> Live-probed 2026-08-16 (disposable
/// <c>ExecuteMCPv2.Temp.Utf8Probe</c>, deleted before commit — see the story's Probe
/// Findings section for the full transcript): <property>%request.Content</property> is a
/// <class>%CSP.BinaryStream</class> holding the RAW, untranslated request bytes (confirmed
/// byte-for-byte against a known UTF-8 encoding — e.g. <code>é</code> arrived as the two
/// raw bytes 195,169, its exact UTF-8 encoding read as if each byte were its own Latin-1
/// code point), and <property>%request.CharSet</property> is empty because the TS client's
/// <code>Content-Type: application/json</code> header carries no charset parameter, so no
/// CSP-level charset negotiation ever applies. Handing this raw-byte stream straight to
/// <method>%FromJSON</method> (the pre-fix behavior) reproduced the defect exactly: per
/// that method's OWN documented note (<c>%Library.DynamicAbstractObject.cls</c>: "for
/// streams not containing 16-bit Unicode it may be necessary to explicitly convert...via
/// $ZCONVERT...or entire streams by setting the TranslateTable attribute"), it does NOT
/// itself assume UTF-8 for an untranslated stream.</p>
/// <p><b>Chunk-boundary safety (AC 34.8.3).</b> Reads <parameter>UTF8CHUNKSIZE</parameter>
/// raw bytes at a time. A naive per-chunk <code>$ZCONVERT(chunk,"I","UTF8")</code> would
/// corrupt any multi-byte UTF-8 sequence straddling a chunk boundary — decoding each
/// fragment independently mangles it. This method instead detects, via
/// <method>IncompleteUtf8TailLength</method>, whether the last 0-3 bytes of a chunk are the
/// unfinished start of a multi-byte sequence, holds those bytes back, and prepends them to
/// the FRONT of the next chunk before decoding — so a sequence is never split across the
/// boundary. Live-verified against a deliberately tiny 16-byte chunk size on a body
/// containing 2-, 3-, and 4-byte UTF-8 characters back to back (several chunk boundaries
/// land mid-sequence by construction): output was byte-for-byte identical to a single-shot
/// whole-body decode.</p>
/// <p><b>Large-body safety (AC 34.8.4) — two traps found live, not by reasoning.</b>
/// (1) <code>$ZCONVERT</code> given a <class>%Stream.Object</class> OREF directly (instead
/// of a <class>%String</class>) does not throw and does not decode anything — it silently
/// STRINGIFIES THE OREF ITSELF (observed: <code>"25209@%CSP.BinaryStream"</code>), so every
/// chunk MUST be materialized as a <class>%String</class> via <code>.Read()</code> before
/// conversion — never pass a stream to <code>$ZCONVERT</code> directly. (2) A SINGLE
/// <code>.Read(stream.Size)</code> call requesting an entire large stream's content in one
/// shot does not reliably return all of it: live-measured on a 49,000,000-byte stream, one
/// such call silently returned only ~3,589,128 characters — NO exception of any kind, never
/// &lt;MAXSTRING&gt;, just quietly less data than asked for. Reading in a
/// <code>While 'stream.AtEnd</code> loop, chunk by chunk, is the shape verified to retrieve
/// the full content — accumulating the DECODED text into a
/// <class>%Stream.TmpCharacter</class> (never into one growing <class>%String</class>) so
/// the decoded output is not bounded by the <class>%String</class> long-string ceiling
/// either. Live-verified end-to-end at 49,000,000 raw bytes / 48,300,000 decoded characters
/// with zero exceptions and a correct content spot-check.</p>
/// <p>Neither <class>%Stream.TmpCharacter</class> nor <class>%Stream.GlobalCharacter</class>
/// exposes a settable <property>TranslateTable</property> property (mechanically confirmed
/// live via <class>%Dictionary.PropertyDefinition</class>: only
/// <class>%Stream.FileCharacter</class> among <code>%Stream.*</code> classes has one) — the
/// "set TranslateTable on the stream" alternative <method>%FromJSON</method>'s own
/// documentation names is therefore not available for the in-memory stream classes used
/// here without introducing a temp file; the explicit chunked <code>$ZCONVERT</code>
/// approach below is used instead.</p>
/// <p><b>ASCII is unaffected (AC 34.8.5).</b> Every ASCII byte (0-127) is already valid
/// single-byte UTF-8, so <code>$ZCONVERT(asciiChunk,"I","UTF8")</code> is a no-op on
/// ASCII-only content — live-verified byte-for-byte identical through this exact method
/// with a deliberately tiny 7-byte chunk size.</p>
/// <p><var>pChunkSize</var> defaults to <parameter>UTF8CHUNKSIZE</parameter> when omitted
/// (sentinel <code>-1</code>, matching <method>ApplyOutputCeiling</method>'s established
/// convention in this class) — production code always omits it; tests pass a small value
/// to force multiple chunks (and therefore boundary crossings) without needing a
/// multi-megabyte fixture. <b>Story 34.8 code review:</b> the guard accepts any NON-POSITIVE
/// value, not just <code>-1</code>. A literal <code>0</code> would otherwise be used as a
/// real chunk size, and <code>.Read(0)</code> was live-verified during this review to return
/// the empty string WITHOUT advancing the stream or setting <property>AtEnd</property> — so
/// the read loop below would never terminate, hanging the job and its Web Gateway
/// connection. Clamping at <code>&lt;= 0</code> makes that unreachable by construction.</p>
/// <p><b>Malformed input safety (Story 34.8 QA).</b> Each decoded chunk is passed through
/// <method>SanitizeUnpairedSurrogates</method> before being written to <var>tOut</var> —
/// see that method's own banner for why a malformed (never a valid-UTF-8-encoded) input
/// byte sequence can otherwise make this method emit a raw, unpaired UTF-16 surrogate that
/// later re-emerges as genuinely invalid UTF-8 on a response.</p>
ClassMethod DecodeUtf8Stream(pRawStream As %Stream.Object, pChunkSize As %Integer = -1) As %Stream.Object
{
    Set tChunkSize = pChunkSize
    If tChunkSize <= 0 { Set tChunkSize = ..#UTF8CHUNKSIZE }
    Set tOut = ##class(%Stream.TmpCharacter).%New()
    Set tCarry = ""
    Do pRawStream.Rewind()
    While 'pRawStream.AtEnd {
        Set tRawChunk = tCarry _ pRawStream.Read(tChunkSize)
        Set tTail = ..IncompleteUtf8TailLength(tRawChunk)
        If tTail > 0 {
            Set tCarry = $Extract(tRawChunk, *-tTail+1, *)
            Set tDecodeNow = $Extract(tRawChunk, 1, *-tTail)
        } Else {
            Set tCarry = ""
            Set tDecodeNow = tRawChunk
        }
        If tDecodeNow '= "" {
            Do ..WriteDecoded(tOut, tDecodeNow)
        }
    }
    ; Final flush: whatever remains in tCarry at end-of-stream is a genuinely truncated or
    ; malformed trailing sequence AT THIS POINT (not a chunk-boundary artifact — every
    ; boundary up to here was proven complete) — decode it as-is rather than silently
    ; dropping it.
    If tCarry '= "" {
        Do ..WriteDecoded(tOut, tCarry)
    }
    Do tOut.Rewind()
    Quit tOut
}

/// Story 34.8 code review — decode ONE raw-byte chunk and append it to <var>pOut</var>,
/// THROWING if the stream write fails.
/// <p>Both <method>DecodeUtf8Stream</method> call sites previously used a bare
/// <code>Do tOut.Write(...)</code>, discarding the <class>%Status</class> that
/// <method>%Stream.Object.Write</method> returns. A failing write (IRISTEMP full or over
/// quota on a large body, a <code>&lt;STORE&gt;</code>) would then be silently ignored: the
/// read loop would continue and <method>%FromJSON</method> would receive a SILENTLY
/// TRUNCATED document — precisely the "do not trade a silent corruption for a silent
/// failure" failure class AC 34.8.4 exists to prevent, reintroduced one layer down. Raising
/// the real status instead surfaces it through <method>ReadRequestBody</method>'s catch as
/// an explicit server-side read/decode error.</p>
ClassMethod WriteDecoded(pOut As %Stream.Object, pRawChunk As %String) As %Status
{
    Set tSC = pOut.Write(..SanitizeUnpairedSurrogates($ZConvert(pRawChunk, "I", "UTF8")))
    If $$$ISERR(tSC) {
        Throw ##class(%Exception.StatusException).CreateFromStatus(tSC)
    }
    Quit tSC
}

/// Story 34.8 QA (adversarial pass) — <method>DecodeUtf8Stream</method>'s
/// <code>$ZConvert(...,"I","UTF8")</code> call is lenient enough to decode a malformed
/// 3-byte WTF-8/CESU-8 byte sequence (<code>0xED [0xA0-0xBF] [0x80-0xBF]</code> — never
/// valid in conformant UTF-8: RFC 3629 section 3 excludes the entire surrogate block
/// D800-DFFF from UTF-8) into a raw, UNPAIRED UTF-16 surrogate code unit rather than
/// rejecting it — live-verified: <code>$Char(237,160,128)</code> decodes to code point
/// 55296, the literal high-surrogate value, and <code>$Char(237,176,128)</code> to 56320,
/// the literal low-surrogate value. The pre-Story-34.8 Latin-1 decode this replaced could
/// NEVER produce a surrogate code unit from ANY input (Latin-1's range is 0-255, entirely
/// below the surrogate block), so an unpaired surrogate reaching a response is a NEW
/// failure mode this story's UTF-8-aware decode introduces, not a pre-existing one.
/// <p>An unpaired surrogate that reaches a JSON response is re-emitted by IRIS as genuinely
/// invalid UTF-8 on the wire — confirmed live with a hand-crafted raw HTTP body (bypassing
/// any client-side JSON.stringify/UTF-8 auto-sanitization, which always substitutes
/// U+FFFD for an unpaired surrogate before it reaches the wire — no standard JSON+UTF-8
/// client, including this suite's own <c>IrisHttpClient</c>, can produce this byte pattern):
/// a strict <code>TextDecoder({fatal:true})</code> against the actual response bytes
/// THREW, confirming HTTP 200 with genuinely corrupt bytes and no error or truncation
/// signal — the same underlying platform behavior <method>SurrogateSafeCutLength</method>
/// already guards against on the truncation/output side (see its own banner), mirrored
/// here on the decode/input side rather than left as a new, undocumented gap.</p>
/// <p>Replaces each unpaired surrogate half with <code>?</code> — matching
/// <code>$ZConvert</code>'s OWN observed substitution for other invalid byte sequences
/// (e.g. an orphan continuation byte, live-verified to decode to <code>?</code> as well),
/// for consistency rather than inventing a new convention. A genuine, correctly-paired
/// surrogate pair (any valid astral character, e.g. an emoji from a real 4-byte UTF-8
/// sequence) is left completely untouched — chunk-boundary safety guarantees a valid
/// pair's 4 raw bytes are always decoded together in the SAME <code>$ZConvert</code> call
/// (see <method>IncompleteUtf8TailLength</method>'s banner), so this method never needs to
/// look across two separate calls to recognize one.</p>
/// <p>Single forward pass, O(n) in <var>pStr</var>'s length — builds the result from
/// unchanged "clean" runs plus substituted characters rather than repeatedly re-slicing a
/// growing string, so a pathological input consisting of many consecutive unpaired
/// surrogates cannot degrade to quadratic behavior.</p>
ClassMethod SanitizeUnpairedSurrogates(pStr As %String) As %String
{
    Set tLen = $Length(pStr)
    Set tOut = ""
    Set tRunStart = 1
    Set i = 1
    While i <= tLen {
        Set tCode = $Ascii(pStr, i)
        Set tUnpaired = 0
        If (tCode >= 55296) && (tCode <= 56319) {
            ; High surrogate half — valid only when immediately followed by a low surrogate.
            Set tNext = $Select(i < tLen: $Ascii(pStr, i + 1), 1: 0)
            If (tNext >= 56320) && (tNext <= 57343) {
                Set i = i + 2 ; a genuine pair — both code units stay in the pending clean run
            } Else {
                Set tUnpaired = 1
            }
        } ElseIf (tCode >= 56320) && (tCode <= 57343) {
            ; A low surrogate is only ever reached here when it was NOT already consumed as
            ; the second half of a pair above (that branch jumps i past it) — so it is
            ; always unpaired by the time control reaches this branch.
            Set tUnpaired = 1
        } Else {
            Set i = i + 1
        }
        If tUnpaired {
            If i > tRunStart {
                Set tOut = tOut _ $Extract(pStr, tRunStart, i - 1)
            }
            Set tOut = tOut _ "?"
            Set i = i + 1
            Set tRunStart = i
        }
    }
    If tRunStart <= tLen {
        Set tOut = tOut _ $Extract(pStr, tRunStart, tLen)
    }
    Quit tOut
}

/// Story 34.8 AC 34.8.3 — how many TRAILING bytes of <var>pChunk</var> are the unfinished
/// start of a multi-byte UTF-8 sequence (0-3). Lead-byte ranges AS CLASSIFIED HERE: 0xC0-0xDF
/// starts a 2-byte sequence, 0xE0-0xEF a 3-byte sequence, 0xF0-0xFF a 4-byte sequence;
/// 0x80-0xBF is a continuation byte.
/// <p><b>Story 34.8 code review — this classification is deliberately WIDER than conformant
/// UTF-8.</b> Per RFC 3629 a valid 4-byte lead is only 0xF0-0xF4, and 0xF5-0xFF never appear
/// in well-formed UTF-8 at all; 0xC0-0xC1 are likewise always invalid (overlong). Those bytes
/// are still treated as leads above so that a malformed trailing byte is HELD BACK and
/// flushed intact rather than split across two <code>$ZConvert</code> calls. The consequence
/// is bounded and lossless: the carry is at most 3 bytes and is always decoded exactly once
/// by the final flush. Live-verified during code review that every such sequence
/// (0xF5-lead, an 0xF8 5-byte-style lead, a bare 0xFF, and an above-U+10FFFF 0xF4 0x90 0x80
/// 0x80) decodes to a literal <code>?</code> and leaks NO surrogate or other code unit that
/// would re-emerge as invalid UTF-8 on the wire.</p>
/// <p>Checking only the last up to 3 bytes is sufficient — no UTF-8
/// sequence is longer than 4 bytes, so if the last 3 bytes are ALL continuation bytes, the
/// only well-formed reading is a COMPLETE 4-byte sequence whose lead byte is one position
/// further back — already inside the caller's "decode now" portion (that lead byte and all
/// 3 of its continuation bytes are entirely within the current chunk), never split at all.
ClassMethod IncompleteUtf8TailLength(pChunk As %String) As %Integer
{
    Set tLen = $Length(pChunk)
    If tLen = 0 Quit 0
    Set tB1 = $Ascii(pChunk, tLen)
    If tB1 >= 192 Quit 1
    If tB1 < 128 Quit 0
    ; tB1 is a continuation byte (128-191) — look one byte further back.
    If tLen < 2 Quit 0
    Set tB2 = $Ascii(pChunk, tLen - 1)
    If tB2 >= 224 Quit 2
    If tB2 < 128 Quit 0
    If tB2 >= 192 Quit 0
    ; tB2 is ALSO a continuation byte — look one more byte further back.
    If tLen < 3 Quit 0
    Set tB3 = $Ascii(pChunk, tLen - 2)
    If tB3 >= 240 Quit 3
    Quit 0
}

/// Read the HTTP request body and parse it as JSON.
/// <p>Returns a <class>%DynamicObject</class> via the <var>pBody</var> output parameter.</p>
/// <p><b>Story 34.8 (ledger <c>34-6-CR-7</c>).</b> The stream resolved below — whichever of
/// the two branches supplies it — is now decoded as UTF-8 via <method>DecodeUtf8Stream</method>
/// before being handed to <method>%FromJSON</method>, fixing the request-body UTF-8
/// mis-decode defect. See <method>DecodeUtf8Stream</method>'s own banner for the full
/// live-probe evidence. Applied uniformly to both the <code>GetMimeData("BODY")</code>
/// branch and the <property>%request.Content</property> fallback: only the fallback is
/// empirically reachable today (probed 2026-08-16 — <code>GetMimeData("BODY")</code> is
/// never populated for this project's plain <code>application/json</code> POSTs, multipart
/// only), but both are documented CSP conventions for "the raw request body" and neither
/// applies charset translation of its own, so the same fix is correct for either.</p>
ClassMethod ReadRequestBody(Output pBody As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pBody = ""
    ; Story 34.8 code review: the decode stage now runs inside this same Try, so the catch
    ; can no longer assume every failure means malformed client JSON. tStage discriminates
    ; a server-side read/decode fault (stream read, $ZConvert, temp-stream write) from a
    ; genuine JSON parse error, so an operator is not sent to debug a payload that was fine.
    Set tStage = "decode"
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
        Set tUtf8Stream = ..DecodeUtf8Stream(tStream)
        Set tStage = "parse"
        Set pBody = ##class(%DynamicObject).%FromJSON(tUtf8Stream)
    } Catch ex {
        If tStage = "parse" {
            Set tSC = $$$ERROR($$$GeneralError, "Invalid JSON in request body: "_ex.DisplayString())
        } Else {
            Set tSC = $$$ERROR($$$GeneralError, "Failed to read and UTF-8-decode the request body before parsing it; this is a server-side read/decode fault, not malformed JSON from the client: "_ex.DisplayString())
        }
    }
    Quit tSC
}

}
