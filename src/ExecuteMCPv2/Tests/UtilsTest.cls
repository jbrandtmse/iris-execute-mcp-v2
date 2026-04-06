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

}
