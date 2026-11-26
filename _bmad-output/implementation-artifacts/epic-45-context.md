# Epic 45 Context: Security Boundaries

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the safety settings mean what the documentation says, and make the documentation say where the real boundary is. This responds to an external user's security report (GitHub issue #1). SQL sent through the suite honors SQL privileges. A read-only connection never installs anything on IRIS, and any operator can turn the automatic install off. The IRIS side can be removed cleanly without touching shared pieces it did not create. The `block` data policy also turns off the raw-read and code-execution tools. The README and `SECURITY.md` state the trust model: the suite's controls guard the agent, and the IRIS account's privileges are the boundary. Two burn-down stories then close the epic's deferred-work ledger. One release, `1.3.0` (minor), ships at epic end.

## Stories

- Story 45.1: SQL Statements Honor SQL Privileges
- Story 45.2: Auto-Install Setting, Off Under Read-Only
- Story 45.3: Careful Uninstall of the IRIS Side
- Story 45.4: Block Turns Off Raw-Read and Code-Execution Tools
- Story 45.5: What the Safety Settings Protect
- Story 45.6: Epic 45 Burn-down, IRIS Side
- Story 45.7: Epic 45 Burn-down, TypeScript and Docs

## Requirements & Constraints

- **SQL privileges:** the custom SQL route prepares with privilege checking on, and nothing turns it off (no parameter, request field or variable). A privilege failure surfaces IRIS's SQLCODE and message through `SanitizeError`. Prepare runs before every refusal check, so an account without a grant gets the privilege error instead of `SQL_READ_ONLY`, the `countOnly` refusal or the cap refusals. IRIS's own Atelier `action/query` still prepares with checking off. That is out of scope and is documented.
- **Automatic install:** `IRIS_AUTO_INSTALL` (true/false, case-insensitive) and a per-profile `autoInstall` field. The field is never inherited from the `default` entry, and the governance file is not a channel for it. It defaults to on, except that `IRIS_GOVERNANCE_PRESET=read-only` forces it off. An explicit "on" together with the read-only preset fails startup, naming both settings and the profile, and a malformed value also fails startup. With the install off, the server only reads: no upload, no compile, no `Configure`/`ConfigureMapping`/`EnsureUnitTestRoot`. On `missing`/`stale`/`unconfigured`, custom-REST calls get a stable not-installed refusal that names the way out, and Atelier-only tools keep working. IPM-owned installs behave as before.
- **Uninstall:** the documented one-liner `Do ##class(ExecuteMCPv2.Setup).Uninstall()` (it needs `%Admin_Manage`, and it is never an SQL procedure, a tool or a CLI). It removes the web app, the `%ALL` mapping and the classes, shadowed copies included. It removes `%ALL` only when the install record says the install created it and nothing else is mapped there, and `^UnitTestRoot` only when the record says the install set it and the value is unchanged. With no record (an install by 1.2.0 or earlier), it leaves both and prints the manual commands. It reports what it removed and what it left, with reasons, and it is idempotent.
- **`block` data policy:** 12 covered keys, declared once as `DATA_POLICY_BLOCK_KEYS` in `@iris-mcp/shared`: `iris_sql_query`, `iris_sql_execute`, `iris_global_get`, `iris_global_list`, `iris_execute_command`, `iris_execute_classmethod`, `iris_execute_tests`, `iris_test_coverage`, `iris_transform_test`, `iris_docdb_document:get`, `iris_docdb_document:delete` and `iris_docdb_find`. Under `block` they seed disabled, and an explicit governance `true` re-enables one. `redact` and `allow` are unchanged. Each server writes at most one startup `[WARN]` line naming the covered tools that are enabled and callable under `redact`/`block`, and it never names hidden keys or logs values.
- **No new tool and no new governance key.** Tool counts, presets and `GOVERNANCE_BASELINE` (`1e62c5ad5bf7`/141, verified with `:check` only) stay unchanged. The pinned `SqlProc` set on `Setup` stays exactly five.
- **Back-compat:** with no new setting used and the policy not `block`, every request and response is byte-identical, apart from the new warning line and the 45.1 privilege refusal. The sanctioned changes are `S-45.1-sql-privileges`, `S-45.2-read-only-no-install`, `S-45.3-careful-uninstall` and `S-45.4-block-raw-tools`, each named in `CHANGELOG.md` and a changeset. Golden byte changes go through `fixtures/sdk-golden-sanctioned-changes.json`, and frozen goldens are never recaptured.
- **Proof:** probe claims first (the local `irislib/`/`irissys/` snapshot, then a throwaway). Each gate is proven red on the path it guards. Endpoint stories drive the live route, with one destructive-path refusal. Uninstalls, user, role or grant changes and `%ALL` changes run only on a throwaway (`scripts/throwaway-iris.mjs`), never on the shared instance.
- **Burn-down (45.6, 45.7):** every ledger entry ends resolved, closed with evidence or closed by decision; re-deferral is not allowed. Tallies are counted mechanically. The lead smoke includes a least-privilege leg. DW-719, DW-720 and DW-722 are owner items and out of scope.

