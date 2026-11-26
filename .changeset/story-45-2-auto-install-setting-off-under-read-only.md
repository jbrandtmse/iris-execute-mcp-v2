---
"@iris-mcp/shared": minor
"@iris-mcp/admin": minor
"@iris-mcp/data": minor
"@iris-mcp/dev": minor
"@iris-mcp/interop": minor
"@iris-mcp/ops": minor
---

feat: the automatic install of the IRIS side is a setting, and the read-only preset turns it off (Story 45.2, sanction `S-45.2-read-only-no-install`, GitHub issue #1 point 3)

- New variable `IRIS_AUTO_INSTALL` (`true` or `false`, any letter case; empty is unset) and a per-profile `autoInstall` field in `IRIS_PROFILES` (a JSON boolean). For each profile the first of these wins: the profile's own `autoInstall`, then `IRIS_AUTO_INSTALL`, then `IRIS_GOVERNANCE_PRESET=read-only` (which forces it off), then on. The `default` entry's value is never inherited, Server Manager profiles take the variable, and the governance file is not a channel.
- With the install off the bootstrap sends reads only: no document upload, no compile, no `Configure`, `ConfigureMapping` or `EnsureUnitTestRoot`. Before, a server started with `IRIS_GOVERNANCE_PRESET=read-only` installed 35 classes, the `/api/executemcp/v2` web application, the `%ALL` namespace and mapping, and `^UnitTestRoot` on connect.
- On a `missing` or `stale` IRIS side, a call that would reach the `/api/executemcp/` custom REST service of that profile is refused before any request is sent, with the new refusal code `IRIS_SIDE_NOT_INSTALLED` (profile, namespace, what was found, the deployed and required versions, which setting turned the install off, and the way out). An `unconfigured` reading only logs one `[WARN]` and the tools go on (the lookup can fail for a reason other than absence; from Story 45.6 a least-privilege account reads `current` against an installed side); a call refuses with the same code (`found: "unconfigured"`) only if the web application then answers the HTTP 404 of an absent application. Tools that use only the Atelier API keep working. `current`, `newer`, `foreign`, `unknown` and IPM-owned installs behave as before (nothing written, tools go on; `newer`, `foreign`, `unknown` and IPM-owned installs log their one warning as today).
- `iris_execute_tests` and `iris_test_coverage` now refuse on a profile whose IRIS side is not installed while the install is off. Before, a 404 on their guard read let them run unguarded.
- `IRIS_AUTO_INSTALL=true`, or a profile's `autoInstall: true`, together with `IRIS_GOVERNANCE_PRESET=read-only` fails startup, naming both settings. A malformed `IRIS_AUTO_INSTALL` or a non-boolean `autoInstall` fails startup naming it.
- `iris_server_profiles` gains `autoInstall` and `autoInstallSource` on each roster entry (additive).
- Upgrade note: after every upgrade of the servers (each release stamps its version into the IRIS-side classes, so the deployed ones then read as older; 1.3.0 also changes the classes), an instance that only read-only servers, or servers with the automatic install off, connect to refuses its custom-REST tools with `IRIS_SIDE_NOT_INSTALLED` until an operator upgrades the IRIS side once: one start with the automatic install on, or `zpm`. Upgrading is a deliberate admin step.
- With `IRIS_AUTO_INSTALL`, `autoInstall` and the read-only preset all unset, the startup requests and the bootstrap result are byte-identical. No `.cls` changed, so `BOOTSTRAP_VERSION` is unchanged.

No tool, action, input field, governance key or visibility is added or changed.
