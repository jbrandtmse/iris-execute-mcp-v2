# Test Automation Summary — Story 17.1 `iris_default_settings_manage`

**Date:** 2026-06-16
**Scope:** QA E2E / coverage-gap pass over the dev's existing tests (no duplication).

## Pre-existing coverage (dev, upstream)

- `packages/iris-interop-mcp/src/__tests__/defaultSettings.test.ts` — 14 unit tests (mocked HTTP): all 4 actions (list/get/set/delete), list filters, get found:true/found:false, set with + without description/deployable, delete, namespace forwarding, IrisApiError (list/set) + non-IrisApiError propagation, metadata (name/scope/mutates).
- `packages/iris-interop-mcp/src/__tests__/defaultSettings-governance.test.ts` — 4 real-gate tests through `McpServerBase.handleToolCall`: set/delete DENIED (`GOVERNANCE_DISABLED`, handler never invoked), list/get ALLOWED, opt-in flips just `set`.
- `index.test.ts` — registration + count (19→20) + name/lookup assertions.

## Coverage gaps filled (QA, this pass)

Appended 5 unit tests to the existing DEFAULT-suite file `defaultSettings.test.ts` (no new file, no `*.integration.test.ts`). Each gap is grounded in the ObjectScript handler contract (`src/ExecuteMCPv2/REST/Interop.cls`):

1. **get-not-found vs delete-not-found asymmetry** (2 tests) — the dev covered get-miss (200 `{found:false}`). The handler routes delete-miss through a `SanitizeError`'d `%Status` → `IrisApiError` → tool `isError:true` with **no** `structuredContent`. Now asserts the contrast: a delete miss must not masquerade as a `found:false` success.
2. **Omitted-tuple-key passthrough** (2 tests) — the four slots default to `"*"` SERVER-side (class `InitialExpression`); the tool's contract for that is to OMIT the key. Asserts unspecified `production`/`item`/`hostClass` are absent from the POST body (and from the list query string), while `action`/`setting`/`value`/`namespace` remain.
3. **structuredContent object-shape guard** (1 test) — project memory: structuredContent must be an object, never a bare array. Asserts list result is a non-null object wrapper (`{settings,count}`), `Array.isArray(structuredContent) === false`.

## Result

- `defaultSettings.test.ts`: 14 → 19 tests (all green).
- Full `@iris-mcp/interop` suite: **194 passed / 11 files**.
- ESLint: clean.

## Coverage

- `iris_default_settings_manage`: 4/4 actions covered; both not-found classes (get-200 / delete-error) covered; tuple-default passthrough covered; structuredContent shape guarded; governance defaults proven end-to-end.

## Next steps

- Lead per-story smoke drives the LIVE deployed REST route over HTTP (out of scope for automated tests; Rule #26).
