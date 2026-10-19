/// Edge tests (Story 40.0 QA) for the two helpers behind the interoperability Event Log surfaces,
/// beyond the pins of <class>ExecuteMCPv2.Tests.EventLogMetricsTest</class>:
/// <method>ExecuteMCPv2.REST.Monitor:UtcCutoff</method> at the boundaries of its day arithmetic and
/// <method>ExecuteMCPv2.REST.Interop:LogTypeValue</method> for values that are not an exact display name.
/// <p>Data-free: no Event Log or message rows are read or written, and no process state is changed.</p>
Class ExecuteMCPv2.Tests.EventLogMetricsEdgeTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// The cutoff borrows whole days and years correctly. Expected values were captured live
/// (IRIS 2026.2 build 221U), each checked by hand against the calendar: two days back from just
/// after midnight, a year rollover (horolog day 58074 is 2000-01-01), and a window that starts
/// across the leap day of 2024 (horolog day 66900 is 2024-03-01).
Method TestUtcCutoffBorrowsDaysAcrossYearsAndLeapDay()
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(172800, "67860,100"), "2026-10-15 00:01:40.000", "two days back from 00:01:40")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(86400, "58074,43200"), "1999-12-31 12:00:00.000", "24 h before noon on 2000-01-01 is in the previous year")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(86410, "66900,5"), "2024-02-28 23:59:55.000", "24 h 10 s before 2024-03-01 00:00:05 crosses the leap day")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(86400, "66900,0"), "2024-02-29 00:00:00.000", "24 h before the first midnight of March is the leap day")
}

/// An exact multiple of a day lands on midnight (it must not borrow a second day), one second
/// before midnight is one second before midnight, and a fraction that is longer than the
/// millisecond digits is cut, never rounded up into 24:00:00 or the next day.
Method TestUtcCutoffExactMultipleAndFractionCut()
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(86400, "67860,0"), "2026-10-16 00:00:00.000", "24 h before midnight is the previous midnight")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(1, "67860,0"), "2026-10-16 23:59:59.000", "one second before midnight")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(0, "67860,86399.9996"), "2026-10-17 23:59:59.999", "a fraction of .9996 is cut to .999")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Monitor).UtcCutoff(86400, "67860,86399.9996"), "2026-10-16 23:59:59.999", "the cut holds after the day is borrowed")
}

/// A value that is not exactly a display name passes through unchanged, so it matches no
/// Event Log type: padded, upper-case, a name inside a longer word, out-of-range numbers,
/// a list, and text with SQL punctuation. A numeric form such as <code>02</code> is also
/// unchanged here; IRIS SQL, not this method, compares it with the stored number.
Method TestLogTypeValueLeavesNearMissesUnchanged()
{
    Set tValues = $ListBuild(" Error", "Error ", " Error ", " ", "ERROR", "ASSERT", "ErrorX", "xError", "Error,Warning", "1,2", "7", "0", "-1", "99", "02", "2.0", "+2", "1e0", " 2", "2 ", "Error' OR '1'='1", "Error;DROP")
    Set tPointer = 0
    While $ListNext(tValues, tPointer, tValue) {
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).LogTypeValue(tValue), tValue, """"_tValue_""" is unchanged")
    }
}

}
