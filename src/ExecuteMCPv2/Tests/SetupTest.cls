/// Unit tests for <class>ExecuteMCPv2.Setup</class>.
/// <p>Tests the Configure, Uninstall, and IsConfigured methods for
/// web application registration.</p>
/// <p><b>Note:</b> These tests require <code>%Admin_Manage</code> privileges
/// since they create/delete web applications in the <code>%SYS</code> namespace.</p>
Class ExecuteMCPv2.Tests.SetupTest Extends %UnitTest.TestCase
{

/// Test that Configure creates the web application successfully.
Method TestConfigureCreatesWebApp() As %Status
{
    ; First uninstall to ensure clean state
    Set tSC = ##class(ExecuteMCPv2.Setup).Uninstall()
    Do $$$AssertStatusOK(tSC, "Uninstall should succeed (clean state)")

    ; Verify it's gone
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).IsConfigured(), 0, "Web app should not exist before Configure")

    ; Run Configure
    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Do $$$AssertStatusOK(tSC, "Configure should succeed")

    ; Verify it exists
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).IsConfigured(), 1, "Web app should exist after Configure")

    Quit $$$OK
}

/// Test that Configure is idempotent — calling it twice succeeds.
Method TestConfigureIdempotent() As %Status
{
    ; Configure twice
    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Do $$$AssertStatusOK(tSC, "First Configure should succeed")

    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Do $$$AssertStatusOK(tSC, "Second Configure should succeed (idempotent)")

    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).IsConfigured(), 1, "Web app should exist after double Configure")

    Quit $$$OK
}

/// Test that Uninstall removes the web application.
Method TestUninstallRemovesWebApp() As %Status
{
    ; Ensure it exists first
    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Do $$$AssertStatusOK(tSC, "Configure should succeed")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).IsConfigured(), 1, "Web app should exist")

    ; Uninstall
    Set tSC = ##class(ExecuteMCPv2.Setup).Uninstall()
    Do $$$AssertStatusOK(tSC, "Uninstall should succeed")

    ; Verify removed
    Do $$$AssertEquals(##class(ExecuteMCPv2.Setup).IsConfigured(), 0, "Web app should not exist after Uninstall")

    Quit $$$OK
}

/// Test that Uninstall is idempotent — calling it when no web app exists succeeds.
Method TestUninstallIdempotent() As %Status
{
    ; Uninstall twice — second should be a no-op
    Set tSC = ##class(ExecuteMCPv2.Setup).Uninstall()
    Do $$$AssertStatusOK(tSC, "First Uninstall should succeed")

    Set tSC = ##class(ExecuteMCPv2.Setup).Uninstall()
    Do $$$AssertStatusOK(tSC, "Second Uninstall should succeed (idempotent)")

    Quit $$$OK
}

/// Test IsConfigured returns correct boolean values.
Method TestIsConfigured() As %Status
{
    ; Configure and check
    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Do $$$AssertStatusOK(tSC, "Configure should succeed")
    Do $$$AssertTrue(##class(ExecuteMCPv2.Setup).IsConfigured(), "IsConfigured should return true when configured")

    ; Uninstall and check
    Set tSC = ##class(ExecuteMCPv2.Setup).Uninstall()
    Do $$$AssertStatusOK(tSC, "Uninstall should succeed")
    Do $$$AssertTrue('##class(ExecuteMCPv2.Setup).IsConfigured(), "IsConfigured should return false when not configured")

    Quit $$$OK
}

/// Cleanup: ensure web app exists after test run (restore expected state).
Method OnAfterAllTests() As %Status
{
    ; Re-configure to leave the system in a working state
    Set tSC = ##class(ExecuteMCPv2.Setup).Configure()
    Quit tSC
}

}
