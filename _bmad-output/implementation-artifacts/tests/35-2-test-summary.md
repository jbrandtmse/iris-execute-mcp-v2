# Test Automation Summary — Story 35.2 (`iris_analytics_cubes:build` Device-Output Isolation)

**Date:** 2026-08-17
**Scope:** `src/ExecuteMCPv2/REST/Analytics.cls`'s `CubeAction` `"build"` branch (null-device
redirect fix, ledger `35-SWEEP-2`, HIGH), and the dev-authored regression gate
`packages/iris-data-mcp/src/__tests__/analytics-cubes-wire-gate.test.ts`. Framework: vitest
(TypeScript), raw `fetch` against the deployed `/api/executemcp/v2/analytics/cubes` route —
the project's existing pattern for wire-level device-output gates (mirrors
`packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts`).

## Baseline (dev stage, independently re-verified this pass)

Dev delivered one new test file, `analytics-cubes-wire-gate.test.ts` (1 test): issues a raw
`fetch` for `build` against a nonexistent cube, reads `response.arrayBuffer()` directly (never
`response.json()`, never the MCP tool handler), and asserts the first byte is `{` and the body
`JSON.parse`s. Ran live during this QA pass (not skipped — IRIS reachable, `ExecuteMCPv2`
deployed): **passed**.

Independently re-proved the Rule #59/#48 mutation cycle myself, on the raw wire, for **both**
paths (not just re-running the existing test):

- **ERROR path** — reverted `Analytics.cls` to pre-fix (`git show HEAD:...`), redeployed via
  `iris_doc_load`, curled the raw bytes: RED — `\r\nERROR #20013: Cube '...' does not exist{"status":...}`,
  fails `JSON.parse`. Restored the fix, redeployed, re-curled: GREEN — `{"status":...}`, parses.
- **SUCCESS path** — stood up my own disposable cube (`ExecuteMCPv2.Temp.QAStory352Person` +
  `QAStory352PersonCube`, 2 source rows), separate from the dev's own already-deleted disposable
  cube, to get independent evidence rather than trusting the dev's transcript alone. Built it
  against the fixed code: GREEN — `{"status":{"errors":[],"summary":""},...,"result":{"cube":
  "QAStory352PersonCube","action":"build","status":"completed"}}`, `%GetCubeFactCount` returned
  `2` (genuine build, not a no-op). Reverted `Analytics.cls` to pre-fix and re-built the SAME
  cube: RED — raw progress narration with literal ANSI escape sequences
  (`\r\nBuilding cube [QASTORY352PERSONCUBE]\r\nDeleting existing cube...\r\x1b[0J...`), fails
  `JSON.parse`. Restored the fix, confirmed GREEN again, then deleted both disposable classes and
  confirmed zero leftover rows in `%Dictionary.CompiledClass` (`LIKE '%Story352%'` and
  `LIKE 'ExecuteMCPv2.Temp.%'`) and zero cubes in `%DeepSee.Utils:%GetCubeList`, across
  `HSCUSTOM`/`SADEMO`/`SATEST64`. Both my QA-created classes and the dev's own disposable classes
  from the dev stage are confirmed absent.

This independently corroborates the dev's own reported mutation evidence for both paths, using a
separate cube instance than the dev used, closing the "trust but verify" gap for AC 35.2.6.

## Gap analysis — no new tests added this pass

Checked `analytics.test.ts`'s existing `iris_analytics_cubes` coverage (26 tests) for overlap
with the new wire-gate test before deciding whether a gap exists:

- `analytics.test.ts`'s `"should build a cube via POST"` and `"should sync a cube via POST"`
  mock `mockHttp.post` to resolve directly with an already-parsed JS object
  (`mockHttp.post.mockResolvedValue(envelope(buildResult))`). This exercises tool-handler
  argument/response-mapping logic ABOVE the JSON-parsing boundary — it structurally CANNOT see a
  device-output-corrupted wire body, since the mock never touches raw bytes. This is exactly the
  class of test Rule #59 warns is not a substitute for a raw-wire assertion; it is complementary
  coverage (handler contract), not redundant with, nor a replacement for, the wire-gate test.
- No other `analytics.test.ts` case duplicates the wire-gate test's raw-byte assertion.

**Conclusion: no test-design gap against Story 35.2's ACs.** The existing wire-gate test (error
path, fixture-free, always-discoverable) plus the mocked-transport tests (handler contract) plus
this pass's manual mutation-verification of the SUCCESS path (documented above, not persisted as
a permanent test — matches the dev's own documented trade-off: a real DeepSee cube build/teardown
on every default-suite run is a materially heavier dependency than the fixture-free error path,
and the error path already exercises the SAME unconditional redirect-wrap `CubeAction`'s `"build"`
branch runs for both outcomes, before success/error is known) together give proportionate,
non-redundant coverage. No additional test file was generated this pass.

## Result

**0 new tests added** (dev's 1 remains the total in `analytics-cubes-wire-gate.test.ts`).
Full `packages/iris-data-mcp` standalone run: **133/133 passed** (8 files, including the new
wire-gate test running live, not skipped). `packages/iris-mcp-all` standalone: **120/120**
(tool/action counts unmoved — Constraint E-1/Rule #31). `packages/shared` standalone:
**1308/1308**. `ExecuteMCPv2.Tests` package: **396/396** — mechanical count of `Test*` methods
across classes literally `Extends %UnitTest.TestCase` under `src/ExecuteMCPv2/Tests/` independently
recomputed at 396, matching the live return exactly (Rule #35 satisfied). Bootstrap regen
independently re-run twice: byte-identical hash both times (idempotent), roster 29 with
`REST/Dispatch.cls` last. `pnpm gen:governance-baseline:check` (check-only): exit 0, frozen
`1e62c5ad5bf7`/141/201/60 unchanged, file untouched (Constraint E-2).

## Coverage

- `CubeAction` `"build"` branch device-output isolation: comprehensively covered — ERROR path by
  a permanent default-suite raw-wire test, SUCCESS path by this-pass live mutation verification
  (RED→GREEN, independent disposable cube) with an explicit, reasoned decision not to persist it
  as an automated test (documented above and in the test file's own banner).
- `CubeAction` `"sync"` branch: unaffected by this story (already clean via `pVerbose=0`,
  independently re-confirmed via code read — no redirect touches the sync branch); no new test
  needed.
- Handler-contract coverage (argument mapping, response shape, error propagation) for both
  `build` and `sync`: pre-existing in `analytics.test.ts`, unaffected by this story's change,
  unaffected by this pass.
- `Redirects()` label method (mnemonic binding, restore discipline): not independently unit-
  testable at the TS layer by construction (it's OS-internal plumbing); verified instead by full
  control-flow code read confirming it matches `Command.cls`'s proven pattern, and transitively
  proven correct by the raw-wire GREEN result on both paths (a binding error would corrupt the
  wire body or leak the redirect into later output).

## Next steps

- No further automated-test gaps identified against Story 35.2's stated ACs.
- `35-2-DEV-1` (MEDIUM, `UnitTest.cls` binds its I/O-redirect mnemonic on `$IO` rather than a
  throw-away null device) is correctly out of this story's `Analytics.cls`-only scope and remains
  ledgered in `deferred-work.md` for a future story, which should apply the same live-first
  mutation-verification discipline this story used before fixing it (per the ledger's own
  suggested-resolution note).
