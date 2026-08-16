/// Unit tests for <class>ExecuteMCPv2.Utils</class>.
Class ExecuteMCPv2.Tests.UtilsTest Extends %UnitTest.TestCase
{

/// Test SwitchNamespace saves the original namespace and switches.
Method TestSwitchNamespaceSuccess() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace("USER", .tOriginal)
    Do $$$AssertStatusOK(tSC, "SwitchNamespace to USER should succeed")
    Do $$$AssertTrue(tOriginal '= "", "Original namespace should be captured")
    ; Restore
    Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOriginal)
    Quit $$$OK
}

/// Test SwitchNamespace with invalid namespace returns error.
Method TestSwitchNamespaceInvalid() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace("NONEXISTENT_NS_12345", .tOriginal)
    Do $$$AssertStatusNotOK(tSC, "SwitchNamespace to invalid namespace should fail")
    Quit $$$OK
}

/// Test RestoreNamespace restores correctly.
Method TestRestoreNamespace() As %Status
{
    Set tBefore = $NAMESPACE
    Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace("USER", .tOriginal)
    Do $$$AssertStatusOK(tSC, "SwitchNamespace should succeed")
    Set tSC = ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOriginal)
    Do $$$AssertStatusOK(tSC, "RestoreNamespace should succeed")
    Do $$$AssertEquals($NAMESPACE, tBefore, "Namespace should be restored to original")
    Quit $$$OK
}

/// Test ValidateRequired with empty value returns error.
Method TestValidateRequiredEmpty() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired("", "myField")
    Do $$$AssertStatusNotOK(tSC, "Empty value should fail required validation")
    Quit $$$OK
}

/// Test ValidateRequired with non-empty value returns OK.
Method TestValidateRequiredNonEmpty() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired("hello", "myField")
    Do $$$AssertStatusOK(tSC, "Non-empty value should pass required validation")
    Quit $$$OK
}

/// Test ValidateString with valid string.
Method TestValidateStringValid() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateString("hello", "name", 10)
    Do $$$AssertStatusOK(tSC, "Valid string within length should pass")
    Quit $$$OK
}

/// Test ValidateString with empty string fails.
Method TestValidateStringEmpty() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateString("", "name", 10)
    Do $$$AssertStatusNotOK(tSC, "Empty string should fail validation")
    Quit $$$OK
}

/// Test ValidateString exceeding max length.
Method TestValidateStringExceedsMaxLen() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateString("hello world", "name", 5)
    Do $$$AssertStatusNotOK(tSC, "String exceeding max length should fail")
    Quit $$$OK
}

/// Test ValidateString with no max length (0) passes any length.
Method TestValidateStringNoMaxLen() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateString("a very long string value", "name", 0)
    Do $$$AssertStatusOK(tSC, "String with no max length restriction should pass")
    Quit $$$OK
}

/// Test ValidateInteger with valid integer.
Method TestValidateIntegerValid() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateInteger("42", "count")
    Do $$$AssertStatusOK(tSC, "Valid integer should pass")
    Quit $$$OK
}

/// Test ValidateInteger with negative integer.
Method TestValidateIntegerNegative() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateInteger("-5", "count")
    Do $$$AssertStatusOK(tSC, "Negative integer should pass")
    Quit $$$OK
}

/// Test ValidateInteger with non-numeric value.
Method TestValidateIntegerInvalid() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateInteger("abc", "count")
    Do $$$AssertStatusNotOK(tSC, "Non-numeric value should fail integer validation")
    Quit $$$OK
}

/// Test ValidateInteger with empty value.
Method TestValidateIntegerEmpty() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateInteger("", "count")
    Do $$$AssertStatusNotOK(tSC, "Empty value should fail integer validation")
    Quit $$$OK
}

/// Test ValidateBoolean with valid values.
Method TestValidateBooleanValid() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateBoolean("1", "flag")
    Do $$$AssertStatusOK(tSC, "1 should be valid boolean")
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateBoolean("0", "flag")
    Do $$$AssertStatusOK(tSC, "0 should be valid boolean")
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateBoolean("true", "flag")
    Do $$$AssertStatusOK(tSC, "true should be valid boolean")
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateBoolean("false", "flag")
    Do $$$AssertStatusOK(tSC, "false should be valid boolean")
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateBoolean("True", "flag")
    Do $$$AssertStatusOK(tSC, "True (capitalized) should be valid boolean")
    Quit $$$OK
}

