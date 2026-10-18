# Test Automation Summary - Story 40.1 (Line Coverage Probe and Engine)

QA gap analysis against the I/O and Edge-Case Matrix and AC-1 to AC-9. The implement stage's 21-row live gate and
its recorded mutations were re-checked. One file was added where the brief's real-runtime cases had no row: several
BUILT dev server processes alive at once, the documented governance recipe alone, the preset listings, the input
edges as the built server words them, and a second namespace. No product source changed.

## Generated Tests

### Built dev server over stdio, real SDK Client (AC-1, AC-4, AC-5, AC-6; Rule 3)
- [x] `packages/iris-mcp-all/src/__tests__/story-40-1-qa-live-gate.test.ts` - 12 tests, about 28 s armed.
  - Visibility and default governance: the default (`full`) preset lists `iris_test_coverage` with the spec's
    annotations and refuses the call as `GOVERNANCE_DISABLED`; `core` hides it even when the recipe enables it
    (`Tool iris_test_coverage not found`); `developer` lists it and still refuses it. Nothing is started.
  - The recipe `IRIS_GOVERNANCE={"global":{"iris_test_coverage":true}}` alone runs the oracle: 20 of 28 executable
    lines (71.43%), checked against the INT source read through the raw Atelier route; a second server process on
    default governance polls the handle and reproduces the result deep-equal; the recipe does not enable
    `iris_test_status:cancel`.
  - AD-16: the starting server process is closed mid-run, a fresh process re-attaches by the handle alone and the
    run completes with its own coverage, released by its runner.
  - `MONITOR_BUSY` from another process for any arguments and any namespace; a refused cancel does not signal the
    run; the running run completes with its own counts.
  - Input edges: every schema rule of `classes`, `level`, `timeout` and `target` as the server words it; 0 and 51
    classes, wildcards, a comma list; the 50-name boundary; an absent class, a wrong-case class, a class with no
    routine, another namespace's class, an empty target, a missing namespace; de-duplication and order;
    `level:"method"` with an existing and an absent method; a second namespace (`EXECMCPTMP40T`) whose result
    differs from the first's (100%, derived by hand from its INT source).
  - Companion edges against a real record: `coverageRunId` with `jobId` or `runIndex`, an unknown id, a malformed
    id, a namespace other than the record's (the error names both).

### Rosters
- `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles` and `story-39-1-gate-guards.test.ts` `GATES`
  list the new gate (its arming guard, freshness-order and deployed-version checks run for it).

## Mutations (9, each red then reverted byte-identical)
- `core` roster includes the tool -> the core row red.
- `mutates` write -> read -> the default-governance row red (a real run started and finished).
- completed summary read in another namespace -> the oracle row and the re-attach row red.
- `else` counted as executable -> the oracle row and the de-duplication row red (29 lines).
- busy refusal without `namespace` -> the busy row red.
- class pattern accepts `*` -> the schema row red.
- zero-result rule disabled -> the absent-method row red.
- namespace mismatch never reported -> the companion row red.
- wait budget times 100 -> the re-attach row and the busy row red (the run completed instead of `running`).

## Coverage
- Rows now pinned on the built server by a test that drives the real surface: matrix rows 1, 2, 4, 5, 6, 11, 14
  and 16 from a second angle (another process, the recipe alone, the presets), plus the `level` method edge.
- Not re-covered here (the 21-row gate already drives them): rows 3, 7 to 10, 13, `MayTerminate`, decision #48,
  retention, `clear-busy-foreign`, `clear-and-proceed`.
- Monitor idle, `("session")` unset, `EXECMCPTMP40S` and `EXECMCPTMP40T` removed, no `Story401` or
  `ExecuteMCPv2.Temp.` document in HSCUSTOM after every armed run.

## Next Steps
- Finding for the lead (not fixed here): the tool's INT line n is line n + 1 of the document `iris_doc_get` and
  `iris_routine_intermediate` return, because document line 1 is the `ROUTINE ... [Type=INT,Generated]` header.
  The description and README say "read it with iris_doc_get" with no offset. The gate pins the offset.
- Observation: the `iris_test_coverage` description says the companion's "cancel" action stops the run but not that
  it is default-disabled (its own key `iris_test_status:cancel`); an operator who follows only the tool's recipe
  cannot cancel through the companion. The companion's description does say so.
