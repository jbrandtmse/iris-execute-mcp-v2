# Deferred Work

Items deferred from code reviews across all epics. Resolved items from Epics 1-3 have been
archived (see git history for full provenance). Only open items and recently resolved items
are listed below.

---

## Open Items — Epic 1 (Shared Infrastructure)

### From Story 1-1 (Monorepo Scaffold)
- No `license` field in package.json files (root or per-package). The repo has an MIT LICENSE file but the npm package metadata does not declare it. Should be added before first publish.

### From Story 1-2 (HTTP Client)
- Logger has no redaction/scrubbing mechanism. If a caller accidentally passes credentials as arguments to `logger.info()`, they will be logged. Consider adding a sanitizer function or warning in the Logger interface docs.

### From Story 1-3 (Connection Health)
- `negotiateVersion` catches all errors with a bare `catch {}` and defaults to v1. This makes it impossible for callers to distinguish "server has no version info" from "authentication failed" or "server returned 403". Consider surfacing error details or returning a richer result type.
- `requireMinVersion` creates `IrisApiError` with `statusCode: 0` and empty `originalUrl`, which may confuse consumers inspecting error metadata. Consider using a dedicated error type or using meaningful sentinel values.

### From Story 1-4 (MCP Server Base)
- No integration test exercises the `handleToolCall` validation error path through the server. Zod validation tests only validate schemas directly, not the server's error formatting and logging when invalid args arrive through the MCP protocol.
- `addTools` with a duplicate tool name will overwrite the internal Map entry but may throw from the MCP SDK (which checks for existing registrations). Consider checking for duplicates before calling SDK `registerTool`.

### From Story 1-5 (Integration Tests)
- Windows-specific network timeout behavior: The connection error test for invalid host uses RFC 5737 TEST-NET IP (192.0.2.1) which may behave differently on Windows vs Linux (faster ICMP reject vs true timeout). The 2-second timeout and 3-second assertion bound may not hold on all Windows configurations. Consider platform-specific timeout adjustments or skip annotation for Windows CI runners.

---

## Open Items — Epic 2 (Dev MCP Tools)

### From Story 2-1 (Dev MCP Package Setup)
- No unit tests for the entry point bootstrap flow (`server.start().catch()` pattern). This would require mocking the full startup sequence including `loadConfig`, health check, and transport connection.
- Package `exports` field in `package.json` advertises importable paths (`"."`) but `src/index.ts` has no exports (it is a side-effect-only CLI entry point). If another package imports from `@iris-mcp/dev`, they get an empty module. Consider whether the `exports` field should be removed or a separate library entry point should be created.

### From Story 2-2 (Document CRUD)
- Batch delete uses individual DELETE calls instead of the Atelier batch endpoint. Consider adding a `deleteWithBody()` method to IrisHttpClient in a future story.

### From Story 2-3 (Document Metadata)
- `metadataOnly` combined with `format` parameter silently ignores the `format` option. Consider either documenting this behavior or returning a validation error when both are set.
- No unit test for `metadataOnly` with a `namespace` override.

### From Story 2-6 (Document Format and XML)
- Duplicated body construction logic in `docXmlExportTool` handler. Consider extracting a shared helper.
- Missing error propagation test for `docXmlExportTool`.

### From Story 2-7 (SQL and Server Info)
- Client-side `maxRows` truncation in `iris.sql.execute` fetches all rows before slicing. Consider server-side row limit.

---

## Open Items — Epic 3 (ObjectScript REST Handlers)

### From Story 3-0 (Epic 2 Deferred Cleanup)
- Mock `createMockCtx()` paginate function ignores cursor and pageSize arguments. Low priority since server-base.test.ts covers pagination logic in isolation.
- No integration test verifying `iris.doc.list` correctly forwards cursor through `ctx.paginate()`. Low priority.

### From Story 3-2 (Global Operations Handler)
- BuildGlobalRef comma-separated subscript parsing cannot handle subscript values containing commas. Inherent limitation.

