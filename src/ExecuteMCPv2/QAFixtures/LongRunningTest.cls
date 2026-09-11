/// Permanent QA fixture for Story 36.1 QA (`iris_execute_tests` running-result
/// contract, AC 36.1.3/36.1.5/36.1.8). A genuine, deliberately slow
/// <class>%UnitTest.TestCase</class> used by the default-suite real-runtime gate
/// (<code>execute-tests-running-contract-epic-gate.test.ts</code>) to prove the
/// "running" branch end-to-end against a real, long-running ObjectScript test.
/// <p>Deliberately placed OUTSIDE the <class>ExecuteMCPv2.Tests</class> package
/// so a package-level run targeting <code>ExecuteMCPv2.Tests</code> (the Rule #35
/// 412-<code>Test*</code>-method OS suite) never discovers or executes this
/// class — a slow <code>Hang</code> inside that suite would skew both its
/// count and its wall-clock runtime.</p>
/// <p>Not part of the bootstrap manifest (Rule #39 — test/fixture classes stay
/// out of <code>scripts/gen-bootstrap.mjs</code>); deployed manually via
/// <code>iris_doc_load</code> on any instance that runs the gate test for real.</p>
Class ExecuteMCPv2.QAFixtures.LongRunningTest Extends %UnitTest.TestCase
{

/// Deliberately slow — 10 seconds (Story 36.1 code review: cut from 30, which
/// cost every live dev-suite run 30+ seconds) — so a caller-supplied
/// `timeout` of a few seconds reliably observes `status: "running"` before this
/// method (and the class-level run around it) completes. The running branch
/// needs only `timeout` &lt; this hang.
Method TestSlowMethod()
{
    Hang 10
    Do $$$AssertTrue(1=1, "slow method completed")
}

}
