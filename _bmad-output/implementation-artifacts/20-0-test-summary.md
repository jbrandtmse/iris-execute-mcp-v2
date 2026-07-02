# Story 20.0 — QA E2E / Guardrail Test Summary

**Feature:** Production `clean` action + F2 "write, default-enabled" governance mechanism
**Stage:** QA (e2e / guardrail test generation)
**Framework:** vitest (established) — TS layer, mocked-HTTP-to-IRIS pattern; ObjectScript handler verified by lead's live-HTTP smoke separately.

## Scope

Focused on the highest-value gaps NOT already covered by the dev's unit tests. The dev's
`control-governance.test.ts` proves the gate for `clean` but registers ONLY a single spied
`productionControlTool`; the pure-function F2 sweep in `governance.test.ts` uses SYNTHETIC tools.
Neither can prove the two invariants that only emerge on the WHOLE, real interop server driven
through the real framework surfaces.

## Generated Tests

### E2E / guardrail (in-process, real McpServerBase + full interop tool set)

- [x] `packages/iris-interop-mcp/src/__tests__/control-governance-e2e.test.ts` (NEW — 4 tests)

| # | Test | AC | Why it is high-value (not a dev-test duplicate) |
|---|------|----|-------------------------------------------------|
| 1 | Discovery tool ↔ governance resource **non-drift** | 20.0.5 | Drives BOTH real SDK surfaces — `tools/call` for `iris_server_profiles` and `resources/read` for `iris-governance://default` — on the full interop server, and asserts `toEqual` on the two full policy maps for the same profile, with `iris_production_control:clean` enabled in both. Proves the discovery tool and D6 resource cannot drift (they share `getEffectivePolicy` threaded with `defaultEnabledWrites`). No dev test drives both surfaces together. |
| 2 | **No-leak capstone**: only `clean` flips; sibling writes stay disabled | 20.0.5a | With ALL 20 interop tools registered, asserts `clean` = enabled while `iris_production_item:add/remove` and `iris_default_settings_manage:set/delete` remain default-disabled, and the 5 grandfathered actions + the framework discovery read stay enabled. **Verified genuine** — injecting `defaultEnabled:["add"]` on `item.ts` made it fail on `iris_production_item:add` (then reverted). The dev's single-tool harness structurally cannot catch such a leak. |
| 3 | Real gate on the full server: `clean` admitted + a grandfathered action admitted | 20.0.5 / 20.0.7 | Confirms end-to-end that under empty `IRIS_GOVERNANCE` the gate ADMITS `clean` (F2) and `recover` (grandfathered) with the full tool set present (handler spy runs). |
| 4 | Explicit `false` disables `clean` on the full server; grandfathered unaffected | 20.0.5 / 20.0.7 | `IRIS_GOVERNANCE {global:{"iris_production_control:clean":false}}` → `GOVERNANCE_DISABLED` for `clean` (handler never runs); `recover` still admitted under the same override (back-compat). |

## Coverage

- **F2 non-drift (discovery tool vs D6 resource):** covered end-to-end on the real interop server (gap the dev tests left open).
- **All-other-writes-still-disabled capstone (AC 20.0.5a):** covered on the full real surface and **proven to fail on a real leak** (mutation-tested).
- **Back-compat (5 grandfathered actions, AC 20.0.7):** covered via the real gate + the effective-policy map on the full server.
- **`clean` enabled-by-default via the real `handleToolCall` gate + explicit-false override:** covered (complements, does not duplicate, the dev's single-tool `control-governance.test.ts`).

Not re-covered here (already covered by dev unit tests, intentionally not duplicated): the ObjectScript
handler branches (double-gate refusal, running-guard envelope, `pKillAppDataToo` forwarding, `recover`
no-arg) — verified by the lead's live-HTTP smoke; and the pure-function F2 sweep / byte-for-byte back-compat
in `governance.test.ts`.

## Discoverability (Rule 8)

- Filename `control-governance-e2e.test.ts` matches `*.test.ts` and is NOT `*.integration.test.ts`
  (the only pattern the interop `vitest.config.ts` excludes). Confirmed picked up by the default
  `vitest run` (ran as part of the 14-file / 234-test interop suite).

## Validation

- New file: **4 passed**.
- Affected suites green with zero regressions:
  - `@iris-mcp/shared`: 27 files, **547 passed**.
  - `@iris-mcp/interop`: 14 files, **234 passed** (was 230; +4 from the new file).
- Lint clean on the new file.
- `packages/iris-interop-mcp/src/tools/item.ts` reverted to its original state after mutation-testing;
  git-clean confirmed.

**Result:** All generated tests pass. ✅ Changes left uncommitted for the lead's smoke gate.
