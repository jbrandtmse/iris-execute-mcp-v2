# Test Automation Summary — Story 34.4 (Response-Path Integrity + Epic-Gate Durability)

QA verification pass. No new test files were added — the dev's own `ExecuteMCPv2.Tests.BaseTest` (6 methods) and the extended `execute-classmethod-epic-gate.test.ts` (legs b/c/d) were independently re-run, mutation-verified, and confirmed against live IRIS by this QA pass. All findings below are verification results, not new automation.

## Verified Tests

### ObjectScript (`%UnitTest`, live IRIS `HSCUSTOM`, IRIS 2026.1 Build 235U)
- [x] `src/ExecuteMCPv2/Tests/BaseTest.cls` — 6/6 passed (AC 34.4.1/34.4.4/scope-decision pins)
- [x] `ExecuteMCPv2.Tests` package — 329/329 passed, 0 failed, 0 skipped (mechanically re-counted: `grep -c "^Method Test"` across all `Tests/*.cls` = 329, matches)

### Vitest (`packages/iris-dev-mcp`)
- [x] `src/__tests__/execute-classmethod-epic-gate.test.ts` — 6/6 passed, 0 skipped (legs a/b/c/d all executed, no `[SKIP]` log lines)
- [x] Full package default suite — 622/622 passed, 38/38 files, 0 skipped

### Repo-wide gates
- [x] `pnpm turbo run build test lint type-check` — 29/29 successful
- [x] `pnpm gen:governance-baseline:check` — frozen `1e62c5ad5bf7` / 141 / 201 / 60, unchanged
- [x] `pnpm run gen:bootstrap` — 29 classes, `BOOTSTRAP_VERSION d7adf516d912`, re-run produced byte-identical diff-stat (idempotent)

## Live Mutation Evidence (independently reproduced by QA, not just re-trusting Dev Notes)

1. **Base.cls argument-passing regression** — reverted `##super(pStatus, tMsgPart, tResPart)` → `##super(pStatus, pMsgPart, pResPart)`: `BaseTest` went 3/6 RED with the exact `<UNDEFINED> *pMsgPart` error; live `curl POST /command` returned **HTTP 200 with a completely empty body** (the catastrophic symptom). Restored byte-identically (`git diff --stat` empty); 6/6 green.
2. **Gate leg (c) fixture mutation** — disabled `ClassMethodArgsFixture.Target20`'s position-19 mutation line: vitest leg (c) went RED (`expected 'v19' to be 'v19-m'`). Restored byte-identically; full gate file 6/6 green, full package 622/622 green.

## Coverage

- Handlers driven live over real HTTP (success + error paths): `/command`, `/classmethod`, `/security/user` (+ `/security/user/:name` error), `/interop/production/status`, `/config/namespace`, `/monitor/system`, `/monitor/health` — all returned well-formed, non-empty JSON envelopes; `truncated` confirmed present on both success and error envelopes for `/command` and `/classmethod`.
- Constraint C-2: exactly one `ExecuteMCPv2.REST.Command.1.int` confirmed via `iris_doc_list(generated=true)`.
- Adversarial check (per task brief): read `%Atelier.REST.RenderResponseBody`'s actual source — it wraps its entire body in Try/Catch and never throws externally (always returns a `%Status`), so `Base.RenderResponseBody`'s outer `Catch` (which converts an exception to a discarded `%Status`) is unreachable via `##super()` in practice. No new hazard found.
- Disposable probe `ExecuteMCPv2.Tests.Temp34ProbeTest` confirmed absent from both disk and server.

## Next Steps

- None — all Story 34.4 ACs (34.4.1–34.4.6) independently re-verified live. No product defects found; no code changes made (all mutations restored byte-identically).