/// Test ValidateBoolean with invalid value.
Method TestValidateBooleanInvalid() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateBoolean("maybe", "flag")
    Do $$$AssertStatusNotOK(tSC, "maybe should fail boolean validation")
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateBoolean("2", "flag")
    Do $$$AssertStatusNotOK(tSC, "2 should fail boolean validation")
    Quit $$$OK
}

/// Test SanitizeError with OK status passes through.
Method TestSanitizeErrorOK() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).SanitizeError($$$OK)
    Do $$$AssertStatusOK(tSC, "OK status should pass through SanitizeError unchanged")
    Quit $$$OK
}

/// Test SanitizeError strips internal details.
Method TestSanitizeErrorStripsDetails() As %Status
{
    Set tErr = $$$ERROR($$$GeneralError, "Error at +5^MyRoutine.1 accessing ^MyGlobal(""key"")")
    Set tSafe = ##class(ExecuteMCPv2.Utils).SanitizeError(tErr)
    Do $$$AssertStatusNotOK(tSafe, "Sanitized error should still be an error")
    Set tText = $System.Status.GetErrorText(tSafe)
    ; Should not contain caret references
    Do $$$AssertTrue(tText '[ "^MyRoutine", "Sanitized error should not contain routine references")
    Do $$$AssertTrue(tText '[ "^MyGlobal", "Sanitized error should not contain global references")
    Quit $$$OK
}

/// Test SanitizeError does not accumulate English ERROR prefix nesting (Rule #8 / Bug #11 regression guard).
/// <p>When SanitizeError receives a status whose embedded message already begins with "ERROR #N: "
/// (a double-wrap scenario), the prefix-strip logic prevents further nesting. This test verifies
/// idempotency: calling SanitizeError a second time does not add another #N: level.
/// The IRIS instance on this project renders its own outer prefix in Arabic ("خطأ"), so the
/// assertion targets prefix count stability rather than an absolute count of 1.</p>
Method TestSanitizeErrorStripsLeadingErrorPrefix() As %Status
{
    ; Construct a status whose user message already embeds "ERROR #5001: Foo"
    ; GetErrorText of this input shows two #5001 occurrences (outer IRIS prefix + inner embedded)
    Set tInput = $$$ERROR($$$GeneralError, "ERROR #5001: Foo")
    ; First sanitize pass: strips one leading prefix from the extracted text
    Set tOnce = ##class(ExecuteMCPv2.Utils).SanitizeError(tInput)
    ; Second sanitize pass: must NOT add another level (idempotency)
    Set tTwice = ##class(ExecuteMCPv2.Utils).SanitizeError(tOnce)
    Set tCountOnce = $Length($System.Status.GetErrorText(tOnce), "#5001") - 1
    Set tCountTwice = $Length($System.Status.GetErrorText(tTwice), "#5001") - 1
    ; The prefix count must not grow on repeated calls — that is the Bug #11 regression guard
    Do $$$AssertTrue(tCountTwice = tCountOnce, "SanitizeError prefix count must be stable on repeated calls (once="_tCountOnce_", twice="_tCountTwice_")")
    ; The result must still be an error status (not $$$OK)
    Do $$$AssertStatusNotOK(tOnce, "Sanitized status should still be an error")
    Quit $$$OK
}

/// Test SanitizeError does not accumulate Arabic prefix nesting (Rule #8 / Bug #11 — locale variant).
/// <p>Same idempotency contract as TestSanitizeErrorStripsLeadingErrorPrefix but for the
/// Arabic "خطأ #N: " prefix variant, which is the locale IRIS renders on this project's instance.</p>
Method TestSanitizeErrorStripsArabicPrefix() As %Status
{
    ; Arabic chars for "خطأ": $Char(1582,1591,1571)
    Set tArabicPrefix = $Char(1582,1591,1571)
    Set tInput = $$$ERROR($$$GeneralError, tArabicPrefix_" #5001: Bar")
    Set tOnce = ##class(ExecuteMCPv2.Utils).SanitizeError(tInput)
    Set tTwice = ##class(ExecuteMCPv2.Utils).SanitizeError(tOnce)
    Set tCountOnce = $Length($System.Status.GetErrorText(tOnce), "#5001") - 1
    Set tCountTwice = $Length($System.Status.GetErrorText(tTwice), "#5001") - 1
    Do $$$AssertTrue(tCountTwice = tCountOnce, "Arabic prefix count must be stable on repeated SanitizeError calls (once="_tCountOnce_", twice="_tCountTwice_")")
    Do $$$AssertStatusNotOK(tOnce, "Sanitized Arabic-prefix status should still be an error")
    Quit $$$OK
}

/// Story 34.6 AC 34.6.1 / Rule #19: a string comfortably under the documented ceiling
/// (32768 chars) passes through completely unchanged, and an ALREADY-false truncated
/// flag stays false.
Method TestApplyOutputCeilingUnderCeilingUnchanged() As %Status
{
    Set tTruncated = 0
    Set tResult = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling("hello world", .tTruncated)
    Do $$$AssertEquals(tResult, "hello world", "under-ceiling content must be byte-identical")
    Do $$$AssertEquals(tTruncated, 0, "truncated must stay false when nothing was truncated")
    Quit $$$OK
}

/// Boundary: a string EXACTLY at the ceiling must not be truncated ($Length <= ceiling,
/// not strictly less-than).
Method TestApplyOutputCeilingExactlyAtCeilingUnchanged() As %Status
{
    Set tTruncated = 0
    Set tInput = $TR($J("", 32768), " ", "Q")
    Set tResult = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tInput, .tTruncated)
    Do $$$AssertEquals($Length(tResult), 32768, "a string exactly at the ceiling must be returned unchanged in length")
    Do $$$AssertEquals(tResult, tInput, "a string exactly at the ceiling must be byte-identical")
    Do $$$AssertEquals(tTruncated, 0, "exactly-at-ceiling must not set truncated")
    Quit $$$OK
}

/// A string one character over the ceiling is truncated, carries the machine-detectable
/// marker (never a bare "..."), and the total length never exceeds the ceiling.
Method TestApplyOutputCeilingOverCeilingTruncates() As %Status
{
    Set tTruncated = 0
    Set tInput = $TR($J("", 32769), " ", "Q")
    Set tResult = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tInput, .tTruncated)
    Do $$$AssertTrue($Length(tResult) <= 32768, "truncated output must never exceed the ceiling")
    Do $$$AssertTrue(tResult [ "[IRIS-MCP-TRUNCATED ceiling=32768chars]", "truncated output must carry the structured, greppable marker")
    Do $$$AssertTrue(tResult '[ "...", "the marker must not be reducible to a bare ellipsis")
    Do $$$AssertEquals(tTruncated, 1, "truncated must be set")
    Quit $$$OK
}

/// Only ever SETS truncated — an already-true flag from an earlier, unrelated cause
/// (e.g. a capture-buffer <MAXSTRING>) is preserved when the content itself does not
/// need truncation, so a caller can OR this in for free by passing its own flag ByRef.
Method TestApplyOutputCeilingPreservesAlreadyTrueFlag() As %Status
{
    Set tTruncated = 1
    Set tResult = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling("short", .tTruncated)
    Do $$$AssertEquals(tResult, "short", "under-ceiling content is still unchanged")
    Do $$$AssertEquals(tTruncated, 1, "an already-true truncated flag must never be reset to false")
    Quit $$$OK
}

/// An explicit pCeiling of 0 (distinct from omitting the argument, which defaults to
/// OUTPUTCEILING via the -1 sentinel) truncates ANY non-empty content to a plain EMPTY
/// STRING, never a marker. Story 34.6 code-review findings CR-6/CR-8 fix: the elision
/// marker itself is ~37+ characters, so at ceiling 0 (or any ceiling smaller than the
/// marker) emitting the marker would replace even a tiny value with something LARGER,
/// and the marker alone would itself exceed the ceiling it is supposed to respect —
/// exactly the defect that let BuildByRefNode destroy small real values with oversized
/// markers once its shared byte budget was exhausted. This is the shape
/// BuildByRefNode/AddByRefPosition now rely on at a fully-exhausted budget.
Method TestApplyOutputCeilingExplicitZeroCeiling() As %Status
{
    Set tTruncated = 0
    Set tResult = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling("anything", .tTruncated, 0)
    Do $$$AssertEquals(tTruncated, 1, "an explicit zero ceiling must still set truncated for non-empty content")
    Do $$$AssertEquals(tResult, "", "with zero characters of budget, the result must be empty — never a marker larger than the budget itself")
    Quit $$$OK
}

/// Story 34.6 code-review finding CR-9 fix (documentation/emission mismatch): below the
/// marker's own length, ApplyOutputCeiling must not emit any partial/malformed marker
/// fragment — the marker is only ever emitted WHOLE, matching the documented format
/// exactly, or not at all. The hard cut below the marker band must still be a genuine
/// PREFIX of the original content.
Method TestApplyOutputCeilingBelowMarkerLengthOmitsMarkerEntirely() As %Status
{
    Set tTruncated = 0
    Set tInput = $TR($J("", 25), " ", "Q")
    Set tResult = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tInput, .tTruncated, 10)
    Do $$$AssertEquals(tTruncated, 1, "content longer than the 10-char ceiling must still be flagged truncated")
    Do $$$AssertEquals($Length(tResult), 10, "with no room for the marker, the result must be a plain hard cut to the ceiling")
    Do $$$AssertEquals(tResult, $Extract(tInput, 1, 10), "the hard cut must be a genuine prefix of the original content, not a fragment of the marker")
    Do $$$AssertTrue(tResult '[ "[IRIS-MCP-TRUNCATED", "no partial/malformed marker fragment may appear when the marker itself does not fit")
    Quit $$$OK
}

/// Story 34.6 code-review findings CR-6/CR-8 fix — the core invariant: for EVERY
/// ceiling from 0 up through comfortably past the marker's own length, the truncated
/// result must never exceed the ceiling it was given NOR exceed the length of the
/// value it replaced. These are the two properties the pre-fix implementation
/// violated (a small value could be replaced by a LARGER marker, and the result could
/// exceed the stated ceiling/budget). Swept across a full range rather than
/// spot-checked at one value, since the marker's own length varies with the ceiling's
/// digit count.
Method TestApplyOutputCeilingNeverExceedsCeilingOrOriginalLength() As %Status
{
    Set tInput = $TR($J("", 60), " ", "Q")
    For tCeiling=0:1:60 {
        Set tTruncated = 0
        Set tResult = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tInput, .tTruncated, tCeiling)
        Do $$$AssertTrue($Length(tResult) <= tCeiling, "result must never exceed ceiling "_tCeiling_" (got "_$Length(tResult)_")")
        Do $$$AssertTrue($Length(tResult) <= $Length(tInput), "result must never exceed the original 60-char input at ceiling "_tCeiling_" (got "_$Length(tResult)_")")
    }
    Quit $$$OK
}

/// A caller-supplied custom ceiling smaller than the default OUTPUTCEILING is honored —
/// proves pCeiling is genuinely a parameter, not silently ignored in favor of the default.
/// (100, not a tiny value like 5, because the marker text itself is ~40 characters —
/// a ceiling smaller than the marker can only ever return the marker alone, which is
/// already covered by TestApplyOutputCeilingExplicitZeroCeiling above.)
Method TestApplyOutputCeilingCustomSmallerCeiling() As %Status
{
    Set tTruncated = 0
    Set tInput = $TR($J("", 200), " ", "9")
    Set tResult = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tInput, .tTruncated, 100)
    Do $$$AssertEquals(tTruncated, 1, "a custom ceiling smaller than the content length must truncate")
    Do $$$AssertTrue($Length(tResult) <= 100, "result must respect the CUSTOM ceiling (100), not the default 32768")
    Do $$$AssertTrue(tResult [ "[IRIS-MCP-TRUNCATED ceiling=100chars]", "the marker must reflect the custom ceiling value")
    Quit $$$OK
}

/// Story 34.6 QA (Priority 1 — UTF-8/surrogate-pair truncation-boundary safety, "the
/// epic's original bug class": a corrupt/unparseable envelope), SUPERSEDED by Story 34.7
/// AC 34.7.1 (ledger <c>34-6-CR-10</c>). The original version of this test only proved
/// the response stayed valid INSIDE IRIS's own %ToJSON/%FromJSON round-trip — a closed
/// loop that tolerates IRIS's own WTF-8 encoding of an unpaired surrogate and is
/// structurally blind to what actually reaches the wire (Rules #36/#54). It is genuinely
/// impossible to pin the REAL defect (invalid UTF-8 bytes on an HTTP response) from
/// inside IRIS at all — that pin lives in the TS default suite,
/// <c>execute-classmethod-epic-gate.test.ts</c>, which decodes the ACTUAL response bytes
/// with a strict, fatal <c>TextDecoder</c> (AC 34.7.2).
/// <p>What THIS test pins instead, at the ObjectScript level, is the new PRODUCT
/// guarantee directly: for every ceiling in a sweep engineered to include at least one
/// case that WOULD have cut mid-pair under the pre-34.7 formula, the retained CONTENT
/// portion of the result — everything before any elision marker — never ends on a lone
/// high surrogate. Live-verified during this story: before the
/// <method>SurrogateSafeCutLength</method> fix, this exact assertion failed at ceiling
/// 101 with a content-portion length of 60 ending in ascii 55357 (a lone high
/// surrogate); after the fix, ceiling 101's content portion is 59 characters, ending in
/// ascii 56832 (the LOW half of the PRECEDING complete pair) — the guard backs off by
/// exactly one code unit, never more.</p>
/// <p>Sweeps 4 consecutive ceilings against a long repeated-pair run rather than one
/// hand-picked value — tKeep = ceiling - markerLen, so consecutive ceilings alternate
/// parity, GUARANTEEING at least one would have landed mid-pair under the UNGUARDED
/// formula, without depending on hand-derived marker-length arithmetic (a mistake made
/// and caught during the original Story 34.6 QA pass). The unguarded tKeep is computed
/// with ApplyOutputCeiling's OWN pre-guard formula, copied verbatim, ONLY to confirm the
/// sweep reaches the dangerous case — never to predict the actual (guarded) result.</p>
/// <p>Rule #58 fixture diversity: the pre-existing TestCaptureMetacharsAndUnicode
/// coverage (ClassMethodArgsTest) embeds "héllo-世界-😀" but well BELOW any ceiling, so
/// it is never actually cut — it cannot catch a truncation-boundary defect. This test
/// exists specifically to close that gap.</p>
Method TestApplyOutputCeilingMidSurrogatePairStaysValidJSON() As %Status
{
    Set tHigh = $Char(55357)
    Set tLow = $Char(56832)
    Set tPair = tHigh _ tLow
    Set tRun = ""
    For i=1:1:50 {
        Set tRun = tRun _ tPair
    }
    Set tFull = tRun _ "TAILAFTERCUT"
    Set tSawWouldHaveCutMidPairUnguarded = 0
    For tCeiling=100:1:103 {
        Set tTruncated = 0
        Set tResult = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tFull, .tTruncated, tCeiling)
        Do $$$AssertEquals(tTruncated, 1, "content longer than ceiling "_tCeiling_" must be truncated")

        ; The marker text is deterministic from tCeiling alone — used to locate the
        ; boundary between the retained CONTENT portion and any trailing marker, and
        ; (via the UNGUARDED formula it embeds) to confirm this sweep genuinely reaches
        ; a would-be mid-pair cut. Never used to predict tResult's actual content.
        Set tMarker = $Char(10)_"[IRIS-MCP-TRUNCATED ceiling="_tCeiling_"chars]"_$Char(10)
        Set tUnguardedKeep = tCeiling - $Length(tMarker)
        If tUnguardedKeep < 0 { Set tUnguardedKeep = 0 }
        Set tUnguardedLastAscii = $Select(tUnguardedKeep>0: $Ascii(tFull, tUnguardedKeep), 1: -1)
        If tUnguardedLastAscii = 55357 {
            Set tSawWouldHaveCutMidPairUnguarded = 1
        }

        ; The ACTUAL, guarded content portion: tResult with any trailing marker
        ; stripped. A marker, when present, is always emitted WHOLE (Story 34.6
        ; CR-6/CR-8/CR-9) at the very end of tResult, so a literal suffix match locates
        ; it unambiguously; when the marker does not fit within tCeiling at all,
        ; tResult IS the content portion (the marker-less hard-cut band).
        Set tContentLen = $Length(tResult)
        If ($Length(tResult) >= $Length(tMarker)) && ($Extract(tResult, $Length(tResult)-$Length(tMarker)+1, *) = tMarker) {
            Set tContentLen = $Length(tResult) - $Length(tMarker)
        }
        Set tContentLastAscii = $Select(tContentLen>0: $Ascii(tResult, tContentLen), 1: -1)
        Do $$$AssertTrue((tContentLastAscii < 55296) || (tContentLastAscii > 56319), "ceiling "_tCeiling_": the retained content must never end on a lone high surrogate (got ascii "_tContentLastAscii_")")

        ; The pre-existing safety net, still true and still worth pinning: whatever the
        ; guard produces must stay valid inside IRIS's own JSON round-trip too.
        Set tObj = {}
        Do tObj.%Set("output", tResult)
        Set tJsonOK = 1
        Set tJsonText = ""
        Try {
            Set tStream = ##class(%Stream.TmpCharacter).%New()
            Do tObj.%ToJSON(tStream)
            Do tStream.Rewind()
            Set tJsonText = tStream.Read(tStream.Size)
        } Catch {
            Set tJsonOK = 0
        }
        Do $$$AssertEquals(tJsonOK, 1, "%ToJSON must not throw at ceiling "_tCeiling_" (contentLastAscii="_tContentLastAscii_")")

        ; And the result must be genuinely re-parseable — a corrupt envelope is corrupt
        ; precisely because a real client's JSON.parse (mirrored here by %FromJSON) fails.
        Set tRoundTripOK = 1
        Try {
            Set tRoundTrip = ##class(%DynamicObject).%FromJSON(tJsonText)
        } Catch {
            Set tRoundTripOK = 0
        }
        Do $$$AssertEquals(tRoundTripOK, 1, "the envelope at ceiling "_tCeiling_" must round-trip through %FromJSON without error")
    }
    ; Confirm the sweep genuinely reached the dangerous case — if this ever fails, the
    ; test's own setup needs revisiting (e.g. IRIS's internal surrogate representation
    ; changed), not the product code the loop above already exercised.
    Do $$$AssertEquals(tSawWouldHaveCutMidPairUnguarded, 1, "the ceiling sweep must include at least one ceiling that would have cut mid-pair under the pre-34.7 unguarded formula, or this test proves nothing about the guard")
    Quit $$$OK
}