## Technical Decisions

- **Governance cascade:** the data-policy seed sits above the preset seed and below every explicit layer: `env.profile ?? env.global ?? file.profile ?? file.global ?? inheritedDisable ?? dataPolicySeed ?? presetSeed ?? defaultSeed`. A seeded disable is not inherited, so `iris_sql_query` carries its own entry. A denial is `GOVERNANCE_DISABLED` with `configSource: "dataPolicy"`, `dataPolicyApplied: "block"` and the suffix ` (data policy 'block')`, never `presetApplied`. The audit entry copies the field. `iris_server_profiles`, the governance resource and the CLI `effective`/`universe` renders all use the same engine. Visibility is never a safety control.
- **Gateway refusal:** the not-installed refusal lives in the one gateway, keyed on the `/api/executemcp/v2` prefix per profile. No tool carries a per-tool flag.
- **`iris_server_profiles`** reports each profile's effective `autoInstall` and its source as additive fields.
- **Install record:** the global `^ExecuteMCPv2.InstallRecord`, kept in each namespace where an install step ran (the `%ALL` package mapping does not map it, so it survives class deletion). It is written only after the step it describes succeeds, and "we created it" is never overwritten. `%ALL` is inspected through the `Config.MapPackages`/`MapGlobals`/`MapRoutines` `:List` queries. `Config.Namespaces.Delete("%ALL")` deletes all of `%ALL`'s mappings and never refuses, so guard before calling it. `Setup` can delete its own package via `$System.OBJ.DeletePackage` and keep running to the end.
- **Bootstrap discipline:** a change to a bootstrapped class (`REST/Sql.cls`, `Setup.cls`) regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to (it was `1.2.0+5.6cbac260e73f` at the wave start). A new class joins both rosters. The IPM tree moves only at the release version step.
- **Trust model:** governance, presets, confirmations, the audit log, the data policy and the SQL safety settings run in the MCP process. The audit log records MCP tool calls only. With checking on, a SELECT that calls a `SqlProc` needs `EXECUTE`. `%Development` (which the web app requires) runs ObjectScript, so database resources bound the data. Getting past a control through the suite's tools is a vulnerability; using the account directly is not.
- **Burn-down rulings:** DW-786 makes `Configure`/`ConfigureMapping` refuse inside a transaction (`$TLEVEL>0`). DW-770 has an install-off profile treat a hash-equal marker as current.

## Cross-Story Dependencies

- Stories run in order 45.1 → 45.7. 45.2 precedes 45.3, because the uninstall docs rely on `IRIS_AUTO_INSTALL=false` to keep a removed instance removed. 45.4 is independent of 45.1 to 45.3. 45.6 precedes 45.7, because DW-773's outcome shapes what 45.7 documents.
- 45.1 and 45.3 move `BOOTSTRAP_VERSION`. After the upgrade, every read-only-only deployment finds a `stale` IRIS side and refuses custom-REST calls until one normal start or an IPM install (DW-770 in 45.7 narrows this).
- 45.5 enriches the earlier stories' minimal docs. It repoints the 45.4 `[WARN]` line to "What the safety settings protect". It assembles the epic-done capstone `packages/iris-mcp-all/src/__tests__/epic45-capstone-gate.test.ts`, which runs in the default suite with each point proven red, plus one armed CI run of the wave-branch tip on a throwaway. The doc-rot guard derives the README's covered-tool list from `DATA_POLICY_BLOCK_KEYS`.
- The burn-down stories update the 45.5 README section wherever behavior moves (DW-786 residual, DW-773 least-privilege text, DW-784 residual table).
