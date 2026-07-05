# Test Automation Summary — Story 22.0 `iris_loc_count` (LOC counter)

**Date:** 2026-07-03
**Scope:** QA E2E / coverage-gap pass over the dev's existing tests (no duplication).

## Pre-existing coverage (dev, upstream)

- `src/ExecuteMCPv2/Tests/LocClassifierTest.cls` (22), `LocScannerTest.cls` (9), `LocFacadeTest.cls` (7) — classifier fixture matrix, live-dictionary scanner behavior, and the `Generate.Count` facade driven in-process.
- `packages/iris-dev-mcp/src/__tests__/loc.test.ts` (14, mocked ToolContext) — wire URL/params, renderings, structuredContent, IrisApiError, Zod bounds.
- `loc-governance.test.ts` (2) — real `handleToolCall` gate (registration + read default-enabled), handler replaced by a spy.
- `index.test.ts` — registration/count (25→26).

## Coverage gaps filled (QA, this pass)

Nothing automated drove the DEPLOYED REST dispatch surface, and nothing drove the REAL TS stack (real server → real `IrisHttpClient`) end-to-end. Two new default-suite test files:

1. **`src/ExecuteMCPv2/Tests/LocRestTest.cls` — 10 tests** issuing REAL HTTP requests (`%Net.HttpRequest`) against the live `GET /api/executemcp/v2/dev/loc` route (Dispatch → `REST.Loc` handler → facade → envelope render):
   - Happy path with the TS tool's exact wire shape (Rule #10 defaults): envelope contract (`status.errors` empty, `console` array), bucket-sum invariant ON the wire result, JSON types (`number`/`boolean`/`array`) the structuredContent-verbatim contract depends on, sorted top-N.
   - Rejection paths as clean JSON envelopes (the Rule #7 "non-JSON response" regression, automated): missing spec, empty spec, whitespace spec, junk `includeGenerated`, junk/negative/decimal `topN` — each asserts HTTP 200 + parseable envelope + stable parameter-name substring (never the locale-variable `ERROR #` prefix — Rules #13/#34) + empty result.
   - `topN=1` cap + `topN=0` clamp-to-1 over the wire; `includeGenerated` toggle on generated `.int`; INC document coverage (`Ensemble.inc` — never test-bucketed); bad namespace → clean error + follow-up request succeeds; omitted namespace defaults to the webapp namespace.
   - Connection: port discovered from `Config.Startup` (%SYS, fallback 52773); documented dev credentials; all three overridable via `^UnitTestConfig("LocRest","Port"|"Username"|"Password")`.
2. **`packages/iris-dev-mcp/src/__tests__/loc-e2e.test.ts` — 3 tests** (default vitest suite, no live IRIS; naming per the `sqlAnalyze-e2e.test.ts` precedent): boots the REAL `McpServerBase`, invokes the REAL handler through the SDK callback, and mocks fetch to replay envelopes **captured verbatim from the live endpoint** (2026-07-03, HSCUSTOM):
   - Success round-trip: wire URL through the REAL profile context (`namespace=DEFAULTNS` + wire-explicit defaults) asserted at the fetch boundary; live numbers flow into the summary table; structuredContent === captured result object verbatim.
   - Live-captured server rejection (HTTP 200 + `status.errors`, the bad-namespace capture) → real `IrisHttpClient` throws → tool `isError` envelope carrying the server's text.
   - Non-JSON body (HTML) → `isError` with the client's "non-JSON" diagnostic (client-side counterpart of the Epic 11 Bug #1 class).

## Result

- ObjectScript: `LocRestTest` **10/10 passed** (0 failures on first run). Rule #35 note: the class-level `iris_execute_tests` report DETERMINISTICALLY truncates this class to its first 3 methods (real-HTTP methods are the suite's slowest) — the run itself completes; all 10 verified authoritatively via `%UnitTest_Result.TestMethod` SQL (run 1439: 10 rows, Status=1) plus 8 individual method-level runs. Method-level targets need the `Test` prefix STRIPPED (`:HappyPathEnvelopeContract`, not `:TestHappyPathEnvelopeContract`).
- No regression: `LocClassifierTest` 22/22, `LocScannerTest` 9/9, `LocFacadeTest` 7/7 (totals match method counts — Rule #35 satisfied).
- TS: `@iris-mcp/dev` **349 passed / 20 files** (346 + 3 new); ESLint clean; `tsc --noEmit` clean; full monorepo `pnpm test` 12/12 turbo tasks green.

## Coverage

- REST envelope contract over the real dispatch surface: automated (was manual-only in dev Task 8).
- Every handler rejection branch in `REST/Loc.cls` exercised over live HTTP; endpoint↔tool contract pinned by live-captured fixtures on the TS side.

## Next steps

- Lead per-story smoke (AC 22.0.13) remains lead-executed: cross-namespace (second namespace, e.g. SADEMO — Rule #34) is NOT automated here; `LocRestTest` automates the HSCUSTOM-side envelope/guard checks the smoke would otherwise repeat.
- If the instance's dev credentials ever change, set `^UnitTestConfig("LocRest","Username"/"Password")` before running `LocRestTest`.
