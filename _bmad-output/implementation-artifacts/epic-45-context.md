# Epic 45 Context: Security Boundaries

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the suite's safety settings mean what the docs say, and make the docs say where the real boundary is. This answers an external security report (GitHub issue #1, four points). After the epic: SQL sent through the suite honors SQL grants. A read-only connection never installs anything on IRIS, and any operator can turn the automatic install off. The IRIS side can be removed cleanly without breaking shared pieces. `block` also turns off the raw-read and code-execution tools. The README and `SECURITY.md` say plainly that governance guards the agent and that the IRIS account's privileges are the boundary. Everything ships in one minor release, `1.3.0`, at the end of the epic.

## Stories

- Story 45.1: SQL Statements Honor SQL Privileges (done)
- Story 45.2: Auto-Install Setting, Off Under Read-Only
- Story 45.3: Careful Uninstall of the IRIS Side
- Story 45.4: Block Turns Off Raw-Read and Code-Execution Tools
- Story 45.5: What the Safety Settings Protect

## Requirements & Constraints

- **No new tool, action or governance key.** Tool counts, presets and the frozen `GOVERNANCE_BASELINE` stay unchanged (check it with `:check` only). A story that needs a new key or tool stops and amends the epic first.
- **Sanctioned behavior changes** (each named in `CHANGELOG.md` and a changeset by its story):
  - `S-45.1-sql-privileges`
  - `S-45.2-read-only-no-install`
  - `S-45.3-careful-uninstall`
  - `S-45.4-block-raw-tools`

  Everything else must be byte-identical when the new settings are unused and the policy is not `block`. The only exceptions are the 45.4 warning line and the 45.1 privilege refusal. Each story pins this with an assertion that fails on drift.
- **Probe before building.** Every claim marked "probe" is unverified. Check it in `irislib/`/`irissys/`, then on a throwaway, and amend the epic text in place if it is wrong.
- **Shared IRIS instance.** Never stop it. Never run an uninstall on it, change a user, role or SQL grant there, or touch `%ALL` there. Those proofs run on a throwaway (`scripts/throwaway-iris.mjs`). Writes to the shared instance go only to disposable `ExecuteMCPv2.Temp.*` classes.
- **Live proof.** Endpoint-backed stories drive the live route and include one destructive-path refusal. Every gate is proven red on the path it guards, and the story names that path.
- **Minimal docs in each story:** the variable's row, a one-line capability statement and its default state. 45.5 enriches these docs and never writes them first.
- **No story publishes.** The Planner raises the bump to minor at release and merges the wave to `main` when the epic is done.
- **Out of scope:**
  - stopping a SELECT from calling a `SqlProc` method under read-only (45.5 documents it);
  - filtering SQL or global reads under `redact`;
  - enforcing governance inside IRIS;
  - changing Atelier's own `action/query` privilege mode;
  - a launcher setting for `IRIS_AUTO_INSTALL`;
  - DW-538, DW-719, DW-720 and DW-722.

## Technical Decisions

- **SQL privileges (45.1, as built).**
  - `REST/Sql.cls` prepares with `checkPriv` 1. Nothing turns it off: no parameter, request field or variable.
  - An ungranted statement fails at prepare with `SQLCODE -99` in the existing error envelope, through `SanitizeError`. Prepare runs before classification and before every refusal check. So an ungranted account now gets the privilege error instead of `SQL_READ_ONLY`, `countOnly` or a cap refusal. Nothing runs in any case.
  - With checking on, a SELECT that calls a `SqlProc` needs `EXECUTE` on it.
  - Atelier `action/query` prepares with checking off (`%Api.Atelier.v1:691`, `v6:236`).
  - The minimum SQL account is `%Development:U` plus the namespace's database resource. This is proven only for a single-database layout (DW-766, which 45.5 must close).
- **Automatic install (45.2).**
  - `IRIS_AUTO_INSTALL` takes `true` or `false`, case-insensitive. Empty means unset, and a malformed value fails startup naming its channel.
  - It can also be set per profile with the `IRIS_PROFILES` field `autoInstall`. That field is never inherited from `default`. An omitted value falls to the variable, then to the default. Server Manager profiles take the variable. The governance file is not a channel.
  - The default is on. `IRIS_GOVERNANCE_PRESET=read-only` forces it off. An explicit "on" under that preset fails startup, naming both settings and the profile.
  - When the install is off, bootstrap only reads. It never uploads, compiles, runs `Configure`, `ConfigureMapping` or `EnsureUnitTestRoot`, or repairs anything.
  - On a `current` IRIS side the compile check still runs.
  - On `missing`, `stale` and `unconfigured`, the one gateway (`IrisHttpClient`) refuses every call to the `/api/executemcp/v2` prefix, per profile. The refusal uses a new stable code that names the way out. Atelier-only tools keep working.
  - `newer`, `foreign`, `unknown` and IPM-owned installs (`InstallGuard` present) behave as today: one warning, and nothing is written.
  - `iris_server_profiles` gains the effective `autoInstall` and its source, as additive fields.
  - Bootstrap stays ungoverned. The preset reaches it only through this setting.
