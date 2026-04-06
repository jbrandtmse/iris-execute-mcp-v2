# Deferred Work

## Deferred from: code review of 1-1-monorepo-scaffold-and-package-structure (2026-04-05)

- No `license` field in package.json files (root or per-package). The repo has an MIT LICENSE file but the npm package metadata does not declare it. Should be added before first publish.

## Deferred from: code review of 1-2-http-client-configuration-and-authentication (2026-04-05)

- Logger has no log-level filtering mechanism. All levels (ERROR, WARN, INFO, DEBUG) always emit output. A configurable minimum level (e.g., via LOG_LEVEL env var) should be added before production use to avoid debug noise.
- CSRF token is not sent on the first POST/PUT/DELETE if no prior GET has been made. If a consumer's first call is a mutating request, it goes out without CSRF protection. IRIS may reject it. Consider an explicit `connect()` or lazy-init GET.
- `destroy()` does not abort in-flight requests. If requests are pending when `destroy()` is called, they continue to completion. Consider tracking active AbortControllers and aborting them on destroy.
- Logger has no redaction/scrubbing mechanism. If a caller accidentally passes credentials as arguments to `logger.info()`, they will be logged. Consider adding a sanitizer function or warning in the Logger interface docs.
