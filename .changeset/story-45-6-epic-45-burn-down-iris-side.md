---
"@iris-mcp/shared": minor
"@iris-mcp/admin": minor
"@iris-mcp/data": minor
"@iris-mcp/dev": minor
"@iris-mcp/interop": minor
"@iris-mcp/ops": minor
---

fix: the IRIS-side install methods refuse a read-only SELECT, a least-privilege account reads the web application, the database list reports real fields, and the bootstrap compiles without interoperability (Story 45.6, Epic 45 burn-down)

- `Configure` and `ConfigureMapping` return an error and change nothing when called inside a transaction during a web request, which is how `iris_sql_query` runs a SELECT (`S-45.6-setup-transaction-guard`, DW-786). The automatic install, IPM and an IRIS terminal run them as before; an IPM install started from a web request (such as `zpm` through `iris_execute_command`) is refused the same way, so run `zpm` from a terminal. Under the read-only preset `iris_execute_command` and `iris_execute_classmethod` are off.
- `IsConfigured` falls back to the CSP application lookup for an account that cannot read the web application's definition in `%SYS` (one that cannot switch to `%SYS`, or can but may not read `Security.Applications`), so a least-privilege account reads `current` against an installed side (`S-45.6-isconfigured-lookup`, DW-773). The compile-check warning `Compile failed: 35 of 35 classes did not compile` that such an account sees with the install on is not fixed in this release.
- `iris_database_list` reports `resource`, `readOnly` and `globalJournalState` from `SYS.Database`, and `iris_database_manage` create and modify apply them (`S-45.6-database-fields`, DW-765).
- The uninstall report gives the manual command for a `%ALL` that every record says the install found, and reports a `^UnitTestRoot` in a namespace with no record of its own (`S-45.6-uninstall-report-text`, DW-780).
- The bootstrap compiles `ExecuteMCPv2.REST.Interop` in a namespace that is not interoperability-enabled (DW-787).
- The `Setup` unit classes run in CI (DW-778). `zpm uninstall` leaving the configuration is closed by decision (DW-774).
- `BOOTSTRAP_VERSION` moves from `1.2.0+10.109d0129528f` to `1.2.0+12.bd38d590c26e`. No tool, action, governance key, preset, refusal code or input field is added or changed.
