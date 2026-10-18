---
"@iris-mcp/dev": minor
"@iris-mcp/shared": patch
---

feat(dev): `iris_test_coverage`, line coverage of a unit-test run (Epic 40, Story 40.1)

`@iris-mcp/dev` gains `iris_test_coverage`: it runs the tests of a `target` while an IRIS Line-by-Line session measures the INT routines of 1 to 50 listed `classes`, and returns the test summary plus, per routine, the executable lines, covered lines, percent and line ranges, and the classes it could not measure. It is a governed write and **DEFAULT-DISABLED**: enable it with `IRIS_GOVERNANCE={"global":{"iris_test_coverage":true}}`. It is hidden under the `core` visibility preset and shown under `developer`, and it forms a co-visible pair with `iris_test_status`.

Only the process that runs the tests is measured (and the suite's own supervisor process, which runs only the suite's own `ExecuteMCPv2` classes). The line numbers are INT line numbers: INT line n is line n+1 of the document `iris_doc_get` returns for `<routine>.int`, whose line 1 is the `ROUTINE` header. The Line-by-Line monitor is one per instance, so while any Line-by-Line or PERFMON session is running the tool is refused with the new refusal code `MONITOR_BUSY` and nothing is started; a session the suite did not start is never touched. A run is owned by two IRIS-side jobs, so a cancel, the time limit or a killed test process releases the monitor. `iris_test_status` gains an optional `coverageRunId` (poll or cancel a coverage run by its handle); its keys and every existing call are unchanged, and its `cancel` stays its own DEFAULT-DISABLED key, `iris_test_status:cancel`.

`@iris-mcp/shared` embeds three new IRIS classes (`ExecuteMCPv2.Coverage.Job`, `ExecuteMCPv2.Coverage.Runner`, `ExecuteMCPv2.REST.Coverage`) and three additive routes, so `BOOTSTRAP_VERSION` moves from `08b8adeaadc6` to `4dd596fa2a0c`, and it adds `REFUSAL_CODES.MONITOR_BUSY` and the `iris_test_coverage` / `iris_test_status` entry of `TOOL_PAIRS`.
