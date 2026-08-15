---
"@iris-mcp/shared": patch
"@iris-mcp/dev": patch
---

fix(execute): `truncated` reaches the error path; `iris_execute_tests` guards class/method zero-result runs (Story 34.5, `34-4-R4`/`34-4-R10`)

`IrisApiError` (`@iris-mcp/shared`) gains a 5th, optional, additive constructor parameter — `result` — which preserves the Atelier envelope's `result` payload at the two envelope-bearing throw sites in `http-client.ts` (an HTTP error status, and an Atelier-level `status.errors[]` failure on HTTP 200). Every existing 3- and 4-argument call site across the codebase is unaffected; `result` is simply `undefined` for them, same as before.

`iris_execute_command` and `iris_execute_classmethod` (`@iris-mcp/dev`) now surface `truncated` in their error response's `structuredContent` (e.g. `{"truncated": false}` alongside `"isError": true`) whenever the underlying `/command`/`/classmethod` REST error envelope carried the flag (Story 34.4's server-side work). `structuredContent` is omitted entirely — not set to `undefined` or `false` — on any error whose envelope never carried it (a request rejected before capture began, or a server predating Story 34.4), so an ordinary error response is byte-identical to today's shape. A transport-level failure such as a refused connection raises a connection error instead of a tool error response, and is unaffected. Verified live against the real `/command` endpoint.

`iris_execute_tests` gains a zero-result guard on the `class` and `method` levels, mirroring the guard `package` already had: a run that drains zero method-level rows (a typo'd class or method name, or a `class:method` spec the runner doesn't match) now returns an explicit `error` field naming the target and level, instead of a silent `total: 0, passed: 0, failed: 0` indistinguishable from a genuine clean run. A matching run's response shape (`total`/`passed`/`failed`/`skipped`/`details`) is unchanged. Verified live against the real Atelier `/work` unittest endpoint for both a nonexistent class and a nonexistent method on a real class, and confirmed a genuine match still reports real counts.

`iris_execute_tests` at `level: "method"` also now normalizes the `Test`-prefixed method name (the form its own schema, and the README, document) against the Atelier endpoint's `methods` filter, which matches only the unprefixed form — and restores the prefix on every result row, at all three levels. Without this, the documented `ClassName:TestMethodName` call shape drained zero rows against the real endpoint; combined with the zero-result guard above, a correct, documented call would have reported a misleading "No tests found" instead of real results. Verified live.

**Behavior change worth noting on upgrade:** because the prefix is restored on every result row, a *successful* run's `details[].method` values now change at all three levels — a method previously reported as `"Validate"` is now reported as `"TestValidate"`, its real ObjectScript name. The response *shape* (`total`/`passed`/`failed`/`skipped`/`details`) is unchanged, and the new values are the ones this tool's schema and README have always documented (the previous stripped values matched no real method and were an unreported leak of the Atelier wire format). A consumer matching on `details[].method` string values should expect the prefixed form.

The zero-result guard also distinguishes "nothing matched" from "the run failed before any method could execute": when the runner reports a class-level failure (for example an `OnBeforeAllTests` error), that reason is surfaced in the `error` field instead of the generic "No tests found", so a setup failure is never misreported as a bad target name. The guard now covers `package` as well — previously a package whose classes were discovered but whose run drained zero method rows still returned a silent `total: 0`.

Both fixes close out `34-4-R4` and `34-4-R10`, escalated to this story by Project Lead review of Story 34.4.