/// Story 34.7 AC 34.7.1 (ledger 34-6-CR-10) — direct, deterministic pin of
/// SurrogateSafeCutLength's four cases, independent of ApplyOutputCeiling's own marker
/// arithmetic. pStr is a complete surrogate pair (high then low) followed by plain
/// ASCII tail characters, so every position's classification is known by construction.
Method TestSurrogateSafeCutLengthCases() As %Status
{
    Set tHigh = $Char(55357)
    Set tLow = $Char(56832)
    Set tStr = tHigh _ tLow _ "TAIL"

    ; Position 1 lands exactly ON the high surrogate — must back off to 0.
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).SurrogateSafeCutLength(tStr, 1), 0, "a cut landing on the high half of a pair must back off to the preceding boundary (0, not 1)")

    ; Position 2 lands exactly on the low surrogate — the pair is COMPLETE at this
    ; length, so the guard must be a no-op (never backs off a clean boundary).
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).SurrogateSafeCutLength(tStr, 2), 2, "a cut landing on the low half (pair already complete) must not be adjusted")

    ; Position 3 lands on a plain ASCII character ('T') — no surrogate involved at all.
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).SurrogateSafeCutLength(tStr, 3), 3, "a cut landing on an ordinary ASCII character must not be adjusted")

    ; pLen=0 is the explicit boundary case the method's own banner calls out — must
    ; return 0 unchanged (nothing to inspect, never negative).
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).SurrogateSafeCutLength(tStr, 0), 0, "pLen=0 must return 0 unchanged")
    Quit $$$OK
}

