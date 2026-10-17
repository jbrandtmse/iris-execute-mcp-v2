/// Tests for the two helpers behind the interoperability Event Log surfaces:
/// <method>ExecuteMCPv2.REST.Monitor:UtcCutoff</method> (the 24-hour window of
/// <code>iris_metrics_interop</code>) and
/// <method>ExecuteMCPv2.REST.Interop:LogTypeValue</method> (the display-name to stored-number
/// mapping of the <code>iris_production_logs</code> <code>type</code> filter).
/// <p>Data-free: no Event Log or message rows are read or written. The cutoff test changes
/// this process's <code>$ZTimeZone</code> and restores it on every path, including
/// <method>OnAfterOneTest</method>.</p>
Class ExecuteMCPv2.Tests.EventLogMetricsTest Extends %UnitTest.TestCase
{

/// The process time zone when the test method started (empty when not captured).
Property SavedZone As %String;

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Set ..SavedZone = ""
    Quit $$$OK
}

/// Remember the process time zone so every test method can restore it.
Method OnBeforeOneTest(testname As %String) As %Status
{
    Set ..SavedZone = $ZTimeZone
    Quit $$$OK
}

/// Restore the process time zone whatever the test method did.
Method OnAfterOneTest(testname As %String) As %Status
{
    If ..SavedZone '= "" Set $ZTimeZone = ..SavedZone
    Quit $$$OK
}

/// Absolute seconds since the horolog epoch of a horolog-shaped <code>days,seconds</code> value.
ClassMethod Seconds(pHorolog As %String) As %Numeric
{
    Quit (+$Piece(pHorolog, ",", 1) * 86400) + $Piece(pHorolog, ",", 2)
}

/// A fixed instant gives a fixed cutoff. Expected values were captured live
/// (IRIS 2026.2 build 221U): a mid-day instant, a cutoff that crosses midnight backwards,
/// a cutoff that stays on the previous day, and the midnight boundary.
Method TestUtcCutoffFixedInstant()
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(86400, "67860,79328.804084877"), "2026-10-16 22:02:08.804", "24 h before a mid-day instant")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(3600, "67860,1800.25"), "2026-10-16 23:30:00.250", "one hour before 00:30 crosses midnight backwards")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(86400, "67860,3600.5"), "2026-10-16 01:00:00.500", "24 h before 01:00 stays on the previous day")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(0, "67860,0"), "2026-10-17 00:00:00.000", "zero seconds before midnight is midnight")
}

/// The default cutoff comes from <code>$ZTimeStamp</code>, so the process time zone, which
/// moves <code>$Horolog</code>, leaves it alone.
Method TestUtcCutoffIgnoresProcessTimeZone()
{
    Set tZones = $ListBuild(420, -600)
    Set tPointer = 0
    While $ListNext(tZones, tPointer, tZone) {
        Try {
            Set $ZTimeZone = tZone
            Set tBefore = ..Seconds($ZTimeStamp)
            Set tCutoff = ##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(86400)
            Set tAfter = ..Seconds($ZTimeStamp)
            Set tGot = ..Seconds($ZDateTimeH(tCutoff, 3, 1))
            Do $$$AssertTrue((tGot >= (tBefore - 86400 - 1)) && (tGot <= (tAfter - 86400 + 1)), "cutoff is 24 h before $ZTimeStamp under $ZTimeZone "_tZone_": "_tCutoff)
        }
        Catch ex {
            Do $$$AssertTrue(0, "UtcCutoff under $ZTimeZone "_tZone_" threw: "_ex.DisplayString())
        }
        Set $ZTimeZone = ..SavedZone
    }
}

/// Every Event Log type name maps to its stored number: the live
/// <class>Ens.DataType.LogType</class> lists are the oracle, and the piece count is pinned so a
/// type added by a later IRIS release fails here.
Method TestLogTypeValueMatchesLogType()
{
    Set tNames = $Parameter("Ens.DataType.LogType", "DISPLAYLIST")
    Set tValues = $Parameter("Ens.DataType.LogType", "VALUELIST")
    Do $$$AssertEquals($Length(tNames, ",") - 1, 6, "Ens.DataType.LogType has 6 display names")
    Do $$$AssertEquals($Length(tValues, ",") - 1, 6, "Ens.DataType.LogType has 6 values")
    For tIndex = 2:1:$Length(tNames, ",") {
        Set tName = $Piece(tNames, ",", tIndex)
        Set tGot = $ClassMethod("ExecuteMCPv2.REST.Interop", "LogTypeValue", tName)
        Do $$$AssertEquals(tGot, $Piece(tValues, ",", tIndex), tName_" maps to the VALUELIST piece")
        Do $$$AssertEquals(tGot, ##class(Ens.DataType.LogType).DisplayToLogical(tName), tName_" maps like DisplayToLogical")
    }
}

/// Anything that is not a display name comes back unchanged: a stored number (older requests),
/// the empty string, an unknown name and a lower-case name.
Method TestLogTypeValuePassesOtherValuesThrough()
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).LogTypeValue("2"), "2", "a stored number is unchanged")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).LogTypeValue(""), "", "the empty string is unchanged")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).LogTypeValue("Bogus"), "Bogus", "an unknown name is unchanged")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).LogTypeValue("error"), "error", "a lower-case name is unchanged")
}

}
