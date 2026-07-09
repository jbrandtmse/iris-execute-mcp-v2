/// Unit tests for <class>ExecuteMCPv2.REST.Health</class>'s composite
/// <method>HealthCheck</method> endpoint (Story 23.1).
/// <p>Tests call the per-area helper methods
/// (<method>HealthCheckSystem</method>, <method>HealthCheckLocks</method>,
/// etc.) and the <var>%request</var>-independent
/// <method>HealthCheckParseAreas</method> seam directly, rather than the
/// <method>HealthCheck</method> dispatcher itself — the dispatcher reads the
/// live CSP <var>%request</var> context (method, query string, POST body),
/// which is only populated when invoked through the real REST pipeline, not
/// from a direct %UnitTest call.</p>
Class ExecuteMCPv2.Tests.HealthCheckTest Extends %UnitTest.TestCase
{

/// AC 23.1.3(a): the <code>system</code> area returns its pinned raw fields.
Method TestSystemAreaSuccess() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckSystem(tAreas, tErrors)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertTrue(tAreas.%IsDefined("system"), "system area present on success")
    Do $$$AssertTrue('tErrors.%IsDefined("system"), "system area should not report an error")
    Set tSystem = tAreas.%Get("system")
    Do $$$AssertTrue(tSystem.%IsDefined("globalReferences"), "globalReferences field present")
    Do $$$AssertTrue(tSystem.%IsDefined("routineCommands"), "routineCommands field present")
    Do $$$AssertTrue(tSystem.%IsDefined("uptimeSeconds"), "uptimeSeconds field present")
    Do $$$AssertTrue(tSystem.%IsDefined("processCount"), "processCount field present")
    Do $$$AssertTrue(+tSystem.%Get("processCount") >= 1, "processCount should be at least 1 (this process)")
    Quit $$$OK
}

/// AC 23.1.3(a): the <code>databases</code> area returns per-DB raw fields
/// including the CR 23.0-5 <code>openFailed</code> flag.
Method TestDatabasesAreaSuccess() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckDatabases(tAreas, tErrors)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertTrue(tAreas.%IsDefined("databases"), "databases area present on success")
    Do $$$AssertTrue('tErrors.%IsDefined("databases"), "databases area should not report an error")
    Set tList = tAreas.%Get("databases")
    Do $$$AssertTrue(tList.%Size() > 0, "at least one database should be listed")
    Set tFirst = tList.%Get(0)
    Do $$$AssertTrue(tFirst.%IsDefined("size"), "size field present")
    Do $$$AssertTrue(tFirst.%IsDefined("maxSize"), "maxSize field present")
    Do $$$AssertTrue(tFirst.%IsDefined("mounted"), "mounted field present")
    Do $$$AssertTrue(tFirst.%IsDefined("openFailed"), "openFailed field present")
    Quit $$$OK
}

/// AC 23.1.3(a): the <code>journal</code> area returns the pinned fields
/// plus the new volume free/total pair.
Method TestJournalAreaSuccess() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckJournal(tAreas, tErrors)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertTrue(tAreas.%IsDefined("journal"), "journal area present on success")
    Do $$$AssertTrue('tErrors.%IsDefined("journal"), "journal area should not report an error")
    Set tJournal = tAreas.%Get("journal")
    Do $$$AssertTrue(tJournal.%IsDefined("primaryDirectory"), "primaryDirectory field present")
    Do $$$AssertTrue(tJournal.%IsDefined("volumeFreeBytes"), "volumeFreeBytes field present")
    Do $$$AssertTrue(tJournal.%IsDefined("volumeTotalBytes"), "volumeTotalBytes field present")
    Do $$$AssertTrue(+tJournal.%Get("volumeTotalBytes") > 0, "volumeTotalBytes should be positive on a real volume")
    Quit $$$OK
}

/// AC 23.1.3(a): the <code>mirror</code> area returns the pinned fields.
Method TestMirrorAreaSuccess() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckMirror(tAreas, tErrors)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertTrue(tAreas.%IsDefined("mirror"), "mirror area present on success")
    Do $$$AssertTrue('tErrors.%IsDefined("mirror"), "mirror area should not report an error")
    Set tMirror = tAreas.%Get("mirror")
    Do $$$AssertTrue(tMirror.%IsDefined("isMember"), "isMember field present")
    Quit $$$OK
}

/// AC 23.1.3(a): the <code>locks</code> area returns the pinned CSV fields
/// when correctly invoked in <code>%SYS</code>.
Method TestLocksAreaSuccess() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckLocks(tAreas, tErrors)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertTrue(tAreas.%IsDefined("locks"), "locks area present on success (in %SYS)")
    Do $$$AssertTrue('tErrors.%IsDefined("locks"), "locks area should not report an error in %SYS")
    Set tLocks = tAreas.%Get("locks")
    Do $$$AssertTrue(tLocks.%IsDefined("usable"), "usable field present")
    Do $$$AssertTrue(tLocks.%IsDefined("used"), "used field present")
    Quit $$$OK
}

/// AC 23.1.3(a): the <code>license</code> area returns both the CSPUsers/
/// userLimit pair AND the CR 23.0-2 authoritative dashboard figures.
Method TestLicenseAreaSuccess() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckLicense(tAreas, tErrors)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertTrue(tAreas.%IsDefined("license"), "license area present on success")
    Do $$$AssertTrue('tErrors.%IsDefined("license"), "license area should not report an error")
    Set tLicense = tAreas.%Get("license")
    Do $$$AssertTrue(tLicense.%IsDefined("currentCSPUsers"), "currentCSPUsers field present")
    Do $$$AssertTrue(tLicense.%IsDefined("userLimit"), "userLimit field present")
    Do $$$AssertTrue(tLicense.%IsDefined("licenseCurrent"), "licenseCurrent field present")
    Do $$$AssertTrue(tLicense.%IsDefined("licenseCurrentPct"), "licenseCurrentPct field present")
    Quit $$$OK
}

/// AC 23.1.3(a): the <code>ecp</code> area returns the pinned fields.
Method TestECPAreaSuccess() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckECP(tAreas, tErrors)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertTrue(tAreas.%IsDefined("ecp"), "ecp area present on success")
    Do $$$AssertTrue('tErrors.%IsDefined("ecp"), "ecp area should not report an error")
    Set tECP = tAreas.%Get("ecp")
    Do $$$AssertTrue(tECP.%IsDefined("configured"), "configured field present")
    Quit $$$OK
}

/// AC 23.1.3(a): the <code>alerts</code> area returns the raw numeric
/// <code>state</code> (not a severity string) plus alertCount/messages.
Method TestAlertsAreaSuccess() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckAlerts(tAreas, tErrors)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertTrue(tAreas.%IsDefined("alerts"), "alerts area present on success")
    Do $$$AssertTrue('tErrors.%IsDefined("alerts"), "alerts area should not report an error")
    Set tAlerts = tAreas.%Get("alerts")
    Do $$$AssertTrue(tAlerts.%IsDefined("state"), "state field present (raw numeric, not severity text)")
    Do $$$AssertTrue(tAlerts.%IsDefined("alertCount"), "alertCount field present")
    Do $$$AssertTrue(tAlerts.%IsDefined("messages"), "messages field present")
    Quit $$$OK
}

/// AC 23.1.2 / 23.1.3(a): the <code>interop</code> area always yields a raw
/// <code>interopEnabled</code> signal (applicable or notApplicable) and NEVER
/// lands in <var>errors</var> from the gate itself. Runs in the ORIGINAL
/// (test) namespace — no <code>%SYS</code> switch — matching how the real
/// dispatcher invokes it.
Method TestInteropAreaAppliesOrNotApplicable() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckInterop(tAreas, tErrors)

    Do $$$AssertTrue(tAreas.%IsDefined("interop"), "interop area always present (applicable or notApplicable, never an error)")
    Do $$$AssertTrue('tErrors.%IsDefined("interop"), "interop gate failure must not land in errors (AC 23.1.2)")
    Set tInterop = tAreas.%Get("interop")
    Do $$$AssertTrue(tInterop.%IsDefined("interopEnabled"), "interopEnabled raw signal always present")
    Quit $$$OK
}

/// AC 23.1.2 / 23.1.3(b): the interop gate's FAILURE branch — the case the
/// story text flags as highest regression risk ("must NOT fall into the
/// per-area error catch, else section 5 AC 4 breaks"). Forced with a REAL
/// failure (not a mock): this IRIS instance's <code>%SYS</code> namespace
/// has no <code>Ens.Director</code> class (verified live), so switching to
/// <code>%SYS</code> before calling <method>HealthCheckInterop</method>
/// deterministically drives the gate's <code>'tGateOK</code> branch — the
/// same class-does-not-exist failure mode the real dispatcher would see on
/// any namespace without Interoperability enabled.
Method TestInteropAreaGateFailureYieldsNotApplicable() As %Status
{
    Set tAreas = {}
    Set tErrors = {}
    Set tOrigNS = $NAMESPACE
    Set $NAMESPACE = "%SYS"
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckInterop(tAreas, tErrors)
    Set $NAMESPACE = tOrigNS

    Do $$$AssertTrue(tAreas.%IsDefined("interop"), "interop area present when the gate fails")
    Do $$$AssertTrue('tErrors.%IsDefined("interop"), "gate failure must NOT land in errors (AC 23.1.2)")
    Set tInterop = tAreas.%Get("interop")
    Do $$$AssertEquals(+tInterop.%Get("interopEnabled"), 0, "interopEnabled must be false when the gate has no Ens.Director")
    Quit $$$OK
}

/// AC 23.1.3(b): per-area error isolation. <method>HealthCheckLocks</method>
/// is called WITHOUT first switching to <code>%SYS</code> (this test runs in
/// HSCUSTOM) — <code>SYS.Lock</code> is pinned (Story 23.0) to NOT exist
/// outside <code>%SYS</code>, so this deterministically forces a genuine
/// exception through the SAME Try/Catch the live dispatcher uses (a real
/// failure, not a mock). A second, unrelated area
/// (<method>HealthCheckMirror</method>, pure <code>$SYSTEM.Mirror.*</code>
/// calls that work from any namespace) is populated into the SAME
/// <var>tAreas</var>/<var>tErrors</var> pair to prove one area's failure
/// does not disturb another area's success within a single composite round.
Method TestLocksAreaErrorIsolatedFromOtherAreas() As %Status
{
    Set tAreas = {}
    Set tErrors = {}

    ; Force a real failure: SYS.Lock does not resolve outside %SYS (pinned,
    ; Story 23.0). This test class runs in HSCUSTOM (no %SYS switch here).
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckLocks(tAreas, tErrors)

    ; A second, unrelated area succeeds into the SAME shared objects.
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckMirror(tAreas, tErrors)

    Do $$$AssertTrue(tErrors.%IsDefined("locks"), "locks failure must be captured in errors")
    Do $$$AssertTrue('tAreas.%IsDefined("locks"), "locks must NOT appear in areas when it errored")
    Set tLocksErr = tErrors.%Get("locks")
    Do $$$AssertTrue(tLocksErr '= "", "locks error message should be a non-empty sanitized string")
    Do $$$AssertTrue(tLocksErr '[ "^", "sanitized error message must not contain caret-global references (Rule #33)")

    Do $$$AssertTrue(tAreas.%IsDefined("mirror"), "mirror area must still succeed even though locks failed")
    Do $$$AssertTrue('tErrors.%IsDefined("mirror"), "mirror area must not report an error")
    Quit $$$OK
}

/// AC 23.1.3(c): a blank areas list means "check everything" (all 9 areas).
Method TestParseAreasDefaultsToAll() As %Status
{
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckParseAreas("", .tWant)
    Do $$$AssertEquals(+$Get(tWant("system")), 1, "blank areas defaults system to wanted")
    Do $$$AssertEquals(+$Get(tWant("databases")), 1, "blank areas defaults databases to wanted")
    Do $$$AssertEquals(+$Get(tWant("journal")), 1, "blank areas defaults journal to wanted")
    Do $$$AssertEquals(+$Get(tWant("mirror")), 1, "blank areas defaults mirror to wanted")
    Do $$$AssertEquals(+$Get(tWant("locks")), 1, "blank areas defaults locks to wanted")
    Do $$$AssertEquals(+$Get(tWant("license")), 1, "blank areas defaults license to wanted")
    Do $$$AssertEquals(+$Get(tWant("ecp")), 1, "blank areas defaults ecp to wanted")
    Do $$$AssertEquals(+$Get(tWant("alerts")), 1, "blank areas defaults alerts to wanted")
    Do $$$AssertEquals(+$Get(tWant("interop")), 1, "blank areas defaults interop to wanted")
    Quit $$$OK
}

/// AC 23.1.3(c): a subset request resolves to EXACTLY that subset.
Method TestParseAreasSubsetOnly() As %Status
{
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckParseAreas("journal,license", .tWant)
    Do $$$AssertEquals(+$Get(tWant("journal")), 1, "journal should be wanted")
    Do $$$AssertEquals(+$Get(tWant("license")), 1, "license should be wanted")
    Do $$$AssertEquals(+$Get(tWant("system")), 0, "system should NOT be wanted")
    Do $$$AssertEquals(+$Get(tWant("databases")), 0, "databases should NOT be wanted")
    Do $$$AssertEquals(+$Get(tWant("mirror")), 0, "mirror should NOT be wanted")
    Do $$$AssertEquals(+$Get(tWant("locks")), 0, "locks should NOT be wanted")
    Do $$$AssertEquals(+$Get(tWant("ecp")), 0, "ecp should NOT be wanted")
    Do $$$AssertEquals(+$Get(tWant("alerts")), 0, "alerts should NOT be wanted")
    Do $$$AssertEquals(+$Get(tWant("interop")), 0, "interop should NOT be wanted")
    Quit $$$OK
}

/// AC 23.1.3(c): unknown area names are ignored, not errors; surrounding
/// whitespace around a valid name is tolerated.
Method TestParseAreasIgnoresUnknownNames() As %Status
{
    Do ##class(ExecuteMCPv2.REST.Health).HealthCheckParseAreas("journal,bogus, license ", .tWant)
    Do $$$AssertEquals(+$Get(tWant("journal")), 1, "journal should be wanted")
    Do $$$AssertEquals(+$Get(tWant("license")), 1, "license (with surrounding whitespace) should be wanted")
    Do $$$AssertTrue('$Data(tWant("bogus")), "unknown area name should not create a spurious entry")
    Quit $$$OK
}

/// Rule #33: AreaErrorText must never surface a caret-global/routine
/// reference to the caller.
Method TestAreaErrorTextStripsCaretReferences() As %Status
{
    Set tErr = $$$ERROR($$$GeneralError, "boom at +5^SomeRoutine.1 touching ^SomeGlobal(""x"")")
    Set tText = ##class(ExecuteMCPv2.REST.Health).AreaErrorText(tErr)
    Do $$$AssertTrue(tText '= "", "error text should not be empty")
    Do $$$AssertTrue(tText '[ "^SomeRoutine", "should not contain routine reference")
    Do $$$AssertTrue(tText '[ "^SomeGlobal", "should not contain global reference")
    Quit $$$OK
}

}
