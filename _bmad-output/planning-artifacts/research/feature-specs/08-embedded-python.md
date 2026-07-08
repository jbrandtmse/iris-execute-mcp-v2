# Spec 08 — `iris_python_execute` / `iris_python_env`: Embedded Python Execution

**Server:** `@iris-mcp/dev` (package tools) | **Priority:** 8 (opportunistic; unblocks Spec 09) | **Effort:** ~2 stories
**Governance:** `iris_python_execute` → `mutates: "write"` (**default-disabled** — arbitrary code
execution, same class as `iris_execute_command`); `iris_python_env` → `mutates: "read"` (enabled)
**Prereqs:** none | **Read first:** [`00-conventions.md`](00-conventions.md),
`.claude/rules/iris-objectscript-basics.md` §"Python Integration" (documents the availability-detection
quirk — CRITICAL), `documention/IRIS_Embedded_Python_Complete_Manual.md` (if present),
`src/ExecuteMCPv2/REST/Command.cls` (the I/O-redirect + single-render pattern to copy — Rule #7),
`irislib/%SYS/Python.cls`

## 1. Objective

Execute embedded Python inside IRIS and report the Python environment — opening
ML/data-science workflows and removing the embedding-runtime dependency that gates Spec 09
(semantic search). Deliberately mirrors `iris_execute_command`'s shape, safety posture, and
governance class.

## 2. Tool contracts

### `iris_python_env` (read)

```
scope: "NS"
annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false }
```
Input: `modules?: string[]` (importability check list, e.g. `["numpy","sentence_transformers"]`),
`namespace?`.
Output: `{ available: boolean, version: string|null, reason?: string,
modules: [{name, importable, version?}] }`.

**CRITICAL detection quirk (from project rules):** `##class(%SYS.Python).IsAvailable()` does
NOT exist, and `GetPythonVersion()` only reports Python that is *already loaded*. Correct
sequence: attempt `##class(%SYS.Python).Import("sys")` inside Try/Catch; on success read
`GetPythonVersion()`; on failure report `available:false` with the sanitized reason. Module
checks: per-module `Import(name)` in its own Try/Catch; version via the imported module's
`__version__` where present `[PROBE: verify attribute access syntax from ObjectScript on the
live instance — builtins/getattr pattern — before coding]`.

### `iris_python_execute` (write, default-disabled)

```
scope: "NS"
annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
```
Input: `code: string` (Python source, multi-line), `timeout?: number` (seconds, default 120),
`namespace?`.
Output: `{ output: string, result?: string, errored: boolean, error?: string }` where `output`
is captured stdout/stderr and `result` is the repr of the last expression when feasible.

## 3. ObjectScript work — MANDATORY probe first (Rule #16)

New routes `POST /dev/python/execute`, `POST /dev/python/env` in `Dispatch.cls` → new
`Python.cls` REST handler class.

**Story-0-style probe (fold into Story 1):** the exact execution mechanism must be pinned on
the live instance before coding. Candidates to probe with a disposable `ExecuteMCPv2.Temp`
class, in order of preference:
1. `%SYS.Python` `Run(...)` / exec-style entry points — enumerate what exists in
   `irislib/%SYS/Python.cls` on the installed version.
2. `builtins` pattern: `Set tBuiltins = ##class(%SYS.Python).Import("builtins")`, build a
   namespace dict, `tBuiltins.exec(code, globals)` — pin the exact calling convention and how
   stdout is captured (probe `io.StringIO` + `contextlib.redirect_stdout` composed from
   ObjectScript).
3. Whichever works, capture: multi-line code, syntax-error shape, runtime-exception shape,
   stdout capture fidelity, and whether execution can hang the CSP process (informs the
   timeout note below).

**Handler requirements:** standard skeleton (conventions §3). Output capture follows the
Command.cls I/O-redirect discipline ONLY if the probe shows Python writes reach the
ObjectScript device (it may not — Python stdout capture likely happens Python-side via
StringIO; prefer that). Timeout: enforce via the existing HTTP-client timeout plumbing; the
tool description MUST document that a hung Python execution can occupy a CSP worker (same
caveat class as `iris_execute_command`). Errors: sanitized, no caret-globals (Rule #33), and
the Python traceback (a legitimate diagnostic) passed through inside `error` after
`SanitizeError` — verify the traceback survives sanitization (Rule #33 strips carets; Python
tracebacks contain none — one test asserts a traceback round-trips readably).

## 4. Story breakdown

1. **Story 1 — probe + ObjectScript (1):** probe per §3 (record findings in story file, delete
   probe class); `Python.cls` handlers + `%UnitTest` tests (env on this instance; execute happy
   path `print(1+1)`; syntax error; runtime exception; module check hit+miss). Deploy loop +
   bootstrap regen.
2. **Story 2 — TS tools + docs + smokes (1):** two tool files (or one `python.ts`), registration
   + counts, `mutates` map + governance tests (execute default-disabled — Rule #28/#30),
   unit tests, docs rollup (execute's default-disabled status + enable snippet + hazard note on
   every doc surface), live smokes: `iris_python_env` on live instance; `iris_python_execute`
   REFUSED under empty governance (Rule #26); enabled via `IRIS_GOVERNANCE` → numpy (or
   stdlib-only if numpy absent) round-trip; **graceful-degradation smoke on a Python-less
   instance/namespace if available, else record residual risk (Rule #34 spirit)**.

## 5. Acceptance criteria

1. `iris_python_env` correctly reports availability using the Import-first sequence (never
   `GetPythonVersion()` alone), module importability, and versions where accessible.
2. `iris_python_execute` runs multi-line code with captured stdout; syntax and runtime errors
   return `errored:true` with a readable traceback, never a raw HTTP 500.
3. Execute is default-disabled; refusal verified live; enable-via-policy verified live.
4. On an instance without embedded Python: env reports `available:false` with actionable
   reason; execute returns a clear capability error (not a crash).
5. Timeout parameter honored (`time.sleep`-based test within CI-tolerable bounds).
6. Probe findings recorded; probe classes deleted; conventions §6 checklist complete.

## 6. Out of scope (v1)

- pip/package installation (OS-level operation; document the manual `irispip` route in the
  tool description instead).
- Persistent Python sessions/state across calls; notebooks.
- `[Language = python]` class-method authoring helpers (the doc tools already write classes).
