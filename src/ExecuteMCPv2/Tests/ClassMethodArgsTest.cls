/// Unit tests for <class>ExecuteMCPv2.Utils</class>'s Story 34.2 argument pipeline
/// (<method>ParseArgEntry</method>, <method>BuildByRefNode</method>,
/// <method>InvokeWithArgs</method>) — the 20-argument ladder, <code>{byRef, value?}</code>
/// marker parsing, by-ref value read-back, non-array-args rejection, and the capture
/// interaction (through the real <class>ExecuteMCPv2.REST.Command</class> mnemonic
/// routine) at the &lt;MAXSTRING&gt; boundary and around a target that redirects I/O
/// itself. Targets live in <class>ExecuteMCPv2.Tests.ClassMethodArgsFixture</class>.
Class ExecuteMCPv2.Tests.ClassMethodArgsTest Extends %UnitTest.TestCase
{

Parameter FIXTURE = "ExecuteMCPv2.Tests.ClassMethodArgsFixture";

/// Clean up capture globals before/after each test.
Method OnBeforeOneTest() As %Status
{
    Kill %ExecuteMCPOutput
    Kill %ExecuteMCPTruncated
    Quit $$$OK
}

/// Kill the capture buffer AND repair device state. Several tests below turn
/// ReDirectIO on around a call; if one of them fails between redirect-on and
/// redirect-off, the process would stay redirected to the null device and every
/// SUBSEQUENT test in the suite would silently lose its output. Restoring here
/// unconditionally keeps one failure from poisoning the rest of the run
/// (code review 2026-08-14).
Method OnAfterOneTest() As %Status
{
    Kill %ExecuteMCPOutput
    Kill %ExecuteMCPTruncated
    Try {
        Do ##class(%Library.Device).ReDirectIO(0)
    } Catch {}
    Quit $$$OK
}

/// Zero-argument dispatch.
Method TestZeroArgs() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "zero-arg call should succeed")
    Do $$$AssertEquals(tArgCount, 0, "argCount should be 0")
    Do $$$AssertEquals(tReturn, "zero-ok", "return value should match target")
    Quit $$$OK
}

/// One plain scalar argument, no marker — pass-by-value only, no byRefValues entry.
Method TestOneArgPlainScalar() As %Status
{
    Set tArgs = ["hello"]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetPlainReadOnly", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "one-arg call should succeed")
    Do $$$AssertEquals(tArgCount, 1, "argCount should be 1")
    Do $$$AssertEquals(tReturn, "seen:hello", "target should see the scalar value")
    Do $$$AssertTrue('tByRefValues.%IsDefined("0"), "no byRefValues entry for a non-marker scalar")
    Quit $$$OK
}

/// A plain (non-marker) JSON NUMBER argument — 34.1's Residual Risk explicitly named
/// numbers/booleans as an unprobed part of the argument-value space (the "safe
/// unconditionally" evidence boundary was established only for string scalars).
Method TestOneArgPlainNumericScalar() As %Status
{
    Set tArgs = [42]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetPlainReadOnly", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "plain numeric scalar call should succeed")
    Do $$$AssertEquals(tReturn, "seen:42", "target should see the numeric value")
    Quit $$$OK
}

/// A plain (non-marker) JSON BOOLEAN argument — closes the same 34.1 residual-risk gap
/// for booleans. IRIS's %DynamicArray materializes JSON true/false as 1/0.
Method TestOneArgPlainBooleanScalar() As %Status
{
    Set tArgs = [true]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetPlainReadOnly", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "plain boolean scalar call should succeed")
    Do $$$AssertEquals(tReturn, "seen:1", "target should see the boolean value as IRIS's 1/0 representation")
    Quit $$$OK
}

/// {byRef:true, value:""} — an explicitly EMPTY STRING value — must materialize as a
/// genuine defined empty string (distinct from both the null-rejected case and the
/// omitted-key/undefined-in case). Closes the third leg of AC 34.2.6/R6's three-way
/// distinction (omitted / null / ""), which had no dedicated test for the "" leg.
Method TestByRefEmptyStringValueMaterializes() As %Status
{
    Set tArgs = [{"byRef":true,"value":""}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRef", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "empty-string marker value should be accepted, not treated as undefined")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "-mutated", "empty string should materialize as a genuinely defined '' before mutation, not be omitted/undefined")
    Quit $$$OK
}

/// AC 34.2.3 requires rung 10 to be covered. Code review found that no test dispatched
/// it — the method below is named "TenArgs" but passes ONE argument, so the arities
/// actually exercised were 0/1/2/11/20/21. Rung 10 is the boundary between the OLD
/// ceiling and the new one, i.e. the highest-value rung in the AC's list.
Method TestTenArgs() As %Status
{
    Set tArgs = []
    For i=0:1:9 { Do tArgs.%Push({"byRef":true,"value":("v"_i)}) }
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target10", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "10-arg call should succeed")
    Do $$$AssertEquals(tArgCount, 10, "argCount should be 10")
    Do $$$AssertEquals(tReturn, "10-ok", "rung 10 of the ladder should dispatch to the 10-formal target")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "v0-m", "position 0 mutated")
    Do $$$AssertEquals(tByRefValues.%Get("9"), "v9-m", "position 9 mutated")
    Set tCount = 0
    For i=0:1:9 {
        If tByRefValues.%IsDefined(i) Set tCount = tCount + 1
    }
    Do $$$AssertEquals(tCount, 10, "all 10 positions should be present in byRefValues")
    Quit $$$OK
}

/// Back-compat pin (AC 34.2.4): a plain-scalar call through InvokeWithArgs must
/// return the identical value $ClassMethod would return directly, and argCount unchanged.
/// (Arity-10 coverage lives in TestTenArgs above — this method's historical name is kept
/// so the AC 34.2.4 trace stays stable.)
Method TestTenArgsBackCompatShape() As %Status
{
    Set tDirect = $ClassMethod("%SYSTEM.Encryption", "Base64Encode", "hello-back-compat")
    Set tArgs = ["hello-back-compat"]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs("%SYSTEM.Encryption", "Base64Encode", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "1-arg back-compat call should succeed")
    Do $$$AssertEquals(tArgCount, 1, "argCount should be 1, unchanged shape")
    Do $$$AssertEquals(tReturn, tDirect, "returnValue must match direct $ClassMethod call exactly (Rule #19)")
    Quit $$$OK
}

/// 11-argument call against a 20-formal target — confirms the ladder handles counts
/// above the old 10-arg ceiling, and that unsupplied trailing ByRef formals (11..19)
/// don't error.
Method TestElevenArgs() As %Status
{
    Set tArgs = []
    For i=0:1:10 { Do tArgs.%Push({"byRef":true,"value":("v"_i)}) }
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target20", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "11-arg call should succeed")
    Do $$$AssertEquals(tArgCount, 11, "argCount should be 11")
    Do $$$AssertEquals(tReturn, "20-ok", "target should return its normal value")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "v0-m", "position 0 should be mutated")
    Do $$$AssertEquals(tByRefValues.%Get("10"), "v10-m", "position 10 should be mutated")
    Do $$$AssertTrue('tByRefValues.%IsDefined("11"), "position 11 was never supplied, no byRefValues entry")
    Quit $$$OK
}

/// 20 arguments, all marked byRef, all mutated — AC 34.2.3's arity ceiling.
Method TestTwentyArgsAllMutated() As %Status
{
    Set tArgs = []
    For i=0:1:19 { Do tArgs.%Push({"byRef":true,"value":("v"_i)}) }
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target20", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "20-arg call should succeed")
    Do $$$AssertEquals(tArgCount, 20, "argCount should be 20")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "v0-m", "position 0 mutated")
    Do $$$AssertEquals(tByRefValues.%Get("19"), "v19-m", "position 19 mutated")
    Set tCount = 0
    For i=0:1:19 {
        If tByRefValues.%IsDefined(i) Set tCount = tCount + 1
    }
    Do $$$AssertEquals(tCount, 20, "all 20 positions should be present in byRefValues")
    Quit $$$OK
}

