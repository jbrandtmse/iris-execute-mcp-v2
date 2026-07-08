# Test Automation Summary — Story 24.0 Baseline Read/Write Classifications

**Date:** 2026-07-08
**Scope:** QA value-pin pass over the dev's existing completeness test (no duplication) — pure-TS data artifact, no runtime handler/HTTP surface to drive.

## Pre-existing coverage (dev, upstream)

- `packages/shared/src/baseline-classifications.ts` — `BASELINE_ACTION_CLASSIFICATIONS: Record<string, MutationClass>`, 141 keys.
- `packages/shared/src/__tests__/baseline-classifications.test.ts` (5 tests) — the structural/completeness contract required by AC 24.0.1: fast tripwire (non-empty, `size === GOVERNANCE_BASELINE.size`), named missing-key set-difference, named extra-key set-difference, value-shape (`"read"`/`"write"` only, no typos), and a sanity check that `GOVERNANCE_BASELINE` is the real (non-stale) import.

## Coverage gap filled (QA, this pass)

The dev suite proves the map's key SET matches the frozen baseline and that every VALUE is a legal enum member — but nothing pinned which specific keys resolve to `"read"` vs `"write"`. A well-intentioned future edit could flip a genuine write (e.g. `iris_execute_command`) to `"read"` and every dev assertion would still pass, because completeness/shape checks are blind to which side of read/write a key landed on. Once Story 24.1's `read-only` preset consumes this map, such a flip is a safety-guarantee breach (a write silently executing under `IRIS_GOVERNANCE_PRESET=read-only`).

New default-suite file: **`packages/shared/src/__tests__/baseline-classifications-safety.test.ts` — 35 tests**:

1. **Named spot-checks (write)** — well-known execution/mutation keys pinned `write`: `iris_execute_command`, `iris_execute_classmethod`, `iris_global_set`, `iris_global_kill`, `iris_doc_put`, `iris_doc_load`, `iris_doc_compile`, `iris_database_manage:create/:delete/:modify`, `iris_user_manage:create`, `iris_role_manage:delete`, `iris_resource_manage:modify`, `iris_namespace_manage:create`, `iris_task_run`.
2. **Named spot-checks (read)** — well-known pure-query keys pinned `read`: `iris_database_list`, `iris_config_manage:get`, `iris_permission_check`, `iris_database_check`, `iris_journal_info`, `iris_license_info`, `iris_mirror_status`, `iris_locks_list`, `iris_jobs_list`, `iris_production_status`, `iris_production_summary`, `iris_role_list`, `iris_user_get`.
3. **Documented judgment-call pins** — the five keys the dev's Completion Notes flag as diverging from the tool's own `annotations.readOnlyHint` (the keys a future "sync to annotations" edit is most likely to flip): `iris_doc_export` (write — bulk local-disk write surface), `iris_execute_tests` (write — despite `readOnlyHint:true`, runs real ObjectScript unit-test methods whose setup/teardown can mutate state), `iris_sql_execute` (write — SELECT-only not guaranteed), `iris_oauth_manage:discover` (read — `Discover()` only populates a ByRef output), `iris_user_password:validate` (read — `ValidatePassword()` never persists).
4. **Systematic verb-suffix sweep** — derives its key set from the LIVE map at runtime (never hand-copied) and checks every `tool:action` key whose action verb is an unambiguous write verb (`create/delete/modify/set/update/build/sync/reset/add/remove/enable/disable`, taken from AC 24.0.2's own verb lists) classifies `write` (34 matching keys, tripwire `>30`), and every key whose verb is an unambiguous read verb (`list/get` — the only AC 24.0.2 read-allowlist verbs that actually occur as an action suffix in this baseline) classifies `read` (11 matching keys, tripwire `>5`). This catches a misclassification on ANY key using this verb convention, not just the ones named above.

## Result

- `pnpm --filter @iris-mcp/shared test -- baseline-classifications` → **2 files, 40 tests passed** (5 dev + 35 new).
- Full default suite `pnpm --filter @iris-mcp/shared test` → **31 files, 606 tests passed** (was 30 files / 571 tests before this pass — the new file is discovered by the default `vitest run`, confirming correct `*.test.ts` naming, not excluded by the `*.integration.test.ts` filter, Rule #21).
- No existing test perturbed; `governance-baseline.ts` untouched (not read or modified by this pass); bare generator not invoked.

## Coverage

- Structural contract (key-set parity, value-shape): dev-owned, unchanged.
- Value-level regression protection for the safety-relevant subset of the map (all 141 keys reachable via the verb sweep for the write/read-verb-suffix keys; explicit spot-checks for the bare-tool and judgment-call keys the verb sweep cannot reach): QA-added, this pass.

## Next steps

- None required for this story — it has no consumer yet (Story 24.1's `presetSeed` is the first reader per the Dev Notes "Integration ACs"). When 24.1 lands, its own tests should exercise the cascade's actual read-only enforcement; this file's job ends at "the map itself is trustworthy."
