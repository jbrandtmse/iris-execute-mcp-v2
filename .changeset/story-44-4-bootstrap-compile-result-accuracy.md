---
"@iris-mcp/shared": patch
---

fix: the bootstrap names every class that did not compile, from a check that reads no localized text (Story 44.4, DW-685)

- After a compile, `bootstrap()` confirms each embedded class with two reads: the class dictionary (a compiled class and no `ClassCompileError`) and IRIS's own up-to-date flag from `docnames`. A failure is reported as `Compile failed: <k> of <n> classes did not compile: <classes>`, with `compiled: false`; an HTTP 200 compile that wrote a class's Storage and failed another class is no longer reported as compiled.
- After a failed or unverifiable compile the `unconfigured` branch stops before registering the web application (sanction `S-44.4-unconfigured-stop`, wave-9 decision #145), and a `current` start runs the same check, so the failure is reported again on the next start until the classes compile. A clean result is byte-identical; the check adds one `action/query` and one `docnames` request (plus the HTTP client's CSRF pre-flight `HEAD` before the query's POST).
- `@iris-mcp/shared` exports `compileAndVerify()`, `verifyCompiled()` and the type `CompileReport`.

No tool, action, input field, governance key, visibility or description changes.
