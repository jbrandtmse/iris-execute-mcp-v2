/// Unit tests for the release proofs and the release locks of <class>ExecuteMCPv2.Coverage.Job</class> (Story 40.1).
/// <p>No test here starts a Line-by-Line session or terminates a process. The proofs are pure functions of the state
/// they are given. The lock tests hold the fake run's release lock, or the monitor's own lock, for at most 2.5 seconds,
/// below the 3 seconds other projects' Line-by-Line calls wait for the monitor's lock: from a helper job that lets go by
/// itself after 2.5 seconds, or in the test process while a probe job (1 second to start, 1.5 seconds to answer)
/// checks it. Every test lets go of what it took, and the test process lets go of both locks after each test.</p>
Class ExecuteMCPv2.Tests.CoverageReleaseTest Extends %UnitTest.TestCase
{

/// The id of the fake run whose release lock the lock tests use.
Parameter FAKERUN = 990000002;

Method OnAfterOneTest(testname As %String) As %Status
{
    Do ##class(ExecuteMCPv2.Coverage.Job).DropReleaseLocks(..#FAKERUN)
    Kill ^IRIS.TempExecuteMCPv2Coverage("fakeRelease")
    Quit $$$OK
}

/// ProofFailure(pids, self, supervisor, runner, routineList, activeRoutines): empty when the active session proves to be
/// the run's, otherwise the reason. The supervisor is 100 and the runner 200.
Method TestProofFailureNamesWhatDoesNotProveASession() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tRun = $ListBuild("Pkg.Fixture.1")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "100 200", 100, 100, 200, tRun, tRun), "", "the supervisor: both processes alive and listed")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "200", 200, 100, 200, tRun, tRun), "", "the runner: the supervisor has ended and left the list")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "100", 100, 100, 200, tRun, tRun), "", "the supervisor: the runner has ended and left the list")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "200 100", 200, 100, 200, tRun, tRun), "", "the order of the list does not matter")
    Do $$$AssertEquals($ClassMethod(tJob, "ProofFailure", "100 200", 100, 100, 200, $ListBuild("A", "B"), $ListBuild("B", "A")), "", "nor does the order of the routines")

    Set tWhy = $ClassMethod(tJob, "ProofFailure", "", 100, 100, 200, tRun, tRun)
    Do $$$AssertTrue(tWhy [ "not scoped to listed processes", "an empty list is a session of all processes or a paused one: "_tWhy)
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "0", 100, 100, 200, tRun, tRun)
    Do $$$AssertTrue(tWhy [ "does not list this process", "a list with no live process does not list this one: "_tWhy)
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "100", 200, 100, 200, tRun, tRun)
    Do $$$AssertTrue(tWhy [ "does not list this process", "a list that names only the other process: "_tWhy)
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "100 200", "", 100, 200, tRun, tRun)
    Do $$$AssertTrue(tWhy [ "does not list this process", "no process id for this process: "_tWhy)
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "200 300", 200, 100, 200, tRun, tRun)
    Do $$$AssertTrue(tWhy [ "neither this run's test process nor its supervisor", "a list with a foreign process: "_tWhy)
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "200 200", 200, 100, 200, tRun, tRun)
    Do $$$AssertTrue(tWhy [ "neither this run's test process nor its supervisor", "the same process twice: "_tWhy)
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "100 200", 100, 100, 200, tRun, $ListBuild(""))
    Do $$$AssertTrue(tWhy [ "could not read the routine names", "a name this process cannot read: "_tWhy)
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "100 200", 100, 100, 200, tRun, "")
    Do $$$AssertTrue(tWhy [ "could not read the routine names", "no routine at all: "_tWhy)
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "100 200", 100, 100, 200, tRun, $ListBuild("Other.1"))
    Do $$$AssertTrue(tWhy [ "not this run's routine list", "another routine: "_tWhy)
    Set tWhy = $ClassMethod(tJob, "ProofFailure", "100 200", 100, 100, 200, tRun, tRun_$ListBuild("Other.1"))
    Do $$$AssertTrue(tWhy [ "not this run's routine list", "one routine more: "_tWhy)
    Quit $$$OK
}

/// NodeMatches(node, pids, routineCount) is the reclaim proof of a request process outside the session; NodeDisproved
/// adds that the process list is a scoped session's own, so a session with no list of its own never disproves a node.
Method TestNodeMatchesAndNodeDisproved() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tNode = $ListBuild(7, 100, 200, "2026-10-18T00:00:00.000Z", $ListBuild("Pkg.Fixture.1"))
    Do $$$AssertEquals($ClassMethod(tJob, "NodeMatches", tNode, "0", 1), 1, "both processes ended, the same routine count")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeMatches", tNode, "100 200", 1), 1, "both processes alive")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeMatches", tNode, "300", 1), 0, "a foreign process")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeMatches", tNode, "0", 2), 0, "another routine count")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeMatches", tNode, "", 1), 0, "no process list")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeMatches", "", "0", 1), 0, "no node")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeDisproved", tNode, "", 1), 0, "a session with no list of its own disproves nothing: the node is kept")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeDisproved", tNode, "300", 1), 1, "a scoped session of a foreign process disproves it")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeDisproved", tNode, "0", 2), 1, "a scoped session with another routine count disproves it")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeDisproved", tNode, "0", 1), 0, "a scoped session that matches does not")
    Do $$$AssertEquals($ClassMethod(tJob, "NodeDisproved", "", "300", 1), 0, "no node, nothing to disprove")
    Quit $$$OK
}