/// Story 34.7 AC 34.7.1 (ledger 34-6-CR-10) — the guard also protects the MARKER-LESS
/// hard-cut band (a ceiling below the ~37-41 character elision marker's own length),
/// not just the marker-carrying band the sweep above exercises. pOutput is a complete
/// surrogate pair followed by plain ASCII, so ceiling=1 deterministically lands ON the
/// high surrogate (backs off to an empty result) and ceiling=2 deterministically lands
/// on the completed pair's low half (an already-clean cut, unaffected by the guard) —
/// both well below any marker, isolating SurrogateSafeCutLength's effect inside
/// ApplyOutputCeiling's own marker-less fallback branch specifically.
Method TestApplyOutputCeilingMarkerlessBandNeverEndsOnHighSurrogate() As %Status
{
    Set tHigh = $Char(55357)
    Set tLow = $Char(56832)
    Set tOutput = tHigh _ tLow _ "TAIL"

    Set tTruncated1 = 0
    Set tResult1 = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tOutput, .tTruncated1, 1)
    Do $$$AssertEquals(tTruncated1, 1, "content longer than ceiling 1 must be truncated")
    Do $$$AssertEquals(tResult1, "", "ceiling 1 lands on the high surrogate alone — must back off to an empty result, never a lone high surrogate")

    Set tTruncated2 = 0
    Set tResult2 = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tOutput, .tTruncated2, 2)
    Do $$$AssertEquals(tTruncated2, 1, "content longer than ceiling 2 must be truncated")
    Do $$$AssertEquals(tResult2, tHigh_tLow, "ceiling 2 lands exactly on the completed pair — must be returned intact, unaffected by the guard")
    Quit $$$OK
}

}
