# Deferred Work

## Deferred from: code review of 1-1-monorepo-scaffold-and-package-structure (2026-04-05)

- No `license` field in package.json files (root or per-package). The repo has an MIT LICENSE file but the npm package metadata does not declare it. Should be added before first publish.

## Deferred from: code review of 1-2-http-client-configuration-and-authentication (2026-04-05)

- ~~Logger has no log-level filtering mechanism.~~ **RESOLVED in Story 5.0:** Added `LogLevel` enum, `parseLogLevel()`, and `LOG_LEVEL` env var filtering.
- ~~CSRF token is not sent on the first POST/PUT/DELETE if no prior GET has been made.~~ **RESOLVED in Story 2.0:** `ensureCsrfToken()` performs HEAD preflight before first mutating request.
- ~~`destroy()` does not abort in-flight requests.~~ **RESOLVED in Story 5.0:** `IrisHttpClient.destroy()` now aborts all active AbortControllers before clearing state.
- Logger has no redaction/scrubbing mechanism. If a caller accidentally passes credentials as arguments to `logger.info()`, they will be logged. Consider adding a sanitizer function or warning in the Logger interface docs.

## Deferred from: code review of 1-3-connection-health-and-atelier-version-negotiation (2026-04-05)

- ~~`headRequest` in IrisHttpClient duplicates ~90% of the `request` method logic.~~ **RESOLVED in Story 2.0:** Shared logic extracted into `executeFetch()` private method.
- `negotiateVersion` catches all errors with a bare `catch {}` and defaults to v1. This makes it impossible for callers to distinguish "server has no version info" from "authentication failed" or "server returned 403". Consider surfacing error details or returning a richer result type.
- ~~`atelierPath` performs no input validation.~~ **RESOLVED in Story 5.0:** Now validates version (positive integer), namespace (non-empty), and action (non-empty).
- `requireMinVersion` creates `IrisApiError` with `statusCode: 0` and empty `originalUrl`, which may confuse consumers inspecting error metadata. Consider using a dedicated error type or using meaningful sentinel values.

## Deferred from: code review of 1-4-mcp-server-base-and-tool-registration-framework (2026-04-05)

- ~~`ToolDefinition.outputSchema` is typed as `object` (plain JSON Schema) but the MCP SDK expects Zod.~~ **RESOLVED in Story 2.0:** Changed to `ZodObject<any>` and `registerTool` passes `.shape` to SDK.
- No integration test exercises the `handleToolCall` validation error path through the server. Zod validation tests only validate schemas directly, not the server's error formatting and logging when invalid args arrive through the MCP protocol.
- ~~`encodeCursor` accepts negative or NaN offset values without validation.~~ **RESOLVED in Story 5.0:** Now throws for negative or NaN offsets.
- `addTools` with a duplicate tool name will overwrite the internal Map entry but may throw from the MCP SDK (which checks for existing registrations). Consider checking for duplicates before calling SDK `registerTool`.

## Deferred from: code review of 1-5-shared-package-integration-tests (2026-04-05)

- Windows-specific network timeout behavior: The connection error test for invalid host uses RFC 5737 TEST-NET IP (192.0.2.1) which may behave differently on Windows vs Linux (faster ICMP reject vs true timeout). The 2-second timeout and 3-second assertion bound may not hold on all Windows configurations. Consider platform-specific timeout adjustments or skip annotation for Windows CI runners.

## Deferred from: code review of 2-1-iris-dev-mcp-package-setup-and-server-entry-point (2026-04-05)

- ~~No unit tests for `resolveTransport()` function.~~ **RESOLVED in Story 5.0:** `resolveTransport` moved to `@iris-mcp/shared` with 7 unit tests.
- No unit tests for the entry point bootstrap flow (`server.start().catch()` pattern). This would require mocking the full startup sequence including `loadConfig`, health check, and transport connection.
- Package `exports` field in `package.json` advertises importable paths (`"."`) but `src/index.ts` has no exports (it is a side-effect-only CLI entry point). If another package imports from `@iris-mcp/dev`, they get an empty module. Consider whether the `exports` field should be removed or a separate library entry point should be created.

