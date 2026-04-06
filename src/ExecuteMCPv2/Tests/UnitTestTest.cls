/// Unit tests for <class>ExecuteMCPv2.REST.UnitTest</class>.
/// <p>Tests the EnsureTestEnvironment guard pattern and BuildTestSpec logic.</p>
Class ExecuteMCPv2.Tests.UnitTestTest Extends %UnitTest.TestCase
{

/// Test EnsureTestEnvironment creates a valid directory when ^UnitTestRoot is undefined.
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
    ; The guard now creates a temp directory (not empty string)
    Do $$$AssertTrue(^UnitTestRoot '= "", "^UnitTestRoot should be a directory path, not empty")
    Do $$$AssertTrue(##class(%File).DirectoryExists(^UnitTestRoot), "^UnitTestRoot directory should exist")

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

    ; Set a custom value that is a real directory
    Set tDir = ##class(%File).NormalizeDirectory($ZU(12)_"unittest_test_preserve")
    Do ##class(%File).CreateDirectoryChain(tDir)
    Set ^UnitTestRoot = tDir

    ; Run the guard — should NOT overwrite since it's a valid directory
    Set tSC = ##class(ExecuteMCPv2.REST.UnitTest).EnsureTestEnvironment()
    Do $$$AssertStatusOK(tSC, "EnsureTestEnvironment should succeed")
    Do $$$AssertEquals(^UnitTestRoot, tDir, "Existing ^UnitTestRoot value should be preserved")

    ; Restore original state
    If tHadValue > 0 {
        Set ^UnitTestRoot = tOldValue
    } Else {
        Kill ^UnitTestRoot
    }
    Quit $$$OK
}

/// Test BuildTestSpec for class level uses colon prefix.
Method TestBuildTestSpecClass() As %Status
{
    Set tSpec = ##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec("ExecuteMCPv2.Tests.UtilsTest", "class")
    Do $$$AssertEquals(tSpec, ":ExecuteMCPv2.Tests.UtilsTest", "Class testspec should have colon prefix")
    Quit $$$OK
}

/// Test BuildTestSpec for method level uses colon prefix with class:method format.
Method TestBuildTestSpecMethod() As %Status
{
    Set tSpec = ##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec("ExecuteMCPv2.Tests.UtilsTest:TestValidateRequiredEmpty", "method")
    Do $$$AssertEquals(tSpec, ":ExecuteMCPv2.Tests.UtilsTest:TestValidateRequiredEmpty", "Method testspec should be :Class:Method")
    Quit $$$OK
}

/// Test BuildTestSpec for method level without colon returns colon-prefixed target.
Method TestBuildTestSpecMethodNoColon() As %Status
{
    Set tSpec = ##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec("ExecuteMCPv2.Tests.UtilsTest", "method")
    Do $$$AssertEquals(tSpec, ":ExecuteMCPv2.Tests.UtilsTest", "Method testspec without colon should have colon prefix")
    Quit $$$OK
}

/// Test BuildTestSpec for package level discovers test classes via SQL.
Method TestBuildTestSpecPackage() As %Status
{
    Set tSpec = ##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec("ExecuteMCPv2.Tests", "package")
    ; Should contain at least UtilsTest with colon prefix
    Do $$$AssertTrue(tSpec [ ":ExecuteMCPv2.Tests.UtilsTest", "Package spec should contain UtilsTest")
    Do $$$AssertTrue($Extract(tSpec) = ":", "Package spec should start with colon")
    Quit $$$OK
}

}
