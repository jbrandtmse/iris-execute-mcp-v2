# Test Automation Summary - Story 40.3 (TestProduction Runs)

QA gap analysis against the I/O and Edge-Case Matrix and AC-1 to AC-10. The implement stage's 19-row live gate and its
recorded mutations were re-checked. One file was added where the brief's real-runtime cases had no row: the AD-15
shape of a run with no TestProduction test, the lifecycle lock never taken for it, inputs the first gate does not send,
package discovery edges, the coverage path at every level, and the bare namespace. No product source changed.

## Generated Tests

### Built dev, admin and interop servers over stdio, real SDK Client (AC-2 to AC-7; Rule 3)
- [x] `packages/iris-mcp-all/src/__tests__/story-40-3-qa-live-gate.test.ts` - 12 tests, about 55 s armed, in
  `EXECMCPTMP40W` (interop-mapped, with the one InstalledNamespace node) and the bare `EXECMCPTMP40X`.
  - Q1a: plain class, method and package runs complete with the structured content of the same calls with no
    production, whose key set is pinned (`details, failed, jobId, passed, runIndex, runIndexSource, skipped, status,
    total`), while `Story403.Other` runs; Other is untouched (status, start time, items, processes).
  - Q1b: with `^Ens.Runtime` held elsewhere a plain run and the raw route proceed at once; a TestProduction run is the
    `Unknown` refusal.
  - Q2: a method target with spaces around the colon, a method that does not exist and a namespace in lower case are
    `PRODUCTION_BUSY`, change nothing and add no row to any of the five `%UnitTest_Result` tables; a class name in
    another letter case is "No tests found", not a run.
  - Q3a: an abstract TestProduction base is not listed while its concrete subclass is; `Story403.Mix` is not
    `Story403.Mixed`. Q3b: a mixed package runs whole when nothing else runs.
  - Q4: a package whose tests declare two productions treats a running one of them as its own.
  - Q5a to Q5d: `iris_test_coverage` at class, method and package level equals the `iris_execute_tests` refusal,
    allocates no run id and no record, leaves the monitor idle; an unreadable state is the `Unknown` refusal; a plain
    run is not refused; a compiled class saved afterwards for another production is judged by its compiled class on
    this path (and by its definition on the Atelier path).
  - Q6a and Q6b: in the bare namespace plain runs complete through both tools, the route answers exactly proceed with
    no tests at every level, and a namespace that does not exist fails as before.

### Rosters
- `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles` and `story-39-1-gate-guards.test.ts` `GATES`
  list the new gate (its arming guard runs for it).

## Mutations (15, each red then reverted byte-identical)
- an extra `guard` key in the completed result -> Q1a red (the first gate's row 6 stayed green).
- the guard call made ineffective in `execute.ts` -> Q1b, Q2, Q3a, Q5a red.
- `error` dropped from the coverage refusal -> Q5b red only.
- the `production-busy` branch removed from `test-coverage.ts` -> Q5a, Q5b, Q5d red.
- the state read also with no TestProduction test -> Q1b, Q3a, Q6a red.
- the class segment not trimmed -> Q2 red.
- `Abstract = 0` dropped -> Q3a red.
- the package prefix without the dot -> Q3a red.
- the own-production loop stops at the first test -> Q4 red.
- coverage resolves by definition -> Q5d red.
- every test class counted as a TestProduction test -> Q1a, Q1b, Q5c, Q6a, Q6b red.
- the Stopped rule removed -> Q3b red.
- the teardown skips removing the bare namespace -> the gate's teardown red.
- the gate removed from `gateTestFiles` -> `live-gate-roster` red; from `GATES` -> the completeness check red.

## Observation
- A package run whose tests declare two productions treats a running one of them as its own (AC 40.3.2); the whole
  `Story403` package run with `Story403.Other` running proceeds and stops it. Spec-bound, pinned by Q4.
