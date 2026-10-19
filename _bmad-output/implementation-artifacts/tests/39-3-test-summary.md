# Test Automation Summary - Story 39.3 (Message Body Content Search)

QA gap analysis of the diff `3977b72..e556857` against the spec's I/O & Edge-Case Matrix and ACs. Every matrix row and AC
already had a pinning test with a recorded mutation. The gaps closed here are the ones that suite was blind to.

## Generated / Modified Tests

### Vitest (`@iris-mcp/all`)
- [x] `packages/iris-mcp-all/src/__tests__/story-39-3-qa-process.test.ts` - 12 tests (new, AC-2, AC-5, default suite, armed by
  `IRIS_REQUIRE_LIVE`, listed in `scripts/prepublish-gate.mjs`): the BUILT interop server over stdio against a recording local
  listener (no IRIS). `block` (operator-wide, per profile, governance file) sends no ExecuteMCPv2 route request whatever else is
  wrong with the call, with one fixed refusal text, and `headers` on the same session does send (positive control). `redact` and
  `allow` send the filters byte for byte, and a reply padded with body content comes out as header rows only. The audit file and
  the DEBUG console log hold no body value and, under `redact`, `block` and for an unresolved profile, no filter value.
- [x] `packages/iris-mcp-all/src/__tests__/story-39-3-qa-live-gate.test.ts` - 31 tests (new, AC-1, AC-4, default suite, armed,
  listed in `gateTestFiles` and in the `story-39-1-gate-guards.test.ts` arming guard), live against the disposable
  `EXECMCPTMP393Q`: the value forms of `%Date`, `%Time`, `%TimeStamp`, text and `%Numeric` properties against a hand-written
  JOIN (each ISO form beside a control); `isNull`/`notNull` on three kinds of stream and the refusal of the other eight
  operators (the engine's own SQLCODE -313 shown for each); the statements the route really prepared, read back from
  `INFORMATION_SCHEMA.STATEMENTS`, select the twelve header columns only and read the headers first through `%INORDER`, the
  body by its ID.
- [x] `packages/iris-mcp-all/src/__tests__/header-row-oracle.ts` - `sqlLiteral` and `bodyJoinOracle` (the JOIN oracle) shared by
  the two body-search gates; `story-39-3-body-search-live-gate.test.ts` now uses them (92 passed, 1 skipped, as before).
- [x] `packages/iris-mcp-all/src/__tests__/story-39-1-gate-guards.test.ts` - the QA live gate is a third gate of the arming guard
  (unarmed skips, armed fails closed, source order): 4 cases added.
- [x] `packages/iris-mcp-all/scripts/prepublish-gate.mjs` - `gateTestFiles` entries for the two new files.

## Runs
- Armed (`IRIS_REQUIRE_LIVE=1`, six `IRIS_*` variables explicit): `@iris-mcp/all` 61 files, 941 passed, 3 skipped; the QA live
  gate 31 passed (7 s); the 39.3 gate 92 passed, 1 skipped; the process test 12 passed.
- eslint clean on every touched file; the files type-check under the base compiler options.
- Nothing left on the shared instance: no `EXECMCPTMP393*` namespace or database, no `Story393` or `ExecuteMCPv2.Temp.` document.

## Falsifiability
Nine mutations demonstrated red and reverted byte-identical (recorded under the spec's `## Verification`, "QA stage"). Two of
them (a body column in the select list, `%INORDER` removed) leave the other 122 body-search rows green; only the plan row sees them.

## Not tested (by decision)
- "Zero IRIS requests" under `block` is asserted for requests to ExecuteMCPv2 routes only. After startup the built server sends
  its own connection and bootstrap-version requests to `/api/atelier/` on its own schedule, so a count of every request is not
  stable.
- The plan lines are the wording of IRIS 2026.2 (Build 221U); another build that words them differently turns the plan row red
  and needs its two patterns re-captured.