/// 21 arguments must be rejected with "maximum is 20".
Method TestTwentyOneArgsRejected() As %Status
{
    Set tArgs = []
    For i=0:1:20 { Do tArgs.%Push(i) }
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "21-arg call should be rejected")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "maximum is 20", "error should mention the 20-arg ceiling")
    Quit $$$OK
}

/// {byRef:true} with no value — Output-style undefined-in; target sees $Data=0 entry.
Method TestByRefOutputUndefinedIn() As %Status
{
    Set tArgs = [{"byRef":true}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetOutput", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "undefined-in Output call should succeed")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "output-set-wasUndef1", "target should have seen the formal as undefined")
    Quit $$$OK
}

/// {byRef:true, value:"before"} — defined-in ByRef case.
Method TestByRefDefinedIn() As %Status
{
    Set tArgs = [{"byRef":true,"value":"before"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRef", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "defined-in ByRef call should succeed")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "before-mutated", "target's mutation should be read back")
    Quit $$$OK
}

/// A {byRef:true} marker whose target never assigns the formal — byRefValues must
/// OMIT the key entirely (still-undefined residual-risk case), never error or emit null.
Method TestByRefUndefinedOutValueOmitted() As %Status
{
    Set tArgs = [{"byRef":true}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetOutputNeverAssigned", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "call should succeed even though the formal stays undefined")
    Do $$$AssertTrue('tByRefValues.%IsDefined("0"), "byRefValues should omit the key when the local is still undefined")
    Quit $$$OK
}

/// AC 34.2.6/R1's motivating case: a subscripted-array Output WITH a top-level value —
/// serialized as {value, subscripts}, with a nested (grandchild) subscript preserved.
Method TestByRefSubscriptTopAndChildren() As %Status
{
    Set tArgs = [{"byRef":true}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetSubscriptOutput", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "subscripted-output call should succeed")
    Set tNode = tByRefValues.%Get("0")
    Do $$$AssertTrue($IsObject(tNode), "subscripted out-value should serialize as a JSON object")
    Do $$$AssertEquals(tNode.%Get("value"), "topvalue", "top-level scalar value should be preserved")
    Set tSubs = tNode.%Get("subscripts")
    Do $$$AssertEquals(tSubs.%Get("k1"), "v1", "leaf subscript should be a raw scalar")
    Set tK2 = tSubs.%Get("k2")
    Do $$$AssertTrue($IsObject(tK2), "k2 has its own descendant, so it should nest as an object")
    Do $$$AssertTrue('tK2.%IsDefined("value"), "k2 itself has no top-level value ($Data=10), so 'value' should be absent")
    Do $$$AssertEquals(tK2.%Get("subscripts").%Get("nested"), "v2", "grandchild subscript should be preserved")
    Quit $$$OK
}

/// Subscripts only, no top-level value ($Data=10) — "value" key must be absent.
Method TestByRefOnlySubscriptsNoTopValue() As %Status
{
    Set tArgs = [{"byRef":true}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetSubscriptOnlyOutput", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "subscripts-only call should succeed")
    Set tNode = tByRefValues.%Get("0")
    Do $$$AssertTrue('tNode.%IsDefined("value"), "no top-level value should mean 'value' key is absent")
    Do $$$AssertEquals(tNode.%Get("subscripts").%Get("a"), "alpha", "subscript 'a' preserved")
    Do $$$AssertEquals(tNode.%Get("subscripts").%Get("b"), "beta", "subscript 'b' preserved")
    Quit $$$OK
}

/// Mixed plain-scalar + byRef marker in the same call — only the marked position
/// appears in byRefValues.
Method TestMixedByRefAndScalar() As %Status
{
    Set tArgs = ["hi", {"byRef":true,"value":"start"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetMixed", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "mixed call should succeed")
    Do $$$AssertEquals(tReturn, "scalar-seen:hi", "plain scalar should be seen by value")
    Do $$$AssertTrue('tByRefValues.%IsDefined("0"), "position 0 was not marked, no byRefValues entry")
    Do $$$AssertEquals(tByRefValues.%Get("1"), "start-mixedmutated", "position 1's mutation should be read back")
    Quit $$$OK
}

/// A target that mutates a by-ref local to hold an OBJECT REFERENCE rather than a
/// scalar or subscript tree must not reach RenderResponseBody unguarded — mirrors the
/// returnValue $IsObject guard.
Method TestByRefOrefOutValueGuarded() As %Status
{
    Set tArgs = [{"byRef":true,"value":"start"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRefOref", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "OREF out-value call should succeed, not error")
    Set tVal = tByRefValues.%Get("0")
    Do $$$AssertTrue('$IsObject(tVal), "byRefValues entry must be JSON-serializable, never a raw OREF")
    Do $$$AssertTrue(tVal [ "<Object:", "OREF out-value should be rendered as a guarded placeholder string")
    Quit $$$OK
}

/// {byRef:false} with no 'value' — rejected (nothing to pass, nothing to read back).
Method TestMarkerByRefFalseNoValue() As %Status
{
    Set tArgs = [{"byRef":false}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "byRef:false with no value should be rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "must include a 'value'", "error should explain the missing value")
    Quit $$$OK
}

/// {byRef:"true"} — a JSON STRING, not a boolean — rejected.
Method TestMarkerByRefStringType() As %Status
{
    Set tArgs = [{"byRef":"true","value":"x"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "string byRef should be rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "must be a JSON boolean", "error should explain the type mismatch")
    Quit $$$OK
}

/// {value:"x"} with no 'byRef' key at all — rejected (not a recognized marker).
Method TestMarkerNoByRefKey() As %Status
{
    Set tArgs = [{"value":"x"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "object without byRef key should be rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "byRef", "error should mention the missing byRef key")
    Quit $$$OK
}

/// {byRef:true, value:42} — a JSON NUMBER value — accepted like any other scalar,
/// materialized and dispatched normally (AC 34.2.6/R7 enumeration only names string
/// values explicitly; numbers/booleans are scalars too and must not be rejected).
Method TestMarkerNumericValueAccepted() As %Status
{
    Set tArgs = [{"byRef":true,"value":42}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRef", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "numeric marker value should be accepted as a scalar")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "42-mutated", "numeric value should materialize and dispatch like any other scalar")
    Quit $$$OK
}

/// {byRef:true, value:false} — a JSON BOOLEAN value — accepted like any other scalar.
Method TestMarkerBooleanValueAccepted() As %Status
{
    Set tArgs = [{"byRef":true,"value":false}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRef", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "boolean marker value should be accepted as a scalar")
    Quit $$$OK
}

/// {byRef:true, value:[1,2,3]} — an ARRAY-typed 'value' — rejected. AC 34.2.6/R7's
/// enumeration groups object/array together in the source ($GetTypeOf branch), but
/// only the object shape had a dedicated test; this closes the array-typed-value gap.
Method TestMarkerArrayValueRejected() As %Status
{
    Set tArgs = [{"byRef":true,"value":[1,2,3]}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "array-typed marker value should be rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "must be a scalar", "error should explain the scalar requirement")
    Quit $$$OK
}

/// {byRef:1, value:"x"} — 'byRef' as a JSON NUMBER (1, not true) — rejected. Confirms
/// %GetTypeOf's "boolean" check rejects numeric truthy values, not just strings.
Method TestMarkerByRefNumericTypeRejected() As %Status
{
    Set tArgs = [{"byRef":1,"value":"x"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "numeric byRef should be rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "must be a JSON boolean", "error should explain the type mismatch")
    Quit $$$OK
}

/// {byref:true, value:"x"} — lowercase 'byref' key (case-sensitive miss) — rejected as
/// "no byRef key", same as an entirely absent key. Named explicitly in 34.1's Residual
/// Risk as an unenumerated marker-recognition edge shape (Rule #56).
Method TestMarkerLowercaseByrefKeyRejected() As %Status
{
    Set tArgs = [{"byref":true,"value":"x"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "lowercase 'byref' key should not be recognized as the 'byRef' marker key")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "byRef", "error should mention the missing byRef key")
    Quit $$$OK
}

/// Rule #58 fixture diversity: captured output containing JSON metacharacters (quote,
/// backslash, brace), a bare LF, a CRLF pair, a tab, a control character, and non-ASCII/
/// UTF-8 text must round-trip through the capture buffer byte-for-byte — the encoding
/// into the JSON envelope itself happens later in Command.cls/%DynamicObject, but the
/// capture buffer must not itself corrupt or drop any of this content.
Method TestCaptureMetacharsAndUnicode() As %Status
{
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetWriteMetachars", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Set tExpected = "quote"""_"backslash\"_"brace{}"_$Char(10)_$Char(13,10)_$Char(9)_"tab-after"_$Char(7)_"unicode-héllo-世界-😀"
    Do $$$AssertStatusOK(tSC, "metachar/unicode write should capture cleanly")
    Do $$$AssertEquals(%ExecuteMCPOutput, tExpected, "captured output must preserve JSON metacharacters, CRLF, control chars, and UTF-8 byte-for-byte")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// Rule #58 fixture diversity: a byRefValues out-value containing the same
/// metacharacter/control-char/unicode mix must round-trip through BuildByRefNode intact
/// (this is a %DynamicObject %Set, not string concatenation, but pin it explicitly since
/// it is the OTHER additive-field encoding path this story introduces).
Method TestByRefValueMetacharsAndUnicode() As %Status
{
    Set tArgs = [{"byRef":true,"value":"start"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRefMetacharsValue", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "metachar/unicode byRef mutation should succeed")
    Set tExpected = "quote"""_"backslash\"_"newline"_$Char(10)_"crlf"_$Char(13,10)_"tab"_$Char(9)_"unicode-héllo-世界-😀"
    Do $$$AssertEquals(tByRefValues.%Get("0"), tExpected, "byRefValues entry must preserve JSON metacharacters, CRLF, control chars, and UTF-8 byte-for-byte")
    Quit $$$OK
}

/// {byRef:true, value:{...}} — an object value — rejected (out of epic scope).
Method TestMarkerObjectValueRejected() As %Status
{
    Set tArgs = [{"byRef":true,"value":{"nested":1}}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "object-typed marker value should be rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "must be a scalar", "error should explain the scalar requirement")
    Quit $$$OK
}

/// Extra unknown keys alongside byRef/value are ignored, not rejected (forward-compat).
Method TestMarkerExtraKeysIgnored() As %Status
{
    Set tArgs = [{"byRef":true,"value":"start","extra":"ignored","another":42}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRef", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "extra unknown keys should be silently ignored")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "start-mutated", "materialization should proceed normally")
    Quit $$$OK
}

/// {} — an empty object — rejected (same as missing byRef key).
Method TestMarkerEmptyObjectRejected() As %Status
{
    Set tArgs = [{}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "empty object should be rejected")
    Quit $$$OK
}

/// A bare JSON array as an argument entry — rejected.
Method TestMarkerNestedArrayRejected() As %Status
{
    Set tArgs = [[1,2,3]]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "nested array argument should be rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "JSON array", "error should mention the array shape")
    Quit $$$OK
}

/// {byRef:true, value:null} — JSON null is explicitly disallowed for 'value'
/// (distinguishes it from an omitted key, AC 34.2.6/R6).
Method TestMarkerNullValueRejected() As %Status
{
    Set tArgs = [{"byRef":true,"value":null}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "null marker value should be rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "cannot be JSON null", "error should explain the null rejection")
    Quit $$$OK
}

/// 'args' supplied as a JSON object (not array) — rejected (AC 34.2.6/R12).
Method TestArgsNotArrayObject() As %Status
{
    Set tArgs = {"notAn":"array"}
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "object args should be rejected")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "must be a JSON array", "error should explain the array requirement")
    Quit $$$OK
}

/// 'args' supplied as a plain (non-empty) string — rejected (AC 34.2.6/R12).
Method TestArgsNotArrayString() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", "notanarray", .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "string args should be rejected")
    Quit $$$OK
}

/// Capture through the ACTUAL production mnemonic routine (Command.cls's Redirects()),
/// dispatching through InvokeWithArgs — proves the two work together (AC 34.2.1).
Method TestCaptureThroughDispatch() As %Status
{
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetWriteTwoLines", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Do $$$AssertStatusOK(tSC, "capture-through-dispatch call should succeed")
    Do $$$AssertEquals(%ExecuteMCPOutput, "line1"_$Char(10)_"line2", "both Write calls should be captured in order")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// AC 34.2.6/R2: a target that writes past the platform's long-string ceiling raises
/// <MAXSTRING> from the capture concatenation itself. Since the Story 34.3 34-2-R1 fix
/// that is absorbed at Command.cls's Redirects() labels (which discriminate on
/// <MAXSTRING> and re-throw anything else) and recorded in %ExecuteMCPTruncated;
/// InvokeWithArgs ORs that flag into pTruncated. Either way the contract asserted here is
/// unchanged: truncated=1 and still $$$OK (partial success, never a silent partial and
/// never an opaque generic error).
Method TestMaxStringTruncation() As %Status
{
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetWriteHuge", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Do $$$AssertStatusOK(tSC, "a <MAXSTRING> capture overflow should be a partial success, not an error")
    Do $$$AssertTrue(tTruncated, "truncated flag should be set")
    Do $$$AssertTrue($Length($Get(%ExecuteMCPOutput,"")) > 1000000, "a large partial capture should still be preserved")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// 34-2-R1 TERMINAL disposition (Story 34.3): a capture <MAXSTRING> that the TARGET's own
/// Try/Catch would previously have swallowed must still surface as truncated:true — the
/// exact silent-partial shape the ledger item reported (deferred from the 34.2 review).
/// Proven by Command.cls's Redirects() labels now absorbing the MAXSTRING internally
/// (setting %ExecuteMCPTruncated) instead of letting it propagate as an exception at all,
/// so the target's own Try/Catch never even sees it — the target runs to completion.
Method TestMaxStringSwallowedByTargetTryCatchStillObservable() As %Status
{
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetWriteHugeSwallowsOwnErrors", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Do $$$AssertStatusOK(tSC, "a target whose own Try/Catch would swallow the capture MAXSTRING must still succeed")
    Do $$$AssertEquals(tReturn, "wrote-huge-swallowed", "the target must run to completion — it never sees the capture-buffer exception at all")
    Do $$$AssertTrue(tTruncated, "34-2-R1: truncation must be observable even when the target's own Try/Catch would have swallowed the underlying MAXSTRING")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// AC 34.2.6/R3 (documented limitation): a target using nested %SYS.Capture does not
/// corrupt the endpoint's own redirect — writes before/after the nested window are
/// still captured, and a follow-up capture cycle proves the device state is clean.
Method TestNestedSysCaptureDoesNotCorruptEnvelope() As %Status
{
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetNestedCapture", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Do $$$AssertStatusOK(tSC, "nested %SYS.Capture target should not throw")
    Do $$$AssertEquals(%ExecuteMCPOutput, "outer-before"_"outer-after", "writes made during the nested capture window are stolen away; before/after are still captured")
    Kill %ExecuteMCPOutput

    ; Follow-up cycle proves the redirect/device state is genuinely clean afterward.
    Set %ExecuteMCPOutput = ""
    Set tInitIO2 = $IO
    Set tNull2 = ##class(%Library.Device).GetNullDevice()
    Open tNull2:::1
    Use tNull2::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)
    Write "post-check"
    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO2
    Close tNull2
    Do $$$AssertEquals(%ExecuteMCPOutput, "post-check", "a subsequent capture cycle should work cleanly")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// Combined AC 34.1.2 / Residual-Risk case, run through the real dispatch chain
/// (mnemonic bound in this test's frame, target's Write reached one extra routine
/// hop away via Utils.InvokeWithArgs — matching production's Command.cls ->
/// Utils.InvokeWithArgs -> $ClassMethod shape) — a target that narrates via Write,
/// switches namespace (ZN) mid-execution (bug report repro 3's shape), AND mutates a
/// ByRef argument, all in the same call. Story 34.1's Residual Risk section flagged
/// this exact combination as the most likely real-world case and never exercised it;
/// this is also the first test to exercise ZN through the NEW InvokeWithArgs frame.
Method TestZNMidExecutionWithByRefThroughDispatch() As %Status
{
    Set tOrigNS = $NAMESPACE
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tArgs = [{"byRef":true,"value":"start"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetZNWriteByRef", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Set tNSAfterCall = $NAMESPACE
    ; Restore namespace exactly as Command.cls's ClassMethod() does before rendering,
    ; so this test doesn't leak a ZN'd process into the rest of the suite.
    Set $NAMESPACE = tOrigNS

    Do $$$AssertStatusOK(tSC, "ZN-mid-execution + ByRef call through the dispatch chain should succeed")
    Do $$$AssertEquals(%ExecuteMCPOutput, "before-zn:"_tOrigNS_$Char(10)_"after-zn:USER", "output should be captured across the ZN and across the Utils.InvokeWithArgs routine-frame boundary")
    Do $$$AssertEquals(tNSAfterCall, "USER", "the target's ZN should persist past return, exactly as production sees before Command.cls's own restore")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "start-zn-mutated", "ByRef mutation should be read back correctly even though the target also switched namespace mid-call")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// Code review regression (HIGH): an OREF out-value on a local that ALSO has subscripts
/// ($Data=11) bypassed the $IsObject guard, which lived inside BuildByRefNode's $Data=1
/// arm. Reproduced live over real HTTP before the fix: the raw OREF reached %ToJSON
/// INSIDE RenderResponseBody and truncated the response body into unparseable JSON with
/// HTTP 200 — the original non-JSON-response bug returning by another door.
Method TestByRefOrefWithSubscriptsGuarded() As %Status
{
    Set tArgs = [{"byRef":true}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRefOrefWithSubscripts", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "an OREF-with-subscripts out-value should not fail the call")
    Set tNode = tByRefValues.%Get("0")
    Do $$$AssertEquals(tNode.%Get("value"), "<Object:ExecuteMCPv2.Tests.ClassMethodArgsFixture>", "the $Data=11 node's own value must be the OREF placeholder, never a raw OREF")
    Do $$$AssertEquals(tNode.%Get("subscripts").%Get("meta"), "has-subscript", "subscripts alongside the OREF value must still serialize")
    ; The whole point of the guard: the assembled node must be JSON-serializable.
    ; Without it, %ToJSON throws here instead of mid-render.
    Do $$$AssertTrue($Length(tByRefValues.%ToJSON()) > 0, "byRefValues must serialize to JSON cleanly")
    Quit $$$OK
}

/// Same guard, one recursion level down: the OREF sits on a CHILD node that has its own
/// subscripts, proving BuildByRefNode guards at every depth (code review).
Method TestNestedOrefOutValueGuarded() As %Status
{
    Set tArgs = [{"byRef":true}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetNestedOrefOutput", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "a nested OREF out-value should not fail the call")
    Set tChild = tByRefValues.%Get("0").%Get("subscripts").%Get("child")
    Do $$$AssertEquals(tChild.%Get("value"), "<Object:ExecuteMCPv2.Tests.ClassMethodArgsFixture>", "a child node's OREF value must also be guarded")
    Do $$$AssertTrue($Length(tByRefValues.%ToJSON()) > 0, "byRefValues must serialize to JSON cleanly at depth")
    Quit $$$OK
}

/// AC 34.2.1's "behavior on target runtime error unchanged" clause had NO test and no
/// throwing fixture target (code review). A genuine target throw must come back as a
/// real error status carrying the real IRIS text (Rule #9), not a success envelope.
Method TestTargetRuntimeErrorSurfaces() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetThrows", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "a throwing target must surface as a real error")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "DIVIDE", "the real IRIS error text must be propagated, not a generic message (Rule #9)")
    Do $$$AssertEquals(tTruncated, 0, "a plain runtime error must not set the truncated flag")
    Quit $$$OK
}

/// Code review regression (HIGH): <MAXSTRING> was detected by substring-matching the
/// error TEXT, so a target whose OWN concatenation overflowed — writing nothing at all —
/// was reported as HTTP 200 success with truncated:true and an empty returnValue,
/// i.e. a crash reported as a truncation. Reproduced live before the fix.
Method TestTargetOwnMaxStringIsRealError() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetThrowsOwnMaxString", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "a target's OWN <MAXSTRING> is a genuine failure, not a capture truncation")
    Do $$$AssertEquals(tTruncated, 0, "truncated must not be set for a <MAXSTRING> the capture buffer did not raise")
    Quit $$$OK
}

/// Same defect class, second shape: an ordinary error whose message merely CONTAINS the
/// literal token <MAXSTRING> must not be swallowed (code review).
Method TestErrorTextMentioningMaxStringIsRealError() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetThrowsTextMentioningMaxString", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "an error merely MENTIONING <MAXSTRING> must stay an error")
    Do $$$AssertEquals(tTruncated, 0, "substring-matching the error text must not set truncated")
    Quit $$$OK
}

/// A bare JSON null array element must be rejected rather than silently coerced to "" —
/// the marker form ({"byRef":true,"value":null}) already was. Code review found the
/// asymmetry and that the shape was missing from the R7 "exhaustive" enumeration
/// (Rule #56); the enumeration date is now 2026-08-15.
Method TestBareNullArgRejected() As %Status
{
    Set tArgs = [null]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetPlainReadOnly", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "a bare JSON null argument should be rejected, not aliased to an empty string")
    Do $$$AssertTrue($System.Status.GetErrorText(tSC) [ "null", "the error should name the null argument")
    Quit $$$OK
}

/// An explicit empty-string element stays accepted and distinct from null (the other
/// half of the R6 three-way distinction, at the non-marker position).
Method TestBareEmptyStringArgAccepted() As %Status
{
    Set tArgs = [""]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetPlainReadOnly", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "an explicit empty-string argument stays valid")
    Do $$$AssertEquals(tReturn, "seen:", "the target should see a genuine empty string")
    Quit $$$OK
}

/// AC 34.2.6/R2's ">8KB" leg: ~20KB of narration, comfortably past the ~8KB CSP
/// response-buffer boundary the null-device redirect exists to avoid, but far below the
/// <MAXSTRING> ceiling. The fixture written for this AC (TargetWriteModerate) was an
/// ORPHAN — defined and referenced by no test — so the AC had no committed regression
/// (code review; also driven end-to-end over real HTTP during review).
Method TestModerateCaptureAboveCspBoundary() As %Status
{
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetWriteModerate", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Do $$$AssertStatusOK(tSC, "a ~20KB narrating target should succeed")
    Do $$$AssertEquals(tTruncated, 0, "20KB is far below the ceiling — truncated must be 0")
    Do $$$AssertTrue($Length($Get(%ExecuteMCPOutput,"")) > 19000, "the full capture must survive past the ~8KB CSP boundary")
    Do $$$AssertEquals($Length(%ExecuteMCPOutput), 300 * 65, "capture length must be exact — 300 lines of 64 chars + newline, no silent loss")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// Constraint C-2 mechanical pin (code review): ClassMethod() binds the capture mnemonic
/// with "^"_$ZNAME, so it MUST compile into the same generated .int as Redirects().
/// Every other capture test hardcodes "^ExecuteMCPv2.REST.Command.1", so all of them
/// would stay green if a future edit pushed ClassMethod() into Command.2.int while
/// production capture broke silently in every namespace. Until now the only check was a
/// one-time manual iris_doc_list step recorded in the story's Debug Log.
Method TestCommandCompilesToSingleGeneratedRoutine() As %Status
{
    Do $$$AssertTrue(##class(%Library.RoutineMgr).Exists("ExecuteMCPv2.REST.Command.1.int"), "the single generated routine for Command.cls must exist")
    Do $$$AssertTrue('##class(%Library.RoutineMgr).Exists("ExecuteMCPv2.REST.Command.2.int"), "Command.cls must still compile to exactly ONE generated .int (Story 34.1 Constraint C-2) — a split silently breaks capture in every namespace")
    Do $$$AssertTrue($Text(wstr^ExecuteMCPv2.REST.Command.1) '= "", "the wstr capture label must live in that same routine")
    Quit $$$OK
}

/// Story 34.6 AC 34.6.1: mirrors Command.cls's OWN capture + ApplyOutputCeiling
/// sequence exactly (open null device, redirect, dispatch, restore, THEN bound the
/// captured output) — the REST handlers themselves are not directly %UnitTest-callable,
/// so this pins the full pipeline they run without requiring live HTTP. Proves the raw
/// capture is untouched (truncation is NOT InvokeWithArgs' concern) and that applying
/// the ceiling afterward, exactly as Command.cls does, produces a bounded, marked result.
Method TestOutputCeilingAppliedAfterCaptureMirrorsCommandCls() As %Status
{
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetWriteOverCeiling", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Do $$$AssertStatusOK(tSC, "a 50000-char narrating target should succeed")
    Do $$$AssertEquals(tTruncated, 0, "InvokeWithArgs itself must not flag truncation — 50000 chars is far below <MAXSTRING>")
    Set tOutput = $Get(%ExecuteMCPOutput, "")
    Do $$$AssertEquals($Length(tOutput), 50000, "the raw capture must hold all 50000 chars — the ceiling is applied AFTER capture, in Command.cls, not during it")
    Kill %ExecuteMCPOutput

    ; Mirror Command.cls's post-capture ceiling application exactly (Rule #19: same
    ; helper, same OR-in semantics).
    Set tOutput = ##class(ExecuteMCPv2.Utils).ApplyOutputCeiling(tOutput, .tTruncated)
    Do $$$AssertTrue($Length(tOutput) <= 32768, "ceiling-applied output must not exceed the documented ceiling")
    Do $$$AssertTrue(tOutput [ "[IRIS-MCP-TRUNCATED", "ceiling-applied output must carry the machine-detectable marker")
    Do $$$AssertEquals(tTruncated, 1, "truncated must now be set — the OR-in behavior Command.cls relies on")
    Quit $$$OK
}

/// Story 34.6 AC 34.6.1: a single byRef value far exceeding the documented byte budget
/// (OUTPUTCEILING, 32768 chars) is truncated in place with the SAME marker
/// ApplyOutputCeiling uses for the output field, and byRefTruncated is set — separately
/// from truncated, which stays 0 (no capture-overflow occurred; this is a structural
/// byRefValues concern, not an output-capture one).
Method TestByRefValueByteBudgetTruncatesHugeLeaf() As %Status
{
    Set tArgs = [{"byRef":true,"value":"start"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRefHugeValue", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated, .tByRefTruncated)
    Do $$$AssertStatusOK(tSC, "huge byRef-value call should succeed")
    Set tVal = tByRefValues.%Get("0")
    Do $$$AssertTrue($Length(tVal) <= 32768, "byRefValues.0 must not exceed the documented byte budget")
    Do $$$AssertTrue(tVal [ "[IRIS-MCP-TRUNCATED", "truncated byRefValues.0 must carry the machine-detectable marker")
    Do $$$AssertEquals(tByRefTruncated, 1, "byRefTruncated must be set when the byte budget is exhausted")
    Do $$$AssertEquals(tTruncated, 0, "the unrelated output-capture truncated flag must stay 0")
    Quit $$$OK
}

/// Story 34.6 AC 34.6.1: 1500 subscript entries (each a trivially small value) exceed
/// the documented STRUCTURAL node budget (BYREFNODECEILING, 1000) — the tree is cut
/// short rather than growing unbounded, and both byRefTruncated AND the cut node's own
/// subscriptsTruncated marker are set, isolating the node budget from the byte budget
/// (every individual value here is one character — the byte budget is nowhere close to
/// exhausted).
Method TestByRefValueNodeBudgetTruncatesManySubscripts() As %Status
{
    Set tArgs = [{"byRef":true}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRefManySubscripts", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated, .tByRefTruncated)
    Do $$$AssertStatusOK(tSC, "many-subscripts call should succeed")
    Set tNode = tByRefValues.%Get("0")
    Do $$$AssertTrue(tNode.%Get("subscriptsTruncated"), "the cut-off node must be marked subscriptsTruncated")
    Set tSubs = tNode.%Get("subscripts")
    Set tIter = tSubs.%GetIterator()
    Set tCount = 0
    While tIter.%GetNext(.tKey, .tVal) {
        Set tCount = tCount + 1
    }
    Do $$$AssertTrue(tCount <= 1000, "subscript count ("_tCount_") must not exceed the documented node budget of 1000, out of 1500 written")
    Do $$$AssertTrue(tCount > 0, "some subscripts should still have been captured before the budget ran out")
    Do $$$AssertEquals(tByRefTruncated, 1, "byRefTruncated must be set when the node budget is exhausted")
    Quit $$$OK
}

/// Story 34.6 code-review finding CR-6 (a defect this story introduced, not
/// pre-existing): once the shared byRefValues byte budget is fully exhausted by an
/// earlier position, later positions must be OMITTED from byRefValues entirely —
/// never replaced by a marker LARGER than the small value it would have destroyed,
/// and never pushing the total content past the documented budget. Mirrors the live
/// reproduction from code review exactly: one huge Output value (which alone consumes
/// the entire remaining budget) followed by several small ones — "42", "hello", "x" —
/// the exact values code review found destroyed and replaced with ~37-char markers.
/// <p><b>Story 34.7 AC 34.7.3:</b> <method>InvokeWithArgs</method>' byRefValues byte
/// budget now STARTS at <parameter>ExecuteMCPv2.Utils.OUTPUTCEILING</parameter> MINUS
/// whatever <c>Target20</c>'s own <c>"20-ok"</c> return value would consume of the ONE
/// shared response budget (5 characters — returnValue is first in the shared-budget
/// priority order), not the full ceiling. <var>tSharedBudget</var> below derives that
/// starting point explicitly rather than hard-coding 32763, so this test does not go
/// stale if the fixture's return string or the ceiling ever change.</p>
Method TestByRefValueBudgetExhaustionOmitsRatherThanDestroys() As %Status
{
    Set tHuge = $TR($J("", 40000), " ", "H")
    Set tArgs = []
    Do tArgs.%Push({"byRef":true,"value":(tHuge)})
    Do tArgs.%Push({"byRef":true,"value":"42"})
    Do tArgs.%Push({"byRef":true,"value":"hello"})
    Do tArgs.%Push({"byRef":true,"value":"x"})
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target20", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated, .tByRefTruncated, .tOutputBudget)
    Do $$$AssertStatusOK(tSC, "budget-exhaustion call should still succeed")
    Do $$$AssertEquals(tByRefTruncated, 1, "byRefTruncated must be set once the shared budget is exhausted")
    Do $$$AssertEquals(tReturn, "20-ok", "Target20's own return value must survive untouched — sanity check on the shared-budget arithmetic below")

    ; Story 34.7 AC 34.7.3: byRefValues starts with whatever the shared response budget
    ; has left after returnValue's own share ("20-ok", 5 chars) — not the full ceiling.
    Set tSharedBudget = ##class(ExecuteMCPv2.Utils).#OUTPUTCEILING - $Length(tReturn)
    Set tVal0 = tByRefValues.%Get("0")
    Do $$$AssertEquals($Length(tVal0), tSharedBudget, "the huge first position must be truncated to exactly the shared budget remaining after returnValue")

    ; Positions 1-3 must be OMITTED entirely — never replaced by an oversized marker,
    ; and never shown as a misleading empty string that could be confused with a
    ; genuine target-assigned empty value.
    Do $$$AssertTrue('tByRefValues.%IsDefined("1"), "position 1 (would-be '42-m') must be omitted once the budget is exhausted, not replaced by a marker")
    Do $$$AssertTrue('tByRefValues.%IsDefined("2"), "position 2 (would-be 'hello-m') must be omitted once the budget is exhausted, not replaced by a marker")
    Do $$$AssertTrue('tByRefValues.%IsDefined("3"), "position 3 (would-be 'x-m') must be omitted once the budget is exhausted, not replaced by a marker")

    ; The combined content across ALL surviving positions must never exceed the
    ; documented budget — the CR-6 "response grew while losing data" defect.
    ; Story 34.6 code review (cycle 2): this previously asserted only
    ; $Length(tVal0) <= 32768, a strictly weaker duplicate of the AssertEquals two lines
    ; above that could not fail and did not measure the property its message claimed —
    ; a surviving position 1 carrying 5KB would have kept it green. Sum the WHOLE
    ; serialized structure instead, so the assertion actually observes the total.
    Do $$$AssertTrue($Length(tByRefValues.%ToJSON()) <= (tSharedBudget + 4096), "total serialized byRefValues ("_$Length(tByRefValues.%ToJSON())_") must stay within the shared budget remaining after returnValue, plus scaffolding allowance")

    ; Story 34.7 AC 34.7.3: nothing is left over for `output` once byRefValues has
    ; consumed the entire shared budget on position 0 alone.
    Do $$$AssertEquals(tOutputBudget, 0, "the shared response budget must be fully exhausted (0 remaining for output) once byRefValues consumed all of it")
    Quit $$$OK
}

/// Story 34.6 code review (cycle 2) — the byRefValues byte budget must charge subscript
/// KEYS, not only leaf values. Before this fix the budget was decremented solely by leaf
/// value length, so a long-keyed Output array (file paths, URLs, composite keys — an
/// entirely idiomatic ObjectScript Output shape) emitted a byRefValues payload
/// arbitrarily larger than the documented 32768-character budget while
/// <var>byRefTruncated</var> still reported false. Measured live against the deployed
/// pre-fix code: 400 positions keyed by 900-character subscripts emitted 363,908
/// characters with 32,368 of the budget still reported unspent.
/// <p>Uses <method>ExecuteMCPv2.Utils.BuildByRefNode</method> directly (the same shape
/// the sibling budget tests use) so the property is pinned at the unit that owns it, and
/// deliberately keeps every VALUE tiny so only the key charging can bound the result —
/// a regression that stops charging keys makes this go RED, not merely slower.</p>
Method TestByRefKeysAreChargedAgainstTheByteBudget() As %Status
{
    Kill tLocal
    Set tKeyBase = $TR($J("", 900), " ", "K")
    For i = 1:1:400 { Set tLocal(tKeyBase_i) = "v" }
    Set tNodeBudget = 1000
    Set tByteBudget = 32768
    Set tByRefTruncated = 0
    Set tNode = ##class(ExecuteMCPv2.Utils).BuildByRefNode(.tLocal, .tNodeBudget, .tByteBudget, .tByRefTruncated)
    Set tSerialized = tNode.%ToJSON()
    ; Every value is 1 character, so the node budget (1000) cannot bind here: 400
    ; subscripts is well under it. Only key charging can stop this.
    Do $$$AssertTrue(tNodeBudget > 0, "the node budget must NOT be what bounds this case — otherwise the test would not exercise key charging")
    Do $$$AssertEquals(tByRefTruncated, 1, "exhausting the shared byte budget on subscript keys must set byRefTruncated")
    Do $$$AssertTrue($Length(tSerialized) <= (32768 + 4096), "serialized byRefValues node ("_$Length(tSerialized)_") must stay within the documented budget plus scaffolding allowance")
    Quit $$$OK
}

/// Story 34.6 code review (cycle 2) — companion to
/// <method>TestByRefKeysAreChargedAgainstTheByteBudget</method> for the OTHER previously
/// free emission: the <code>&lt;Object:...&gt;</code> placeholder written for an OREF
/// out-value. Before this fix that arm never decremented the byte budget at all, so the
/// budget provided literally zero protection on the OREF path.
Method TestOrefPlaceholdersAreChargedAgainstTheByteBudget() As %Status
{
    Kill tLocal
    Set tLocal = "root"
    For i = 1:1:400 { Set tLocal(i) = ##class(%DynamicObject).%New() }
    Set tNodeBudget = 1000
    Set tByteBudget = 32768
    Set tByRefTruncated = 0
    Set tNode = ##class(ExecuteMCPv2.Utils).BuildByRefNode(.tLocal, .tNodeBudget, .tByteBudget, .tByRefTruncated)
    Do $$$AssertTrue(tByteBudget < 32768, "OREF placeholders must be charged against the shared byte budget, not emitted free")
    Do $$$AssertTrue($Length(tNode.%ToJSON()) <= (32768 + 4096), "serialized byRefValues node must stay within the documented budget plus scaffolding allowance")
    Quit $$$OK
}

/// Story 34.6 AC 34.6.5 (Rule #19): an ordinary, small byRefValues call stays
/// byte-identical to pre-34.6 behavior — byRefTruncated is additively false, never
/// invented as true when nothing was truncated.
Method TestByRefValueUnderBudgetByRefTruncatedFalse() As %Status
{
    Set tArgs = [{"byRef":true,"value":"before"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetByRef", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated, .tByRefTruncated)
    Do $$$AssertStatusOK(tSC, "ordinary defined-in ByRef call should succeed")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "before-mutated", "value unaffected by the new budget machinery")
    Do $$$AssertEquals(tByRefTruncated, 0, "byRefTruncated must be false when nothing was truncated")
    Quit $$$OK
}

/// Story 34.6 AC 34.6.2 fixture sanity: TargetReturnNamespace reflects the CURRENT
/// namespace, proving it is genuinely namespace-sensitive — used by the epic gate's leg
/// (d) and its custom-rest.integration.test.ts original to replace the
/// namespace-invariant %SYSTEM.Version.GetVersion() oracle (ledger 34-4-R1).
Method TestTargetReturnNamespaceReflectsCurrentNamespace() As %Status
{
    Set tBefore = $NAMESPACE
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetReturnNamespace", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "TargetReturnNamespace call should succeed")
    Do $$$AssertEquals(tReturn, tBefore, "should return the namespace the call executed in")
    Quit $$$OK
}

/// AC 34.2.6/R3 (documented limitation): a target that turns the redirect off/on
/// itself does not corrupt the envelope — its "during-off" write is silently lost
/// (discarded to the null device), but before/after writes are captured and the
/// endpoint's own redirect state stays clean afterward.
Method TestSelfRedirectOffDoesNotCorruptEnvelope() As %Status
{
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetSelfRedirectOff", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Do $$$AssertStatusOK(tSC, "self-redirect-off target should not throw")
    Do $$$AssertEquals(%ExecuteMCPOutput, "before-off"_"after-on-again", "the during-off write is silently lost, not corrupting the envelope")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

}