### From Story 3-3 (ObjectScript Execution Handler)
- AC2 specifies ByRef/Output parameter support for classmethod handler but current implementation only captures return values. Consider adding ByRef support in a future enhancement.

---

## Open Items — Epic 4 (Admin MCP Tools)

### From Story 4-0 (Epic 3 Deferred Cleanup)
- `./test-helpers` subpath export points to raw TypeScript source files rather than compiled dist output. Works in monorepo but would break for external consumers.

### From Story 4-1 (Admin MCP Package Setup)
- Invalid CLI `--transport` values are silently ignored without warning. Consider adding a warning for unrecognized CLI transport values.

### From Story 4-2 (Namespace and Database Management)
- AC4 specifies "returns all databases with size, free space, and mount status" but `Config.Databases.Get` does not expose a free space property. Consider adding free space in a future enhancement.

### From Story 4-4 (User and Password Management)
- `UserRoles` does not validate that `role` is non-whitespace. Low priority.
- GET requests to `/security/user/roles` or `/security/user/password` match the wildcard route. Cosmetic issue.

### From Story 4-8 (OAuth2 Management)
- The TypeScript `oauthManageTool` handler passes through the entire response without client-side stripping of sensitive fields. Defense-in-depth only since IRIS backend correctly excludes secrets.

### From Story 4-9 (Admin Integration Tests)
- `probeCustomRest` in `integration-setup.ts` uses duck-typing instead of `instanceof IrisApiError`. Low priority cosmetic improvement.

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

## Deferred from: code review of 6-0-epic-5-deferred-cleanup (2026-04-07)

- No npm script entry for `scripts/gen-bootstrap.mjs`. Developers must know to run `node scripts/gen-bootstrap.mjs` manually. Consider adding a `gen:bootstrap` script to root `package.json`.
- No error handling in `gen-bootstrap.mjs` for missing `.cls` files. `readFileSync` will throw with unhelpful stack trace if a class file is missing or renamed. Consider adding try-catch with user-friendly error message.

## Deferred from: code review of 6-6-task-scheduling-tools (2026-04-07)

- AC6 mentions "duration" in task history but no explicit duration field is computed. The handler returns `lastStart` and `completed` timestamps from which duration can be derived client-side. Computing duration server-side would require parsing IRIS internal date/time format (`$HOROLOG`-based strings). Low risk — data is available for derivation.
- No schedule properties (TimePeriod, DailyStartTime, DailyEndTime, etc.) exposed in `iris.task.manage` create action. Users can create tasks with name, class, namespace, description, and suspended flag, but cannot set a schedule. The `%SYS.Task` scheduling subsystem has many interrelated properties. Consider adding schedule configuration in a future enhancement story.

## Deferred from: code review of 6-3-jobs-and-locks-tools (2026-04-07)

- AC1 specifies "start time" for jobs but `%SYS.ProcessQuery` does not expose a start time column. The verified SQL table lacks this field. Consider updating AC1 wording or adding a derived start time if IRIS exposes it in a future version.
- No ObjectScript-side unit test for the dual-format Owner parsing in `LocksList` (pipe-delimited vs plain PID). The fix was verified by the lead during Step 2.5 but has no automated regression test on the IRIS side.

## Deferred from: code review of 6-7-system-configuration-tools (2026-04-07)

- Dynamic annotations via `_meta.readOnly` in config tool response don't affect MCP protocol-level tool hints. The tool is statically marked `destructiveHint: true` to cover the worst-case "set" action. MCP annotations are per-tool, not per-invocation, so this is a known trade-off for single-tool multi-action patterns.
- `GetConfig` for config section reads only 11 hardcoded properties from `Config.config` out of ~70 available. Consider iterating all properties via `%Dictionary.PropertyDefinition` for completeness in a future enhancement.
- No whitelist/validation on property names passed to `SetConfig`. Invalid names are caught by `Config.config.Modify()` returning an error status, so this is defense-in-depth only.
- `ExportConfig` only includes the "config" section data, not startup or locale. Intentional per dev notes but could be expanded to include all sections in a future enhancement.
