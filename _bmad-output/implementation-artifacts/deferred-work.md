# Deferred Work

## Deferred from: code review of 1-1-monorepo-scaffold-and-package-structure (2026-04-05)

- No `license` field in package.json files (root or per-package). The repo has an MIT LICENSE file but the npm package metadata does not declare it. Should be added before first publish.

## Deferred from: code review of 1-2-http-client-configuration-and-authentication (2026-04-05)

- Logger has no log-level filtering mechanism. All levels (ERROR, WARN, INFO, DEBUG) always emit output. A configurable minimum level (e.g., via LOG_LEVEL env var) should be added before production use to avoid debug noise.
- ~~CSRF token is not sent on the first POST/PUT/DELETE if no prior GET has been made.~~ **RESOLVED in Story 2.0:** `ensureCsrfToken()` performs HEAD preflight before first mutating request.
- `destroy()` does not abort in-flight requests. If requests are pending when `destroy()` is called, they continue to completion. Consider tracking active AbortControllers and aborting them on destroy.
- Logger has no redaction/scrubbing mechanism. If a caller accidentally passes credentials as arguments to `logger.info()`, they will be logged. Consider adding a sanitizer function or warning in the Logger interface docs.

## Deferred from: code review of 1-3-connection-health-and-atelier-version-negotiation (2026-04-05)

- ~~`headRequest` in IrisHttpClient duplicates ~90% of the `request` method logic.~~ **RESOLVED in Story 2.0:** Shared logic extracted into `executeFetch()` private method.
- `negotiateVersion` catches all errors with a bare `catch {}` and defaults to v1. This makes it impossible for callers to distinguish "server has no version info" from "authentication failed" or "server returned 403". Consider surfacing error details or returning a richer result type.
- `atelierPath` performs no input validation. Negative or zero version numbers, empty namespace, or empty action produce malformed paths. Consider adding guards or at minimum documenting valid input ranges.
- `requireMinVersion` creates `IrisApiError` with `statusCode: 0` and empty `originalUrl`, which may confuse consumers inspecting error metadata. Consider using a dedicated error type or using meaningful sentinel values.

## Deferred from: code review of 1-4-mcp-server-base-and-tool-registration-framework (2026-04-05)

- ~~`ToolDefinition.outputSchema` is typed as `object` (plain JSON Schema) but the MCP SDK expects Zod.~~ **RESOLVED in Story 2.0:** Changed to `ZodObject<any>` and `registerTool` passes `.shape` to SDK.
- No integration test exercises the `handleToolCall` validation error path through the server. Zod validation tests only validate schemas directly, not the server's error formatting and logging when invalid args arrive through the MCP protocol.
- `encodeCursor` accepts negative or NaN offset values without validation, producing valid-looking cursors that decode to invalid offsets. Consider adding a guard.
- `addTools` with a duplicate tool name will overwrite the internal Map entry but may throw from the MCP SDK (which checks for existing registrations). Consider checking for duplicates before calling SDK `registerTool`.

## Deferred from: code review of 1-5-shared-package-integration-tests (2026-04-05)

- Windows-specific network timeout behavior: The connection error test for invalid host uses RFC 5737 TEST-NET IP (192.0.2.1) which may behave differently on Windows vs Linux (faster ICMP reject vs true timeout). The 2-second timeout and 3-second assertion bound may not hold on all Windows configurations. Consider platform-specific timeout adjustments or skip annotation for Windows CI runners.

## Deferred from: code review of 2-1-iris-dev-mcp-package-setup-and-server-entry-point (2026-04-05)

- No unit tests for `resolveTransport()` function in `src/index.ts`. The function has multiple code paths (CLI `--transport` flag, `--transport=` form, `MCP_TRANSPORT` env var, default fallback) that are not tested. Currently not easily testable since it reads `process.argv` and `process.env` directly and is not exported. Consider exporting it or extracting into a testable module.
- No unit tests for the entry point bootstrap flow (`server.start().catch()` pattern). This would require mocking the full startup sequence including `loadConfig`, health check, and transport connection.
- Package `exports` field in `package.json` advertises importable paths (`"."`) but `src/index.ts` has no exports (it is a side-effect-only CLI entry point). If another package imports from `@iris-mcp/dev`, they get an empty module. Consider whether the `exports` field should be removed or a separate library entry point should be created.

## Deferred from: code review of 2-2-document-crud-tools (2026-04-05)

- Batch delete uses individual DELETE calls instead of the Atelier batch endpoint (`DELETE /api/atelier/v{N}/{ns}/docs` with body array). This is because `IrisHttpClient.delete()` does not accept a body parameter. Consider adding a `deleteWithBody()` method to IrisHttpClient in a future story to support the batch endpoint for better performance with large deletions.
- No input validation/sanitization on document name path parameter. Names like `../../etc/passwd` or `foo?bar=baz` are interpolated directly into the URL path. The Atelier API will likely reject malformed names, but client-side validation would provide earlier, clearer error messages.
- `ctx.paginate()` is not available on ToolContext, so `iris.doc.list` cannot paginate large result sets as specified in the story tasks. The `paginate` method lives on McpServerBase, not ToolContext. Consider adding a `paginate` function to ToolContext or passing it via a callback in a future story.

## Deferred from: code review of 2-3-document-metadata-and-modified-tracking (2026-04-05)

- `metadataOnly` combined with `format` parameter silently ignores the `format` option. If both are provided, `format` has no effect because the `metadataOnly` branch returns early before building query parameters. Consider either documenting this behavior or returning a validation error when both are set.
- No unit test for `metadataOnly` with a `namespace` override. The code path is identical to the non-metadata path (uses `resolveNamespace` the same way), so risk is low, but adding a test would improve coverage symmetry with the `modifiedSince` + namespace test.

## Deferred from: code review of 2-4-compilation-tools (2026-04-05)

- Test helper duplication across test files (`createMockHttp`, `createMockCtx`, `envelope` in both `compile.test.ts` and `doc.test.ts`). Consider extracting shared test helpers into a common test utility module to reduce maintenance burden and ensure consistency.
