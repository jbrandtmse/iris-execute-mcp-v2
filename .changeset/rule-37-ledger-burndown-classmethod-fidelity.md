---
"@iris-mcp/shared": patch
"@iris-mcp/dev": patch
"@iris-mcp/client-config": patch
"@iris-mcp/admin": patch
"@iris-mcp/data": patch
"@iris-mcp/interop": patch
"@iris-mcp/ops": patch
"@iris-mcp/all": patch
---

fix: Rule #37 ledger burn-down — classmethod-fidelity redirect teardown, `/classmethod` schema tightening, client-config write-engine hardening, and test output kept out of every published tarball (Story 36.3)

`ExecuteMCPv2.REST.Command` (ObjectScript, embedded via `@iris-mcp/shared`'s bootstrap): a new shared `TeardownRedirect` helper runs each step of the `/command`/`/classmethod` output-capture teardown — disable the redirect, `Use` the original device, `Close` the scratch device — independently, so a failing `Use` no longer skips the `Close`. Closing the capture device returns `$IO` to the request's own response stream, so a response can no longer land on the scratch device as an HTTP 200 with an empty body. Both outer error handlers now also clear both process-private capture variables (housekeeping: a stale value was never observable, because every request resets them before capturing). `BOOTSTRAP_VERSION`: `e1168c1ebe56` → `8465393b3f74`.

`iris_execute_classmethod` (`@iris-mcp/dev`): the `args` array's JSON Schema now matches the server's own contract (a scalar, or a `{byRef, value?}` marker) instead of accepting anything. Every documented form is still accepted; a malformed entry is now rejected at the schema layer, not only server-side. The description now states that omitting `args` and passing `[]` are the same zero-argument call, and documents a capture caveat: a target that KILLs the capture variables (an argumentless `KILL`, or a unit-test class's setup/teardown) silently loses what was captured — run unit-test suites with `iris_execute_tests`. The `execute-classmethod-epic-gate.test.ts` live gate's 20-argument leg now checks every position, and a new "repro 3b" leg covers several `ZN` switches interleaved with narration and a `ByRef` mutation.

`@iris-mcp/client-config`:
- **Fixed a config-corrupting update:** applying to a Codex entry that had only a `command` line placed the new `args` line inside the new `[mcp_servers.<name>.env]` table (read back as `env.args`, a still-valid but wrong file). An entry whose first line was `args` could also lose the inserted `command`.
- **CRLF files keep CRLF on every written line.** This covers insert, set-flag and merge-update, including a first write into a `config.toml` with no MCP table yet and files with no trailing newline.
- A stale stash record left after a no-op `enable` is now dropped. Backup filenames disambiguate when two writes land in the same millisecond, and `doctor` ages those disambiguated backups too.
- A hand-edited native `disabled` flag is read per the real client's own truthiness rules.
- Duplicate JSON/JSONC keys are flagged where they make the manager's view ambiguous: a duplicated root key, a duplicate server name, or a duplicate key inside a manager-owned entry. A duplicated unrelated setting elsewhere in a hand-edited settings file no longer blocks the manager.
- A canonical-named entry holding a non-object value now reports as mis-shaped, with repair guidance for its own format.
- A merge-update now carries a changed line's trailing comment forward. It edits env sub-table keys individually, so untouched keys and their comments survive.
- `doctor` handles `$$` (PID) runs correctly in shell-style references and no longer hides Claude-style `$${VAR}` references. Its entry walk is bounded.
- The `certify` script gained a tested restore-ladder decision, a word-boundary-safe evidence excerpt, `--skip-agent` for the claude-code verifier, a dangling-symlink refusal, and a tested argument parser: a trailing valueless `--residual-risk` no longer erases a recorded residual risk.
- One item (`33-1-R3`, JSONC comments inside a manager-owned entry) is accepted as a documented limitation; see `packages/client-config/README.md`.

**Packaging (every publishable package):** compiled test files (`dist/**/__tests__`) are excluded from each tarball through the package's `"files"` list. Test files stay fully type-checked by `type-check` and `build`. `npm pack --dry-run` and `pnpm pack` show zero `__tests__` files in all seven publishable packages. `@iris-mcp/all`, a dependency-only meta-package, had no `"files"` list and shipped its whole `src/` tree; it now ships only its manifest, README and licence.

This closes the 45 items carried at Rule #37 count 2 to a terminal disposition (resolved, closed-with-evidence, or closed-by-decision). See `deferred-work.md`'s "Story 36.3 burn-down" section and its code-review corrections for the per-item evidence.
