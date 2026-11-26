---
"@iris-mcp/shared": minor
---

feat: a careful uninstall of the IRIS side, and an install record it reads (Story 45.3, sanction `S-45.3-careful-uninstall`, GitHub issue #1 point 3)

- `Do ##class(ExecuteMCPv2.Setup).Uninstall()` in an IRIS terminal (as a user with `%Admin_Manage`) removes the web application, the `%ALL` package mapping, the `ExecuteMCPv2` classes of every namespace that holds a copy the install deployed (shadowed copies included), the `%ALL` namespace only when the install created it and nothing else is mapped in it, `^UnitTestRoot` only where the install set it and its value is unchanged, and the install records last. It reports what it removed, what it left and why (with the manual command), and what failed (with IRIS's text); a repeat run removes nothing more while a copy of the `Setup` class remains, and a failed step keeps the records. Before, it deleted only the web application.
- The install records what it created in `^ExecuteMCPv2.InstallRecord` of each namespace where a step ran (`Configure`, `ConfigureMapping`, `EnsureUnitTestRoot`; the bootstrap and IPM's invokes alike). An install by `1.2.0` or earlier, or one upgraded in place from it, has no record: the command then never removes `%ALL` or `^UnitTestRoot` and names the commands to remove them by hand. A namespace whose copy the install did not deploy (a `dev` copy) and one where IPM installed the classes are left and named.
- `Uninstall` is not an SQL procedure; the five `Setup` methods the bootstrap calls through SQL keep their signature, return type and SQL-procedure flag. IPM order: this command first, then `zpm "uninstall iris-execute-mcp-v2"`. A running server whose automatic install is on puts the IRIS side back, so stop it or set `IRIS_AUTO_INSTALL=false` first.
- `BOOTSTRAP_VERSION` moves from `1.2.0+8.5cedcac20ae9` to `1.2.0+9.db691c6fee3d`. No tool, action, input field, governance key or visibility is added or changed.
