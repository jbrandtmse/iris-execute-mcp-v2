# Deferred Work

## Deferred from: code review of 1-1-monorepo-scaffold-and-package-structure (2026-04-05)

- No `license` field in package.json files (root or per-package). The repo has an MIT LICENSE file but the npm package metadata does not declare it. Should be added before first publish.

## Deferred from: code review of 1-2-http-client-configuration-and-authentication (2026-04-05)

- Logger has no log-level filtering mechanism. All levels (ERROR, WARN, INFO, DEBUG) always emit output. A configurable minimum level (e.g., via LOG_LEVEL env var) should be added before production use to avoid debug noise.
- CSRF token is not sent on the first POST/PUT/DELETE if no prior GET has been made. If a consumer's first call is a mutating request, it goes out without CSRF protection. IRIS may reject it. Consider an explicit `connect()` or lazy-init GET.
- `destroy()` does not abort in-flight requests. If requests are pending when `destroy()` is called, they continue to completion. Consider tracking active AbortControllers and aborting them on destroy.
- Logger has no redaction/scrubbing mechanism. If a caller accidentally passes credentials as arguments to `logger.info()`, they will be logged. Consider adding a sanitizer function or warning in the Logger interface docs.

## Deferred from: code review of 1-3-connection-health-and-atelier-version-negotiation (2026-04-05)

- `headRequest` in IrisHttpClient duplicates ~90% of the `request` method logic (auth, cookies, retries, error handling). Refactor to extract shared fetch/error logic into a common private method to reduce maintenance burden and ensure future changes apply uniformly.
- `negotiateVersion` catches all errors with a bare `catch {}` and defaults to v1. This makes it impossible for callers to distinguish "server has no version info" from "authentication failed" or "server returned 403". Consider surfacing error details or returning a richer result type.
- `atelierPath` performs no input validation. Negative or zero version numbers, empty namespace, or empty action produce malformed paths. Consider adding guards or at minimum documenting valid input ranges.
- `requireMinVersion` creates `IrisApiError` with `statusCode: 0` and empty `originalUrl`, which may confuse consumers inspecting error metadata. Consider using a dedicated error type or using meaningful sentinel values.

## Deferred from: code review of 1-4-mcp-server-base-and-tool-registration-framework (2026-04-05)

- `ToolDefinition.outputSchema` is typed as `object` (plain JSON Schema) but the MCP SDK's `registerTool` expects a Zod schema for `outputSchema`. The current code does not pass `outputSchema` to the SDK at all. When a future tool provides `outputSchema`, the types must be reconciled (either change the interface to accept Zod, or convert JSON Schema to Zod before passing to the SDK).
- No integration test exercises the `handleToolCall` validation error path through the server. Zod validation tests only validate schemas directly, not the server's error formatting and logging when invalid args arrive through the MCP protocol.
- `encodeCursor` accepts negative or NaN offset values without validation, producing valid-looking cursors that decode to invalid offsets. Consider adding a guard.
- `addTools` with a duplicate tool name will overwrite the internal Map entry but may throw from the MCP SDK (which checks for existing registrations). Consider checking for duplicates before calling SDK `registerTool`.
