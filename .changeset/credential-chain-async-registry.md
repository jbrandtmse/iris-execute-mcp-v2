---
"@iris-mcp/shared": patch
---

feat(server-manager): credential chain for Server-Manager-sourced profiles (`IRIS_CREDENTIAL_HELPER`, OS keychain)

A Server Manager connection definition imported via `IRIS_SERVER_MANAGER=auto`/`required` no longer needs an inline password. Any imported definition lacking one is completed by an ordered chain: the OS keychain (`@napi-rs/keyring`, service `iris-mcp`, account `<serverName>`), then `IRIS_CREDENTIAL_HELPER` (a command run with the server name appended as its final argument; trimmed stdout is the password, 10s timeout, no shell). A definition the chain cannot complete is excluded at startup with a log line naming every remediation; under `IRIS_SERVER_MANAGER=required` that becomes a startup failure. No resolved password is ever logged, thrown, or included in `iris_server_profiles` output.

`@napi-rs/keyring` is an **optionalDependency**: when the native module cannot load (unsupported platform, no prebuilt binary, restricted CI image) the keychain link is skipped with a debug line and the chain continues — it never crashes startup.

**API change (`@iris-mcp/shared` consumers only)** — `loadProfileRegistry(env?, platform?)` is now **async**: it returns `Promise<ProfileRegistry>` and gained an optional third `credentialChainDeps` parameter for injecting the keychain/helper seams in tests. The OS-keychain link loads its native module through a guarded dynamic `import()`, which is inherently asynchronous, so the entry point could not stay synchronous. Callers must `await` it:

```diff
-const registry = loadProfileRegistry();
+const registry = await loadProfileRegistry();
```

No MCP server behavior changes: the suite's own call site (`McpServerBase.start()`) was already async. `resolveServerManagerProfiles` now returns `ServerManagerProfileResult[]` (an `IrisProfile` plus `credentialStatus`), which is source-compatible with the previous `IrisProfile[]`.

**Behavior change for existing `IRIS_SERVER_MANAGER` users** — an `intersystems.servers` entry that does **not** declare its own `username` is no longer imported at all (previously it was imported when it carried an inline `password`, silently inheriting the local `IRIS_USERNAME`). Pairing an inherited username with a password destined for a different remote host risks repeated authentication failures that can lock out the account there. Add `"username"` to the entry to restore it; a startup warning names the file and the fix.

With `IRIS_SERVER_MANAGER` unset (the default) nothing here runs: no settings file is read, the chain has nothing to resolve, and the profile registry is byte-for-byte unchanged.