## Deferred from: code review of 2-2-document-crud-tools (2026-04-05)

- Batch delete uses individual DELETE calls instead of the Atelier batch endpoint. Consider adding a `deleteWithBody()` method to IrisHttpClient in a future story.
- ~~No input validation/sanitization on document name path parameter.~~ **RESOLVED in Story 5.0:** `validateDocName()` rejects names containing `..` or starting with `/`.
- ~~`ctx.paginate()` is not available on ToolContext.~~ **RESOLVED in Story 3.0:** Added `paginate()` to ToolContext interface and `buildToolContext()`.

## Deferred from: code review of 2-3-document-metadata-and-modified-tracking (2026-04-05)

- `metadataOnly` combined with `format` parameter silently ignores the `format` option. Consider either documenting this behavior or returning a validation error when both are set.
- No unit test for `metadataOnly` with a `namespace` override.

## Deferred from: code review of 2-4-compilation-tools (2026-04-05)

- ~~Test helper duplication across test files.~~ **RESOLVED in Story 3.0.**

## Deferred from: code review of 2-6-document-format-and-xml-tools (2026-04-05)

- Duplicated body construction logic in `docXmlExportTool` handler. Consider extracting a shared helper.
- Missing error propagation test for `docXmlExportTool`.

## Deferred from: code review of 2-7-sql-execution-and-server-info (2026-04-05)

- Client-side `maxRows` truncation in `iris.sql.execute` fetches all rows before slicing. Consider server-side row limit.
- ~~Test helper duplication.~~ **RESOLVED in Story 3.0.**

## Deferred from: code review of 3-0-epic-2-deferred-cleanup (2026-04-06)

- Mock `createMockCtx()` paginate function ignores cursor and pageSize arguments. Low priority since server-base.test.ts covers pagination logic in isolation.
- No integration test verifying `iris.doc.list` correctly forwards cursor through `ctx.paginate()`. Low priority.
- ~~Invalid/corrupted cursor values silently decode to offset 0.~~ **ACKNOWLEDGED:** Pre-existing behavior; decodeCursor now rejects negative offsets, and paginate signals pastEnd for out-of-bounds cursors (Story 5.0).

## Deferred from: code review of 3-1-objectscript-rest-dispatch-and-utils-classes (2026-04-06)

- ~~Stub handler catch blocks do not call RenderResponseBody.~~ **RESOLVED in Story 3.2.**

## Deferred from: code review of 3-2-global-operations-rest-handler-and-tools (2026-04-06)

- ~~ListGlobals has no pagination or max-count safeguard.~~ **DOCUMENTED in Story 5.0:** Tool description now notes client-side pagination limitation.
- BuildGlobalRef comma-separated subscript parsing cannot handle subscript values containing commas. Inherent limitation.

## Deferred from: code review of 3-3-objectscript-execution-rest-handler-and-tools (2026-04-06)

- AC2 specifies ByRef/Output parameter support for classmethod handler but current implementation only captures return values. Consider adding ByRef support in a future enhancement.

## Deferred from: code review of 4-0-epic-3-deferred-cleanup (2026-04-06)

- `./test-helpers` subpath export points to raw TypeScript source files rather than compiled dist output. Works in monorepo but would break for external consumers.
- ~~`iris.global.list` pagination is client-side.~~ **DOCUMENTED in Story 5.0:** Tool description updated.
- ~~`decodeCursor` with offset beyond array length produces empty page without error.~~ **RESOLVED in Story 5.0:** `paginate()` now sets `pastEnd: true` flag.

## Deferred from: code review of 4-1-iris-admin-mcp-package-setup-and-server-entry-point (2026-04-06)

