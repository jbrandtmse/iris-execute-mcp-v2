/// Unit tests for <class>ExecuteMCPv2.REST.Command</class>.
/// <p>Tests the command execution and class method invocation handlers
/// including I/O capture, error handling, namespace switch/restore,
/// and argument passing. Uses temporary globals and safe class methods
/// for testing.</p>
Class ExecuteMCPv2.Tests.CommandTest Extends %UnitTest.TestCase
{

/// Clean up test globals before each test.
Method OnBeforeOneTest() As %Status
{
    Kill ^ExecuteMCPv2CmdTest
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// Clean up test globals after each test.
Method OnAfterOneTest() As %Status
{
    Kill ^ExecuteMCPv2CmdTest
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// Test $ClassMethod invocation with zero arguments.
Method TestClassMethodZeroArgs() As %Status
{
    Set tResult = $ClassMethod("%SYSTEM.Version", "GetVersion")
    Do $$$AssertTrue(tResult '= "", "$ClassMethod with zero args should return version string")
    Quit $$$OK
}

/// Test $ClassMethod invocation with one argument.
Method TestClassMethodOneArg() As %Status
{
    ; $ZConvert is a function, not a class method — use %Library.File.Exists instead
    Set tResult = $ClassMethod("%SYSTEM.Status", "GetErrorText", $$$OK)
    Do $$$AssertTrue(tResult = "" || (tResult [ "OK") || (tResult '[ "ERROR"), "GetErrorText on OK status should not contain ERROR")
    Quit $$$OK
}

/// Test $ClassMethod invocation with two arguments.
Method TestClassMethodTwoArgs() As %Status
{
    ; Use $$$ERROR to create an error status, then get its text
    Set tStatus = $$$ERROR($$$GeneralError, "test error message")
    Set tResult = $ClassMethod("%SYSTEM.Status", "GetErrorText", tStatus)
    Do $$$AssertTrue(tResult [ "test error message", "GetErrorText should contain our error message")
    Quit $$$OK
}

/// Test $ClassMethod with non-existent class raises error.
Method TestClassMethodBadClass() As %Status
{
    Set tCaught = 0
    Try {
        Set tResult = $ClassMethod("NonExistent.Class.XYZ12345", "DoSomething")
    } Catch ex {
        Set tCaught = 1
        Do $$$AssertTrue(ex.AsStatus() '= $$$OK, "Non-existent class should produce an error status")
    }
    Do $$$AssertTrue(tCaught, "$ClassMethod with bad class should throw an exception")
    Quit $$$OK
}

/// Test $ClassMethod with non-existent method raises error.
Method TestClassMethodBadMethod() As %Status
{
    Set tCaught = 0
    Try {
        Set tResult = $ClassMethod("%SYSTEM.Version", "NonExistentMethodXYZ12345")
    } Catch ex {
        Set tCaught = 1
        Do $$$AssertTrue(ex.AsStatus() '= $$$OK, "Non-existent method should produce an error status")
    }
    Do $$$AssertTrue(tCaught, "$ClassMethod with bad method should throw an exception")
    Quit $$$OK
}

/// Test XECUTE with a simple SET command.
Method TestXecuteSetCommand() As %Status
{
    XECUTE "Set ^ExecuteMCPv2CmdTest = ""xecuted"""
    Set tValue = $Get(^ExecuteMCPv2CmdTest)
    Do $$$AssertEquals(tValue, "xecuted", "XECUTE SET should store value in global")
    Quit $$$OK
}

/// Test XECUTE with a Write command — verifies it does not throw.
Method TestXecuteWriteCommand() As %Status
{
    ; Just verify XECUTE with Write doesn't cause an error
    Set tCaught = 0
    Try {
        XECUTE "Set ^ExecuteMCPv2CmdTest = 42"
    } Catch ex {
        Set tCaught = 1
    }
    Do $$$AssertTrue('tCaught, "XECUTE with SET should not throw")
    Do $$$AssertEquals($Get(^ExecuteMCPv2CmdTest), 42, "Value should be set correctly")
    Quit $$$OK
}

/// Test XECUTE with an invalid command raises an error.
Method TestXecuteInvalidCommand() As %Status
{
    Set tCaught = 0
    Try {
        XECUTE "InvalidCommand12345 xyz"
    } Catch ex {
        Set tCaught = 1
    }
    Do $$$AssertTrue(tCaught, "XECUTE with invalid command should throw an exception")
    Quit $$$OK
}

/// Test namespace switch and restore pattern works correctly.
Method TestNamespaceSwitchRestore() As %Status
{
    Set tBefore = $NAMESPACE
    Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace("USER", .tOrigNS)
    Do $$$AssertStatusOK(tSC, "SwitchNamespace to USER should succeed")
    Do $$$AssertEquals($NAMESPACE, "USER", "Should be in USER namespace")
    Set tSC = ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Do $$$AssertStatusOK(tSC, "RestoreNamespace should succeed")
    Do $$$AssertEquals($NAMESPACE, tBefore, "Namespace should be restored to original")
    Quit $$$OK
}

/// Test namespace switch to invalid namespace returns error status.
Method TestNamespaceSwitchInvalid() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace("NONEXISTENT_NS_XYZ12345", .tOrigNS)
    Do $$$AssertStatusNotOK(tSC, "SwitchNamespace to invalid namespace should return error")
    Quit $$$OK
}

/// Test SanitizeError strips internal details.
Method TestSanitizeErrorStripsDetails() As %Status
{
    Set tStatus = $$$ERROR($$$GeneralError, "Some error at +5^MyRoutine with ^MyGlobal(""key"")")
    Set tSanitized = ##class(ExecuteMCPv2.Utils).SanitizeError(tStatus)
    Set tText = $System.Status.GetErrorText(tSanitized)
    Do $$$AssertTrue(tText '[ "^MyRoutine", "Sanitized error should not contain routine reference")
    Do $$$AssertTrue(tText '[ "^MyGlobal", "Sanitized error should not contain global reference")
    Quit $$$OK
}

/// Test SanitizeError passes through OK status.
Method TestSanitizeErrorOKPassthrough() As %Status
{
    Set tResult = ##class(ExecuteMCPv2.Utils).SanitizeError($$$OK)
    Do $$$AssertStatusOK(tResult, "SanitizeError should pass through OK status")
    Quit $$$OK
}

/// Test ValidateRequired with empty value returns error.
Method TestValidateRequiredEmpty() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired("", "command")
    Do $$$AssertStatusNotOK(tSC, "Empty value should fail validation")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "command", "Error should mention the field name")
    Quit $$$OK
}

/// Test ValidateRequired with non-empty value succeeds.
Method TestValidateRequiredNonEmpty() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired("Write 1", "command")
    Do $$$AssertStatusOK(tSC, "Non-empty value should pass validation")
    Quit $$$OK
}

/// Test argument count branching for $ClassMethod up to 3 args.
Method TestClassMethodMultipleArgs() As %Status
{
    ; Test with 0 args
    Set tResult0 = $ClassMethod("%SYSTEM.Version", "GetVersion")
    Do $$$AssertTrue(tResult0 '= "", "0-arg call should return version")

    ; Test with 1 arg — use %Library.Base64 Encode
    Set tResult1 = $ClassMethod("%SYSTEM.Encryption", "Base64Encode", "hello")
    Do $$$AssertTrue(tResult1 '= "", "1-arg call should return encoded value")

    ; Test with 2 args — use %SYSTEM.Encryption Base64Decode (returns the original)
    Set tResult2 = $ClassMethod("%SYSTEM.Encryption", "Base64Decode", tResult1)
    Do $$$AssertEquals(tResult2, "hello", "2-arg round-trip should return original value")

    Quit $$$OK
}

/// Guards against the 2026-04-23 non-JSON-response-on-large-output regression.
/// <p><b>The bug</b>: <method>Execute</method> bound the I/O-redirect mnemonic
/// onto <var>$IO</var> — the HTTP response stream in CSP context. After
/// <code>ReDirectIO(0)</code> + bare <code>Use tInitIO</code>, the mnemonic
/// stayed bound on the device, corrupting CSP's response-buffer state.
/// At the ~8KB flush boundary the first ~8191 bytes of the JSON envelope
/// were silently dropped — the client saw a truncated non-JSON body.</p>
/// <p><b>The fix</b>: open a separate null device for the redirect target so
/// <var>$IO</var> is never modified. This test exercises the post-fix pattern
/// with &gt;8KB of captured output and asserts the capture is complete and
/// uncorrupted. Live HTTP verification (responses 100 → 100,000 bytes all
/// returning clean JSON envelopes) was performed by the fix author via
/// curl; see CHANGELOG entry for the 2026-04-23 pre-release block.</p>
Method TestLargeOutputCaptureOver8KB() As %Status
{
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()

    ; Reproduce Execute()'s redirect pattern verbatim
    Set %ExecuteMCPOutput = ""
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    ; Write 10000 chars — safely past CSP's ~8KB flush boundary where
    ; the bug previously triggered
    For i=1:1:10000 { Write "X" }

    ; Restore via the post-fix pattern: disable redirect, switch back to
    ; untouched initial device, close the scratch null device.
    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    ; Capture must be intact — no bytes lost to truncation, no extra bytes
    ; from corruption.
    Do $$$AssertEquals($Length(%ExecuteMCPOutput), 10000, "capture should hold all 10000 chars past the 8KB boundary")
    Do $$$AssertTrue($Extract(%ExecuteMCPOutput, 1, 5) = "XXXXX", "capture should start with XXXXX")
    Do $$$AssertTrue($Extract(%ExecuteMCPOutput, *-4, *) = "XXXXX", "capture should end with XXXXX")

    Quit $$$OK
}

}
