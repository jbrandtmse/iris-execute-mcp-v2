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
