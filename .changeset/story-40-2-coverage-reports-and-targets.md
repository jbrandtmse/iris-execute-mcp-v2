---
"@iris-mcp/dev": minor
"@iris-mcp/shared": patch
---

feat(dev): coverage over the class source, `minCoverage` and a Cobertura export (Epic 40, Story 40.2)

`iris_test_coverage` and the coverage side of `iris_test_status` now report coverage per class and per method over the lines of the class document you edit (`coverage.classes[].source`, `coverage.source`), with the uncovered line ranges and a count of the lines the compiler generated, which are never reported as source lines. Class line numbers are those of the document `iris_doc_get` returns for the class, which IRIS stores in its own layout. `iris_test_coverage` takes an optional `minCoverage` (0 to 100): a completed result then carries `coverage.verdict`, compared unrounded, and a failing verdict is still `isError: false`. `iris_test_status` reproduces the summary and the verdict from the `coverageRunId` alone.

`iris_test_status` gains `action: "export"`, which writes a completed coverage run's Cobertura XML to an absolute `outputPath` (the path guard of `iris_doc_export`, ending `.xml`), with an optional `sourceRoot`. It is a governed write and **DEFAULT-DISABLED**: enable it with `IRIS_GOVERNANCE={"global":{"iris_test_status:export":true}}`. `iris_test_coverage` itself writes no file. No tool is added and no tool count moves.

A coverage run whose Line-by-Line session did not load every listed routine (a routine deleted after the run resolved its list) now ends `failed` before any test runs, naming the routines; the test process stops its own session at once.

`@iris-mcp/shared` embeds the changed IRIS classes (`ExecuteMCPv2.Coverage.Job`, `ExecuteMCPv2.Coverage.Runner`, `ExecuteMCPv2.REST.Coverage`), so `BOOTSTRAP_VERSION` moves from `14a4cba6504a` to `3a3b4cf76502`. The Status and Start routes stay additive: every 40.1 request is accepted unchanged.