- **Install record and uninstall (45.3).**
  - The `Setup` methods record what the install created: the `%ALL` namespace, the `ExecuteMCPv2` mapping and its database, `^UnitTestRoot` and its value, and the namespaces deployed to. The bootstrap and IPM paths record alike.
  - Each item is written only after its step succeeds. A repeated install never overwrites "we created it".
  - The record's home is a probe outcome. It must survive deleting the classes, and it is never a new system-level write.
  - The uninstall removes, in this order:
    1. the web application;
    2. the mapping;
    3. the classes, shadowed copies included;
    4. `%ALL`, only if the record says the install created it and nothing else is mapped in it;
    5. `^UnitTestRoot`, only if the record says the install set it and its value is unchanged;
    6. the record itself.
  - The uninstall is idempotent. It reports what it removed, and what it left with the reason.
  - With no record (an install by `1.2.0` or earlier), it leaves `%ALL` and `^UnitTestRoot` and reports them with the manual commands.
  - When IPM owns the install, it removes the configuration only and points to `zpm uninstall`.
  - How the package removes itself, and whether the uninstall is offered as a one-liner, a CLI command or a tool, are probe outcomes. A tool would need an epic amendment.
- **`block` data-policy seed (45.4).**
  - This is a new seed layer in the governance cascade: `env.profile ?? env.global ?? file.profile ?? file.global ?? inheritedDisable ?? dataPolicySeed ?? presetSeed ?? defaultSeed`.
  - It sits above the preset, so `block` also turns off `iris_sql_query`. An explicit `true` re-enables a key.
  - A seeded disable is never inherited by child keys.
  - Denials keep `GOVERNANCE_DISABLED` with an additive attribution, and `configSource` reports `"dataPolicy"`.
  - The mechanism is governance, never visibility.
  - The covered set is declared once:
    - Floor: `iris_sql_query`, `iris_sql_execute`, `iris_global_get`, `iris_global_list`, `iris_execute_command`, `iris_execute_classmethod`.
    - Recommended at the spec gate: `iris_execute_tests`, `iris_test_coverage`, `iris_transform_test`, and the docdb raw reads.
  - A test in `iris-mcp-all` checks the set mechanically against the PHI scope table, the README and `tool_support.md`.
  - At startup each server writes at most one `[WARN]` line, naming per `redact` or `block` profile the covered tools that are visible and enabled. It never names hidden tools and never logs values.
- **Trust model (45.5).** Governance, presets, confirmations, the audit log and the data policy guard the agent in the MCP process. The account's privileges are the boundary: database resources bound a `%Development` account, and SQL grants bound the suite's SQL tools. The audit log covers MCP calls only. In `SECURITY.md` the scope becomes: getting past a control through the servers' tools is in scope, and using the account directly is not. No email address is added.
- **Bootstrap discipline.** A change to `REST/Sql.cls` (45.1) or `Setup.cls` (45.3) regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to. A new class joins both rosters. The IPM tree is regenerated only at the release version step.

## Cross-Story Dependencies

- **45.2 before 45.3.** The uninstall docs rely on `IRIS_AUTO_INSTALL=false` to keep a removed instance removed. 45.3 owns the install record, and 45.2 needs no record.
- **Upgrade note.** 45.1 and 45.3 move `BOOTSTRAP_VERSION`, so every read-only-only deployment finds a `stale` IRIS side on its first `1.3.0` start, and its custom-REST tools refuse until one upgrade. The owner accepted this. The README, the refusal message, the CHANGELOG and the release notes must say so.
- **45.4 is independent** of 45.1 to 45.3.
- **45.5 depends on all four:**
  - it uses 45.1's probe results;
  - its doc-rot guard derives from 45.4's declaration;
  - it points to 45.2 and 45.3;
  - it assembles the capstone `packages/iris-mcp-all/src/__tests__/epic45-capstone-gate.test.ts`, in the default suite, covering the four points. Each point is proven red by reverting its story's guard.
- **The epic is done when** the default suite is green and one armed throwaway CI run of the wave tip (45.1's refusal and 45.3's round trip) is green, with its URL recorded.