Method TestAllNamed() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Do $$$AssertEquals($ClassMethod(tJob, "AllNamed", $ListBuild("A.1", "B.1")), 1, "every name is readable")
    Do $$$AssertEquals($ClassMethod(tJob, "AllNamed", $ListBuild("A.1", "")), 0, "one name is not")
    Do $$$AssertEquals($ClassMethod(tJob, "AllNamed", ""), 0, "no routine at all")
    Quit $$$OK
}

/// A job: hold the lock <var>pWhich</var> (<code>release</code>, the fake run's release lock, or <code>monitor</code>,
/// <code>^%SYS("MON-HOLD")</code>, which other projects' Line-by-Line calls wait 3 seconds for) until the stop flag
/// is set, for 2.5 seconds at most.
ClassMethod HoldLock(pWhich As %String)
{
    If pWhich = "release" {
        Lock +^IRIS.TempExecuteMCPv2Coverage("owner", ..#FAKERUN, "release"):5
    } Else {
        Lock +^%SYS("MON-HOLD"):5
    }
    If '$Test Quit
    Set ^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "held") = 1
    For tI = 1:1:25 {
        If $Get(^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "stop")) Quit
        Hang 0.1
    }
    If pWhich = "release" {
        Lock -^IRIS.TempExecuteMCPv2Coverage("owner", ..#FAKERUN, "release")
    } Else {
        Lock -^%SYS("MON-HOLD")
    }
}

/// A job: record whether this process can take, with timeout 0, the fake run's release lock and the monitor's lock.
ClassMethod TryLocks()
{
    Set tRelease = 0
    Set tMonitor = 0
    Lock +^IRIS.TempExecuteMCPv2Coverage("owner", ..#FAKERUN, "release"):0
    If $Test {
        Set tRelease = 1
        Lock -^IRIS.TempExecuteMCPv2Coverage("owner", ..#FAKERUN, "release")
    }
    Lock +^%SYS("MON-HOLD"):0
    If $Test {
        Set tMonitor = 1
        Lock -^%SYS("MON-HOLD")
    }
    Set ^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "try") = tRelease_","_tMonitor
}

/// What another process can take now: <code>release,monitor</code>, each 1 when it can take that lock and 0 when not.
/// It takes 2.5 seconds at most, because the test process may hold the monitor's lock meanwhile.
Method OtherProcessCanTake() As %String
{
    Kill ^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "try")
    Job ##class(ExecuteMCPv2.Tests.CoverageReleaseTest).TryLocks()::1
    If '$Test Quit "the probe job did not start"
    For tI = 1:1:15 {
        If $Data(^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "try")) Quit
        Hang 0.1
    }
    Quit $Get(^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "try"), "the probe job did not answer")
}

