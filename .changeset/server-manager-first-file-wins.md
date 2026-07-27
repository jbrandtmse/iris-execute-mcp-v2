---
"@iris-mcp/shared": patch
---

fix(server-manager): first-file-wins precedence, `required` collision check, host/pathPrefix validation (Story 32.3 deferred-work burn-down)

**Behavior change for `IRIS_SERVER_MANAGER` users — multi-file precedence is now first-file-wins, always** (deferred items 31-1-2/31-3-3, one recorded decision): when the same server name is defined in more than one settings file, the Story 31.1 "rescue" — a lower-precedence file's entry carrying a deprecated inline password replacing the higher-precedence definition wholesale (host, port and username included) — is removed. The higher-precedence definition now always wins, and a skipped password-bearing definition is announced with a startup warning naming both files' hosts and the remedy (`iris-mcp-credentials set <name>` completes the winning definition via the OS keychain). The credential chain resolves by name, so an unresolved higher-precedence entry was never a dead one — completing it via the keychain is the recommended shape.

Other hardening in the same pass:

- `IRIS_SERVER_MANAGER=required` now also fails startup when **every** imported definition is discarded by a name collision with an env/`IRIS_PROFILES`/reserved-`default` profile (previously the server started degraded, env-only, despite `required`).
- `mergeProfile` host validation now rejects a `host` containing `@`, `/`, or whitespace (URL userinfo such as `admin:hunter2@host` must never land in `baseUrl` or the `iris_server_profiles` roster). Shared by `IRIS_PROFILES` and Server-Manager entries; the error never echoes the received value.
- A `webServer.pathPrefix` still containing `?`, `#`, `//`, or `:` after normalization is ignored with a warning (previously it composed a malformed `baseUrl` authority and every call 404'd with no diagnostic).
- Structurally unusable `intersystems.servers` entries (non-object, no `webServer`, blank host) now produce one warning per entry naming file + server + reason, and count toward `required`'s "considered" tally — the honest third check fires instead of the misleading "zero definitions found".
- Discovery candidates are always absolute paths, so a relative `IRIS_SM_SETTINGS_PATHS`/`IRIS_SM_WORKSPACE` no longer yields a CWD-relative `sourceFile`.
- The "N profile(s) have no password yet" debug summary moved to `loadProfileRegistry` (post collision-filter), so names discarded before the credential chain are no longer counted as "will be attempted".

With `IRIS_SERVER_MANAGER` unset (the default) nothing here runs: no settings file is read and the profile registry is byte-for-byte unchanged.

The same burn-down also hardened the `iris-mcp-credentials` CLI (32-3-R12 — these user-facing changes ship under this same bump and were previously omitted here):

- **`set --stdin` input guards.** Stdin past 64 KiB now fails with exit 2 naming the cap (previously an unbounded allocation), and input whose decoded text contains a NUL (U+0000) — almost certainly UTF-16, what PowerShell's `Out-File` produces on some hosts — is rejected with exit 2 naming the likely cause and the fix (previously stored NUL-interleaved and reported as success). Both are new exit-2 error paths; neither writes the keychain.
- **`test --connect` reports the real credential provenance** via a new `connect.credentialSource` field (`env`/`server-manager`), and `connect.ok` is now `boolean | null` — `null` (with `attempted: false`) when the probe never ran because registry resolution already failed (previously `ok: false` conflated "probe failed" with "probe never ran" — a wire-shape change to the JSON output).
- **`set` distinguishes create from replace**: "Replaced the existing password for …" vs "Stored a password for …", so a silent overwrite is no longer indistinguishable from a fresh store.
- `test --connect` now says WHICH credential the probe exercised — the registry profile's password (named in the human output, with its provenance in `connect.credentialSource`) — which can differ from the chain-resolved credential reported in `source` (e.g. a stale `IRIS_PASSWORD` vs a fresh keychain entry).
