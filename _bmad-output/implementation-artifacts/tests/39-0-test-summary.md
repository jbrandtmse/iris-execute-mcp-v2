# Test Automation Summary - Story 39.0 (Epic 38 deferred cleanup)

QA gap analysis against the I/O matrix and AC-1 to AC-9. The implement stage pinned every AC in-process and
recorded a mutation for each. This pass added the real-runtime tier the story's user-facing surfaces lacked: the
built `iris-mcp-governance` bin over the whole suite, the built dev and interop servers with several dead keys,
and the DW-567 examples against the live Atelier route. Nothing was written to IRIS.

## Generated Tests

### Process tests (built dists, `@iris-mcp/all`)
- [x] `packages/iris-mcp-all/src/__tests__/story-39-0-qa-governance-check-process.test.ts` - 9 rows. `check` spawned
  from a non-repository directory with a scrubbed environment: keys of all five servers and the framework tool exit 0;
  a key no tool has exits 1 with form (d) alone, empty stdout, file untouched; `IRIS_GOVERNANCE` is its own channel.
- [x] `packages/iris-mcp-all/src/__tests__/story-38-7-qa-governance-process.test.ts` - extended in place, +5 rows (44):
  five dead keys across `global` and `profile "default"` log exactly five WARN lines in order on both channels; a
  hidden tool still warns; both channels at once; the built interop server warns for a mistyped action and is silent
  for another server's key and a suite-unknown key.

### Live gate (read-only, `@iris-mcp/dev`)
- [x] `packages/iris-dev-mcp/src/__tests__/doc-type-description-live-gate.test.ts` - 6 rows, listed in
  `scripts/prepublish-gate.mjs`. Every example read out of `DOC_TYPE_DESCRIPTION` answers HTTP 200 on the wire;
  `iris_doc_list` and `iris_package_list` send the same request; the old `CLS/cls` and `RTN/cls` pairings answer 400.

## Coverage
- DW-565 startup WARN: built dev server, 6 forms/positions; built interop server, 1.
- DW-565 `check`: in-process (implement) + built bin over five dists (QA) for exit 0, 1, `--json`, both channels.
- DW-567: unit pin of the text (implement) + live wire status of every example (QA).
- Mutations demonstrated by QA: 6 (see the spec's `## Verification`).

## Next Steps
- Run the live gate armed from the dev package's `prepublishOnly` (`scripts/prepublish-gate.mjs`).
- Observation for the lead: the shared HTTP client turns an HTTP 400 with an empty error list into an empty success,
  so the old `'cls' for CLS` example returned `{ items: [] }` through the tools, not an error.
