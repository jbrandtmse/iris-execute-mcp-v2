# Test Automation Summary - Story 39.2 (PHI Data Policy)

QA gap analysis of the diff `37a1b7c..549bbad` against the spec's I/O & Edge-Case Matrix and ACs. Every matrix row and AC
already had a pinning test with a recorded mutation. The gaps closed here are the ones that suite was blind to.

## Generated / Modified Tests

### Vitest (`@iris-mcp/shared`)
- [x] `packages/shared/src/__tests__/hl7-keeplist-oracle.ts` - helper (new): the reviewed keep-list table typed out
  independently of the engine, and a builder that tags every field position and prescribes the output (AC-2).
- [x] `packages/shared/src/__tests__/hl7-redaction-keeplist.test.ts` - 143 tests (new, AC-2): the shipped keep-list equals
  the table; every reviewed segment, 17 unreviewed siblings and Z-segments (70 tagged fields each) in three separator sets;
  whole messages and batches; a seeded 300-message sweep; stray lines refused.

### Vitest (`@iris-mcp/all`)
- [x] `packages/iris-mcp-all/src/__tests__/story-39-2-qa-process.test.ts` - 17 tests (new, AC-1 to AC-5, default suite,
  armed by `IRIS_REQUIRE_LIVE`, listed in `scripts/prepublish-gate.mjs`): the BUILT interop server against a recording
  local listener (no IRIS): the request body per policy and per profile; hostile and version-skewed replies (the real
  captured legacy reply included) never reaching the result, the audit file or stderr; the four channels in order, one layer
  at a time with a different value on each, mixed letter case, a Server Manager profile. `redactHl7` of the BUILT shared
  dist in a fresh Node process, resolved as a consumer resolves it, against the reviewed table.
- [x] `packages/iris-mcp-all/src/__tests__/story-39-2-data-policy-live-gate.test.ts` - 2 rows added (AC-2, AC-3), armed
  against `default` / the disposable `EXECMCPTMP392A`: IRIS's own stored text for headers 1, 2 and 8 through the built engine
  with IRIS's parser as the oracle; a header that is not found under `redact` and `block`.
- [x] `packages/iris-mcp-all/scripts/prepublish-gate.mjs` - `gateTestFiles` entry for the new process test.

## Runs
- `@iris-mcp/shared` 80 files / 2045 tests; `@iris-mcp/all` 57 files / 765 tests + 2 skipped capture rows; lint and
  type-check for shared clean (one pre-existing warning).
- Armed (`IRIS_REQUIRE_LIVE=1`, six `IRIS_*` variables explicit): the process test and `live-gate-roster.test.ts` 22
  passed; the live gate 16 passed, 1 skipped (the capture row).
- Nothing left on the shared instance: no `EXECMCPTMP392*` namespace, no `Story39*` or `ExecuteMCPv2.Temp.` document.

## Falsifiability
Nine mutations demonstrated red and reverted (recorded under the spec's `## Verification`, "QA stage"). Two keep-list
drifts (`NK1-8`, `OBX-7`) leave the implement stage's 140 engine tests green; the stderr sweep and the precedence swap were
likewise invisible before.

## Not tested (by decision)
- A continuation line of exactly three characters that fit a segment name (`LEE`, `JRS`, `A12`), from a raw line feed in a
  free-text field, is emitted unredacted by `redactHl7`. Reported to the lead; no test pins the leak as expected.
