---
"@iris-mcp/shared": minor
"@iris-mcp/admin": minor
"@iris-mcp/data": minor
"@iris-mcp/dev": minor
"@iris-mcp/interop": minor
"@iris-mcp/ops": minor
---

fix: install-off profiles read a restamped IRIS side as current, the startup bootstrap follows the `default` profile, `block` turns off `iris_sql_analyze` stats, running and advise, a least-privilege account compiles without a false warning, the bootstrap reads the status `Configure` returns, and a failed IPM install no longer breaks the namespace table (Story 45.7, Epic 45 burn-down)

- With the automatic install off, a deployed marker whose hash equals this build's reads `current` whatever its semver and sequence, so a release that only restamps the version needs no IRIS-side upgrade (`S-45.7-same-classes-current`, DW-770). A marker with another hash is refused as before, and with the install on nothing changes. After a release that changes the IRIS-side classes (its CHANGELOG says so in its IRIS side section), the one administrator upgrade is still needed.
- The startup bootstrap uses the namespace, host and port of an `IRIS_PROFILES` `default` entry, as the default profile's client and tools already did (`S-45.7-default-profile-bootstrap`, DW-767).
- `IRIS_DATA_POLICY=block` also turns off `iris_sql_analyze` `stats`, `running` and `advise`, which return other sessions' statement text or bound literals; the covered set is 15 keys (`S-45.7-block-sql-analyze`, DW-784). `explain` and `indexUsage` stay on, and nothing changes under `redact`, `allow` or an unset policy except that the dev server's startup warning also names the three keys.
- The compile check reads the up-to-date flag through Atelier's `action/index` for the classes the filtered document list leaves out, so a least-privilege account no longer logs `Compile failed: 35 of 35 classes did not compile` (`S-45.7-compile-check-index`, DW-788). The verdicts of `iris_doc_compile`, `iris_doc_load` and `iris_env_promote` for such an account change from a false "not confirmed" to the right answer.
- The bootstrap reads the status IRIS returns for `Configure` and `ConfigureMapping` (`%ODBCOUT`), so a refused call reports `configured: false` with IRIS's text instead of `true` (`S-45.7-configure-status`, DW-790).
- Inside an IPM install's transaction, `ConfigureMapping` keeps `%ALL`, the mapping and their install record out of the rollback, so a failed install leaves them in place, consistent, and `Setup.Uninstall()` removes them (`S-45.7-mapping-survives-rollback`, DW-792). For an instance a failed install of an earlier release left broken, run `Do ##class(Config.Namespaces).ActivateAll()` in `%SYS`.
- `iris_sql_analyze` `advise` in workload mode advises the SELECT inside the `DECLARE <cursor> CURSOR FOR <select>` that IRIS 2026.2 stores for dynamic SQL (EXPLAIN rejects a `DECLARE`, so every statement failed for every account); an account without SQL privilege on a table is still refused by IRIS for those statements, and the all-failed error now quotes IRIS's text and names the privilege (DW-793).
- The startup warning for an `unconfigured` reading says `The web application lookup failed, or the web application is not registered.` (DW-791). `SECURITY.md` gains two wording changes.
- `BOOTSTRAP_VERSION` moves from `1.2.0+12.bd38d590c26e` to `1.2.0+13.864f12b75f7b`. No tool, action, governance key, preset, refusal code or input field is added or changed.