- ~~`resolveTransport()` logic is duplicated between iris-dev-mcp and iris-admin-mcp.~~ **RESOLVED in Story 5.0:** Moved to `@iris-mcp/shared`, both packages import from there.
- Invalid CLI `--transport` values are silently ignored without warning. Consider adding a warning for unrecognized CLI transport values.

## Deferred from: code review of 4-2-namespace-and-database-management-tools (2026-04-06)

- AC4 specifies "returns all databases with size, free space, and mount status" but `Config.Databases.Get` does not expose a free space property. Consider adding free space in a future enhancement.

## Deferred from: code review of 4-3-namespace-mapping-tools (2026-04-06)

- ~~`tProps` not killed between loop iterations in `MappingList`.~~ **RESOLVED in Story 5.0:** Added `Kill tProps` before each `Get` call in MappingList, NamespaceList, and DatabaseList.

## Deferred from: code review of 4-4-user-and-password-management-tools (2026-04-06)

- ~~`UserPassword` validate action uses `$Replace(tMsg, tPassword, "***")` to strip the password.~~ **RESOLVED in Story 5.0:** Enhanced with progressive fragment stripping to handle IRIS-reformatted error text.
- `UserRoles` does not validate that `role` is non-whitespace. Low priority.
- GET requests to `/security/user/roles` or `/security/user/password` match the wildcard route. Cosmetic issue.

## Deferred from: code review of 4-5-role-and-resource-management-tools (2026-04-06)

- ~~`PermissionCheck` does not check user's directly-assigned resources.~~ **RESOLVED in Story 5.0:** Now checks `$Get(tUserProps("Resources"))` before iterating roles.

## Deferred from: code review of 4-6-web-application-management-tools (2026-04-06)

- ~~`WebAppManage` duplicates 11 lines of property-mapping logic.~~ **RESOLVED in Story 5.0:** Extracted to `BuildWebAppProps` helper method.

## Deferred from: code review of 4-8-oauth2-management-tools (2026-04-06)

- The TypeScript `oauthManageTool` handler passes through the entire response without client-side stripping of sensitive fields. Defense-in-depth only since IRIS backend correctly excludes secrets.

## Deferred from: code review of 4-9-iris-admin-mcp-unit-and-integration-tests (2026-04-06)

- `probeCustomRest` in `integration-setup.ts` uses duck-typing instead of `instanceof IrisApiError`. Low priority cosmetic improvement.

## Deferred from: code review of 5-0-epic-4-deferred-cleanup (2026-04-06)

- `pastEnd` flag added to `PaginateResult` and set in `paginate()` (server-base.ts) but no tool handler currently checks or returns it to the MCP client. The flag is available for future consumers but has no effect today.

## Deferred from: code review of 5-2-production-lifecycle-tools (2026-04-06)

- `ProductionControl` tTimeout=0 is silently overridden to 120. If a user explicitly passes `timeout: 0`, the intent may be "no wait" but the code treats it as "use default". Consider distinguishing null/undefined from explicit zero.
- `ProductionSummary` inner catch block (per-namespace iteration) swallows all errors silently, including security violations. Consider logging skipped namespaces or including them in the response with an error reason.
- `ProductionManage` uses `%Dictionary.ClassDefinition.%ExistsId` to check existence, which matches any class definition, not specifically production classes. A non-production class with the same name would produce misleading errors.
- `productionControlTool` Zod schema marks `name` as optional for all actions, but start/restart require it server-side. Consider adding a `.refine()` for client-side validation.

## Deferred from: code review of 5-3-production-item-and-auto-start-tools (2026-04-06)

- `ItemManage` "set" action silently ignores unknown settings keys. If a caller passes an unrecognized key (e.g., `{ "badKey": 1 }`), it is skipped without feedback. Consider returning a list of unrecognized keys in the response.
- `ItemManage` "set" action: If `tItem.%Save()` succeeds but `Ens.Director.UpdateProduction()` fails, the persisted config and the running production are out of sync. Pre-existing IRIS pattern limitation -- no simple rollback mechanism.
