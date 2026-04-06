/// Unit tests for <class>ExecuteMCPv2.REST.Global</class>.
/// <p>Tests the global operations handler including BuildGlobalRef,
/// ValidateGlobalName, and the namespace switch/restore pattern.
/// Uses a temporary global <code>^ExecuteMCPv2Test</code> for safe testing.</p>
Class ExecuteMCPv2.Tests.GlobalTest Extends %UnitTest.TestCase
{

/// Name of the temporary global used for testing.
Parameter TESTGLOBAL = "ExecuteMCPv2Test";

/// Clean up the test global before each test.
Method OnBeforeOneTest() As %Status
{
    Kill ^ExecuteMCPv2Test
    Quit $$$OK
}

/// Clean up the test global after each test.
Method OnAfterOneTest() As %Status
{
    Kill ^ExecuteMCPv2Test
    Quit $$$OK
}

/// Test BuildGlobalRef with no subscripts returns bare global reference.
Method TestBuildGlobalRefNoSubscripts() As %Status
{
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("TestGlobal", "")
    Do $$$AssertEquals(tRef, "^TestGlobal", "No subscripts should return ^TestGlobal")
    Quit $$$OK
}

/// Test BuildGlobalRef with numeric subscripts.
Method TestBuildGlobalRefNumericSubscripts() As %Status
{
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("TestGlobal", "1,2,3")
    Do $$$AssertEquals(tRef, "^TestGlobal(1,2,3)", "Numeric subscripts should be unquoted")
    Quit $$$OK
}

/// Test BuildGlobalRef with string subscripts.
Method TestBuildGlobalRefStringSubscripts() As %Status
{
    Set tRef = ##class(ExecuteMCPv2.REST.Global).BuildGlobalRefPublic("TestGlobal", """key1"",""key2""")
    Do $$$AssertEquals(tRef, "^TestGlobal(""key1"",""key2"")", "String subscripts should be quoted")
    Quit $$$OK
}

/// Test ValidateGlobalName with valid names.
Method TestValidateGlobalNameValid() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.REST.Global).ValidateGlobalNamePublic("MyGlobal")
    Do $$$AssertStatusOK(tSC, "Alphanumeric name should be valid")
    Set tSC = ##class(ExecuteMCPv2.REST.Global).ValidateGlobalNamePublic("%MyGlobal")
    Do $$$AssertStatusOK(tSC, "Name with leading % should be valid")
    Set tSC = ##class(ExecuteMCPv2.REST.Global).ValidateGlobalNamePublic("A")
    Do $$$AssertStatusOK(tSC, "Single-letter name should be valid")
    Quit $$$OK
}

/// Test ValidateGlobalName with invalid names.
Method TestValidateGlobalNameInvalid() As %Status
{
    Set tSC = ##class(ExecuteMCPv2.REST.Global).ValidateGlobalNamePublic("My Global")
    Do $$$AssertStatusNotOK(tSC, "Name with space should be invalid")
    Set tSC = ##class(ExecuteMCPv2.REST.Global).ValidateGlobalNamePublic("My;Global")
    Do $$$AssertStatusNotOK(tSC, "Name with semicolon should be invalid")
    Set tSC = ##class(ExecuteMCPv2.REST.Global).ValidateGlobalNamePublic("^MyGlobal")
    Do $$$AssertStatusNotOK(tSC, "Name with caret should be invalid (caret added by handler)")
    Quit $$$OK
}

/// Test direct global set and get using indirection.
Method TestGlobalSetAndGet() As %Status
{
    ; Directly test the global operations that the handler performs
    Set tRef = "^ExecuteMCPv2Test"
    Set @tRef = "testValue"
    Set tValue = $Get(@tRef)
    Do $$$AssertEquals(tValue, "testValue", "Global set/get should round-trip correctly")
    Quit $$$OK
}

/// Test global set and get with subscripts.
Method TestGlobalSetAndGetWithSubscripts() As %Status
{
    Set tRef = "^ExecuteMCPv2Test(""key1"",""key2"")"
    Set @tRef = "nestedValue"
    Set tValue = $Get(@tRef)
    Do $$$AssertEquals(tValue, "nestedValue", "Subscripted global should round-trip correctly")
    Quit $$$OK
}

/// Test global $Data for existing and non-existing nodes.
Method TestGlobalDataCheck() As %Status
{
    Set ^ExecuteMCPv2Test = "exists"
    Set tRef = "^ExecuteMCPv2Test"
    Do $$$AssertTrue($Data(@tRef) > 0, "$Data should be > 0 for existing node")
    Set tRefMissing = "^ExecuteMCPv2Test(""nonexistent"")"
    Do $$$AssertTrue($Data(@tRefMissing) = 0, "$Data should be 0 for non-existing node")
    Quit $$$OK
}

/// Test global Kill removes the node.
Method TestGlobalKill() As %Status
{
    Set ^ExecuteMCPv2Test = "toDelete"
    Set tRef = "^ExecuteMCPv2Test"
    Do $$$AssertTrue($Data(@tRef) > 0, "Node should exist before kill")
    Kill @tRef
    Do $$$AssertTrue($Data(@tRef) = 0, "Node should not exist after kill")
    Quit $$$OK
}

/// Test global Kill removes entire subtree.
Method TestGlobalKillSubtree() As %Status
{
    Set ^ExecuteMCPv2Test("a") = 1
    Set ^ExecuteMCPv2Test("a","b") = 2
    Set ^ExecuteMCPv2Test("a","c") = 3
    Kill ^ExecuteMCPv2Test("a")
    Do $$$AssertTrue($Data(^ExecuteMCPv2Test("a")) = 0, "Subtree root should be removed")
    Do $$$AssertTrue($Data(^ExecuteMCPv2Test("a","b")) = 0, "Subtree child b should be removed")
    Do $$$AssertTrue($Data(^ExecuteMCPv2Test("a","c")) = 0, "Subtree child c should be removed")
    Quit $$$OK
}

/// Test namespace switch and restore pattern.
Method TestNamespaceSwitchRestore() As %Status
{
    Set tBefore = $NAMESPACE
    Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace("USER", .tOrigNS)
    Do $$$AssertStatusOK(tSC, "SwitchNamespace should succeed")
    Do $$$AssertTrue(tOrigNS '= "", "Original namespace should be captured")
    Set tSC = ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Do $$$AssertStatusOK(tSC, "RestoreNamespace should succeed")
    Do $$$AssertEquals($NAMESPACE, tBefore, "Namespace should be restored")
    Quit $$$OK
}

/// Test $Order iteration pattern used by ListGlobals.
Method TestGlobalOrderIteration() As %Status
{
    ; Set up test globals in a predictable pattern
    Set ^ExecuteMCPv2Test("alpha") = 1
    Set ^ExecuteMCPv2Test("beta") = 2
    Set ^ExecuteMCPv2Test("gamma") = 3

    ; Iterate using $Order (same pattern as ListGlobals)
    Set tKey = ""
    Set tCount = 0
    For {
        Set tKey = $Order(^ExecuteMCPv2Test(tKey))
        Quit:tKey=""
        Set tCount = tCount + 1
    }
    Do $$$AssertEquals(tCount, 3, "$Order should iterate through all 3 subscript nodes")
    Quit $$$OK
}

}
