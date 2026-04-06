/// Unit tests for <class>ExecuteMCPv2.REST.UnitTest</class>.
/// <p>Tests the EnsureTestEnvironment guard pattern, BuildTestSpec logic,
/// and ParseTestResults after running a known test class.</p>
Class ExecuteMCPv2.Tests.UnitTestTest Extends %UnitTest.TestCase
{

/// Test EnsureTestEnvironment sets ^UnitTestRoot when not defined.
Method TestEnsureTestEnvironmentSetsGlobal() As %Status
{
    ; Save current value if it exists
    Set tHadValue = $Data(^UnitTestRoot)
    Set tOldValue = $Get(^UnitTestRoot, "")

    ; Kill it to simulate fresh namespace
    Kill ^UnitTestRoot

    ; Run the guard
    Set tSC = ##class(ExecuteMCPv2.REST.UnitTest).EnsureTestEnvironment()
    Do $$$AssertStatusOK(tSC, "EnsureTestEnvironment should succeed")
    Do $$$AssertTrue($Data(^UnitTestRoot) > 0, "^UnitTestRoot should be defined after guard")
    Do $$$AssertEquals(^UnitTestRoot, "", "^UnitTestRoot should be empty string for pre-compiled mode")

    ; Restore original state
    If tHadValue > 0 {
        Set ^UnitTestRoot = tOldValue
    } Else {
        Kill ^UnitTestRoot
    }
    Quit $$$OK
}

/// Test EnsureTestEnvironment preserves existing ^UnitTestRoot value.
Method TestEnsureTestEnvironmentPreservesExisting() As %Status
{
    ; Save current value
    Set tHadValue = $Data(^UnitTestRoot)
    Set tOldValue = $Get(^UnitTestRoot, "")

    ; Set a custom value
    Set ^UnitTestRoot = "C:\CustomTestDir"

    ; Run the guard — should NOT overwrite
    Set tSC = ##class(ExecuteMCPv2.REST.UnitTest).EnsureTestEnvironment()
    Do $$$AssertStatusOK(tSC, "EnsureTestEnvironment should succeed")
    Do $$$AssertEquals(^UnitTestRoot, "C:\CustomTestDir", "Existing ^UnitTestRoot value should be preserved")

    ; Restore original state
    If tHadValue > 0 {
        Set ^UnitTestRoot = tOldValue
    } Else {
        Kill ^UnitTestRoot
    }
    Quit $$$OK
}

/// Test BuildTestSpec for package level.
Method TestBuildTestSpecPackage() As %Status
{
    Set tSpec = ##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec("ExecuteMCPv2.Tests", "package")
    Do $$$AssertEquals(tSpec, "ExecuteMCPv2.Tests", "Package testspec should be the package name")
    Quit $$$OK
}

/// Test BuildTestSpec for class level.
Method TestBuildTestSpecClass() As %Status
{
    Set tSpec = ##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec("ExecuteMCPv2.Tests.UtilsTest", "class")
    Do $$$AssertEquals(tSpec, "ExecuteMCPv2.Tests.UtilsTest", "Class testspec should be the class name")
    Quit $$$OK
}

/// Test BuildTestSpec for method level extracts class name.
Method TestBuildTestSpecMethod() As %Status
{
    Set tSpec = ##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec("ExecuteMCPv2.Tests.UtilsTest:TestValidateRequiredEmpty", "method")
    Do $$$AssertEquals(tSpec, "ExecuteMCPv2.Tests.UtilsTest", "Method testspec should extract class name before colon")
    Quit $$$OK
}

/// Test BuildTestSpec for method level without colon returns target as-is.
Method TestBuildTestSpecMethodNoColon() As %Status
{
    Set tSpec = ##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec("ExecuteMCPv2.Tests.UtilsTest", "method")
    Do $$$AssertEquals(tSpec, "ExecuteMCPv2.Tests.UtilsTest", "Method testspec without colon should return target as-is")
    Quit $$$OK
}

/// Test that running actual unit tests produces structured results.
/// <p>Runs the UtilsTest class using the UnitTest handler's internal logic
/// and validates that ParseTestResults returns correct structure.</p>
Method TestRunAndParseActualTests() As %Status
{
    ; Ensure test environment
    Set tSC = ##class(ExecuteMCPv2.REST.UnitTest).EnsureTestEnvironment()
    Do $$$AssertStatusOK(tSC, "EnsureTestEnvironment should succeed")

    ; Run UtilsTest directly via %UnitTest.Manager
    Set tSC = ##class(%UnitTest.Manager).RunTest("ExecuteMCPv2.Tests.UtilsTest", "/noload/nodelete")
    ; Note: RunTest may return error if any tests fail, but we still get results

    ; Parse results
    Set tResult = ##class(ExecuteMCPv2.REST.UnitTest).ParseTestResults()

    ; Validate structure
    Do $$$AssertTrue($IsObject(tResult), "ParseTestResults should return an object")
    Do $$$AssertTrue(tResult.%Get("total") > 0, "Should have at least one test result")
    Do $$$AssertTrue(tResult.%Get("passed") > 0, "UtilsTest should have passing tests")

    ; Validate details array
    Set tDetails = tResult.%Get("details")
    Do $$$AssertTrue($IsObject(tDetails), "Details should be an array")
    Do $$$AssertTrue(tDetails.%Size() > 0, "Details should contain test method entries")

    ; Check first detail has required fields
    Set tFirst = tDetails.%Get(0)
    Do $$$AssertTrue($IsObject(tFirst), "First detail entry should be an object")
    Do $$$AssertTrue(tFirst.%Get("class") '= "", "Detail should have class name")
    Do $$$AssertTrue(tFirst.%Get("method") '= "", "Detail should have method name")
    Do $$$AssertTrue((tFirst.%Get("status") = "passed") || (tFirst.%Get("status") = "failed"), "Detail status should be passed or failed")
    Quit $$$OK
}

/// Test that method filter works correctly in ParseTestResults.
Method TestParseTestResultsWithMethodFilter() As %Status
{
    ; Run UtilsTest first to populate results
    Set tSC = ##class(ExecuteMCPv2.REST.UnitTest).EnsureTestEnvironment()
    Do $$$AssertStatusOK(tSC, "EnsureTestEnvironment should succeed")

    Set tSC = ##class(%UnitTest.Manager).RunTest("ExecuteMCPv2.Tests.UtilsTest", "/noload/nodelete")

    ; Parse with a filter for a specific method
    Set tResult = ##class(ExecuteMCPv2.REST.UnitTest).ParseTestResults("TestValidateRequiredEmpty")

    ; Should only have 1 result
    Do $$$AssertEquals(tResult.%Get("total"), 1, "Filtered results should have exactly 1 test")
    Set tDetails = tResult.%Get("details")
    Do $$$AssertEquals(tDetails.%Size(), 1, "Details should have exactly 1 entry")
    Do $$$AssertEquals(tDetails.%Get(0).%Get("method"), "TestValidateRequiredEmpty", "Filtered method name should match")
    Quit $$$OK
}

}
