# Deferred Work

All deferred items have been formally triaged and closed as of Story 8.0 (Epic 7 Deferred Cleanup).
This is the final feature epic; no further feature work is planned beyond Epic 8 (Documentation).

> **Epic 1-4 items formally closed in Story 7.0** (26 items). See git history for provenance.

---

## Closed Items --- Epic 5 (Interoperability MCP Tools)

### From Story 5-0 (Epic 4 Deferred Cleanup)
- ~~`pastEnd` flag added to `PaginateResult`~~ --- **Closed (Story 8.0)**: Removed as dead code. No consumer existed after 7 epics. The `pastEnd` field has been removed from `PaginateResult`, `paginate()` in server-base.ts, and related tests.

### From Story 5-2 (Production Lifecycle)
- ~~`ProductionControl` tTimeout=0 silently overridden to 120~~ --- **Closed (won't-fix, Story 8.0)**: Edge case with no reported incidents. The server-side default is acceptable for all known use cases.
- ~~`ProductionSummary` inner catch block swallows errors silently~~ --- **Closed (Story 8.0)**: Added console log for skipped namespaces with error reason in Interop.cls.
- ~~`ProductionManage` uses `%Dictionary.ClassDefinition.%ExistsId`~~ --- **Closed (won't-fix, Story 8.0)**: IRIS API limitation. Non-production classes with the same name is an unlikely edge case with no practical impact.
- ~~`productionControlTool` Zod schema marks `name` as optional for all actions~~ --- **Closed (Story 8.0)**: Added `.refine()` validation requiring `name` for `start` and `restart` actions.

### From Story 5-3 (Production Item and Auto-Start)
- ~~`ItemManage` "set" silently ignores unknown settings keys~~ --- **Closed (won't-fix, Story 8.0)**: Acceptable behavior. Unknown keys are ignored per standard IRIS configuration patterns.
- ~~`ItemManage` "set" save/update consistency~~ --- **Closed (won't-fix, Story 8.0)**: Pre-existing IRIS pattern limitation with no simple rollback mechanism. No incidents reported.

### From Story 5-5 (Credential and Lookup Table)
- ~~`LookupTransfer` import is additive/merge~~ --- **Closed (won't-fix, Story 8.0)**: Merge semantics are safer than replace. Tool description is adequate.
- ~~`CredentialManage` empty string username/password handling~~ --- **Closed (won't-fix, Story 8.0)**: Edge case. Users can delete and recreate credentials instead of clearing fields.

### From Story 5-7 (Interop Integration Tests)
- ~~`probeCustomRest` duck-typing instead of instanceof~~ --- **Closed (won't-fix, Story 8.0)**: Cosmetic improvement. Works reliably in practice.
- ~~No integration tests for interopRest/ruleGet/transformTest~~ --- **Closed (won't-fix, Story 8.0)**: Requires IRIS test production setup. Unit tests provide adequate coverage.

---

## Closed Items --- Epic 6 (Operations & Monitoring MCP Tools)

### From Story 6-0 (Epic 5 Deferred Cleanup)
- ~~No npm script for gen-bootstrap.mjs~~ --- **Closed (Story 8.0)**: Added `gen:bootstrap` script to root package.json.
- ~~No error handling in gen-bootstrap.mjs for missing .cls files~~ --- **Closed (won't-fix, Story 8.0)**: Node.js already provides clear error messages for missing files. Low value add.

### From Story 6-3 (Jobs and Locks Tools)
- ~~AC1 "start time" field~~ --- **Closed (won't-fix, Story 8.0)**: IRIS %SYS.ProcessQuery does not expose start time. Cannot be implemented without IRIS-side changes.
- ~~No ObjectScript unit test for dual-format Owner parsing~~ --- **Closed (won't-fix, Story 8.0)**: Verified by lead during review. TypeScript-side tests cover the parsing.

### From Story 6-6 (Task Scheduling Tools)
- ~~AC6 "duration" not computed~~ --- **Closed (won't-fix, Story 8.0)**: lastStart and completed timestamps are available for client-side derivation.
- ~~No schedule properties in iris.task.manage create action~~ --- **Closed (won't-fix, Story 8.0)**: Complex scheduling subsystem. No planned future enhancement epics.

### From Story 6-7 (System Configuration Tools)
- ~~Dynamic annotations via `_meta.readOnly`~~ --- **Closed (won't-fix, Story 8.0)**: Known MCP protocol limitation. Static annotations are the correct approach.
- ~~GetConfig reads only 11 hardcoded properties~~ --- **Closed (won't-fix, Story 8.0)**: Covers most common configuration needs. Full property iteration is a future enhancement.
- ~~No whitelist/validation on SetConfig property names~~ --- **Closed (won't-fix, Story 8.0)**: Config.config.Modify() validates server-side. Defense-in-depth only.
- ~~ExportConfig only includes config section~~ --- **Closed (won't-fix, Story 8.0)**: Intentional per original design. No incidents or requests for expansion.

### From Story 6-8 (Ops Integration Tests)
- ~~Duplicate getConfig()/declare global blocks~~ --- **Closed (Story 8.0)**: Extracted shared `getIntegrationConfig()` helper to `@iris-mcp/shared/test-helpers/integration-config`.
- ~~Task creation unchecked `as` cast~~ --- **Closed (won't-fix, Story 8.0)**: Low risk. Cleanup runs via afterAll regardless.

---

## Closed Items --- Epic 7 (Data & Analytics MCP Tools)

### From Story 7-3 (Analytics Tools)
- ~~`%BuildCube` synchronous with no timeout~~ --- **Closed (won't-fix, Story 8.0)**: Story spec explicitly calls for synchronous operation. Timeout/async is a future enhancement.

### From Story 7-4 (REST API Management)
- ~~`encodeURIComponent()` percent-encoding slashes~~ --- **Closed (won't-fix, Story 8.0)**: Follows spec-prescribed pattern. No reported issues.

### From Story 7-5 (Data Integration Tests)
- ~~`insertedDocId` regex only matches numeric IDs~~ --- **Closed (won't-fix, Story 8.0)**: Fallback only; structuredContent extraction is primary. Low risk.
- ~~Find-with-filter test does not assert document count~~ --- **Closed (won't-fix, Story 8.0)**: Other lifecycle tests verify content correctness. Low priority.

---

## Deferred from: code review of 8-0-epic-7-deferred-cleanup (2026-04-07)

- Duplicate `getIntegrationConfig` helper: `packages/shared/src/__tests__/integration-helpers.ts` (pre-existing, accepts overrides) and `packages/shared/src/test-helpers/integration-config.ts` (new, includes `declare global` augmentation). Both produce the same config from env vars. Functionally harmless but could be consolidated into the new cross-package helper if `integration-helpers.ts` is refactored to delegate to it.

## Deferred from: code review of 8-1-suite-level-readme-and-architecture-overview (2026-04-07)

- Per-package README links in root README.md point to files that do not yet exist (e.g., `packages/iris-dev-mcp/README.md`). These will be created in Story 8.2. Until then, links are dead. Pre-existing by design (story spec says to link ahead).
