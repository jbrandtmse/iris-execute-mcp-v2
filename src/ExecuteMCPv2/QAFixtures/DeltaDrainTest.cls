/// Permanent QA fixture for Story 36.2 (<code>iris_test_status</code>, AC 36.2.2/36.2.4) —
/// the DELTA-drain completeness property AC 36.2.2 was amended for. Three FAST methods
/// finish (and are drained into <code>iris_execute_tests</code>' own <code>running</code>
/// response's <code>partial</code>) long before the SLOW one does, so the later
/// <code>iris_test_status</code> <code>completed</code> envelope is only correct if it is
/// built from <code>%UnitTest_Result</code> by exact <code>InstanceIndex</code> — a drain-only
/// completion would silently lose the three already-drained rows. The same run also gives
/// the default-suite live capstone (<code>test-status-epic-gate.test.ts</code>) a real
/// drain-path row for every value-identity field: a pass, an assert failure, and a thrown
/// exception (the method-level error the drain reports from
/// <code>TestMethod.ErrorDescription</code>).
/// <p>The two FAILURES ARE DELIBERATE — this class exists to produce them. Deliberately
/// placed OUTSIDE the <class>ExecuteMCPv2.Tests</class> package so a package-level run
/// targeting <code>ExecuteMCPv2.Tests</code> (the Rule #35 OS suite) never discovers or
/// executes it.</p>
/// <p>Not part of the bootstrap manifest (Rule #39 — test/fixture classes stay out of
/// <code>scripts/gen-bootstrap.mjs</code>); deployed manually via <code>iris_doc_load</code>
/// on any instance that runs the gate test for real.</p>
Class ExecuteMCPv2.QAFixtures.DeltaDrainTest Extends %UnitTest.TestCase
{

/// Fast pass — drained early.
Method Test1FastPass()
{
    Do $$$AssertTrue(1=1, "fast pass")
}

/// Fast DELIBERATE assert failure — drained early; its drain-path message is
/// <code>Action: Description</code> of the failed <code>TestAssert</code>.
Method Test2FastAssertFail()
{
    Do $$$AssertTrue(0, "deliberate assert failure (QA fixture)")
}

/// Fast DELIBERATE thrown exception — drained early; its drain-path message is the
/// method-level error (<code>TestMethod.ErrorAction</code>/<code>ErrorDescription</code>).
Method Test3FastThrows()
{
    Throw ##class(%Exception.General).%New("DeltaDrainFixture", 5001, , "deliberate throw (QA fixture)")
}

/// Slow pass — 6 seconds, so a caller-supplied <code>timeout</code> of a few seconds
/// observes <code>status: "running"</code> AFTER the three fast methods were drained.
Method Test9SlowPass()
{
    Hang 6
    Do $$$AssertTrue(1=1, "slow method completed")
}

}