/// Start a job that holds the lock <var>pWhich</var>, and wait until it does. Returns whether it holds it.
Method StartHolder(pWhich As %String) As %Boolean
{
    Kill ^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "held"), ^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "stop")
    Job ##class(ExecuteMCPv2.Tests.CoverageReleaseTest).HoldLock(pWhich)::10
    If '$Test Quit 0
    For tI = 1:1:60 {
        If $Get(^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "held")) Quit
        Hang 0.1
    }
    Quit +$Get(^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "held"))
}

/// Ask the holder to let go of the lock <var>pWhich</var>, and wait until the lock is free.
Method StopHolder(pWhich As %String)
{
    Set ^IRIS.TempExecuteMCPv2Coverage("fakeRelease", "stop") = 1
    For tI = 1:1:60 {
        If pWhich = "release" {
            Lock +^IRIS.TempExecuteMCPv2Coverage("owner", ..#FAKERUN, "release"):0
        } Else {
            Lock +^%SYS("MON-HOLD"):0
        }
        If $Test {
            If pWhich = "release" {
                Lock -^IRIS.TempExecuteMCPv2Coverage("owner", ..#FAKERUN, "release")
            } Else {
                Lock -^%SYS("MON-HOLD")
            }
            Quit
        }
        Hang 0.1
    }
}

/// TakeReleaseLocks holds the run's release lock and the monitor's own lock until DropReleaseLocks lets go of them.
Method TestTakeReleaseLocksHoldsBothLocksUntilDropped() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tTaken = $ClassMethod(tJob, "TakeReleaseLocks", ..#FAKERUN, .tWhy, 5, 5)
    Set tDuring = ..OtherProcessCanTake()
    Do $ClassMethod(tJob, "DropReleaseLocks", ..#FAKERUN)
    Set tAfter = ..OtherProcessCanTake()
    Do $$$AssertEquals(tTaken, 1, "both locks are free, so both are taken")
    Do $$$AssertEquals(tWhy, "", "with nothing to report")
    Do $$$AssertEquals(tDuring, "0,0", "while held, another process can take neither the release lock nor the monitor's lock")
    Do $$$AssertEquals(tAfter, "1,1", "after the drop it can take both")
    Quit $$$OK
}

/// A release lock that another releaser holds times out: nothing is held, and the reason names the release lock.
Method TestTakeReleaseLocksHoldsNothingWhenTheReleaseLockTimesOut() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tHeld = ..StartHolder("release")
    Do $$$AssertTrue(tHeld, "another process holds the release lock")
    If tHeld {
        Set tTaken = $ClassMethod(tJob, "TakeReleaseLocks", ..#FAKERUN, .tWhy, 1, 5)
        If tTaken Do $ClassMethod(tJob, "DropReleaseLocks", ..#FAKERUN)
        Set tProbe = ..OtherProcessCanTake()
        Do $$$AssertEquals(tTaken, 0, "the release lock times out, so nothing is taken")
        Do $$$AssertTrue(tWhy [ "release lock", "and the reason names the release lock: "_tWhy)
        Do $$$AssertEquals($Piece(tProbe, ",", 2), 1, "the monitor's lock was not left held")
    }
    Do ..StopHolder("release")
    Quit $$$OK
}

/// A monitor lock that another process holds times out: the release lock taken first is let go again, so the other
/// releaser is not starved, and the reason names the monitor's lock.
Method TestTakeReleaseLocksLetsGoOfTheReleaseLockWhenTheMonitorLockTimesOut() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Set tHeld = ..StartHolder("monitor")
    Do $$$AssertTrue(tHeld, "another process holds the monitor's lock")
    If tHeld {
        Set tTaken = $ClassMethod(tJob, "TakeReleaseLocks", ..#FAKERUN, .tWhy, 5, 1)
        If tTaken Do $ClassMethod(tJob, "DropReleaseLocks", ..#FAKERUN)
        Set tProbe = ..OtherProcessCanTake()
        Do $$$AssertEquals(tTaken, 0, "the monitor's lock times out, so nothing is taken")
        Do $$$AssertTrue(tWhy [ "monitor's own lock", "and the reason names the monitor's lock: "_tWhy)
        Do $$$AssertEquals($Piece(tProbe, ",", 1), 1, "the release lock was let go again")
    }
    Do ..StopHolder("monitor")
    Quit $$$OK
}

}
