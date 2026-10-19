# Test Automation Summary - Story 38.7 (Epic 38 Burn-Down)

QA gap analysis of the diff `fe58430..4520fd7` against the spec's I/O & Edge-Case Matrix and ACs. The implement stage
had pinning tests with recorded mutations for every AC. The gaps closed here are the rows whose proof sat on a fake, a
single happy path, or a process that could not tell "rejected before IRIS" from "rejected after".

## Generated / Modified Tests

### Vitest (`@iris-mcp/all`)
- [x] `packages/iris-mcp-all/src/__tests__/story-38-7-qa-governance-process.test.ts` - 30 tests (new, AC-1, no IRIS):
  the BUILT dev server against a local listener that records every request. Seven governance-shaped keys (flat tool
  key with a boolean, string or number; upper case; top-level profile; object-valued `globals`; plain boolean) in
  `IRIS_GOVERNANCE` and in `IRIS_GOVERNANCE_FILE` exit 1 with the matrix text, never echo a value, and the listener sees
  zero requests; five valid documents (empty, `global`, `profiles`, both, both beside `comment`/`version`/`$schema`)
  start and reach the listener; the reported policy and attribution of a document with scalar metadata equal those of
  the same layers alone; an unknown `profiles` name starts the server with the policy of no governance and logs one
  WARN (env, file with path, two configured profiles, two typos).
- [x] `packages/iris-mcp-all/src/__tests__/story-38-7-qa-wire-gate.test.ts` - 10 tests (new, live, AC-2, AC-5, AC-6,
  AC-7): SDK client over stdio to the BUILT interop and dev dists against HSCUSTOM. A compiled non-production class is
  refused with the matrix text and stays stored; an uncompiled class whose Super is `Ens.Production` is deleted; a
  missing name keeps "does not exist"; the three `modifiedSince` descriptions and refusals; an empty `modifiedSince`;
  the no-range `iris_doc_get` soft error; `ignoreConflict: false` through the MCP argument parsing.
- [x] `process-gate-helpers.ts` gains an optional `onStderr`; `epic38-gate-guards.test.ts` enrols the wire gate in
  `GATES_WITH_VERSION_CHECK` (11 tests, was 10); both gates are in `packages/iris-mcp-all/scripts/prepublish-gate.mjs`.

### Vitest (`@iris-mcp/dev`)
- [x] `packages/iris-dev-mcp/src/__tests__/story-38-7-qa-live-gate.test.ts` - 8 tests (new, live, AC-6, AC-7, AC-8):
  `modifiedSince` refused with the global `fetch` never called (list, export with an empty destination, package list)
  and the empty value listing through `/docnames/` only; `iris_doc_load` `ignoreConflict: false` with a change between
  the two PUTs (IRIS's own 409 becomes a per-file `DOCUMENT_CONFLICT`, five PUTs across a conflicting, an existing and a
  new file) and the default path as one `?ignoreConflict=1` PUT; `iris_env_promote` execute with a control that
  completes and a target PUT IRIS itself refuses with `ERROR #16021` in a 200 envelope (failed, rest skipped, no compile,
  nothing stored). Listed in `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`.

## Runs
- `@iris-mcp/all`, armed and serial: 45 files / 495 tests in 54 s (baseline before this stage 43 files / 453).
- Six dev live gates armed and serial: 249 tests (sql-safety 90, storage-guard 114, edit 9, QA 8, range 21, bom 7).
- `InteropHostGuardTest` 11 of 11 and `InteropProductionDeleteTest` 7 of 7; launcher four files 133; dev lint and
  type-check clean; the new `@iris-mcp/all` files type-check under `tsc --strict`.
- Leftover scans after the last run: no `Story38*` / `ExecuteMCPv2.Temp` document (generated included), 0 rows in
  `Ens_Config.Production` under `ExecuteMCPv2.Temp.`, no OS temp directory.

## Falsifiability
Nine mutations demonstrated red and reverted byte-identical (recorded under the spec's `## Verification`, QA record).

## Not tested (by decision)
- A refusal for a Running production through the delete route (decision #17 forbids starting a production).
- The DW-549 conflict and DW-530 soft status through an MCP session (needs `iris_env_promote:execute` enabled and two
  profiles); both are live at handler level with the real client and routes.
- `iris_doc_export` and `iris_package_list` with an empty `modifiedSince` against the live instance: both enumerate the
  whole namespace's docnames; the unit tests pin the unchanged request.
