# Deferred Work

Items deferred from code reviews across all epics. Only open and genuinely actionable items
are listed below.

> **Epic 1-4 items formally closed in Story 7.0** (26 items). These were triaged as won't-fix
> based on: no production incidents, no external consumers, IRIS API limitations, or
> acceptable-risk trade-offs after 6 epics of stable operation. See git history for full
> provenance.

---

## Open Items — Epic 5 (Interoperability MCP Tools)

### From Story 5-0 (Epic 4 Deferred Cleanup)
- `pastEnd` flag added to `PaginateResult` and set in `paginate()` (server-base.ts) but no tool handler currently checks or returns it to the MCP client. The flag is available for future consumers but has no effect today.

### From Story 5-2 (Production Lifecycle)
- `ProductionControl` tTimeout=0 is silently overridden to 120. If a user explicitly passes `timeout: 0`, the intent may be "no wait" but the code treats it as "use default". Consider distinguishing null/undefined from explicit zero.
- `ProductionSummary` inner catch block (per-namespace iteration) swallows all errors silently, including security violations. Consider logging skipped namespaces or including them in the response with an error reason.
- `ProductionManage` uses `%Dictionary.ClassDefinition.%ExistsId` to check existence, which matches any class definition, not specifically production classes. A non-production class with the same name would produce misleading errors.
- `productionControlTool` Zod schema marks `name` as optional for all actions, but start/restart require it server-side. Consider adding a `.refine()` for client-side validation.

### From Story 5-3 (Production Item and Auto-Start)
- `ItemManage` "set" action silently ignores unknown settings keys. If a caller passes an unrecognized key (e.g., `{ "badKey": 1 }`), it is skipped without feedback. Consider returning a list of unrecognized keys in the response.
- `ItemManage` "set" action: If `tItem.%Save()` succeeds but `Ens.Director.UpdateProduction()` fails, the persisted config and the running production are out of sync. Pre-existing IRIS pattern limitation -- no simple rollback mechanism.

### From Story 5-5 (Credential and Lookup Table)
- `LookupTransfer` import action is additive/merge -- it sets entries from XML but does not remove pre-existing entries not present in the XML. The tool description implies full import. Consider adding a `replace` option or documenting the merge behavior.
- `CredentialManage` update action: passing empty string for `username` or `password` is silently ignored (`If tPassword '= ""`). A user cannot explicitly clear the username to empty. Consider using `%IsDefined` to distinguish missing from empty.

### From Story 5-7 (Interop Integration Tests)
- `probeCustomRest` in `integration-setup.ts` uses duck-typing (`"statusCode" in error`) instead of `instanceof IrisApiError`. Same pattern as iris-admin-mcp (deferred in Story 4.9). Low priority cosmetic improvement.
- No integration tests for `interopRestTool`, `ruleGetTool`, or `transformTestTool`. These tools are not required by any AC but represent uncovered surface area. Low priority -- can be added when specific test productions with rules/transforms are available.

---

## Open Items — Epic 6 (Operations & Monitoring MCP Tools)

### From Story 6-0 (Epic 5 Deferred Cleanup)
- No npm script entry for `scripts/gen-bootstrap.mjs`. Developers must know to run `node scripts/gen-bootstrap.mjs` manually. Consider adding a `gen:bootstrap` script to root `package.json`.
- No error handling in `gen-bootstrap.mjs` for missing `.cls` files. `readFileSync` will throw with unhelpful stack trace if a class file is missing or renamed. Consider adding try-catch with user-friendly error message.

### From Story 6-3 (Jobs and Locks Tools)
- AC1 specifies "start time" for jobs but `%SYS.ProcessQuery` does not expose a start time column. The verified SQL table lacks this field. Consider updating AC1 wording or adding a derived start time if IRIS exposes it in a future version.
- No ObjectScript-side unit test for the dual-format Owner parsing in `LocksList` (pipe-delimited vs plain PID). The fix was verified by the lead during Step 2.5 but has no automated regression test on the IRIS side.

### From Story 6-6 (Task Scheduling Tools)
- AC6 mentions "duration" in task history but no explicit duration field is computed. The handler returns `lastStart` and `completed` timestamps from which duration can be derived client-side. Computing duration server-side would require parsing IRIS internal date/time format (`$HOROLOG`-based strings). Low risk — data is available for derivation.
- No schedule properties (TimePeriod, DailyStartTime, DailyEndTime, etc.) exposed in `iris.task.manage` create action. Users can create tasks with name, class, namespace, description, and suspended flag, but cannot set a schedule. The `%SYS.Task` scheduling subsystem has many interrelated properties. Consider adding schedule configuration in a future enhancement story.

### From Story 6-7 (System Configuration Tools)
- Dynamic annotations via `_meta.readOnly` in config tool response don't affect MCP protocol-level tool hints. The tool is statically marked `destructiveHint: true` to cover the worst-case "set" action. MCP annotations are per-tool, not per-invocation, so this is a known trade-off for single-tool multi-action patterns.
- `GetConfig` for config section reads only 11 hardcoded properties from `Config.config` out of ~70 available. Consider iterating all properties via `%Dictionary.PropertyDefinition` for completeness in a future enhancement.
- No whitelist/validation on property names passed to `SetConfig`. Invalid names are caught by `Config.config.Modify()` returning an error status, so this is defense-in-depth only.
- `ExportConfig` only includes the "config" section data, not startup or locale. Intentional per dev notes but could be expanded to include all sections in a future enhancement.

### From Story 6-8 (Ops Integration Tests)
- Duplicate `getConfig()` function and `declare global` block between `integration-setup.ts` and `ops.integration.test.ts`. Same pattern exists in iris-interop-mcp. Consider extracting shared test config helper in a future cleanup story.
- Task creation test extracts `createdTaskId` via unchecked `as` cast on `structuredContent`. If the response shape changes, the cast silently produces undefined fields. Low risk since cleanup still runs via afterAll.

---

## Open Items — Epic 7 (Data & Analytics MCP Tools)

### From Story 7-3 (Analytics Tools) — code review (2026-04-07)
- `%BuildCube` with `pAsync=0` runs synchronously with no timeout protection. A large cube build could block the HTTP request indefinitely. The story spec explicitly calls for synchronous operation, so adding timeout or async support would be a future enhancement.

### From Story 7-4 (REST API Management) — code review (2026-04-07)
- `encodeURIComponent()` on the `application` parameter encodes forward slashes (e.g., `/api/myapp` becomes `%2Fapi%2Fmyapp`). Whether the IRIS Management API v2 correctly decodes percent-encoded slashes in the URL path segment is unverified. If not, application paths with slashes may need to be split and encoded segment-by-segment. Requires live IRIS testing to confirm. Low risk -- follows the spec-prescribed pattern.

### From Story 7-5 (Data Integration Tests) — code review (2026-04-07)
- `insertedDocId` extraction regex in `data.integration.test.ts` (line ~178) only matches numeric IDs (`(\d+)`). If DocDB returns UUID or string-based IDs in a future IRIS version, the fallback extraction would fail silently. Low risk since `structuredContent` extraction is tried first and the regex is a fallback only.
- Find-with-filter test (test 7) does not assert on the number of returned documents or verify that the found document content matches the inserted data. The test only checks for a non-error response. Low priority -- the other lifecycle tests (get, update) verify content correctness.
